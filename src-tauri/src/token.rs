//! Токен Steam: находит JWT во вставленном тексте, проверяет срок и SteamID.
//! Значение токена не печатается ни в Debug, ни в журнале, ни в текстах ошибок.

use std::fmt;
use std::sync::OnceLock;

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use regex::Regex;
use serde::Serialize;
use serde_json::Value;

/// Значение токена. Наружу отдаётся только через `expose()` — для запроса к Steam.
#[derive(Clone, PartialEq, Eq)]
pub struct Secret(String);

impl Secret {
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Secret(***)")
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Token {
    pub secret: Secret,
    pub steamid: String,
    /// Unix-время окончания, секунды.
    pub expires_at: i64,
}

/// То, что видит окно: сокращённый SteamID и срок.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenInfo {
    pub steamid_masked: String,
    pub expires_at: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum TokenError {
    #[error("no Steam token found in the pasted text")]
    NotFound,
    #[error("the token has no expiry")]
    NoExpiry,
    #[error("the token has expired")]
    Expired,
    #[error("the SteamID in the cookie does not match the token")]
    SteamIdMismatch,
}

impl Token {
    pub fn info(&self) -> TokenInfo {
        TokenInfo {
            steamid_masked: mask_steamid(&self.steamid),
            expires_at: self.expires_at,
        }
    }

    pub fn is_expired(&self, now: i64) -> bool {
        self.expires_at <= now
    }
}

/// «76561190000000001» → «7656…0001».
pub fn mask_steamid(id: &str) -> String {
    if id.len() <= 8 || !id.is_ascii() {
        return id.to_string();
    }
    format!("{}…{}", &id[..4], &id[id.len() - 4..])
}

/// Ищет токен в тексте: ответ `ajaxgetasyncconfig` целиком, сам `webapi_token`
/// или cookie `steamLoginSecure` (`steamid%7C%7Cjwt`). Возвращает первый годный.
/// Если годного нет, ошибка относится к первому кандидату, похожему на токен Steam.
pub fn parse_token(raw: &str, now: i64) -> Result<Token, TokenError> {
    let text = raw.replace("%7C", "|").replace("%7c", "|");
    let mut error = TokenError::NotFound;
    for cap in candidates().captures_iter(&text) {
        let cookie_steamid = cap.get(1).map(|m| m.as_str());
        match check(&cap[2], cookie_steamid, now) {
            Ok(token) => return Ok(token),
            Err(TokenError::NotFound) => {}
            Err(e) if error == TokenError::NotFound => error = e,
            Err(_) => {}
        }
    }
    Err(error)
}

fn candidates() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?:(\d{17})\|\|)?(ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)")
            .expect("valid regex")
    })
}

fn check(jwt: &str, cookie_steamid: Option<&str>, now: i64) -> Result<Token, TokenError> {
    let mut parts = jwt.split('.');
    let header = parts.next().and_then(decode).ok_or(TokenError::NotFound)?;
    let payload = parts.next().and_then(decode).ok_or(TokenError::NotFound)?;
    if !header.is_object() {
        return Err(TokenError::NotFound);
    }
    let steamid = payload
        .get("sub")
        .and_then(Value::as_str)
        .filter(|s| is_steamid(s))
        .ok_or(TokenError::NotFound)?;
    let expires_at = payload
        .get("exp")
        .and_then(Value::as_i64)
        .ok_or(TokenError::NoExpiry)?;
    if expires_at <= now {
        return Err(TokenError::Expired);
    }
    if cookie_steamid.is_some_and(|id| id != steamid) {
        return Err(TokenError::SteamIdMismatch);
    }
    Ok(Token {
        secret: Secret(jwt.to_string()),
        steamid: steamid.to_string(),
        expires_at,
    })
}

