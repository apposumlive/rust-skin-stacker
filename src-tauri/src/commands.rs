//! Команды окна. Токен остаётся в ядре: окно получает только `TokenInfo`.
//! Логика — в методах `AppState`, чтобы её можно было проверить без Tauri.

use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::inventory::{self, Inventory, Reconciliation};
use crate::journal::Journal;
use crate::plan::{self, Operation, Plan};
use crate::runner::{self, Progress, RunConfig, RunOutcome, SteamStacker, StopReason};
use crate::settings::{self, Settings};
use crate::steam::{ReadControl, SleepFn, SteamClient, SteamError};
use crate::token::{self, Token, TokenError, TokenInfo};

/// Ход запуска и ожидание по 429 при любом чтении инвентаря: перед запуском, после него и при загрузке.
pub const PROGRESS_EVENT: &str = "run-progress";

/// Ошибка для окна: код, по которому окно берёт текст из i18n.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UiError {
    pub code: &'static str,
    pub status: Option<u16>,
}

impl UiError {
    fn new(code: &'static str) -> Self {
        Self { code, status: None }
    }
}

impl From<TokenError> for UiError {
    fn from(e: TokenError) -> Self {
        UiError::new(match e {
            TokenError::NotFound => "tokenNotFound",
            TokenError::NoExpiry => "tokenNoExpiry",
            TokenError::Expired => "tokenExpired",
            TokenError::SteamIdMismatch => "tokenSteamIdMismatch",
        })
    }
}

