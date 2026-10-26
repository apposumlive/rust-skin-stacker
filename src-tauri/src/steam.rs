//! HTTP к Steam Web API. В текстах ошибок нет ни URL, ни параметров, потому что
//! в них токен. Поэтому ошибки reqwest наружу никогда не форматируются.

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
#[cfg(test)]
use std::sync::Mutex;
use std::time::Duration;

use reqwest::header::CONTENT_TYPE;
use serde_json::Value;
use url::{Url, form_urlencoded};

use crate::token::Token;

pub const API_BASE: &str = "https://api.steampowered.com";
pub const RUST_APPID: u32 = 252490;
pub const RUST_CONTEXTID: u32 = 2;
pub const PAGE_SIZE: u32 = 500;
/// Сколько раз повторять чтение инвентаря при 429, 5xx и сбое сети.
pub const GET_RETRIES: u64 = 3;
/// Дольше ждать по `Retry-After` не будем.
pub const MAX_RETRY_AFTER: u64 = 60;

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
            .timeout(Duration::from_secs(30))
            .build()
            .expect("HTTP client");
        Self {
            http,
            base: base.trim_end_matches('/').to_string(),
            sleep,
        }
    }

    /// Одна страница инвентаря Rust: объект `response` из ответа Steam.
    /// Повторяется при 429, 5xx и сбое сети, не больше `GET_RETRIES` раз.
    pub async fn inventory_page(
        &self,
        token: &Token,
        start_assetid: Option<&str>,
        language: &str,
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
        loop {
            let outcome = match self.http.get(url.clone()).send().await {
                Ok(resp) => read_json(resp).await,
                Err(e) => Err(network(&e)),
            };
            let wait = match &outcome {
                Err(SteamError::Network(_)) => Some(5 * (attempt + 1)),
                Err(SteamError::RateLimited { retry_after }) => {
                    Some(retry_after.unwrap_or(10 * (attempt + 1)))
                }
                Err(SteamError::Http(status)) if *status >= 500 => Some(10 * (attempt + 1)),
                _ => None,
            };
            match wait {
                Some(secs) if attempt < GET_RETRIES => {
                    attempt += 1;
                    (self.sleep)(Duration::from_secs(secs.min(MAX_RETRY_AFTER))).await;
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
    if let Some(code) = header_number::<i32>(&resp, "x-eresult")
        && code != 1
    {
        return Err(SteamError::Rejected(code));
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
        let page = client
            .inventory_page(&test_token(), Some("42"), "english")
            .await
            .unwrap();
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
        client
            .inventory_page(&test_token(), None, "english")
            .await
            .unwrap();
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
        client
            .inventory_page(&test_token(), None, "english")
            .await
            .unwrap();
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
        let err = client
            .inventory_page(&test_token(), None, "english")
            .await
            .unwrap_err();
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
        let err = client
            .inventory_page(&test_token(), None, "english")
            .await
            .unwrap_err();
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
        let err = client
            .inventory_page(&test_token(), None, "english")
            .await
            .unwrap_err();
        assert_eq!(err, SteamError::BadResponse);
    }

    /// Медленный тест: на Windows отказ в соединении с локальным портом приходит примерно через секунду.
    #[tokio::test]
    async fn inventory_page_retries_network_errors() {
        let (sleep, slept) = recording_sleep();
        let client = SteamClient::new(DEAD, sleep);
        let err = client
            .inventory_page(&test_token(), None, "english")
            .await
            .unwrap_err();
        assert!(matches!(err, SteamError::Network(_)));
        assert_eq!(secs(&slept), vec![5, 10, 15]);
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
        ];
        for e in errors {
            let shown = format!("{e} {e:?}");
            assert!(!shown.contains("tok-SECRET"), "{shown}");
            assert!(!shown.contains("access_token"), "{shown}");
            assert!(!shown.contains("http"), "{shown}");
        }
    }
}
