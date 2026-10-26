//! Выполняет шаги по одному с паузой между запросами и сообщает окну о ходе.
//! Останавливается после трёх неудач подряд, при 401/403 и по кнопке «Остановить».

use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::Serialize;

use crate::journal::Journal;
use crate::plan::{self, Step};
use crate::steam::{SleepFn, SteamClient, SteamError};
use crate::token::Token;

pub const MAX_FAILURES_IN_ROW: u32 = 3;
/// Сколько раз на одном шаге ждать по 429, прежде чем считать шаг неудачным.
pub const MAX_RATE_WAITS: u32 = 3;
pub const MAX_WAIT_SECS: u64 = 60;

/// Запросы, которые меняют инвентарь. В тестах их подменяет поддельный Steam.
pub trait StackApi {
    fn split(&self, assetid: &str) -> impl Future<Output = Result<(), SteamError>> + Send;
    fn combine(
        &self,
        from: &str,
        dest: &str,
        quantity: u32,
    ) -> impl Future<Output = Result<(), SteamError>> + Send;
}

pub struct SteamStacker {
    pub client: SteamClient,
    pub token: Token,
}

impl StackApi for SteamStacker {
    async fn split(&self, assetid: &str) -> Result<(), SteamError> {
        self.client.split(&self.token, assetid, 1).await
    }