impl From<SteamError> for UiError {
    fn from(e: SteamError) -> Self {
        match e {
            SteamError::Auth(status) => UiError {
                code: "tokenRejected",
                status: Some(status),
            },
            SteamError::RateLimited { .. } => UiError::new("rateLimited"),
            SteamError::Http(status) => UiError {
                code: "http",
                status: Some(status),
            },
            SteamError::Rejected(_) => UiError::new("steamRejected"),
            SteamError::Network(_) => UiError::new("network"),
            SteamError::BadResponse => UiError::new("badResponse"),
            SteamError::PagingLoop => UiError::new("pagingLoop"),
            SteamError::TooLarge => UiError::new("tooLarge"),
            SteamError::Stopped => UiError::new("stopped"),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum StartResult {
    /// Инвентарь изменился после предпросмотра: показать новый план, не запускать.
    PlanChanged { plan: Plan, inventory: Inventory },
    /// Операция закончилась. Сверки нет, если инвентарь не удалось перечитать.
    Finished {
        outcome: RunOutcome,
        reconciliation: Option<Reconciliation>,
        inventory: Option<Inventory>,
    },
}

#[derive(Default)]
struct Session {
    token: Option<Token>,
    inventory: Option<Inventory>,
    last_plan: Option<Plan>,
}

impl Session {
    /// В сессии лежит именно этот токен (не забыт и не заменён другим).
    fn holds(&self, token: &Token) -> bool {
        self.token
            .as_ref()
            .is_some_and(|t| t.secret == token.secret)
    }
}

pub struct AppState {
    client: SteamClient,
    sleep: SleepFn,
    session: tokio::sync::Mutex<Session>,
    /// Сигнал «токен забыт или заменён»: обрывает чтение инвентаря, которое уже идёт.
    forgotten: tokio::sync::Notify,
    stop: AtomicBool,
    running: AtomicBool,
    journal: Journal,
    settings: Mutex<Settings>,
    /// Пауза из настроек, мс. Раннер читает её перед каждой паузой.
    delay_ms: AtomicU64,
    settings_path: Option<PathBuf>,
}

pub fn steam_language(lang: &str) -> &'static str {
    if lang == "ru" { "russian" } else { "english" }
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

impl AppState {
    pub fn new(
        client: SteamClient,
        sleep: SleepFn,
        settings: Settings,
        settings_path: Option<PathBuf>,
    ) -> Self {
        let settings = settings.normalized();
        let journal = Journal::default();
        // Первая строка журнала — версия: её просит шаблон issue.
        journal.add(format!(
            "Rust Skin Stacker {} on {}",
            env!("CARGO_PKG_VERSION"),
            std::env::consts::OS
        ));
        Self {
            client,
            sleep,
            session: tokio::sync::Mutex::new(Session::default()),
            forgotten: tokio::sync::Notify::new(),
            stop: AtomicBool::new(false),
            running: AtomicBool::new(false),
            journal,
            delay_ms: AtomicU64::new(u64::from(settings.delay_ms)),
            settings: Mutex::new(settings),
            settings_path,
        }
    }

    pub async fn set_token(&self, raw: &str, now: i64) -> Result<TokenInfo, UiError> {
        if self.running.load(Ordering::SeqCst) {
            return Err(UiError::new("busy"));
        }
        let token = token::parse_token(raw, now)?;
        let info = token.info();
        *self.session.lock().await = Session {
            token: Some(token),
            ..Session::default()
        };
        // Чтение со старым токеном бросаем, как при «Забыть токен».
        self.forgotten.notify_waiters();
        self.journal
            .add(format!("token accepted for {}", info.steamid_masked));
        Ok(info)
    }

    pub async fn forget_token(&self) {
        self.drop_session(&mut *self.session.lock().await);
        self.journal.add("token forgotten");
    }

    /// Окно перезагрузили (F5, «Обновить»): новое окно не знает ни токена, ни запуска,
    /// и «Остановить» в нём нет. Сбрасываем всё, как «Забыть токен», но только если есть что
    /// сбрасывать: при первой загрузке журнал не засоряем.
    pub async fn reset_on_page_load(&self) {
        let mut session = self.session.lock().await;
        let running = self.running.load(Ordering::SeqCst);
        if session.token.is_none() && !running {
            return;
        }
        self.drop_session(&mut session);
        drop(session);
        self.journal.add(if running {
            "page reloaded: token forgotten, run stopped after the current request"
        } else {
            "page reloaded: token forgotten"
        });
    }

    /// Останавливает запуск, очищает сессию и обрывает чтение в пути. Сессия уже под замком.
    fn drop_session(&self, session: &mut Session) {
        self.stop.store(true, Ordering::SeqCst);
        *session = Session::default();
        // Чтение инвентаря в пути бросаем: ни страниц, ни повторов с забытым токеном.
        self.forgotten.notify_waiters();
    }

    async fn token(&self, now: i64) -> Result<Token, UiError> {
        let token = self
            .session
            .lock()
            .await
            .token
            .clone()
            .ok_or(UiError::new("noToken"))?;
        if token.is_expired(now) {
            return Err(UiError::new("tokenExpired"));
        }
        Ok(token)
    }

    /// Читает инвентарь, пока этот токен в сессии. Забыли или заменили — чтение обрывается,
    /// как и по «Остановить». Ожидание по 429 окно видит тем же событием, что и в запуске, а после каждой
    /// страницы — сколько прочитано.
    async fn read_inventory(
        &self,
        token: &Token,
        lang: &str,
        emit: &(dyn Fn(Progress) + Sync),
    ) -> Result<Inventory, UiError> {
        // Подписка раньше проверки: «Забыть» между ними не потеряется.
        let forgotten = self.forgotten.notified();
        if !self.session.lock().await.holds(token) {
            return Err(self.read_dropped());
        }
        let on_wait = |seconds| {
            self.journal.add(format!(
                "inventory read: Steam asked to slow down, waiting {seconds} s"
            ));
            emit(Progress::Waiting { seconds });
        };
        // Принятая страница — только окну: строка журнала на каждую страницу ни к чему.
        let on_page = |read, total| emit(Progress::Reading { read, total });
        let control = ReadControl {
            stop: &self.stop,
            on_wait: &on_wait,
            on_page: &on_page,
        };
        let read = inventory::load(&self.client, token, steam_language(lang), &control);
        let result = tokio::select! {
            biased;
            () = forgotten => return Err(self.read_dropped()),
            result = read => result,
        };
        match result {
            Ok(inv) => {
                self.journal.add(format!(
                    "inventory read: {} skins, {} items",
                    inv.skins.len(),
                    inv.total()
                ));
                Ok(inv)
            }
            Err(SteamError::Stopped) => {
                self.journal.add("inventory read stopped by the user");
                Err(SteamError::Stopped.into())
            }
            Err(e) => {
                self.journal.add(format!("inventory read failed: {e}"));
                Err(e.into())
            }
        }
    }

    fn read_dropped(&self) -> UiError {
        self.journal
            .add("inventory read dropped: the token was forgotten or replaced");
        UiError::new("noToken")
    }

    /// Кладёт инвентарь в сессию, только если в ней всё ещё тот же токен.
    /// Проверка и запись идут под одним замком, поэтому «Забыть» не проскочит между ними.
    async fn store(&self, token: &Token, inv: &Inventory, last_plan: Option<Plan>) -> bool {
        let mut session = self.session.lock().await;
        if !session.holds(token) {
            return false;
        }
        session.inventory = Some(inv.clone());
        session.last_plan = last_plan;
        true
    }

    pub async fn load_inventory(
        &self,
        lang: &str,
        now: i64,
        emit: impl Fn(Progress) + Sync,
    ) -> Result<Inventory, UiError> {
        // «Остановить», нажатая раньше (например, когда прошлое чтение уже кончилось), это чтение не обрывает.
        // Во время запуска флаг его: сбросом потерялась бы просьба остановить запуск.
        if !self.running.load(Ordering::SeqCst) {
            self.stop.store(false, Ordering::SeqCst);
        }
        let token = self.token(now).await?;
        let inv = self.read_inventory(&token, lang, &emit).await?;
        if !self.store(&token, &inv, None).await {
            self.journal
                .add("token forgotten or replaced during the read, nothing stored");
            return Err(UiError::new("noToken"));
        }
        Ok(inv)
    }

    pub async fn preview(&self, operation: Operation) -> Result<Plan, UiError> {
        let mut session = self.session.lock().await;
        let inv = session
            .inventory
            .as_ref()
            .ok_or(UiError::new("noInventory"))?;
        let plan = plan::build(inv, &operation);
        session.last_plan = Some(plan.clone());
        Ok(plan)
    }

    pub async fn start(
        &self,
        operation: Operation,
        lang: &str,
        now: i64,
        emit: impl Fn(Progress) + Sync,
    ) -> Result<StartResult, UiError> {
        if self.running.swap(true, Ordering::SeqCst) {
            return Err(UiError::new("busy"));
        }
        let result = self.run_operation(operation, lang, now, emit).await;
        self.running.store(false, Ordering::SeqCst);
        result
    }

    async fn run_operation(
        &self,
        operation: Operation,
        lang: &str,
        now: i64,
        emit: impl Fn(Progress) + Sync,
    ) -> Result<StartResult, UiError> {
        self.stop.store(false, Ordering::SeqCst);
        let token = self.token(now).await?;
        let previewed = self.session.lock().await.last_plan.clone();

        // Правило 1: перед запуском инвентарь перечитывается. «Остановить» во время этого чтения — ошибка `stopped`:
        // в Steam ничего не ушло, а предпросмотренный план остаётся в сессии.
        let before = self.read_inventory(&token, lang, &emit).await?;
        // Нажатие пришло, когда последняя страница уже прочитана: всё равно ничего не шлём и план в сессии не меняем.
        if self.stop.load(Ordering::SeqCst) {
            self.journal
                .add("stop requested before the run, nothing sent");
            return Err(SteamError::Stopped.into());
        }
        let plan = plan::build(&before, &operation);
        if !self.store(&token, &before, Some(plan.clone())).await {
            self.journal
                .add("token forgotten or replaced during the read, nothing stored");
            return Err(UiError::new("noToken"));
        }
        let unchanged =
            previewed.is_some_and(|p| p.operation == operation && p.steps == plan.steps);
        if !unchanged {
            self.journal
                .add("inventory changed since the preview, showing the new plan");
            return Ok(StartResult::PlanChanged {
                plan,
                inventory: before,
            });
        }

        let config = RunConfig {
            delay_ms: &self.delay_ms,
        };
        self.journal.add(format!(
            "start: {} requests, pause {} ms",
            plan.requests,
            self.delay_ms.load(Ordering::SeqCst)
        ));
        let api = SteamStacker {
            client: self.client.clone(),
            token: token.clone(),
        };
        let outcome = runner::run(
            &api,
            &plan.steps,
            &config,
            &self.stop,
            &self.sleep,
            &self.journal,
            &emit,
        )
        .await;
        // Нажатие «Остановить» во время запуска сработало: дальше флаг — для чтения для сверки, его обрывает только
        // новое нажатие. Сброс сразу, до любого ожидания: окно снова включает «Остановить», получив последнее
        // событие запуска, а оно уже ушло.
        self.stop.store(false, Ordering::SeqCst);
        self.journal.add(format!(
            "finished: {:?}, done {}, errors {}",
            outcome.reason, outcome.done, outcome.errors
        ));

        // «Забыть токен» во время запуска: токен больше не используем, сессию не трогаем.
        if !self.session.lock().await.holds(&token) {
            return Ok(self.check_skipped(outcome));
        }
        // Steam отказал токену: чтение с ним тоже получит 401/403, не шлём его.
        if outcome.reason == StopReason::TokenRejected {
            self.journal.add("the token was rejected, check skipped");
            return Ok(StartResult::Finished {
                outcome,
                reconciliation: None,
                inventory: None,
            });
        }

        // Правило 7: сверка по свежему чтению инвентаря. Остановка запуска её не отменяет; «Остановить» во время
        // этого чтения обрывает его — тогда сверки нет.
        match self.read_inventory(&token, lang, &emit).await {
            Ok(after) => {
                // «Забыть» во время чтения: в сессию ничего не пишем, окну инвентарь не отдаём.
                if !self.store(&token, &after, None).await {
                    return Ok(self.check_skipped(outcome));
                }
                let reconciliation = inventory::reconcile(&before, &after);
                self.journal.add(format!(
                    "check: before {}, after {}, mismatches {}",
                    reconciliation.before,
                    reconciliation.after,
                    reconciliation.mismatches.len()
                ));
                for m in &reconciliation.mismatches {
                    self.journal
                        .add(format!("mismatch «{}»: {} -> {}", m.key, m.before, m.after));
                }
                Ok(StartResult::Finished {
                    outcome,
                    reconciliation: Some(reconciliation),
                    inventory: Some(after),
                })
            }
            Err(_) => Ok(StartResult::Finished {
                outcome,
                reconciliation: None,
                inventory: None,
            }),
        }
    }

    /// Запуск закончен, а токен уже забыт: сверки нет, окну инвентарь не отдаём.
    fn check_skipped(&self, outcome: RunOutcome) -> StartResult {
        self.journal
            .add("token forgotten during the run, check skipped");
        StartResult::Finished {
            outcome,
            reconciliation: None,
            inventory: None,
        }
    }

    pub fn stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
        self.journal.add("stop requested");
    }

    pub fn settings(&self) -> Settings {
        self.settings
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    pub fn save_settings(&self, settings: Settings) -> Result<Settings, UiError> {
        let settings = settings.normalized();
        if let Some(path) = &self.settings_path {
            settings::save(path, &settings).map_err(|_| UiError::new("settingsNotSaved"))?;
        }
        *self.settings.lock().unwrap_or_else(|e| e.into_inner()) = settings.clone();
        // Идущий запуск возьмёт новую паузу со следующей паузы между запросами.
        let delay_ms = u64::from(settings.delay_ms);
        let old = self.delay_ms.swap(delay_ms, Ordering::SeqCst);
        if old != delay_ms && self.running.load(Ordering::SeqCst) {
            self.journal
                .add(format!("pause changed during the run: {delay_ms} ms"));
        }
        Ok(settings)
    }

    pub fn journal_text(&self) -> String {
        self.journal.text()
    }
}

#[tauri::command]
pub async fn set_token(state: State<'_, AppState>, raw: String) -> Result<TokenInfo, UiError> {
    state.set_token(&raw, now()).await
}

#[tauri::command]
pub async fn forget_token(state: State<'_, AppState>) -> Result<(), UiError> {
    state.forget_token().await;
    Ok(())
}

#[tauri::command]
pub async fn load_inventory(
    app: AppHandle,
    state: State<'_, AppState>,
    lang: String,
) -> Result<Inventory, UiError> {
    state
        .load_inventory(&lang, now(), |progress| {
            let _ = app.emit(PROGRESS_EVENT, progress);
        })
        .await
}

#[tauri::command]
pub async fn preview(state: State<'_, AppState>, operation: Operation) -> Result<Plan, UiError> {
    state.preview(operation).await
}

#[tauri::command]
pub async fn start(
    app: AppHandle,
    state: State<'_, AppState>,
    operation: Operation,
    lang: String,
) -> Result<StartResult, UiError> {
    state
        .start(operation, &lang, now(), |progress| {
            let _ = app.emit(PROGRESS_EVENT, progress);
        })
        .await
}

#[tauri::command]
pub fn stop(state: State<'_, AppState>) {
    state.stop();
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Settings {
    state.settings()
}

#[tauri::command]
pub fn save_settings(state: State<'_, AppState>, settings: Settings) -> Result<Settings, UiError> {
    state.save_settings(settings)
}

#[tauri::command]
pub fn journal(state: State<'_, AppState>) -> String {
    state.journal_text()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::{MAX_DELAY_MS, MIN_DELAY_MS};
    use crate::steam::{PAGE_PAUSE, recording_sleep};
    use crate::token::test_token;
    use serde_json::json;
    use std::sync::Arc;
    use std::time::{Duration, Instant};
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    const NOW: i64 = 1_800_000_000;
    const INV: &str = "/IEconService/GetInventoryItemsWithDescriptions/v1/";
    const SPLIT: &str = "/IInventoryService/SplitItemStack/v1/";

    fn inventory_body(amount: u32) -> serde_json::Value {
        json!({"response": {
            "assets": [{"assetid": "1001", "classid": "c1", "instanceid": "0", "amount": amount.to_string()}],
            "descriptions": [{"classid": "c1", "instanceid": "0", "market_hash_name": "Outlaw Revolver",
                              "name": "Outlaw Revolver", "tradable": 1, "marketable": 1}],
            "total_inventory_count": 1
        }})
    }

    fn inventory_reply(amount: u32) -> ResponseTemplate {
        ResponseTemplate::new(200).set_body_json(inventory_body(amount))
    }

    /// Не последняя страница: Steam говорит, что есть ещё, и называет курсор.
    /// Если чтение не оборвали, за ней уйдёт ещё один запрос.
    fn paged_reply(amount: u32) -> ResponseTemplate {
        let mut body = inventory_body(amount);
        body["response"]["more_items"] = json!(true);
        body["response"]["last_assetid"] = json!("1001");
        ResponseTemplate::new(200).set_body_json(body)
    }

    type SleepLog = Arc<Mutex<Vec<Duration>>>;

    /// Состояние на поддельном Steam и журнал пауз, которые просил выполнить код.
    fn state_with(server: &MockServer, settings: Settings) -> (AppState, SleepLog) {
        let (sleep, slept) = recording_sleep();
        let state = AppState::new(
            SteamClient::new(&server.uri(), sleep.clone()),
            sleep,
            settings,
            None,
        );
        (state, slept)
    }

    fn state_for(server: &MockServer) -> AppState {
        state_with(server, Settings::default()).0
    }

    async fn with_token(state: &AppState) {
        state.session.lock().await.token = Some(test_token());
    }

    /// Токен с инвентарём и предпросмотренным планом «разделить всё».
    async fn previewed(server: &MockServer, settings: Settings) -> (AppState, SleepLog) {
        let (state, slept) = state_with(server, settings);
        with_token(&state).await;
        state.load_inventory("en", NOW, |_| {}).await.unwrap();
        state.preview(Operation::SplitAll).await.unwrap();
        (state, slept)
    }

    async fn mount_inventory(server: &MockServer, amount: u32) {
        Mock::given(method("GET"))
            .and(path(INV))
            .respond_with(inventory_reply(amount))
            .mount(server)
            .await;
    }

    fn split_reply() -> ResponseTemplate {
        ResponseTemplate::new(200).set_body_json(json!({"response": {}}))
    }

    async fn requests_to(server: &MockServer, http_method: &str) -> usize {
        let requests = server.received_requests().await.unwrap_or_default();
        requests
            .iter()
            .filter(|r| r.method.as_str() == http_method)
            .count()
    }

    /// Ждёт, пока до поддельного Steam дойдёт нужное число запросов.
    /// Ответ на последний из них ещё может быть в пути: так ловим момент «посреди запроса».
    async fn wait_for_requests(server: &MockServer, http_method: &str, count: usize) {
        let wait = async {
            while requests_to(server, http_method).await < count {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        };
        tokio::time::timeout(Duration::from_secs(10), wait)
            .await
            .expect("the request never reached the fake Steam");
    }

    /// События окну, которые прислало ядро.
    #[derive(Default)]
    struct Events(Mutex<Vec<Progress>>);

    impl Events {
        fn push(&self, progress: Progress) {
            self.0.lock().unwrap().push(progress);
        }

        fn all(&self) -> Vec<Progress> {
            self.0.lock().unwrap().clone()
        }
    }

    /// Нажимает «Остановить», когда до поддельного Steam дошло `count` GET, и возвращает момент нажатия.
    /// Ответ на последний из них ещё в пути.
    async fn stop_at_get(state: &AppState, server: &MockServer, count: usize) -> Instant {
        wait_for_requests(server, "GET", count).await;
        state.stop();
        Instant::now()
    }

    fn assert_within_a_second(pressed: Instant) {
        let took = pressed.elapsed();
        assert!(
            took < Duration::from_secs(1),
            "the read took {took:?} to stop"
        );
    }

    /// Ответ, который задерживается на 5 с: если «Остановить» его не оборвала, тест это заметит по времени.
    fn slow(reply: ResponseTemplate) -> ResponseTemplate {
        reply.set_delay(Duration::from_secs(5))
    }

    fn assert_idle(state: &AppState) {
        assert!(
            !state.running.load(Ordering::SeqCst),
            "the running flag is still set"
        );
    }

    /// Годный токен в виде текста для вставки: заголовок, полезная нагрузка и подпись.
    fn raw_token() -> String {
        use base64::Engine;
        use base64::engine::general_purpose::URL_SAFE_NO_PAD;
        let payload = format!(
            r#"{{"iss":"r:0","sub":"76561190000000001","aud":["web"],"exp":{}}}"#,
            NOW + 3600
        );
        format!(
            "{}.{}.c2ln",
            URL_SAFE_NO_PAD.encode(r#"{"alg":"EdDSA","typ":"JWT"}"#),
            URL_SAFE_NO_PAD.encode(payload)
        )
    }

    #[test]
    fn errors_map_to_codes_for_the_window() {
        assert_eq!(UiError::from(TokenError::Expired).code, "tokenExpired");
        assert_eq!(UiError::from(TokenError::NotFound).code, "tokenNotFound");
        assert_eq!(
            UiError::from(SteamError::Auth(403)),
            UiError {
                code: "tokenRejected",
                status: Some(403)
            }
        );
        assert_eq!(
            UiError::from(SteamError::Network("timeout")).code,
            "network"
        );
        assert_eq!(
            serde_json::to_string(&UiError::from(SteamError::Http(502))).unwrap(),
            r#"{"code":"http","status":502}"#
        );
    }

    #[test]
    fn steam_language_follows_the_window() {
        assert_eq!(steam_language("ru"), "russian");
        assert_eq!(steam_language("en"), "english");
        assert_eq!(steam_language("de"), "english");
    }

    #[tokio::test]
    async fn loading_needs_a_token() {
        let server = MockServer::start().await;
        let err = state_for(&server)
            .load_inventory("en", NOW, |_| {})
            .await
            .unwrap_err();
        assert_eq!(err.code, "noToken");
    }

    #[tokio::test]
    async fn expired_token_is_caught_before_any_request() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(inventory_reply(3))
            .expect(0)
            .mount(&server)
            .await;
        let state = state_for(&server);
        let mut token = test_token();
        token.expires_at = NOW - 1;
        state.session.lock().await.token = Some(token);
        assert_eq!(
            state
                .load_inventory("en", NOW, |_| {})
                .await
                .unwrap_err()
                .code,
            "tokenExpired"
        );
    }

    #[tokio::test]
    async fn set_token_rejects_garbage_and_keeps_nothing() {
        let server = MockServer::start().await;
        let state = state_for(&server);
        assert_eq!(
            state.set_token("hello", NOW).await.unwrap_err().code,
            "tokenNotFound"
        );
        assert!(state.session.lock().await.token.is_none());
    }

    #[tokio::test]
    async fn preview_needs_an_inventory() {
        let server = MockServer::start().await;
        let err = state_for(&server)
            .preview(Operation::SplitAll)
            .await
            .unwrap_err();
        assert_eq!(err.code, "noInventory");
    }

    #[tokio::test]
    async fn previewed_plan_runs_and_is_reconciled() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path(INV))
            .respond_with(inventory_reply(3))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path(SPLIT))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"response": {}})))
            .expect(2)
            .mount(&server)
            .await;
        let state = state_for(&server);
        with_token(&state).await;
        state.load_inventory("en", NOW, |_| {}).await.unwrap();
        assert_eq!(
            state.preview(Operation::SplitAll).await.unwrap().requests,
            2
        );

        let events = Events::default();
        let result = state
            .start(Operation::SplitAll, "en", NOW, |p| events.push(p))
            .await
            .unwrap();
        let StartResult::Finished {
            outcome,
            reconciliation,
            inventory,
        } = result
        else {
            panic!("expected Finished, got {result:?}");
        };
        assert_eq!(outcome.reason, StopReason::Finished);
        assert_eq!(outcome.done, 2);
        let reconciliation = reconciliation.expect("reconciliation");
        assert_eq!((reconciliation.before, reconciliation.after), (3, 3));
        assert!(reconciliation.mismatches.is_empty());
        assert!(inventory.is_some());
        assert!(!events.all().is_empty());
        assert!(state.journal_text().contains("check: before 3, after 3"));
    }

    #[tokio::test]
    async fn changed_inventory_returns_a_new_plan_instead_of_running() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path(INV))
            .respond_with(inventory_reply(3))
            .up_to_n_times(1)
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path(INV))
            .respond_with(inventory_reply(4))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(200))
            .expect(0)
            .mount(&server)
            .await;
        let state = state_for(&server);
        with_token(&state).await;
        state.load_inventory("en", NOW, |_| {}).await.unwrap();
        state.preview(Operation::SplitAll).await.unwrap();
        let result = state
            .start(Operation::SplitAll, "en", NOW, |_| {})
            .await
            .unwrap();
        let StartResult::PlanChanged { plan, .. } = result else {
            panic!("expected PlanChanged, got {result:?}");
        };
        assert_eq!(plan.requests, 3);
    }

    #[tokio::test]
    async fn vanished_record_returns_a_new_plan_instead_of_running() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path(INV))
            .respond_with(inventory_reply(3))
            .up_to_n_times(1)
            .mount(&server)
            .await;
        // При перечитывании записи 1001 уже нет: вместо неё другая.
        let mut moved = inventory_body(3);
        moved["response"]["assets"][0]["assetid"] = json!("2002");
        Mock::given(method("GET"))
            .and(path(INV))
            .respond_with(ResponseTemplate::new(200).set_body_json(moved))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(200))
            .expect(0)
            .mount(&server)
            .await;
        let state = state_for(&server);
        with_token(&state).await;
        state.load_inventory("en", NOW, |_| {}).await.unwrap();
        let operation = Operation::SplitRecords {
            assetids: vec!["1001".into()],
        };
        assert_eq!(state.preview(operation.clone()).await.unwrap().requests, 2);
        let result = state.start(operation, "en", NOW, |_| {}).await.unwrap();
        let StartResult::PlanChanged { plan, .. } = result else {
            panic!("expected PlanChanged, got {result:?}");
        };
        assert_eq!(plan.requests, 0);
    }

    #[tokio::test]
    async fn start_without_preview_shows_the_plan_first() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path(INV))
            .respond_with(inventory_reply(3))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(200))
            .expect(0)
            .mount(&server)
            .await;
        let state = state_for(&server);
        with_token(&state).await;
        let result = state
            .start(Operation::SplitAll, "en", NOW, |_| {})
            .await
            .unwrap();
        assert!(
            matches!(result, StartResult::PlanChanged { .. }),
            "{result:?}"
        );
    }

    #[tokio::test]
    async fn second_start_while_running_is_busy() {
        let server = MockServer::start().await;
        let state = state_for(&server);
        state.running.store(true, Ordering::SeqCst);
        let err = state
            .start(Operation::SplitAll, "en", NOW, |_| {})
            .await
            .unwrap_err();
        assert_eq!(err.code, "busy");
    }

    #[tokio::test]
    async fn save_settings_normalizes_and_writes_the_file() {
        let server = MockServer::start().await;
        let path = std::env::temp_dir()
            .join(format!("rss-commands-{}", std::process::id()))
            .join("settings.json");
        let (sleep, _) = recording_sleep();
        let state = AppState::new(
            SteamClient::new(&server.uri(), sleep.clone()),
            sleep,
            Settings::default(),
            Some(path.clone()),
        );
        let saved = state
            .save_settings(Settings {
                language: Some("ru".into()),
                delay_ms: 50,
                ..Settings::default()
            })
            .unwrap();
        assert_eq!(
            saved,
            Settings {
                language: Some("ru".into()),
                delay_ms: 500,
                ..Settings::default()
            }
        );
        assert_eq!(state.settings(), saved);
        assert_eq!(crate::settings::load(&path), saved);
    }

    #[tokio::test]
    async fn new_state_clamps_settings_from_the_file() {
        let server = MockServer::start().await;
        let (state, _) = state_with(
            &server,
            Settings {
                language: None,
                delay_ms: 60_000,
                ..Settings::default()
            },
        );
        assert_eq!(state.settings().delay_ms, MAX_DELAY_MS);
        let (state, _) = state_with(
            &server,
            Settings {
                language: None,
                delay_ms: 1,
                ..Settings::default()
            },
        );
        assert_eq!(state.settings().delay_ms, MIN_DELAY_MS);
    }

    #[tokio::test]
    async fn running_flag_is_cleared_without_a_token() {
        let server = MockServer::start().await;
        let state = state_for(&server);
        let err = state
            .start(Operation::SplitAll, "en", NOW, |_| {})
            .await
            .unwrap_err();
        assert_eq!(err.code, "noToken");
        assert_idle(&state);
    }

    #[tokio::test]
    async fn running_flag_is_cleared_with_an_expired_token() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(inventory_reply(3))
            .expect(0)
            .mount(&server)
            .await;
        let state = state_for(&server);
        let mut token = test_token();
        token.expires_at = NOW - 1;
        state.session.lock().await.token = Some(token);
        let err = state
            .start(Operation::SplitAll, "en", NOW, |_| {})
            .await
            .unwrap_err();
        assert_eq!(err.code, "tokenExpired");
        assert_idle(&state);
    }

    #[tokio::test]
    async fn running_flag_is_cleared_after_a_failed_pre_run_read() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path(INV))
            .respond_with(inventory_reply(3))
            .up_to_n_times(1)
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path(INV))
            .respond_with(ResponseTemplate::new(500))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .respond_with(split_reply())
            .expect(0)
            .mount(&server)
            .await;
        let (state, _) = previewed(&server, Settings::default()).await;
        let err = state
            .start(Operation::SplitAll, "en", NOW, |_| {})
            .await
            .unwrap_err();
        assert_eq!(
            err,
            UiError {
                code: "http",
                status: Some(500)
            }
        );
        assert_idle(&state);
    }

    #[tokio::test]
    async fn running_flag_is_cleared_after_a_finished_run() {
        let server = MockServer::start().await;
        mount_inventory(&server, 3).await;
        Mock::given(method("POST"))
            .respond_with(split_reply())
            .mount(&server)
            .await;
        let (state, _) = previewed(&server, Settings::default()).await;
        let result = state
            .start(Operation::SplitAll, "en", NOW, |_| {})
            .await
            .unwrap();
        assert!(matches!(result, StartResult::Finished { .. }), "{result:?}");
        assert_idle(&state);
    }

    #[tokio::test]
    async fn set_token_accepts_a_valid_token_when_idle() {
        let server = MockServer::start().await;
        let state = state_for(&server);
        let info = state.set_token(&raw_token(), NOW).await.unwrap();
        assert_eq!(info.steamid_masked, "7656…0001");
        assert!(state.session.lock().await.token.is_some());
    }

    #[tokio::test]
    async fn set_token_while_running_is_busy_and_keeps_the_session() {
        let server = MockServer::start().await;
        let state = state_for(&server);
        with_token(&state).await;
        state.running.store(true, Ordering::SeqCst);
        let err = state.set_token(&raw_token(), NOW).await.unwrap_err();
        assert_eq!(err.code, "busy");
        assert_eq!(state.session.lock().await.token, Some(test_token()));
    }

    /// «Остановить» во время чтения перед запуском обрывает чтение: в Steam ничего не уходит,
    /// предпросмотренный план остаётся, и его можно запустить снова.
    #[tokio::test]
    async fn stop_during_the_pre_run_read_ends_it_within_a_second() {
        let server = MockServer::start().await;
        // Первое чтение (загрузка) быстрое, второе (перед запуском) медленное.
        Mock::given(method("GET"))
            .and(path(INV))
            .respond_with(inventory_reply(3))
            .up_to_n_times(1)
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path(INV))
            .respond_with(slow(inventory_reply(3)))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .respond_with(split_reply())
            .expect(0)
            .mount(&server)
            .await;
        let (state, _) = previewed(&server, Settings::default()).await;

        let (result, pressed) = tokio::join!(
            state.start(Operation::SplitAll, "en", NOW, |_| {}),
            stop_at_get(&state, &server, 2)
        );
        assert_within_a_second(pressed);
        assert_eq!(result.unwrap_err().code, "stopped");
        assert_eq!(requests_to(&server, "POST").await, 0);
        assert!(state.session.lock().await.last_plan.is_some());
        assert!(
            state
                .journal_text()
                .contains("inventory read stopped by the user")
        );
        assert_idle(&state);
    }

    #[tokio::test]
    async fn stop_during_a_load_ends_the_read_within_a_second() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path(INV))
            .respond_with(slow(inventory_reply(3)))
            .mount(&server)
            .await;
        let state = state_for(&server);
        with_token(&state).await;

        let (result, pressed) = tokio::join!(
            state.load_inventory("en", NOW, |_| {}),
            stop_at_get(&state, &server, 1)
        );
        assert_within_a_second(pressed);
        assert_eq!(result.unwrap_err().code, "stopped");
        assert!(state.session.lock().await.inventory.is_none());
    }

    /// «Остановить», нажатая, когда ничего не шло, следующее чтение не обрывает.
    #[tokio::test]
    async fn an_old_stop_does_not_stop_the_next_load() {
        let server = MockServer::start().await;
        mount_inventory(&server, 3).await;
        let state = state_for(&server);
        with_token(&state).await;
        state.stop();
        let inv = state.load_inventory("en", NOW, |_| {}).await.unwrap();
        assert_eq!(inv.total(), 3);
    }

    /// Загрузка во время запуска флаг не сбрасывает: иначе потерялась бы просьба остановить запуск.
    #[tokio::test]
    async fn a_load_during_a_run_keeps_the_stop_of_the_run() {
        let server = MockServer::start().await;
        mount_inventory(&server, 3).await;
        let state = state_for(&server);
        with_token(&state).await;
        state.running.store(true, Ordering::SeqCst);
        state.stop();
        let err = state.load_inventory("en", NOW, |_| {}).await.unwrap_err();
        assert_eq!(err.code, "stopped");
        assert!(state.stop.load(Ordering::SeqCst));
    }

    /// Первое «Остановить» останавливает запуск, но не сверку; второе, во время чтения для сверки, обрывает и её.
    #[tokio::test]
    async fn a_second_stop_ends_the_check_after_a_stopped_run() {
        let server = MockServer::start().await;
        // Загрузка и чтение перед запуском быстрые, чтение после запуска медленное.
        Mock::given(method("GET"))
            .and(path(INV))
            .respond_with(inventory_reply(4))
            .up_to_n_times(2)
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path(INV))
            .respond_with(slow(inventory_reply(4)))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .respond_with(split_reply().set_delay(Duration::from_millis(300)))
            .mount(&server)
            .await;
        let (state, _) = previewed(&server, Settings::default()).await;

        let (result, pressed) =
            tokio::join!(state.start(Operation::SplitAll, "en", NOW, |_| {}), async {
                wait_for_requests(&server, "POST", 1).await;
                state.stop();
                stop_at_get(&state, &server, 3).await
            });
        assert_within_a_second(pressed);
        let StartResult::Finished {
            outcome,
            reconciliation,
            inventory,
        } = result.unwrap()
        else {
            panic!("expected Finished");
        };
        assert_eq!(outcome.reason, StopReason::StoppedByUser);
        assert_eq!((outcome.done, outcome.total), (1, 3));
        assert_eq!(requests_to(&server, "POST").await, 1);
        assert!(reconciliation.is_none());
        assert!(inventory.is_none());
        assert_idle(&state);
    }

    /// Запуск прошёл, чтение для сверки идёт долго: «Остановить» обрывает его, сверки нет.
    #[tokio::test]
    async fn stop_during_the_post_run_read_ends_it_without_a_check() {
        let server = MockServer::start().await;
        // Загрузка и чтение перед запуском быстрые, чтение после запуска медленное.
        Mock::given(method("GET"))
            .and(path(INV))
            .respond_with(inventory_reply(3))
            .up_to_n_times(2)
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path(INV))
            .respond_with(slow(inventory_reply(3)))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .respond_with(split_reply())
            .expect(2)
            .mount(&server)
            .await;
        let (state, _) = previewed(&server, Settings::default()).await;

        let (result, pressed) = tokio::join!(
            state.start(Operation::SplitAll, "en", NOW, |_| {}),
            stop_at_get(&state, &server, 3)
        );
        assert_within_a_second(pressed);
        let StartResult::Finished {
            outcome,
            reconciliation,
            inventory,
        } = result.unwrap()
        else {
            panic!("expected Finished");
        };
        assert_eq!(outcome.reason, StopReason::Finished);
        assert_eq!(outcome.done, 2);
        assert!(reconciliation.is_none());
        assert!(inventory.is_none());
        assert_idle(&state);
    }

    /// Каждая принятая страница — событие окну: сколько записей прочитано и сколько их всего. Между страницами пауза,
    /// в журнале строк о страницах нет.
    #[tokio::test]
    async fn a_load_reports_every_page_to_the_window() {
        let server = MockServer::start().await;
        let mut first = inventory_body(3);
        first["response"]["total_inventory_count"] = json!(2);
        first["response"]["more_items"] = json!(true);
        first["response"]["last_assetid"] = json!("1001");
        let mut last = inventory_body(2);
        last["response"]["total_inventory_count"] = json!(2);
        last["response"]["assets"][0]["assetid"] = json!("1002");
        Mock::given(method("GET"))
            .and(path(INV))
            .respond_with(ResponseTemplate::new(200).set_body_json(first))
            .up_to_n_times(1)
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path(INV))
            .respond_with(ResponseTemplate::new(200).set_body_json(last))
            .mount(&server)
            .await;
        let (state, slept) = state_with(&server, Settings::default());
        with_token(&state).await;
        let events = Events::default();
        let inv = state
            .load_inventory("en", NOW, |p| events.push(p))
            .await
            .unwrap();
        assert_eq!(inv.total(), 5);
        assert_eq!(
            events.all(),
            vec![
                Progress::Reading {
                    read: 1,
                    total: Some(2)
                },
                Progress::Reading {
                    read: 2,
                    total: Some(2)
                },
            ]
        );
        assert_eq!(*slept.lock().unwrap(), vec![PAGE_PAUSE]);
        // Версия и итог чтения — и всё.
        let journal = state.journal_text();
        assert_eq!(journal.lines().count(), 2, "{journal}");
    }

    /// Steam попросил подождать при чтении: окно получает то же событие, что и во время запуска, журнал — строку.
    #[tokio::test]
    async fn rate_limit_wait_during_a_load_is_shown_to_the_window() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path(INV))
            .respond_with(ResponseTemplate::new(429).insert_header("Retry-After", "7"))
            .up_to_n_times(1)
            .mount(&server)
            .await;
        mount_inventory(&server, 3).await;
        let (state, slept) = state_with(&server, Settings::default());
        with_token(&state).await;
        let events = Events::default();
        state
            .load_inventory("en", NOW, |p| events.push(p))
            .await
            .unwrap();
        assert_eq!(
            events.all(),
            vec![
                Progress::Waiting { seconds: 7 },
                Progress::Reading {
                    read: 1,
                    total: Some(1)
                },
            ]
        );
        assert_eq!(*slept.lock().unwrap(), vec![Duration::from_secs(7)]);
        assert!(
            state
                .journal_text()
                .contains("inventory read: Steam asked to slow down, waiting 7 s")
        );
    }

    /// Ожидание при чтении перед запуском окно видит раньше хода запуска.
    #[tokio::test]
    async fn rate_limit_wait_during_the_pre_run_read_is_shown_to_the_window() {
        let server = MockServer::start().await;
        // Загрузка проходит, чтение перед запуском сначала получает 429.
        Mock::given(method("GET"))
            .and(path(INV))
            .respond_with(inventory_reply(3))
            .up_to_n_times(1)
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path(INV))
            .respond_with(ResponseTemplate::new(429).insert_header("Retry-After", "4"))
            .up_to_n_times(1)
            .mount(&server)
            .await;
        mount_inventory(&server, 3).await;
        Mock::given(method("POST"))
            .respond_with(split_reply())
            .expect(2)
            .mount(&server)
            .await;
        let (state, _) = previewed(&server, Settings::default()).await;
        let events = Events::default();
        let result = state
            .start(Operation::SplitAll, "en", NOW, |p| events.push(p))
            .await
            .unwrap();
        assert!(matches!(result, StartResult::Finished { .. }), "{result:?}");
        let events = events.all();
        assert_eq!(events.first(), Some(&Progress::Waiting { seconds: 4 }));
        assert_eq!(
            events[1],
            Progress::Reading {
                read: 1,
                total: Some(1)
            }
        );
        assert!(matches!(events[2], Progress::Request { done: 0, .. }));
    }

    #[tokio::test]
    async fn an_old_stop_does_not_block_the_next_run() {
        let server = MockServer::start().await;
        mount_inventory(&server, 3).await;
        Mock::given(method("POST"))
            .respond_with(split_reply())
            .expect(2)
            .mount(&server)
            .await;
        let (state, _) = previewed(&server, Settings::default()).await;
        // «Остановить» нажали, когда ничего не шло.
        state.stop();
        let result = state
            .start(Operation::SplitAll, "en", NOW, |_| {})
            .await
            .unwrap();
        let StartResult::Finished { outcome, .. } = result else {
            panic!("expected Finished, got {result:?}");
        };
        assert_eq!(outcome.reason, StopReason::Finished);
        assert_eq!(outcome.done, 2);
    }

    #[tokio::test]
    async fn stop_during_a_run_stops_after_the_current_request() {
        let server = MockServer::start().await;
        mount_inventory(&server, 4).await; // три разделения
        Mock::given(method("POST"))
            .respond_with(split_reply().set_delay(Duration::from_millis(300)))
            .mount(&server)
            .await;
        let (state, _) = previewed(&server, Settings::default()).await;

        let (result, ()) =
            tokio::join!(state.start(Operation::SplitAll, "en", NOW, |_| {}), async {
                wait_for_requests(&server, "POST", 1).await;
                state.stop();
            });
        let StartResult::Finished {
            outcome,
            reconciliation,
            ..
        } = result.unwrap()
        else {
            panic!("expected Finished");
        };
        assert_eq!(outcome.reason, StopReason::StoppedByUser);
        assert_eq!((outcome.done, outcome.total), (1, 3));
        assert_eq!(requests_to(&server, "POST").await, 1);
        // Сверка после остановки всё равно делается.
        assert!(reconciliation.is_some());
        assert!(state.journal_text().contains("stop requested"));
    }

    #[tokio::test]
    async fn forgetting_the_token_during_a_run_sends_no_further_requests() {
        let server = MockServer::start().await;
        mount_inventory(&server, 3).await;
        Mock::given(method("POST"))
            .respond_with(split_reply().set_delay(Duration::from_millis(300)))
            .mount(&server)
            .await;
        let (state, _) = previewed(&server, Settings::default()).await;
        assert_eq!(requests_to(&server, "GET").await, 1); // чтение при загрузке

        let (result, ()) =
            tokio::join!(state.start(Operation::SplitAll, "en", NOW, |_| {}), async {
                wait_for_requests(&server, "POST", 1).await;
                state.forget_token().await;
            });
        let StartResult::Finished {
            outcome,
            reconciliation,
            inventory,
        } = result.unwrap()
        else {
            panic!("expected Finished");
        };
        assert_eq!(outcome.reason, StopReason::StoppedByUser);
        assert_eq!(outcome.done, 1);
        assert!(reconciliation.is_none());
        assert!(inventory.is_none());
        // Запрос, который уже в пути, дойдёт до конца; после него запросов с забытым токеном нет.
        // Ещё одно чтение — только перед запуском.
        assert_eq!(requests_to(&server, "GET").await, 2);
        assert_eq!(requests_to(&server, "POST").await, 1);
        {
            let session = state.session.lock().await;
            assert!(session.token.is_none());
            assert!(session.inventory.is_none());
        }
        assert!(
            state
                .journal_text()
                .contains("token forgotten during the run, check skipped")
        );
        assert_idle(&state);
    }

    /// «Забыть токен» без сигнала: ведёт себя как «Забыть», нажатое сразу после конца чтения,
    /// но до записи в сессию. Так охрана записи проверяется отдельно от обрыва чтения.
    async fn clear_session_silently(state: &AppState) {
        *state.session.lock().await = Session::default();
    }

    /// Другой токен в сессии без сигнала: как вставка сразу после конца чтения,
    /// но до записи в сессию.
    async fn replace_token_silently(state: &AppState) {
        let other = token::parse_token(&raw_token(), NOW).unwrap();
        *state.session.lock().await = Session {
            token: Some(other),
            ..Session::default()
        };
    }

    #[tokio::test]
    async fn reading_with_a_token_that_is_not_in_the_session_sends_nothing() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(inventory_reply(3))
            .expect(0)
            .mount(&server)
            .await;
        let state = state_for(&server);
        with_token(&state).await;
        let token = test_token();
        state.forget_token().await;
        let err = state
            .read_inventory(&token, "en", &|_| {})
            .await
            .unwrap_err();
        assert_eq!(err.code, "noToken");
    }

    #[tokio::test]
    async fn forgetting_the_token_drops_the_inventory_read_in_flight() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path(INV))
            .respond_with(paged_reply(3).set_delay(Duration::from_millis(300)))
            .mount(&server)
            .await;
        let state = state_for(&server);
        with_token(&state).await;

        // «Забыть» и новый токен посреди чтения первой страницы.
        let (result, ()) = tokio::join!(state.load_inventory("en", NOW, |_| {}), async {
            wait_for_requests(&server, "GET", 1).await;
            state.forget_token().await;
            state.set_token(&raw_token(), NOW).await.unwrap();
        });
        assert_eq!(result.unwrap_err().code, "noToken");
        // Вторую страницу старым токеном не просили.
        assert_eq!(requests_to(&server, "GET").await, 1);
        let session = state.session.lock().await;
        assert!(session.token.is_some());
        assert_ne!(session.token, Some(test_token()));
        assert!(session.inventory.is_none());
        assert!(session.last_plan.is_none());
    }

    #[tokio::test]
    async fn inventory_read_for_a_replaced_token_is_not_stored() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path(INV))
            .respond_with(inventory_reply(3).set_delay(Duration::from_millis(300)))
            .mount(&server)
            .await;
        let state = state_for(&server);
        with_token(&state).await;

        // Другой токен в сессии, пока читался инвентарь первого: чтение никто не обрывал.
        let (result, ()) = tokio::join!(state.load_inventory("en", NOW, |_| {}), async {
            wait_for_requests(&server, "GET", 1).await;
            replace_token_silently(&state).await;
        });
        assert_eq!(result.unwrap_err().code, "noToken");
        {
            let session = state.session.lock().await;
            assert!(session.token.is_some());
            assert_ne!(session.token, Some(test_token()));
            assert!(session.inventory.is_none());
            assert!(session.last_plan.is_none());
        }
        assert!(state.journal_text().contains("nothing stored"));
    }

    #[tokio::test]
    async fn forgetting_the_token_during_the_pre_run_read_stores_and_runs_nothing() {
        let server = MockServer::start().await;
        // Загрузка быстрая, чтение перед запуском медленное и «не последнее».
        Mock::given(method("GET"))
            .and(path(INV))
            .respond_with(inventory_reply(3))
            .up_to_n_times(1)
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path(INV))
            .respond_with(paged_reply(3).set_delay(Duration::from_millis(300)))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .respond_with(split_reply())
            .expect(0)
            .mount(&server)
            .await;
        let (state, _) = previewed(&server, Settings::default()).await;

        let (result, ()) =
            tokio::join!(state.start(Operation::SplitAll, "en", NOW, |_| {}), async {
                wait_for_requests(&server, "GET", 2).await;
                state.forget_token().await;
            });
        // Ни нового плана окну, ни записи в сессию.
        assert_eq!(result.unwrap_err().code, "noToken");
        assert_eq!(requests_to(&server, "GET").await, 2);
        assert_eq!(requests_to(&server, "POST").await, 0);
        {
            let session = state.session.lock().await;
            assert!(session.token.is_none());
            assert!(session.inventory.is_none());
            assert!(session.last_plan.is_none());
        }
        // Без токена нет и предпросмотра.
        assert_eq!(
            state.preview(Operation::SplitAll).await.unwrap_err().code,
            "noInventory"
        );
        assert_idle(&state);
    }

    #[tokio::test]
    async fn pre_run_read_finishing_after_the_session_was_cleared_is_not_stored() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path(INV))
            .respond_with(inventory_reply(3))
            .up_to_n_times(1)
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path(INV))
            .respond_with(inventory_reply(3).set_delay(Duration::from_millis(300)))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .respond_with(split_reply())
            .expect(0)
            .mount(&server)
            .await;
        let (state, _) = previewed(&server, Settings::default()).await;

        let (result, ()) =
            tokio::join!(state.start(Operation::SplitAll, "en", NOW, |_| {}), async {
                wait_for_requests(&server, "GET", 2).await;
                clear_session_silently(&state).await;
            });
        assert_eq!(result.unwrap_err().code, "noToken");
        assert_eq!(requests_to(&server, "POST").await, 0);
        {
            let session = state.session.lock().await;
            assert!(session.inventory.is_none());
            assert!(session.last_plan.is_none());
        }
        assert!(state.journal_text().contains("nothing stored"));
        assert_idle(&state);
    }

    #[tokio::test]
    async fn forgetting_the_token_during_the_post_run_read_drops_it() {
        let server = MockServer::start().await;
        // Загрузка и чтение перед запуском быстрые, чтение после запуска медленное и «не последнее».
        Mock::given(method("GET"))
            .and(path(INV))
            .respond_with(inventory_reply(3))
            .up_to_n_times(2)
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path(INV))
            .respond_with(paged_reply(3).set_delay(Duration::from_millis(300)))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .respond_with(split_reply())
            .expect(2)
            .mount(&server)
            .await;
        let (state, _) = previewed(&server, Settings::default()).await;

        let (result, ()) =
            tokio::join!(state.start(Operation::SplitAll, "en", NOW, |_| {}), async {
                wait_for_requests(&server, "GET", 3).await;
                state.forget_token().await;
            });
        let StartResult::Finished {
            outcome,
            reconciliation,
            inventory,
        } = result.unwrap()
        else {
            panic!("expected Finished");
        };
        assert_eq!(outcome.done, 2);
        assert!(reconciliation.is_none());
        assert!(inventory.is_none());
        // Вторую страницу после «Забыть» не просили.
        assert_eq!(requests_to(&server, "GET").await, 3);
        {
            let session = state.session.lock().await;
            assert!(session.token.is_none());
            assert!(session.inventory.is_none());
            assert!(session.last_plan.is_none());
        }
        assert_idle(&state);
    }

    #[tokio::test]
    async fn post_run_read_finishing_after_the_session_was_cleared_is_not_stored() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path(INV))
            .respond_with(inventory_reply(3))
            .up_to_n_times(2)
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path(INV))
            .respond_with(inventory_reply(3).set_delay(Duration::from_millis(300)))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .respond_with(split_reply())
            .expect(2)
            .mount(&server)
            .await;
        let (state, _) = previewed(&server, Settings::default()).await;

        let (result, ()) =
            tokio::join!(state.start(Operation::SplitAll, "en", NOW, |_| {}), async {
                wait_for_requests(&server, "GET", 3).await;
                clear_session_silently(&state).await;
            });
        let StartResult::Finished {
            outcome,
            reconciliation,
            inventory,
        } = result.unwrap()
        else {
            panic!("expected Finished");
        };
        assert_eq!(outcome.reason, StopReason::Finished);
        assert_eq!(outcome.done, 2);
        assert!(reconciliation.is_none());
        assert!(inventory.is_none());
        assert!(state.session.lock().await.inventory.is_none());
        assert!(
            state
                .journal_text()
                .contains("token forgotten during the run, check skipped")
        );
        assert_idle(&state);
    }

    #[tokio::test]
    async fn failed_post_run_read_still_finishes_without_a_check() {
        let server = MockServer::start().await;
        // Загрузка и чтение перед запуском проходят, чтение после запуска — нет.
        Mock::given(method("GET"))
            .and(path(INV))
            .respond_with(inventory_reply(3))
            .up_to_n_times(2)
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path(INV))
            .respond_with(ResponseTemplate::new(500))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .respond_with(split_reply())
            .expect(2)
            .mount(&server)
            .await;
        let (state, _) = previewed(&server, Settings::default()).await;
        let result = state
            .start(Operation::SplitAll, "en", NOW, |_| {})
            .await
            .unwrap();
        let StartResult::Finished {
            outcome,
            reconciliation,
            inventory,
        } = result
        else {
            panic!("expected Finished, got {result:?}");
        };
        assert_eq!(outcome.reason, StopReason::Finished);
        assert_eq!(outcome.done, 2);
        assert!(reconciliation.is_none());
        assert!(inventory.is_none());
        assert!(state.journal_text().contains("inventory read failed"));
    }

    #[tokio::test]
    async fn configured_delay_is_the_pause_between_requests() {
        let server = MockServer::start().await;
        mount_inventory(&server, 3).await;
        Mock::given(method("POST"))
            .respond_with(split_reply())
            .expect(2)
            .mount(&server)
            .await;
        let (state, slept) = previewed(
            &server,
            Settings {
                language: None,
                delay_ms: 700,
                ..Settings::default()
            },
        )
        .await;
        let result = state
            .start(Operation::SplitAll, "en", NOW, |_| {})
            .await
            .unwrap();
        assert!(matches!(result, StartResult::Finished { .. }), "{result:?}");
        // Два запроса — одна пауза между ними, и она равна настройке.
        assert_eq!(*slept.lock().unwrap(), vec![Duration::from_millis(700)]);
    }

    /// Паузу сохранили в настройках во время второго запроса: вторая пауза уже новая.
    #[tokio::test]
    async fn pause_saved_during_a_run_applies_from_the_next_pause() {
        let server = MockServer::start().await;
        mount_inventory(&server, 4).await; // три разделения — две паузы
        Mock::given(method("POST"))
            .respond_with(split_reply())
            .expect(3)
            .mount(&server)
            .await;
        let (state, slept) = previewed(
            &server,
            Settings {
                language: None,
                delay_ms: 700,
                ..Settings::default()
            },
        )
        .await;
        let result = state
            .start(Operation::SplitAll, "en", NOW, |p| {
                if matches!(p, Progress::Request { done: 1, .. }) {
                    state
                        .save_settings(Settings {
                            language: None,
                            delay_ms: 2000,
                            ..Settings::default()
                        })
                        .unwrap();
                }
            })
            .await
            .unwrap();
        assert!(matches!(result, StartResult::Finished { .. }), "{result:?}");
        assert_eq!(
            *slept.lock().unwrap(),
            vec![Duration::from_millis(700), Duration::from_millis(2000)]
        );
        assert!(
            state
                .journal_text()
                .contains("pause changed during the run: 2000 ms")
        );
    }

    #[tokio::test]
    async fn rejected_token_skips_the_post_run_read() {
        let server = MockServer::start().await;
        mount_inventory(&server, 3).await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(401))
            .expect(1)
            .mount(&server)
            .await;
        let (state, _) = previewed(&server, Settings::default()).await;
        let result = state
            .start(Operation::SplitAll, "en", NOW, |_| {})
            .await
            .unwrap();
        let StartResult::Finished {
            outcome,
            reconciliation,
            inventory,
        } = result
        else {
            panic!("expected Finished, got {result:?}");
        };
        assert_eq!(outcome.reason, StopReason::TokenRejected);
        assert!(reconciliation.is_none());
        assert!(inventory.is_none());
        // Чтение при загрузке и перед запуском; после отказа токена чтения нет.
        assert_eq!(requests_to(&server, "GET").await, 2);
        assert!(
            state
                .journal_text()
                .contains("the token was rejected, check skipped")
        );
        assert_idle(&state);
    }

    #[tokio::test]
    async fn replacing_the_token_drops_the_inventory_read_in_flight() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path(INV))
            .respond_with(paged_reply(3).set_delay(Duration::from_millis(300)))
            .mount(&server)
            .await;
        let state = state_for(&server);
        with_token(&state).await;

        // Новый токен посреди чтения первой страницы, без «Забыть».
        let (result, info) = tokio::join!(state.load_inventory("en", NOW, |_| {}), async {
            wait_for_requests(&server, "GET", 1).await;
            state.set_token(&raw_token(), NOW).await
        });
        info.unwrap();
        assert_eq!(result.unwrap_err().code, "noToken");
        // Вторую страницу старым токеном не просили.
        assert_eq!(requests_to(&server, "GET").await, 1);
        let session = state.session.lock().await;
        assert_ne!(session.token, Some(test_token()));
        assert!(session.inventory.is_none());
    }

    #[tokio::test]
    async fn journal_starts_with_the_app_version() {
        let server = MockServer::start().await;
        let state = state_for(&server);
        state.journal.add("later line");
        let text = state.journal_text();
        let first = text.lines().next().unwrap_or_default();
        let expected = format!(
            "Rust Skin Stacker {} on {}",
            env!("CARGO_PKG_VERSION"),
            std::env::consts::OS
        );
        assert!(first.ends_with(&expected), "{text}");
    }

    #[tokio::test]
    async fn page_reload_during_a_run_stops_it_and_forgets_the_token() {
        let server = MockServer::start().await;
        mount_inventory(&server, 4).await; // три разделения
        Mock::given(method("POST"))
            .respond_with(split_reply().set_delay(Duration::from_millis(300)))
            .mount(&server)
            .await;
        let (state, _) = previewed(&server, Settings::default()).await;

        let (result, ()) =
            tokio::join!(state.start(Operation::SplitAll, "en", NOW, |_| {}), async {
                wait_for_requests(&server, "POST", 1).await;
                state.reset_on_page_load().await;
            });
        let StartResult::Finished {
            outcome,
            reconciliation,
            inventory,
        } = result.unwrap()
        else {
            panic!("expected Finished");
        };
        // Текущий запрос дошёл до конца, новых с этим токеном нет.
        assert_eq!(outcome.reason, StopReason::StoppedByUser);
        assert_eq!((outcome.done, outcome.total), (1, 3));
        assert_eq!(requests_to(&server, "POST").await, 1);
        assert_eq!(requests_to(&server, "GET").await, 2);
        assert!(reconciliation.is_none());
        assert!(inventory.is_none());
        assert!(state.session.lock().await.token.is_none());
        assert!(
            state
                .journal_text()
                .contains("page reloaded: token forgotten, run stopped after the current request")
        );
        assert_idle(&state);
    }

    #[tokio::test]
    async fn page_reload_with_a_token_forgets_it() {
        let server = MockServer::start().await;
        mount_inventory(&server, 3).await;
        let (state, _) = previewed(&server, Settings::default()).await;
        state.reset_on_page_load().await;
        {
            let session = state.session.lock().await;
            assert!(session.token.is_none());
            assert!(session.inventory.is_none());
            assert!(session.last_plan.is_none());
        }
        assert!(
            state
                .journal_text()
                .contains("page reloaded: token forgotten")
        );
    }

    #[tokio::test]
    async fn first_page_load_with_an_empty_session_does_nothing() {
        let server = MockServer::start().await;
        let state = state_for(&server);
        let before = state.journal_text();
        state.reset_on_page_load().await;
        assert_eq!(state.journal_text(), before);
        assert!(!state.journal_text().contains("page reloaded"));
        assert!(!state.stop.load(Ordering::SeqCst));
    }
}
