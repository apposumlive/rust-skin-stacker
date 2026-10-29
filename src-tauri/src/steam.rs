//! HTTP к Steam Web API. В текстах ошибок нет ни URL, ни параметров, потому что
//! в них токен. Поэтому ошибки reqwest наружу никогда не форматируются.

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
#[cfg(test)]
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use reqwest::header::CONTENT_TYPE;
use serde_json::Value;
use tokio::time::Instant;
use url::{Url, form_urlencoded};

use crate::token::Token;

pub const API_BASE: &str = "https://api.steampowered.com";
pub const RUST_APPID: u32 = 252490;
pub const RUST_CONTEXTID: u32 = 2;
pub const PAGE_SIZE: u32 = 500;
/// Пауза перед каждой страницей инвентаря, кроме первой: большой инвентарь читается не залпом.
/// Ожидание по 429 — своё, отдельно от этой паузы.
pub const PAGE_PAUSE: Duration = Duration::from_secs(1);
/// Сколько раз повторять чтение инвентаря при 429, 5xx и сбое сети.
pub const GET_RETRIES: u64 = 3;
/// Дольше ждать по `Retry-After` не будем.
pub const MAX_RETRY_AFTER: u64 = 60;
/// Дольше одного запроса (вместе с телом ответа) не ждём.
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
/// Общий срок одного GET вместе с повторами: запросы и ожидания между ними. Ожидание начинается, только если
/// после него на запрос остаётся полный таймаут, поэтому срок не превышается. 120 с вмещают самое долгое
/// ожидание по `Retry-After` (60 с) даже после запроса, ушедшего в таймаут, а при быстрых ответах — всю
/// лестницу 5xx (10 + 20 + 30 с). Дольше ждать без человека незачем: окно предложит «Повторить».
pub const GET_DEADLINE: Duration = Duration::from_secs(120);
const _: () = assert!(
    REQUEST_TIMEOUT.as_secs() + MAX_RETRY_AFTER + REQUEST_TIMEOUT.as_secs()
        <= GET_DEADLINE.as_secs()
);
/// Как часто чтение смотрит на «Остановить» во время запроса и ожидания: обрыв — быстрее секунды.
const STOP_POLL: Duration = Duration::from_millis(100);

/// Чтение инвентаря видит «Остановить» и сообщает, когда Steam просит подождать.
pub struct ReadControl<'a> {
    /// «Остановить»: чтение бросает запрос в пути и ожидание и за следующей страницей не идёт.
    pub stop: &'a AtomicBool,
    /// Steam ответил 429: перед повтором ждём столько секунд. Окно показывает отсчёт.
    pub on_wait: &'a (dyn Fn(u64) + Sync),
    /// Принята очередная страница: сколько записей прочитано всего и сколько их по словам Steam.
    pub on_page: &'a (dyn Fn(u32, Option<u32>) + Sync),
}

/// Пауза, которую тесты подменяют записью длительности.
pub type SleepFn = Arc<dyn Fn(Duration) -> Pin<Box<dyn Future<Output = ()> + Send>> + Send + Sync>;

