//! Команды окна. Токен остаётся в ядре: окно получает только `TokenInfo`.
//! Логика — в методах `AppState`, чтобы её можно было проверить без Tauri.

use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::inventory::{self, Inventory, Reconciliation};
use crate::journal::Journal;
use crate::plan::{self, Operation, Plan};
use crate::runner::{self, Progress, RunConfig, RunOutcome, SteamStacker};
use crate::settings::{self, Settings};
use crate::steam::{SleepFn, SteamClient, SteamError};
use crate::token::{self, Token, TokenError, TokenInfo};

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

pub struct AppState {
    client: SteamClient,
    sleep: SleepFn,
    session: tokio::sync::Mutex<Session>,
    stop: AtomicBool,
    running: AtomicBool,
    journal: Journal,
    settings: Mutex<Settings>,
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
        Self {
            client,
            sleep,
            session: tokio::sync::Mutex::new(Session::default()),
            stop: AtomicBool::new(false),
            running: AtomicBool::new(false),
            journal: Journal::default(),
            settings: Mutex::new(settings.normalized()),
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
        self.journal
            .add(format!("token accepted for {}", info.steamid_masked));
        Ok(info)
    }

    pub async fn forget_token(&self) {
        self.stop.store(true, Ordering::SeqCst);
        *self.session.lock().await = Session::default();
        self.journal.add("token forgotten");
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

    async fn read_inventory(&self, token: &Token, lang: &str) -> Result<Inventory, UiError> {
        match inventory::load(&self.client, token, steam_language(lang)).await {
            Ok(inv) => {
                self.journal.add(format!(
                    "inventory read: {} skins, {} items",
                    inv.skins.len(),
                    inv.total()
                ));
                Ok(inv)
            }
            Err(e) => {
                self.journal.add(format!("inventory read failed: {e}"));
                Err(e.into())
            }
        }
    }

    pub async fn load_inventory(&self, lang: &str, now: i64) -> Result<Inventory, UiError> {
        let token = self.token(now).await?;
        let inv = self.read_inventory(&token, lang).await?;
        let mut session = self.session.lock().await;
        session.inventory = Some(inv.clone());
        session.last_plan = None;
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
        emit: impl FnMut(Progress),
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
        emit: impl FnMut(Progress),
    ) -> Result<StartResult, UiError> {
        self.stop.store(false, Ordering::SeqCst);
        let token = self.token(now).await?;
        let previewed = self.session.lock().await.last_plan.clone();

        // Правило 1: перед запуском инвентарь перечитывается.
        let before = self.read_inventory(&token, lang).await?;
        let plan = plan::build(&before, &operation);
        {
            let mut session = self.session.lock().await;
            session.inventory = Some(before.clone());
            session.last_plan = Some(plan.clone());
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

        let delay_ms = self
            .settings
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .delay_ms;
        let config = RunConfig {
            delay: Duration::from_millis(u64::from(delay_ms)),
        };
        self.journal.add(format!(
            "start: {} requests, pause {delay_ms} ms",
            plan.requests
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
            emit,
        )
        .await;
        self.journal.add(format!(
            "finished: {:?}, done {}, errors {}",
            outcome.reason, outcome.done, outcome.errors
        ));

        // Правило 7: сверка по свежему чтению инвентаря.
        match self.read_inventory(&token, lang).await {
            Ok(after) => {
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
                let mut session = self.session.lock().await;
                session.inventory = Some(after.clone());
                session.last_plan = None;
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
    state: State<'_, AppState>,
    lang: String,
) -> Result<Inventory, UiError> {
    state.load_inventory(&lang, now()).await
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
    use crate::runner::StopReason;
    use crate::steam::recording_sleep;
    use crate::token::test_token;
    use serde_json::json;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    const NOW: i64 = 1_800_000_000;
    const INV: &str = "/IEconService/GetInventoryItemsWithDescriptions/v1/";
    const SPLIT: &str = "/IInventoryService/SplitItemStack/v1/";

    fn inventory_reply(amount: u32) -> ResponseTemplate {
        ResponseTemplate::new(200).set_body_json(json!({"response": {
            "assets": [{"assetid": "1001", "classid": "c1", "instanceid": "0", "amount": amount.to_string()}],
            "descriptions": [{"classid": "c1", "instanceid": "0", "market_hash_name": "Outlaw Revolver",
                              "name": "Outlaw Revolver", "tradable": 1, "marketable": 1}],
            "total_inventory_count": 1
        }}))
    }

    fn state_for(server: &MockServer) -> AppState {
        let (sleep, _) = recording_sleep();
        AppState::new(
            SteamClient::new(&server.uri(), sleep.clone()),
            sleep,
            Settings::default(),
            None,
        )
    }

    async fn with_token(state: &AppState) {
        state.session.lock().await.token = Some(test_token());
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
            .load_inventory("en", NOW)
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
            state.load_inventory("en", NOW).await.unwrap_err().code,
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
        state.load_inventory("en", NOW).await.unwrap();
        assert_eq!(
            state.preview(Operation::SplitAll).await.unwrap().requests,
            2
        );

        let mut events = Vec::new();
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
        assert!(!events.is_empty());
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
        state.load_inventory("en", NOW).await.unwrap();
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
            })
            .unwrap();
        assert_eq!(
            saved,
            Settings {
                language: Some("ru".into()),
                delay_ms: 500
            }
        );
        assert_eq!(state.settings(), saved);
        assert_eq!(crate::settings::load(&path), saved);
    }
}