fn decode(part: &str) -> Option<Value> {
    let bytes = URL_SAFE_NO_PAD.decode(part).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn is_steamid(s: &str) -> bool {
    s.len() == 17 && s.bytes().all(|b| b.is_ascii_digit())
}

/// Токен для тестов других модулей. SteamID выдуманный.
#[cfg(test)]
pub(crate) fn test_token() -> Token {
    Token {
        secret: Secret("tok-SECRET-value".to_string()),
        steamid: "76561190000000001".to_string(),
        expires_at: i64::MAX,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;

    const ID: &str = "76561190000000001";
    const NOW: i64 = 1_800_000_000;

    fn b64(s: &str) -> String {
        URL_SAFE_NO_PAD.encode(s)
    }

    /// Заголовок с пробелами, как у Steam: он кодируется в «eyAi…».
    fn jwt(payload: &str) -> String {
        format!(
            "{}.{}.c2lnbmF0dXJl",
            b64(r#"{ "typ": "JWT", "alg": "EdDSA" }"#),
            b64(payload)
        )
    }

    fn payload(sub: &str, exp: i64) -> String {
        format!(r#"{{"iss":"r:0","sub":"{sub}","aud":["web"],"exp":{exp}}}"#)
    }

    #[test]
    fn steam_header_starts_with_ey_ai() {
        assert!(jwt(&payload(ID, NOW + 10)).starts_with("eyAi"));
    }

    #[test]
    fn parses_bare_jwt() {
        let raw = jwt(&payload(ID, NOW + 3600));
        let token = parse_token(&raw, NOW).unwrap();
        assert_eq!(token.steamid, ID);
        assert_eq!(token.expires_at, NOW + 3600);
        assert_eq!(token.secret.expose(), raw);
    }

    #[test]
    fn parses_standard_jwt_header() {
        let raw = format!(
            "{}.{}.c2ln",
            b64(r#"{"alg":"EdDSA","typ":"JWT"}"#),
            b64(&payload(ID, NOW + 60))
        );
        assert!(raw.starts_with("eyJ"));
        assert_eq!(parse_token(&raw, NOW).unwrap().steamid, ID);
    }

    #[test]
    fn parses_whole_page_json() {
        let token = jwt(&payload(ID, NOW + 60));
        let page = format!(
            r#"{{"success":1,"data":{{"webapi_token":"{token}","webapi_token_expiration":0}}}}"#
        );
        assert_eq!(parse_token(&page, NOW).unwrap().secret.expose(), token);
    }

    #[test]
    fn parses_page_copied_as_text() {
        let token = jwt(&payload(ID, NOW + 60));
        let text = format!("success: 1\ndata:\n  webapi_token: {token}\n  other: x");
        assert_eq!(parse_token(&text, NOW).unwrap().secret.expose(), token);
    }

    #[test]
    fn parses_cookie_with_encoded_separator() {
        let token = jwt(&payload(ID, NOW + 60));
        let cookie = format!("steamLoginSecure={ID}%7C%7C{token}");
        let parsed = parse_token(&cookie, NOW).unwrap();
        assert_eq!(parsed.secret.expose(), token);
        assert_eq!(parsed.steamid, ID);
    }

    #[test]
    fn rejects_cookie_with_other_steamid() {
        let token = jwt(&payload(ID, NOW + 60));
        let cookie = format!("76561190000000002||{token}");
        assert_eq!(parse_token(&cookie, NOW), Err(TokenError::SteamIdMismatch));
    }

    #[test]
    fn rejects_expired_token() {
        assert_eq!(
            parse_token(&jwt(&payload(ID, NOW)), NOW),
            Err(TokenError::Expired)
        );
    }

    #[test]
    fn rejects_token_without_expiry() {
        let raw = jwt(&format!(r#"{{"sub":"{ID}"}}"#));
        assert_eq!(parse_token(&raw, NOW), Err(TokenError::NoExpiry));
    }

    #[test]
    fn rejects_text_without_token() {
        assert_eq!(parse_token("hello", NOW), Err(TokenError::NotFound));
        assert_eq!(
            parse_token("eyXX.not.base64!", NOW),
            Err(TokenError::NotFound)
        );
    }

    #[test]
    fn skips_junk_candidate_before_real_token() {
        let token = jwt(&payload(ID, NOW + 60));
        let text = format!("eyJunk.junk.junk {token}");
        assert_eq!(parse_token(&text, NOW).unwrap().secret.expose(), token);
    }

    #[test]
    fn debug_never_shows_secret() {
        let token = parse_token(&jwt(&payload(ID, NOW + 60)), NOW).unwrap();
        let shown = format!("{token:?}");
        assert!(!shown.contains(token.secret.expose()));
        assert!(shown.contains("***"));
    }

    #[test]
    fn info_masks_steamid() {
        let token = parse_token(&jwt(&payload(ID, NOW + 60)), NOW).unwrap();
        assert_eq!(
            token.info(),
            TokenInfo {
                steamid_masked: "7656…0001".into(),
                expires_at: NOW + 60
            }
        );
        assert!(!token.is_expired(NOW));
        assert!(token.is_expired(NOW + 60));
    }

    #[test]
    fn info_serializes_in_camel_case() {
        let info = TokenInfo {
            steamid_masked: "7656…0001".into(),
            expires_at: 5,
        };
        assert_eq!(
            serde_json::to_string(&info).unwrap(),
            r#"{"steamidMasked":"7656…0001","expiresAt":5}"#
        );
    }

    #[test]
    fn test_token_hides_its_value() {
        let token = test_token();
        assert!(!format!("{token:?}").contains("tok-SECRET"));
        assert!(!token.is_expired(NOW));
    }
}