    async fn combine(&self, from: &str, dest: &str, quantity: u32) -> Result<(), SteamError> {
        self.client.combine(&self.token, from, dest, quantity).await
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Progress {
    /// Перед каждым запросом и один раз в конце (`key` пустой).
    Request {
        done: u32,
        total: u32,
        errors: u32,
        key: String,
    },
    /// Steam ответил 429: ждём столько секунд.
    Waiting { seconds: u64 },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StopReason {
    Finished,
    StoppedByUser,
    TokenRejected,
    TooManyFailures,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunOutcome {
    pub reason: StopReason,
    pub done: u32,
    pub errors: u32,
    pub total: u32,
}

pub struct RunConfig {
    pub delay: Duration,
}

enum Failure {
    Steam(SteamError),
    Invalid(&'static str),
    Stopped,
}

pub async fn run<A: StackApi>(
    api: &A,
    steps: &[Step],
    config: &RunConfig,
    stop: &AtomicBool,
    sleep: &SleepFn,
    journal: &Journal,
    mut emit: impl FnMut(Progress),
) -> RunOutcome {
    let total = steps.len() as u32;
    let mut outcome = RunOutcome {
        reason: StopReason::Finished,
        done: 0,
        errors: 0,
        total,
    };
    let mut in_row = 0;
    for (i, step) in steps.iter().enumerate() {
        // Пауза только между запросами и не после нажатия «Остановить».
        if i > 0 && !stop.load(Ordering::SeqCst) {
            sleep(config.delay).await;
        }
        if stop.load(Ordering::SeqCst) {
            journal.add("stopped by the user");
            outcome.reason = StopReason::StoppedByUser;
            break;
        }
        emit(Progress::Request {
            done: outcome.done,
            total,
            errors: outcome.errors,
            key: step.key().to_string(),
        });
        match send(api, step, stop, sleep, journal, &mut emit).await {
            Ok(()) => {
                outcome.done += 1;
                in_row = 0;
            }
            Err(Failure::Stopped) => {
                journal.add("stopped by the user while waiting");
                outcome.reason = StopReason::StoppedByUser;
                break;
            }
            Err(Failure::Steam(SteamError::Auth(status))) => {
                journal.add(format!(
                    "Steam rejected the token (HTTP {status}), stopping"
                ));
                outcome.reason = StopReason::TokenRejected;
                break;
            }
            Err(failure) => {
                outcome.errors += 1;
                in_row += 1;
                journal.add(format!(
                    "{} «{}» failed: {}",
                    action(step),
                    step.key(),
                    describe(&failure)
                ));
                if in_row >= MAX_FAILURES_IN_ROW {
                    journal.add("three failures in a row, stopping");
                    outcome.reason = StopReason::TooManyFailures;
                    break;
                }
            }
        }
    }
    emit(Progress::Request {
        done: outcome.done,
        total,
        errors: outcome.errors,
        key: String::new(),
    });
    outcome
}

/// Один шаг. При 429 ждёт и повторяет тот же запрос, проверяя «Остановить» каждую секунду.
async fn send<A: StackApi>(
    api: &A,
    step: &Step,
    stop: &AtomicBool,
    sleep: &SleepFn,
    journal: &Journal,
    emit: &mut impl FnMut(Progress),
) -> Result<(), Failure> {
    plan::validate(step).map_err(Failure::Invalid)?;
    let mut waits = 0;
    loop {
        let result = match step {
            Step::Split { assetid, .. } => api.split(assetid).await,
            Step::Combine {
                from,
                dest,
                quantity,
                ..
            } => api.combine(&from.assetid, &dest.assetid, *quantity).await,
        };
        match result {
            Err(SteamError::RateLimited { retry_after }) if waits < MAX_RATE_WAITS => {
                waits += 1;
                let seconds = retry_after
                    .unwrap_or(10 * u64::from(waits))
                    .min(MAX_WAIT_SECS);
                journal.add(format!("Steam asked to slow down, waiting {seconds} s"));
                emit(Progress::Waiting { seconds });
                // «Остановить» проверяем до первой секунды и после каждой: нажатие на последней
                // секунде (или при ожидании в 0 с) не должно привести к повторному запросу.
                if stop.load(Ordering::SeqCst) {
                    return Err(Failure::Stopped);
                }
                for _ in 0..seconds {
                    sleep(Duration::from_secs(1)).await;
                    if stop.load(Ordering::SeqCst) {
                        return Err(Failure::Stopped);
                    }
                }
            }
            other => return other.map_err(Failure::Steam),
        }
    }
}

fn action(step: &Step) -> &'static str {
    match step {
        Step::Split { .. } => "split",
        Step::Combine { .. } => "combine",
    }
}

fn describe(failure: &Failure) -> String {
    match failure {
        Failure::Steam(e) => e.to_string(),
        Failure::Invalid(why) => format!("invalid step, not sent: {why}"),
        Failure::Stopped => "stopped".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::inventory::Record;
    use crate::steam::recording_sleep;
    use crate::token::test_token;
    use std::collections::VecDeque;
    use std::sync::{Arc, Mutex};
    use wiremock::matchers::method;
    use wiremock::{Mock, MockServer, ResponseTemplate};

    /// Поддельный Steam: отвечает по списку, после списка — успехом.
    #[derive(Default)]
    struct FakeApi {
        replies: Mutex<VecDeque<Result<(), SteamError>>>,
        calls: Mutex<Vec<String>>,
        /// Нажать «Остановить» во время первого запроса.
        stop_on_call: Option<Arc<AtomicBool>>,
    }

    impl FakeApi {
        fn new(replies: Vec<Result<(), SteamError>>) -> Self {
            Self {
                replies: Mutex::new(replies.into()),
                ..Self::default()
            }
        }

        fn reply(&self, call: String) -> Result<(), SteamError> {
            self.calls.lock().unwrap().push(call);
            if let Some(stop) = &self.stop_on_call {
                stop.store(true, Ordering::SeqCst);
            }
            self.replies.lock().unwrap().pop_front().unwrap_or(Ok(()))
        }

        fn calls(&self) -> Vec<String> {
            self.calls.lock().unwrap().clone()
        }
    }

    impl StackApi for FakeApi {
        async fn split(&self, assetid: &str) -> Result<(), SteamError> {
            self.reply(format!("split {assetid}"))
        }

        async fn combine(&self, from: &str, dest: &str, quantity: u32) -> Result<(), SteamError> {
            self.reply(format!("combine {from}->{dest} x{quantity}"))
        }
    }

    fn splits(n: usize) -> Vec<Step> {
        (0..n)
            .map(|i| Step::Split {
                key: format!("Skin {i}"),
                assetid: format!("{}", 1000 + i),
            })
            .collect()
    }

    fn record(assetid: &str, amount: u32) -> Record {
        Record {
            assetid: assetid.into(),
            classid: "c1".into(),
            instanceid: "0".into(),
            amount,
            tradable: true,
            marketable: true,
            available_after: None,
        }
    }

    struct Run {
        outcome: RunOutcome,
        events: Vec<Progress>,
        slept: Vec<Duration>,
        journal: Journal,
    }

    async fn go<A: StackApi>(api: &A, steps: &[Step], stop: &AtomicBool) -> Run {
        let (sleep, slept) = recording_sleep();
        go_with(api, steps, stop, &sleep, &slept).await
    }

    /// То же, что `go`, но с чужой подменой паузы; `slept` — её журнал длительностей.
    async fn go_with<A: StackApi>(
        api: &A,
        steps: &[Step],
        stop: &AtomicBool,
        sleep: &SleepFn,
        slept: &Mutex<Vec<Duration>>,
    ) -> Run {
        let journal = Journal::default();
        let mut events = Vec::new();
        let config = RunConfig {
            delay: Duration::from_millis(1500),
        };
        let outcome = run(api, steps, &config, stop, sleep, &journal, |p| {
            events.push(p)
        })
        .await;
        let slept = slept.lock().unwrap().clone();
        Run {
            outcome,
            events,
            slept,
            journal,
        }
    }

    /// Пауза для тестов: записывает длительность и нажимает «Остановить» на `stop_at`-й паузе.
    fn stopping_sleep(
        stop: &Arc<AtomicBool>,
        stop_at: usize,
    ) -> (SleepFn, Arc<Mutex<Vec<Duration>>>) {
        let slept = Arc::new(Mutex::new(Vec::new()));
        let log = slept.clone();
        let stop = stop.clone();
        let sleep: SleepFn = Arc::new(move |d| {
            let count = {
                let mut log = log.lock().unwrap();
                log.push(d);
                log.len()
            };
            if count == stop_at {
                stop.store(true, Ordering::SeqCst);
            }
            Box::pin(async {})
        });
        (sleep, slept)
    }

    fn limited(retry_after: u64) -> Vec<Result<(), SteamError>> {
        vec![Err(SteamError::RateLimited {
            retry_after: Some(retry_after),
        })]
    }

    fn waits(events: &[Progress]) -> Vec<u64> {
        events
            .iter()
            .filter_map(|e| match e {
                Progress::Waiting { seconds } => Some(*seconds),
                Progress::Request { .. } => None,
            })
            .collect()
    }

    #[tokio::test]
    async fn runs_all_steps_with_a_pause_between_requests() {
        let api = FakeApi::new(vec![]);
        let r = go(&api, &splits(3), &AtomicBool::new(false)).await;
        assert_eq!(
            r.outcome,
            RunOutcome {
                reason: StopReason::Finished,
                done: 3,
                errors: 0,
                total: 3
            }
        );
        assert_eq!(api.calls(), vec!["split 1000", "split 1001", "split 1002"]);
        assert_eq!(r.slept, vec![Duration::from_millis(1500); 2]);
        assert_eq!(
            r.events.first(),
            Some(&Progress::Request {
                done: 0,
                total: 3,
                errors: 0,
                key: "Skin 0".into()
            })
        );
        assert_eq!(
            r.events.last(),
            Some(&Progress::Request {
                done: 3,
                total: 3,
                errors: 0,
                key: String::new()
            })
        );
    }

    #[tokio::test]
    async fn auth_error_stops_at_once() {
        let api = FakeApi::new(vec![Ok(()), Err(SteamError::Auth(401))]);
        let r = go(&api, &splits(4), &AtomicBool::new(false)).await;
        assert_eq!(r.outcome.reason, StopReason::TokenRejected);
        assert_eq!(r.outcome.done, 1);
        assert_eq!(api.calls().len(), 2);
    }

    #[tokio::test]
    async fn three_failures_in_a_row_stop_the_run() {
        let fail = || Err(SteamError::Http(500));
        let api = FakeApi::new(vec![fail(), Ok(()), fail(), fail(), fail()]);
        let r = go(&api, &splits(6), &AtomicBool::new(false)).await;
        assert_eq!(
            r.outcome,
            RunOutcome {
                reason: StopReason::TooManyFailures,
                done: 1,
                errors: 4,
                total: 6
            }
        );
        assert_eq!(api.calls().len(), 5);
        assert!(r.journal.text().contains("three failures in a row"));
    }

    #[tokio::test]
    async fn network_failure_is_counted_once_and_not_retried() {
        let api = FakeApi::new(vec![Err(SteamError::Network("connection failed")), Ok(())]);
        let r = go(&api, &splits(2), &AtomicBool::new(false)).await;
        assert_eq!(api.calls(), vec!["split 1000", "split 1001"]);
        assert_eq!(
            r.outcome,
            RunOutcome {
                reason: StopReason::Finished,
                done: 1,
                errors: 1,
                total: 2
            }
        );
        assert!(r.journal.text().contains("network error"));
    }

    #[tokio::test]
    async fn scattered_failures_do_not_stop_the_run() {
        let fail = || Err(SteamError::Http(500));
        let api = FakeApi::new(vec![fail(), Ok(()), fail(), Ok(())]);
        let r = go(&api, &splits(4), &AtomicBool::new(false)).await;
        assert_eq!(
            r.outcome,
            RunOutcome {
                reason: StopReason::Finished,
                done: 2,
                errors: 2,
                total: 4
            }
        );
    }

    #[tokio::test]
    async fn rate_limit_waits_and_retries_the_same_step() {
        let api = FakeApi::new(vec![
            Err(SteamError::RateLimited {
                retry_after: Some(3),
            }),
            Ok(()),
        ]);
        let r = go(&api, &splits(1), &AtomicBool::new(false)).await;
        assert_eq!(
            r.outcome,
            RunOutcome {
                reason: StopReason::Finished,
                done: 1,
                errors: 0,
                total: 1
            }
        );
        assert_eq!(api.calls(), vec!["split 1000", "split 1000"]);
        assert_eq!(waits(&r.events), vec![3]);
        assert_eq!(r.slept, vec![Duration::from_secs(1); 3]);
    }

    #[tokio::test]
    async fn rate_limit_without_header_waits_10_20_30_then_fails() {
        let limited = || Err(SteamError::RateLimited { retry_after: None });
        let api = FakeApi::new(vec![limited(), limited(), limited(), limited()]);
        let r = go(&api, &splits(1), &AtomicBool::new(false)).await;
        assert_eq!(waits(&r.events), vec![10, 20, 30]);
        assert_eq!(
            r.outcome,
            RunOutcome {
                reason: StopReason::Finished,
                done: 0,
                errors: 1,
                total: 1
            }
        );
        assert_eq!(api.calls().len(), 4);
    }

    #[tokio::test]
    async fn rate_limit_wait_is_capped_at_60_seconds() {
        let api = FakeApi::new(vec![
            Err(SteamError::RateLimited {
                retry_after: Some(600),
            }),
            Ok(()),
        ]);
        let r = go(&api, &splits(1), &AtomicBool::new(false)).await;
        assert_eq!(waits(&r.events), vec![60]);
    }

    #[tokio::test]
    async fn stop_before_start_sends_nothing() {
        let api = FakeApi::new(vec![]);
        let r = go(&api, &splits(3), &AtomicBool::new(true)).await;
        assert_eq!(r.outcome.reason, StopReason::StoppedByUser);
        assert!(api.calls().is_empty());
    }

    #[tokio::test]
    async fn stop_finishes_the_current_request_and_stops() {
        let stop = Arc::new(AtomicBool::new(false));
        let api = FakeApi {
            stop_on_call: Some(stop.clone()),
            ..FakeApi::default()
        };
        let r = go(&api, &splits(3), &stop).await;
        assert_eq!(
            r.outcome,
            RunOutcome {
                reason: StopReason::StoppedByUser,
                done: 1,
                errors: 0,
                total: 3
            }
        );
        assert_eq!(api.calls().len(), 1);
        assert!(r.slept.is_empty(), "no pause after stop: {:?}", r.slept);
    }

    /// «Остановить» нажали во время паузы между запросами: следующий запрос уходить не должен.
    #[tokio::test]
    async fn stop_during_the_pause_between_requests_sends_no_request() {
        let stop = Arc::new(AtomicBool::new(false));
        let api = FakeApi::new(vec![]);
        let (sleep, slept) = stopping_sleep(&stop, 1);
        let r = go_with(&api, &splits(3), &stop, &sleep, &slept).await;
        assert_eq!(
            r.outcome,
            RunOutcome {
                reason: StopReason::StoppedByUser,
                done: 1,
                errors: 0,
                total: 3
            }
        );
        assert_eq!(api.calls(), vec!["split 1000"]);
        assert_eq!(r.slept, vec![Duration::from_millis(1500)]);
    }

    #[tokio::test]
    async fn stop_during_rate_limit_wait_stops() {
        let stop = Arc::new(AtomicBool::new(false));
        let api = FakeApi {
            replies: Mutex::new(VecDeque::from([Err(SteamError::RateLimited {
                retry_after: Some(30),
            })])),
            stop_on_call: Some(stop.clone()),
            ..FakeApi::default()
        };
        let r = go(&api, &splits(2), &stop).await;
        assert_eq!(r.outcome.reason, StopReason::StoppedByUser);
        assert_eq!(api.calls().len(), 1);
        assert!(r.slept.is_empty(), "no sleeping after stop: {:?}", r.slept);
    }

    /// «Остановить» нажали на второй секунде из тридцати: ждать дальше и слать запрос не надо.
    #[tokio::test]
    async fn stop_during_a_long_rate_limit_wait_stops_within_a_second() {
        let stop = Arc::new(AtomicBool::new(false));
        let api = FakeApi::new(limited(30));
        let (sleep, slept) = stopping_sleep(&stop, 2);
        let r = go_with(&api, &splits(2), &stop, &sleep, &slept).await;
        assert_eq!(
            r.outcome,
            RunOutcome {
                reason: StopReason::StoppedByUser,
                done: 0,
                errors: 0,
                total: 2
            }
        );
        assert_eq!(r.slept, vec![Duration::from_secs(1); 2]);
        assert_eq!(api.calls().len(), 1);
        assert!(r.journal.text().contains("while waiting"));
    }

    /// «Остановить» нажали на последней секунде ожидания: повторного запроса быть не должно.
    #[tokio::test]
    async fn stop_during_the_last_second_of_a_wait_sends_no_request() {
        let stop = Arc::new(AtomicBool::new(false));
        let api = FakeApi::new(limited(3));
        let (sleep, slept) = stopping_sleep(&stop, 3);
        let r = go_with(&api, &splits(2), &stop, &sleep, &slept).await;
        assert_eq!(
            r.outcome,
            RunOutcome {
                reason: StopReason::StoppedByUser,
                done: 0,
                errors: 0,
                total: 2
            }
        );
        assert_eq!(r.slept, vec![Duration::from_secs(1); 3]);
        assert_eq!(api.calls(), vec!["split 1000"]);
    }

    /// `Retry-After: 0` — ожидания нет, но «Остановить» всё равно проверяется до повтора.
    #[tokio::test]
    async fn stop_with_a_zero_second_wait_sends_no_request() {
        let stop = Arc::new(AtomicBool::new(false));
        let api = FakeApi {
            replies: Mutex::new(limited(0).into()),
            stop_on_call: Some(stop.clone()),
            ..FakeApi::default()
        };
        let r = go(&api, &splits(2), &stop).await;
        assert_eq!(r.outcome.reason, StopReason::StoppedByUser);
        assert_eq!(waits(&r.events), vec![0]);
        assert_eq!(api.calls(), vec!["split 1000"]);
        assert!(r.slept.is_empty(), "no sleeping after stop: {:?}", r.slept);
    }

    #[tokio::test]
    async fn invalid_combine_is_not_sent() {
        let api = FakeApi::new(vec![]);
        let bad = Step::Combine {
            key: "Skin".into(),
            from: record("1", 2),
            dest: record("1", 2),
            quantity: 2,
        };
        let good = Step::Combine {
            key: "Skin".into(),
            from: record("2", 3),
            dest: record("1", 5),
            quantity: 3,
        };
        let r = go(&api, &[bad, good], &AtomicBool::new(false)).await;
        assert_eq!(api.calls(), vec!["combine 2->1 x3"]);
        assert_eq!(
            r.outcome,
            RunOutcome {
                reason: StopReason::Finished,
                done: 1,
                errors: 1,
                total: 2
            }
        );
        assert!(r.journal.text().contains("invalid step"));
    }

    #[tokio::test]
    async fn journal_never_contains_token_or_steamid() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(500))
            .mount(&server)
            .await;
        let (sleep, _) = recording_sleep();
        let api = SteamStacker {
            client: SteamClient::new(&server.uri(), sleep),
            token: test_token(),
        };
        let r = go(&api, &splits(2), &AtomicBool::new(false)).await;
        assert_eq!(r.outcome.errors, 2);
        let text = r.journal.text();
        assert!(!text.contains("tok-SECRET"), "{text}");
        assert!(!text.contains("76561190000000001"), "{text}");
        assert!(text.contains("HTTP 500"), "{text}");
    }

    #[test]
    fn progress_and_outcome_serialize_for_the_window() {
        let p = Progress::Request {
            done: 1,
            total: 2,
            errors: 0,
            key: "A".into(),
        };
        assert_eq!(
            serde_json::to_string(&p).unwrap(),
            r#"{"kind":"request","done":1,"total":2,"errors":0,"key":"A"}"#
        );
        assert_eq!(
            serde_json::to_string(&Progress::Waiting { seconds: 5 }).unwrap(),
            r#"{"kind":"waiting","seconds":5}"#
        );
        assert_eq!(
            serde_json::to_string(&StopReason::TooManyFailures).unwrap(),
            r#""tooManyFailures""#
        );
    }
}