pub fn tokio_sleep() -> SleepFn {
    Arc::new(|d| Box::pin(tokio::time::sleep(d)))
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum SteamError {
    #[error("Steam rejected the token (HTTP {0})")]
    Auth(u16),
    #[error("Steam asked to slow down (HTTP 429)")]
    RateLimited { retry_after: Option<u64> },
    #[error("Steam answered HTTP {0}")]
    Http(u16),
    #[error("Steam refused the request (eresult {0})")]
    Rejected(i32),
    #[error("network error: {0}")]
    Network(&'static str),
    #[error("unexpected response from Steam")]
    BadResponse,
    #[error("Steam returned the same inventory page twice")]
    PagingLoop,
    #[error("the inventory has too many pages")]
    TooLarge,
    #[error("the inventory read was stopped")]
    Stopped,
}

#[derive(Clone)]
pub struct SteamClient {
    http: reqwest::Client,
    base: String,
    sleep: SleepFn,
}

impl SteamClient {
    pub fn new(base: &str, sleep: SleepFn) -> Self {
        // Без редиректов: адрес с токеном не должен уйти на другой хост.
        let http = reqwest::Client::builder()
            .user_agent(concat!("RustSkinStacker/", env!("CARGO_PKG_VERSION")))
            .redirect(reqwest::redirect::Policy::none())
            .timeout(REQUEST_TIMEOUT)
            .build()
            .expect("HTTP client");
        Self {
            http,
            base: base.trim_end_matches('/').to_string(),
            sleep,
        }
    }

    /// Одна страница инвентаря Rust: объект `response` из ответа Steam.
    /// Повторяется при 429, 5xx и сбое сети, не больше `GET_RETRIES` раз и в срок `GET_DEADLINE`.
    /// «Остановить» обрывает и запрос, и ожидание перед повтором.
    pub async fn inventory_page(
        &self,
        token: &Token,
        start_assetid: Option<&str>,
        language: &str,
        control: &ReadControl<'_>,
    ) -> Result<Value, SteamError> {
        let mut params = vec![
            ("access_token", token.secret.expose().to_string()),
            ("steamid", token.steamid.clone()),
            ("appid", RUST_APPID.to_string()),
            ("contextid", RUST_CONTEXTID.to_string()),
            ("get_descriptions", "true".to_string()),
            ("language", language.to_string()),
            ("count", PAGE_SIZE.to_string()),
        ];
        if let Some(start) = start_assetid {
            params.push(("start_assetid", start.to_string()));
        }
        let address = format!(
            "{}/IEconService/GetInventoryItemsWithDescriptions/v1/",
            self.base
        );
        let url = Url::parse_with_params(&address, &params).map_err(|_| SteamError::BadResponse)?;
        let mut attempt: u64 = 0;
        // Сколько уже ушло на этот GET: запросы и ожидания.
        let mut spent = Duration::ZERO;
        loop {
            let sent = Instant::now();
            // Чтение в Steam ничего не меняет, поэтому запрос в пути можно бросить. `biased`: нажатие, сделанное
            // раньше, не даёт запросу уйти.
            let outcome = tokio::select! {
                biased;
                () = stop_pressed(control.stop) => return Err(SteamError::Stopped),
                outcome = self.get_json(&url) => outcome,
            };
            spent += sent.elapsed();
            let wait = match &outcome {
                Err(SteamError::Network(_)) => Some(5 * (attempt + 1)),
                Err(SteamError::RateLimited { retry_after }) => {
                    Some(retry_after.unwrap_or(10 * (attempt + 1)))
                }
                Err(SteamError::Http(status)) if *status >= 500 => Some(10 * (attempt + 1)),
                _ => None,
            };
            match wait.map(|secs| Duration::from_secs(secs.min(MAX_RETRY_AFTER))) {
                Some(pause) if attempt < GET_RETRIES && retry_fits(spent, pause) => {
                    attempt += 1;
                    if matches!(outcome, Err(SteamError::RateLimited { .. })) {
                        (control.on_wait)(pause.as_secs());
                    }
                    self.pause(pause, control.stop).await?;
                    spent += pause;
                }
                _ => {
                    return outcome?
                        .get("response")
                        .cloned()
                        .ok_or(SteamError::BadResponse);
                }
            }
        }
    }

    async fn get_json(&self, url: &Url) -> Result<Value, SteamError> {
        match self.http.get(url.clone()).send().await {
            Ok(resp) => read_json(resp).await,
            Err(e) => Err(network(&e)),
        }
    }

    /// Пауза перед очередной страницей инвентаря. Её, как и ожидание перед повтором, обрывает «Остановить».
    /// В срок `GET_DEADLINE` она не входит: срок считается на один GET.
    pub async fn page_pause(&self, stop: &AtomicBool) -> Result<(), SteamError> {
        self.pause(PAGE_PAUSE, stop).await
    }

    /// Ожидание перед повтором GET или перед следующей страницей, которое обрывает «Остановить». Если пауза
    /// кончилась раньше, чем опрос заметил нажатие, запрос всё равно не уйдёт: `inventory_page` сначала смотрит
    /// на «Остановить».
    async fn pause(&self, pause: Duration, stop: &AtomicBool) -> Result<(), SteamError> {
        tokio::select! {
            biased;
            () = stop_pressed(stop) => Err(SteamError::Stopped),
            () = (self.sleep)(pause) => Ok(()),
        }
    }

    pub async fn split(
        &self,
        token: &Token,
        itemid: &str,
        quantity: u32,
    ) -> Result<(), SteamError> {
        let fields = [
            ("appid", RUST_APPID.to_string()),
            ("itemid", itemid.to_string()),
            ("quantity", quantity.to_string()),
            ("steamid", token.steamid.clone()),
        ];
        self.post("IInventoryService/SplitItemStack/v1/", token, &fields)
            .await
    }

    pub async fn combine(
        &self,
        token: &Token,
        from: &str,
        dest: &str,
        quantity: u32,
    ) -> Result<(), SteamError> {
        let fields = [
            ("appid", RUST_APPID.to_string()),
            ("fromitemid", from.to_string()),
            ("destitemid", dest.to_string()),
            ("quantity", quantity.to_string()),
            ("steamid", token.steamid.clone()),
        ];
        self.post("IInventoryService/CombineItemStacks/v1/", token, &fields)
            .await
    }

    /// POST без повторов: после сбоя сети неизвестно, выполнил ли Steam запрос.
    /// 429 возвращается наверх, ожиданием с отсчётом управляет runner.
    async fn post(
        &self,
        method: &str,
        token: &Token,
        fields: &[(&str, String)],
    ) -> Result<(), SteamError> {
        let body = form_urlencoded::Serializer::new(String::new())
            .extend_pairs(fields.iter().map(|(k, v)| (*k, v.as_str())))
            .append_pair("access_token", token.secret.expose())
            .finish();
        let resp = self
            .http
            .post(format!("{}/{}", self.base, method))
            .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
            .body(body)
            .send()
            .await
            .map_err(|e| network(&e))?;
        read_json(resp).await.map(|_| ())
    }
}

/// Статус, заголовок `x-eresult` и JSON. Пустое тело — пустой объект.
async fn read_json(resp: reqwest::Response) -> Result<Value, SteamError> {
    let status = resp.status().as_u16();
    if status == 401 || status == 403 {
        return Err(SteamError::Auth(status));
    }
    if status == 429 {
        return Err(SteamError::RateLimited {
            retry_after: retry_after(&resp),
        });
    }
    if !(200..300).contains(&status) {
        return Err(SteamError::Http(status));
    }
    // Нет заголовка — это успех. Заголовок не число — ответу нельзя верить,
    // и считать запрос выполненным нельзя.
    if resp.headers().contains_key("x-eresult") {
        match header_number::<i32>(&resp, "x-eresult") {
            Some(1) => {}
            Some(code) => return Err(SteamError::Rejected(code)),
            None => return Err(SteamError::BadResponse),
        }
    }
    let bytes = resp.bytes().await.map_err(|e| network(&e))?;
    if bytes.iter().all(u8::is_ascii_whitespace) {
        return Ok(Value::Object(serde_json::Map::new()));
    }
    serde_json::from_slice(&bytes).map_err(|_| SteamError::BadResponse)
}

fn header_number<T: std::str::FromStr>(resp: &reqwest::Response, name: &str) -> Option<T> {
    resp.headers().get(name)?.to_str().ok()?.trim().parse().ok()
}

fn retry_after(resp: &reqwest::Response) -> Option<u64> {
    header_number::<u64>(resp, "retry-after").map(|s| s.min(MAX_RETRY_AFTER))
}

/// Помещаются ли в общий срок ожидание `pause` и полный таймаут запроса после него, если на GET уже ушло `spent`.
fn retry_fits(spent: Duration, pause: Duration) -> bool {
    spent + pause + REQUEST_TIMEOUT <= GET_DEADLINE
}

/// Заканчивается, когда нажали «Остановить».
async fn stop_pressed(stop: &AtomicBool) {
    while !stop.load(Ordering::SeqCst) {
        tokio::time::sleep(STOP_POLL).await;
    }
}

/// Только вид сбоя: в тексте ошибки reqwest есть URL с токеном.
fn network(e: &reqwest::Error) -> SteamError {
    if e.is_timeout() {
        SteamError::Network("timeout")
    } else if e.is_connect() {
        SteamError::Network("connection failed")
    } else {
        SteamError::Network("request failed")
    }
}

/// Пауза для тестов: не ждёт, а записывает длительность.
#[cfg(test)]
pub(crate) fn recording_sleep() -> (SleepFn, Arc<Mutex<Vec<Duration>>>) {
    let slept = Arc::new(Mutex::new(Vec::new()));
    let log = slept.clone();
    let sleep: SleepFn = Arc::new(move |d| {
        log.lock().unwrap().push(d);
        Box::pin(async {})
    });
    (sleep, slept)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::inventory::{self, Inventory};
    use crate::token::test_token;
    use serde_json::json;
    use wiremock::matchers::{body_string_contains, method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    const INV: &str = "/IEconService/GetInventoryItemsWithDescriptions/v1/";
    const SPLIT: &str = "/IInventoryService/SplitItemStack/v1/";
    const COMBINE: &str = "/IInventoryService/CombineItemStacks/v1/";
    /// Адрес, где никто не слушает: сбой сети.
    const DEAD: &str = "http://127.0.0.1:9";

    async fn setup() -> (MockServer, SteamClient, Arc<Mutex<Vec<Duration>>>) {
        let server = MockServer::start().await;
        let (sleep, slept) = recording_sleep();
        let client = SteamClient::new(&server.uri(), sleep);
        (server, client, slept)
    }

    fn secs(slept: &Arc<Mutex<Vec<Duration>>>) -> Vec<u64> {
        slept
            .lock()
            .unwrap()
            .iter()
            .map(Duration::as_secs)
            .collect()
    }

    fn empty_page() -> ResponseTemplate {
        ResponseTemplate::new(200).set_body_json(json!({"response": {"total_inventory_count": 0}}))
    }

    /// «Остановить» и ожидания по 429, о которых чтение сообщило окну.
    #[derive(Default)]
    struct Watch {
        stop: Arc<AtomicBool>,
        waits: Mutex<Vec<u64>>,
    }

    impl Watch {
        async fn page(
            &self,
            client: &SteamClient,
            start: Option<&str>,
        ) -> Result<Value, SteamError> {
            let on_wait = |seconds| self.waits.lock().unwrap().push(seconds);
            let on_page = |_: u32, _: Option<u32>| {};
            let control = ReadControl {
                stop: &self.stop,
                on_wait: &on_wait,
                on_page: &on_page,
            };
            client
                .inventory_page(&test_token(), start, "english", &control)
                .await
        }

        /// Весь инвентарь, страница за страницей.
        async fn load(&self, client: &SteamClient) -> Result<Inventory, SteamError> {
            let on_wait = |seconds| self.waits.lock().unwrap().push(seconds);
            let on_page = |_: u32, _: Option<u32>| {};
            let control = ReadControl {
                stop: &self.stop,
                on_wait: &on_wait,
                on_page: &on_page,
            };
            inventory::load(client, &test_token(), "english", &control).await
        }

        fn waits(&self) -> Vec<u64> {
            self.waits.lock().unwrap().clone()
        }
    }

    /// Первая страница, которую никто не останавливает.
    async fn first_page(client: &SteamClient) -> Result<Value, SteamError> {
        Watch::default().page(client, None).await
    }

    /// Пауза для тестов: записывает длительность, нажимает «Остановить» и сразу кончается — как настоящая пауза,
    /// которая кончилась раньше, чем опрос заметил нажатие.
    fn stopping_sleep(stop: &Arc<AtomicBool>) -> (SleepFn, Arc<Mutex<Vec<Duration>>>) {
        let (record, slept) = recording_sleep();
        let stop = stop.clone();
        let sleep: SleepFn = Arc::new(move |d| {
            let recorded = record(d);
            let stop = stop.clone();
            Box::pin(async move {
                recorded.await;
                stop.store(true, Ordering::SeqCst);
            })
        });
        (sleep, slept)
    }

    /// Пауза для тестов, которая сама не кончается: записывает длительность и нажимает «Остановить».
    /// Кончить её может только «Остановить».
    fn stuck_sleep(stop: &Arc<AtomicBool>) -> (SleepFn, Arc<Mutex<Vec<Duration>>>) {
        let slept = Arc::new(Mutex::new(Vec::new()));
        let log = slept.clone();
        let stop = stop.clone();
        let sleep: SleepFn = Arc::new(move |d| {
            log.lock().unwrap().push(d);
            stop.store(true, Ordering::SeqCst);
            Box::pin(std::future::pending())
        });
        (sleep, slept)
    }

    /// Не последняя страница: Steam называет курсор следующей.
    fn paged() -> ResponseTemplate {
        ResponseTemplate::new(200).set_body_json(json!({"response": {
            "assets": [], "total_inventory_count": 0, "more_items": 1, "last_assetid": "1001"
        }}))
    }

    async fn requests(server: &MockServer) -> usize {
        server.received_requests().await.unwrap_or_default().len()
    }

    /// Нажимает «Остановить», как только `ready` скажет «пора» (ждёт не дольше 10 с). Возвращает момент нажатия.
    async fn press_stop<F: Future<Output = bool>>(
        stop: &AtomicBool,
        ready: impl Fn() -> F,
    ) -> Instant {
        let wait = async {
            while !ready().await {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        };
        tokio::time::timeout(Duration::from_secs(10), wait)
            .await
            .expect("the moment to press Stop never came");
        stop.store(true, Ordering::SeqCst);
        Instant::now()
    }

    #[tokio::test]
    async fn inventory_page_sends_params_and_returns_response() {
        let (server, client, _) = setup().await;
        Mock::given(method("GET"))
            .and(path(INV))
            .and(query_param("access_token", "tok-SECRET-value"))
            .and(query_param("steamid", "76561190000000001"))
            .and(query_param("appid", "252490"))
            .and(query_param("contextid", "2"))
            .and(query_param("get_descriptions", "true"))
            .and(query_param("language", "english"))
            .and(query_param("count", "500"))
            .and(query_param("start_assetid", "42"))
            .respond_with(empty_page())
            .expect(1)
            .mount(&server)
            .await;
        let page = Watch::default().page(&client, Some("42")).await.unwrap();
        assert_eq!(page["total_inventory_count"], 0);
    }

    #[tokio::test]
    async fn inventory_page_waits_retry_after_on_429() {
        let (server, client, slept) = setup().await;
        Mock::given(method("GET"))
            .and(path(INV))
            .respond_with(ResponseTemplate::new(429).insert_header("Retry-After", "2"))
            .up_to_n_times(1)
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path(INV))
            .respond_with(empty_page())
            .mount(&server)
            .await;
        first_page(&client).await.unwrap();
        assert_eq!(secs(&slept), vec![2]);
    }

    #[tokio::test]
    async fn retry_after_is_capped_at_60_seconds() {
        let (server, client, slept) = setup().await;
        Mock::given(method("GET"))
            .and(path(INV))
            .respond_with(ResponseTemplate::new(429).insert_header("Retry-After", "600"))
            .up_to_n_times(1)
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path(INV))
            .respond_with(empty_page())
            .mount(&server)
            .await;
        first_page(&client).await.unwrap();
        assert_eq!(secs(&slept), vec![60]);
    }

    #[tokio::test]
    async fn inventory_page_gives_up_after_three_retries_on_5xx() {
        let (server, client, slept) = setup().await;
        Mock::given(method("GET"))
            .and(path(INV))
            .respond_with(ResponseTemplate::new(502))
            .expect(4)
            .mount(&server)
            .await;
        let err = first_page(&client).await.unwrap_err();
        assert_eq!(err, SteamError::Http(502));
        assert_eq!(secs(&slept), vec![10, 20, 30]);
    }

    #[tokio::test]
    async fn inventory_page_does_not_retry_401() {
        let (server, client, slept) = setup().await;
        Mock::given(method("GET"))
            .and(path(INV))
            .respond_with(ResponseTemplate::new(401))
            .expect(1)
            .mount(&server)
            .await;
        let err = first_page(&client).await.unwrap_err();
        assert_eq!(err, SteamError::Auth(401));
        assert!(secs(&slept).is_empty());
    }

    #[tokio::test]
    async fn inventory_page_without_response_is_bad() {
        let (server, client, _) = setup().await;
        Mock::given(method("GET"))
            .and(path(INV))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({})))
            .mount(&server)
            .await;
        let err = first_page(&client).await.unwrap_err();
        assert_eq!(err, SteamError::BadResponse);
    }

    /// Медленный тест: на Windows отказ в соединении с локальным портом приходит примерно через секунду.
    #[tokio::test]
    async fn inventory_page_retries_network_errors() {
        let (sleep, slept) = recording_sleep();
        let client = SteamClient::new(DEAD, sleep);
        let err = first_page(&client).await.unwrap_err();
        assert!(matches!(err, SteamError::Network(_)));
        assert_eq!(secs(&slept), vec![5, 10, 15]);
    }

    /// Окну сообщается только ожидание по 429: при 5xx Steam подождать не просил.
    #[tokio::test]
    async fn only_rate_limit_waits_are_reported_to_the_window() {
        let (server, client, slept) = setup().await;
        Mock::given(method("GET"))
            .and(path(INV))
            .respond_with(ResponseTemplate::new(429).insert_header("Retry-After", "2"))
            .up_to_n_times(1)
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path(INV))
            .respond_with(ResponseTemplate::new(502))
            .up_to_n_times(1)
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path(INV))
            .respond_with(empty_page())
            .mount(&server)
            .await;
        let watch = Watch::default();
        watch.page(&client, None).await.unwrap();
        assert_eq!(secs(&slept), vec![2, 20]);
        assert_eq!(watch.waits(), vec![2]);
    }

    #[test]
    fn a_retry_needs_room_for_the_wait_and_a_full_request() {
        let s = Duration::from_secs;
        // Самое долгое ожидание помещается даже после запроса, ушедшего в таймаут, но не секундой позже.
        assert!(retry_fits(s(30), s(60)));
        assert!(!retry_fits(s(31), s(60)));
        // Время запросов считается: после двух таймаутов и ожиданий 5 и 10 с на третье ожидание места нет.
        assert!(retry_fits(s(30 + 5 + 30), s(10)));
        assert!(!retry_fits(s(30 + 5 + 30 + 10 + 30), s(15)));
        // При быстрых ответах помещается вся лестница 5xx.
        assert!(retry_fits(s(10 + 20), s(30)));
    }

    /// Второе ожидание в 60 с и таймаут запроса после него в общий срок не помещаются:
    /// чтение отдаёт ошибку, не начиная ожидания.
    #[tokio::test]
    async fn retries_end_at_the_deadline() {
        let (server, client, slept) = setup().await;
        Mock::given(method("GET"))
            .and(path(INV))
            .respond_with(ResponseTemplate::new(429).insert_header("Retry-After", "60"))
            .expect(2)
            .mount(&server)
            .await;
        let watch = Watch::default();
        let err = watch.page(&client, None).await.unwrap_err();
        assert_eq!(
            err,
            SteamError::RateLimited {
                retry_after: Some(60)
            }
        );
        assert_eq!(secs(&slept), vec![60]);
        assert_eq!(watch.waits(), vec![60]);
    }

    #[tokio::test]
    async fn stopped_read_sends_nothing() {
        let (server, client, _) = setup().await;
        Mock::given(method("GET"))
            .respond_with(empty_page())
            .expect(0)
            .mount(&server)
            .await;
        let watch = Watch::default();
        watch.stop.store(true, Ordering::SeqCst);
        let err = watch.page(&client, None).await.unwrap_err();
        assert_eq!(err, SteamError::Stopped);
    }

    /// «Остановить» нажали во время ожидания перед повтором: повторного запроса нет.
    #[tokio::test]
    async fn stop_during_a_retry_wait_sends_no_retry() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path(INV))
            .respond_with(ResponseTemplate::new(429).insert_header("Retry-After", "30"))
            .expect(1)
            .mount(&server)
            .await;
        let watch = Watch::default();
        let (sleep, slept) = stopping_sleep(&watch.stop);
        let client = SteamClient::new(&server.uri(), sleep);
        let err = watch.page(&client, None).await.unwrap_err();
        assert_eq!(err, SteamError::Stopped);
        assert_eq!(secs(&slept), vec![30]);
    }

    /// Настоящее ожидание в 30 с: «Остановить» обрывает его быстрее секунды.
    #[tokio::test]
    async fn stop_ends_a_real_retry_wait_within_a_second() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path(INV))
            .respond_with(ResponseTemplate::new(429).insert_header("Retry-After", "30"))
            .expect(1)
            .mount(&server)
            .await;
        let client = SteamClient::new(&server.uri(), tokio_sleep());
        let watch = Watch::default();
        let (result, pressed) = tokio::join!(
            watch.page(&client, None),
            press_stop(&watch.stop, || async { !watch.waits().is_empty() })
        );
        let took = pressed.elapsed();
        assert_eq!(result.unwrap_err(), SteamError::Stopped);
        assert!(took < Duration::from_secs(1), "{took:?}");
    }

    /// Ответ задерживается на 5 с: «Остановить» бросает запрос в пути быстрее секунды.
    #[tokio::test]
    async fn stop_drops_the_request_in_flight_within_a_second() {
        let (server, client, slept) = setup().await;
        Mock::given(method("GET"))
            .and(path(INV))
            .respond_with(empty_page().set_delay(Duration::from_secs(5)))
            .expect(1)
            .mount(&server)
            .await;
        let watch = Watch::default();
        let server = &server;
        let (result, pressed) = tokio::join!(
            watch.page(&client, None),
            press_stop(&watch.stop, || async move { requests(server).await > 0 })
        );
        let took = pressed.elapsed();
        assert_eq!(result.unwrap_err(), SteamError::Stopped);
        assert!(took < Duration::from_secs(1), "{took:?}");
        assert!(secs(&slept).is_empty());
    }

    /// Перед второй страницей — пауза, перед первой и после последней паузы нет.
    #[tokio::test]
    async fn pages_after_the_first_wait_a_page_pause() {
        let (server, client, slept) = setup().await;
        Mock::given(method("GET"))
            .and(path(INV))
            .respond_with(paged())
            .up_to_n_times(1)
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path(INV))
            .and(query_param("start_assetid", "1001"))
            .respond_with(empty_page())
            .expect(1)
            .mount(&server)
            .await;
        Watch::default().load(&client).await.unwrap();
        assert_eq!(*slept.lock().unwrap(), vec![PAGE_PAUSE]);
        assert_eq!(requests(&server).await, 2);
    }

    #[tokio::test]
    async fn one_page_has_no_page_pause() {
        let (server, client, slept) = setup().await;
        Mock::given(method("GET"))
            .and(path(INV))
            .respond_with(empty_page())
            .expect(1)
            .mount(&server)
            .await;
        Watch::default().load(&client).await.unwrap();
        assert!(secs(&slept).is_empty());
    }

    /// «Остановить» нажали во время паузы между страницами: пауза обрывается, второй страницы не просим.
    #[tokio::test]
    async fn stop_during_the_page_pause_asks_for_no_more_pages() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path(INV))
            .respond_with(paged())
            .expect(1)
            .mount(&server)
            .await;
        let watch = Watch::default();
        let (sleep, slept) = stuck_sleep(&watch.stop);
        let client = SteamClient::new(&server.uri(), sleep);
        let read = tokio::time::timeout(Duration::from_secs(10), watch.load(&client));
        let err = read
            .await
            .expect("Stop did not end the page pause")
            .unwrap_err();
        assert_eq!(err, SteamError::Stopped);
        assert_eq!(*slept.lock().unwrap(), vec![PAGE_PAUSE]);
        assert_eq!(requests(&server).await, 1);
    }

    #[tokio::test]
    async fn split_posts_form() {
        let (server, client, _) = setup().await;
        Mock::given(method("POST"))
            .and(path(SPLIT))
            .and(body_string_contains("appid=252490"))
            .and(body_string_contains("itemid=1001"))
            .and(body_string_contains("quantity=1"))
            .and(body_string_contains("steamid=76561190000000001"))
            .and(body_string_contains("access_token=tok-SECRET-value"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"response": {}})))
            .expect(1)
            .mount(&server)
            .await;
        client.split(&test_token(), "1001", 1).await.unwrap();
    }

    #[tokio::test]
    async fn combine_posts_form() {
        let (server, client, _) = setup().await;
        Mock::given(method("POST"))
            .and(path(COMBINE))
            .and(body_string_contains("fromitemid=1002"))
            .and(body_string_contains("destitemid=1001"))
            .and(body_string_contains("quantity=4"))
            .and(body_string_contains("steamid=76561190000000001"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"response": {}})))
            .expect(1)
            .mount(&server)
            .await;
        client
            .combine(&test_token(), "1002", "1001", 4)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn post_returns_429_without_waiting() {
        let (server, client, slept) = setup().await;
        Mock::given(method("POST"))
            .and(path(SPLIT))
            .respond_with(ResponseTemplate::new(429).insert_header("Retry-After", "5"))
            .expect(1)
            .mount(&server)
            .await;
        let err = client.split(&test_token(), "1001", 1).await.unwrap_err();
        assert_eq!(
            err,
            SteamError::RateLimited {
                retry_after: Some(5)
            }
        );
        assert!(secs(&slept).is_empty());
    }

    #[tokio::test]
    async fn post_does_not_retry_5xx() {
        let (server, client, _) = setup().await;
        Mock::given(method("POST"))
            .and(path(COMBINE))
            .respond_with(ResponseTemplate::new(500))
            .expect(1)
            .mount(&server)
            .await;
        let err = client
            .combine(&test_token(), "1002", "1001", 1)
            .await
            .unwrap_err();
        assert_eq!(err, SteamError::Http(500));
    }

    #[tokio::test]
    async fn post_reports_eresult_rejection() {
        let (server, client, _) = setup().await;
        Mock::given(method("POST"))
            .and(path(SPLIT))
            .respond_with(ResponseTemplate::new(200).insert_header("x-eresult", "8"))
            .mount(&server)
            .await;
        let err = client.split(&test_token(), "1001", 1).await.unwrap_err();
        assert_eq!(err, SteamError::Rejected(8));
    }

    #[tokio::test]
    async fn post_with_eresult_one_is_success() {
        let (server, client, _) = setup().await;
        Mock::given(method("POST"))
            .and(path(SPLIT))
            .respond_with(ResponseTemplate::new(200).insert_header("x-eresult", "1"))
            .expect(1)
            .mount(&server)
            .await;
        client.split(&test_token(), "1001", 1).await.unwrap();
    }

    #[tokio::test]
    async fn post_with_malformed_eresult_is_bad_response() {
        let (server, client, _) = setup().await;
        Mock::given(method("POST"))
            .and(path(SPLIT))
            .respond_with(ResponseTemplate::new(200).insert_header("x-eresult", "abc"))
            .expect(1)
            .mount(&server)
            .await;
        let err = client.split(&test_token(), "1001", 1).await.unwrap_err();
        assert_eq!(err, SteamError::BadResponse);
    }

    /// Редирект на другой адрес: туда не должен уйти ни один запрос, в нём токен.
    async fn mount_redirect(server: &MockServer, verb: &str, from: &str, status: u16) {
        Mock::given(method(verb))
            .and(path(from))
            .respond_with(
                ResponseTemplate::new(status)
                    .insert_header("Location", format!("{}/elsewhere", server.uri())),
            )
            .expect(1)
            .mount(server)
            .await;
        // Без проверки метода: цель не должна получить ни GET, ни POST.
        Mock::given(path("/elsewhere"))
            .respond_with(empty_page())
            .expect(0)
            .mount(server)
            .await;
    }

    #[tokio::test]
    async fn get_does_not_follow_redirects() {
        let (server, client, slept) = setup().await;
        mount_redirect(&server, "GET", INV, 302).await;
        let err = first_page(&client).await.unwrap_err();
        assert_eq!(err, SteamError::Http(302));
        assert!(secs(&slept).is_empty());
        server.verify().await;
    }

    #[tokio::test]
    async fn post_does_not_follow_redirects() {
        let (server, client, slept) = setup().await;
        mount_redirect(&server, "POST", SPLIT, 307).await;
        let err = client.split(&test_token(), "1001", 1).await.unwrap_err();
        assert_eq!(err, SteamError::Http(307));
        assert!(secs(&slept).is_empty());
        server.verify().await;
    }

    #[tokio::test]
    async fn post_network_error_is_not_retried() {
        let (sleep, slept) = recording_sleep();
        let client = SteamClient::new(DEAD, sleep);
        let err = client.split(&test_token(), "1001", 1).await.unwrap_err();
        assert!(matches!(err, SteamError::Network(_)));
        assert!(secs(&slept).is_empty());
        assert!(!format!("{err} {err:?}").contains("tok-SECRET"));
    }

    #[test]
    fn error_texts_never_contain_token_or_url() {
        let errors = [
            SteamError::Auth(401),
            SteamError::RateLimited {
                retry_after: Some(5),
            },
            SteamError::Http(500),
            SteamError::Rejected(8),
            SteamError::Network("connection failed"),
            SteamError::BadResponse,
            SteamError::PagingLoop,
            SteamError::TooLarge,
            SteamError::Stopped,
        ];
        for e in errors {
            let shown = format!("{e} {e:?}");
            assert!(!shown.contains("tok-SECRET"), "{shown}");
            assert!(!shown.contains("access_token"), "{shown}");
            assert!(!shown.contains("http"), "{shown}");
        }
    }
}
