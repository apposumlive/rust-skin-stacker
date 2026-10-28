//! Ответ Steam → скины Rust. Нечитаемая запись не пропадает: она попадает
//! в `unreadable` и учитывается в общем количестве.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;
use serde_json::Value;

use crate::steam::{ReadControl, SteamClient, SteamError};
use crate::token::Token;

/// 100 страниц по 500 записей — с запасом для инвентаря на тысячи предметов.
pub const MAX_PAGES: usize = 100;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    pub assetid: String,
    pub classid: String,
    pub instanceid: String,
    pub amount: u32,
    pub tradable: bool,
    pub marketable: bool,
    /// `cache_expiration` из описания, если предмет пока нельзя обменять.
    pub available_after: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    pub id: String,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Skin {
    /// `market_hash_name`, а без него `class:<classid>`.
    pub key: String,
    pub name: String,
    /// Хеш картинки на CDN Steam, только `[A-Za-z0-9_-]`.
    pub icon: Option<String>,
    pub category: Option<Category>,
    pub total: u32,
    /// По убыванию `amount`, при равенстве — по `assetid`.
    pub records: Vec<Record>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Unreadable {
    pub assetid: Option<String>,
    pub amount: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Inventory {
    /// По возрастанию `key`.
    pub skins: Vec<Skin>,
    pub unreadable: Vec<Unreadable>,
}

impl Inventory {
    /// Все штуки, включая нечитаемые записи.
    pub fn total(&self) -> u64 {
        let skins: u64 = self.skins.iter().map(|s| u64::from(s.total)).sum();
        let unreadable: u64 = self.unreadable.iter().map(|u| u64::from(u.amount)).sum();
        skins + unreadable
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Mismatch {
    pub key: String,
    pub name: String,
    pub before: u32,
    pub after: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reconciliation {
    pub before: u64,
    pub after: u64,
    pub mismatches: Vec<Mismatch>,
}

/// Весь инвентарь Rust: все страницы, затем разбор.
pub async fn load(
    client: &SteamClient,
    token: &Token,
    language: &str,
    control: &ReadControl<'_>,
) -> Result<Inventory, SteamError> {
    let pages = collect_pages(control.stop, |start| async move {
        client
            .inventory_page(token, start.as_deref(), language, control)
            .await
    })
    .await?;
    Ok(parse_pages(&pages))
}

/// Страницы подряд по курсору `last_assetid`, пока Steam отвечает `more_items`.
/// «Остановить» проверяется перед каждой страницей.
pub async fn collect_pages<F, Fut>(
    stop: &AtomicBool,
    mut get_page: F,
) -> Result<Vec<Value>, SteamError>
where
    F: FnMut(Option<String>) -> Fut,
    Fut: Future<Output = Result<Value, SteamError>>,
{
    let mut pages = Vec::new();
    let mut start = None;
    let mut seen = HashSet::new();
    for _ in 0..MAX_PAGES {
        if stop.load(Ordering::SeqCst) {
            return Err(SteamError::Stopped);
        }
        let page = get_page(start.take()).await?;
        let Some(obj) = page.as_object() else {
            return Err(SteamError::BadResponse);
        };
        if !obj.contains_key("assets") && !obj.contains_key("total_inventory_count") {
            return Err(SteamError::BadResponse);
        }
        if obj.get("assets").is_some_and(|a| !a.is_array()) {
            return Err(SteamError::BadResponse);
        }
        let more = truthy(obj.get("more_items"));
        let cursor = id_of(obj.get("last_assetid"));
        pages.push(page);
        if !more {
            return Ok(pages);
        }
        // Следующая страница есть, а курсора нет: молча обрезать инвентарь нельзя.
        let cursor = cursor.ok_or(SteamError::BadResponse)?;
        if !seen.insert(cursor.clone()) {
            return Err(SteamError::PagingLoop);
        }
        start = Some(cursor);
    }
    Err(SteamError::TooLarge)
}

pub fn parse_pages(pages: &[Value]) -> Inventory {
    let mut descriptions: HashMap<(String, String), &Value> = HashMap::new();
    let mut assets: Vec<&Value> = Vec::new();
    for page in pages {
        for d in array(page.get("descriptions")) {
            if let Some(classid) = id_of(d.get("classid")) {
                descriptions.insert((classid, instance_of(d)), d);
            }
        }
        assets.extend(array(page.get("assets")));
    }

    let mut skins: BTreeMap<String, Skin> = BTreeMap::new();
    let mut unreadable = Vec::new();
    for raw in assets {
        let Some((assetid, classid, amount)) = read_asset(raw) else {
            unreadable.push(Unreadable {
                assetid: id_of(raw.get("assetid")),
                amount: amount_or_one(raw.get("amount")),
            });
            continue;
        };
        let instanceid = instance_of(raw);
        let desc = descriptions
            .get(&(classid.clone(), instanceid.clone()))
            .copied();
        let key = skin_key(desc, &classid);
        let skin = skins
            .entry(key.clone())
            .or_insert_with(|| new_skin(key, desc, &classid));
        skin.total = skin.total.saturating_add(amount);
        skin.records.push(Record {
            assetid,
            classid,
            instanceid,
            amount,
            tradable: flag(desc, "tradable"),
            marketable: flag(desc, "marketable"),
            available_after: available_after(desc),
        });
    }
    let mut skins: Vec<Skin> = skins.into_values().collect();
    for skin in &mut skins {
        skin.records.sort_by(|a, b| {
            b.amount
                .cmp(&a.amount)
                .then_with(|| cmp_assetid(&a.assetid, &b.assetid))
        });
    }
    Inventory { skins, unreadable }
}

/// Порядок assetid как чисел: сначала по длине, затем по символам.
/// Строки Steam — десятичные числа без ведущих нулей.
pub fn cmp_assetid(a: &str, b: &str) -> std::cmp::Ordering {
    a.len().cmp(&b.len()).then_with(|| a.cmp(b))
}

/// Сумма `amount` по каждому скину до и после операции.
pub fn reconcile(before: &Inventory, after: &Inventory) -> Reconciliation {
    let mut totals: BTreeMap<&str, (&str, u32, u32)> = BTreeMap::new();
    for skin in &before.skins {
        totals
            .entry(skin.key.as_str())
            .or_insert((skin.name.as_str(), 0, 0))
            .1 += skin.total;
    }
    for skin in &after.skins {
        totals
            .entry(skin.key.as_str())
            .or_insert((skin.name.as_str(), 0, 0))
            .2 += skin.total;
    }
    let mismatches = totals
        .into_iter()
        .filter(|(_, (_, b, a))| b != a)
        .map(|(key, (name, before, after))| Mismatch {
            key: key.to_string(),
            name: name.to_string(),
            before,
            after,
        })
        .collect();
    Reconciliation {
        before: before.total(),
        after: after.total(),
        mismatches,
    }
}

fn read_asset(raw: &Value) -> Option<(String, String, u32)> {
    let assetid = id_of(raw.get("assetid"))?;
    let classid = id_of(raw.get("classid"))?;
    let amount = match raw.get("amount") {
        None | Some(Value::Null) => 1,
        Some(v) => number(v).filter(|n| *n >= 1)?,
    };
    Some((assetid, classid, amount))
}

fn amount_or_one(value: Option<&Value>) -> u32 {
    value.and_then(number).filter(|n| *n >= 1).unwrap_or(1)
}

fn instance_of(raw: &Value) -> String {
    id_of(raw.get("instanceid")).unwrap_or_else(|| "0".to_string())
}

fn skin_key(desc: Option<&Value>, classid: &str) -> String {
    text(desc, "market_hash_name").map_or_else(|| format!("class:{classid}"), str::to_string)
}

fn new_skin(key: String, desc: Option<&Value>, classid: &str) -> Skin {
    let name = text(desc, "market_name")
        .or_else(|| text(desc, "name"))
        .map_or_else(|| format!("classid {classid}"), str::to_string);
    Skin {
        key,
        name,
        icon: text(desc, "icon_url")
            .filter(|h| is_icon_hash(h))
            .map(str::to_string),
        category: category(desc),
        total: 0,
        records: Vec::new(),
    }
}

fn category(desc: Option<&Value>) -> Option<Category> {
    let tag = array(desc?.get("tags"))
        .iter()
        .find(|t| t.get("category").and_then(Value::as_str) == Some("steamcat"))?;
    let id = text(Some(tag), "internal_name").or_else(|| text(Some(tag), "localized_tag_name"))?;
    let label = text(Some(tag), "localized_tag_name")
        .or_else(|| text(Some(tag), "name"))
        .unwrap_or(id);
    Some(Category {
        id: id.to_string(),
        label: label.to_string(),
    })
}

fn available_after(desc: Option<&Value>) -> Option<String> {
    if flag(desc, "tradable") {
        return None;
    }
    text(desc, "cache_expiration").map(str::to_string)
}

fn flag(desc: Option<&Value>, field: &str) -> bool {
    truthy(desc.and_then(|d| d.get(field)))
}

fn is_icon_hash(hash: &str) -> bool {
    hash.len() <= 1024
        && hash
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

fn text<'a>(desc: Option<&'a Value>, field: &str) -> Option<&'a str> {
    desc?.get(field)?.as_str().filter(|s| !s.is_empty())
}

fn array(value: Option<&Value>) -> &[Value] {
    value
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
}

/// Идентификатор Steam: непустая строка или неотрицательное число.
fn id_of(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::String(s) if !s.is_empty() => Some(s.clone()),
        Value::Number(n) => n.as_u64().map(|n| n.to_string()),
        _ => None,
    }
}

fn number(value: &Value) -> Option<u32> {
    match value {
        Value::String(s) => s.trim().parse().ok(),
        Value::Number(n) => n.as_u64().and_then(|n| u32::try_from(n).ok()),
        _ => None,
    }
}

/// Steam пишет флаги по-разному: `1`, `true`, `"1"`.
fn truthy(value: Option<&Value>) -> bool {
    match value {
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|n| n != 0.0),
        Some(Value::String(s)) => s == "1" || s.eq_ignore_ascii_case("true"),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::VecDeque;
    use std::future::ready;

    fn desc(classid: &str, instanceid: &str, hash: &str) -> Value {
        json!({
            "classid": classid, "instanceid": instanceid,
            "market_hash_name": hash, "market_name": hash, "name": hash,
            "icon_url": "abc_DEF-123", "tradable": 1, "marketable": 1,
            "tags": [
                {"category": "itemclass", "internal_name": "revolver", "localized_tag_name": "Revolver"},
                {"category": "steamcat", "internal_name": "steamcat.weapon", "localized_tag_name": "Weapon"}
            ]
        })
    }

    fn asset(assetid: &str, classid: &str, instanceid: &str, amount: &str) -> Value {
        json!({"appid": 252490, "contextid": "2", "assetid": assetid, "classid": classid,
               "instanceid": instanceid, "amount": amount})
    }

    fn page(assets: Vec<Value>, descriptions: Vec<Value>) -> Value {
        json!({"assets": assets, "descriptions": descriptions, "total_inventory_count": 0})
    }

    /// «Остановить» не нажата.
    fn no_stop() -> AtomicBool {
        AtomicBool::new(false)
    }

    fn one_skin(inv: &Inventory) -> &Skin {
        assert_eq!(inv.skins.len(), 1, "{inv:?}");
        &inv.skins[0]
    }

    #[test]
    fn groups_records_of_one_skin_and_sorts_by_amount() {
        let inv = parse_pages(&[page(
            vec![
                asset("1001", "c1", "0", "1"),
                asset("1002", "c1", "0", "5"),
                asset("1003", "c1", "9", "4"),
            ],
            vec![
                desc("c1", "0", "Outlaw Revolver"),
                desc("c1", "9", "Outlaw Revolver"),
            ],
        )]);
        let skin = one_skin(&inv);
        assert_eq!(skin.key, "Outlaw Revolver");
        assert_eq!(skin.total, 10);
        let amounts: Vec<u32> = skin.records.iter().map(|r| r.amount).collect();
        assert_eq!(amounts, vec![5, 4, 1]);
        let ids: Vec<&str> = skin.records.iter().map(|r| r.assetid.as_str()).collect();
        assert_eq!(ids, vec!["1002", "1003", "1001"]);
        assert_eq!(skin.records[1].instanceid, "9");
        assert_eq!(inv.total(), 10);
    }

    #[test]
    fn equal_amounts_are_ordered_by_numeric_assetid() {
        // Входной порядок перемешан: без tie-break останется он, а строковое
        // сравнение поставит "10000000000" раньше "1001" и "9999999999".
        let inv = parse_pages(&[page(
            vec![
                asset("9999999999", "c1", "0", "1"),
                asset("10000000000", "c1", "0", "1"),
                asset("1001", "c1", "0", "1"),
            ],
            vec![desc("c1", "0", "Outlaw Revolver")],
        )]);
        let ids: Vec<&str> = one_skin(&inv)
            .records
            .iter()
            .map(|r| r.assetid.as_str())
            .collect();
        assert_eq!(ids, vec!["1001", "9999999999", "10000000000"]);
    }

    #[test]
    fn reads_description_fields() {
        let inv = parse_pages(&[page(
            vec![asset("1001", "c1", "0", "2")],
            vec![desc("c1", "0", "Tempered AK47")],
        )]);
        let skin = one_skin(&inv);
        assert_eq!(skin.name, "Tempered AK47");
        assert_eq!(skin.icon.as_deref(), Some("abc_DEF-123"));
        assert_eq!(
            skin.category,
            Some(Category {
                id: "steamcat.weapon".into(),
                label: "Weapon".into()
            })
        );
        let record = &skin.records[0];
        assert!(record.tradable && record.marketable);
        assert_eq!(record.available_after, None);
    }

    #[test]
    fn untradable_item_keeps_date() {
        let mut d = desc("c1", "0", "Twitch Hoodie");
        d["tradable"] = json!(0);
        d["marketable"] = json!(0);
        d["cache_expiration"] = json!("2026-11-02T07:00:00Z");
        let inv = parse_pages(&[page(vec![asset("1001", "c1", "0", "1")], vec![d])]);
        let record = &one_skin(&inv).records[0];
        assert!(!record.tradable && !record.marketable);
        assert_eq!(
            record.available_after.as_deref(),
            Some("2026-11-02T07:00:00Z")
        );
    }

    #[test]
    fn rejects_unsafe_icon_hash() {
        let mut d = desc("c1", "0", "Skin");
        d["icon_url"] = json!("../evil?x");
        let inv = parse_pages(&[page(vec![asset("1001", "c1", "0", "1")], vec![d])]);
        assert_eq!(one_skin(&inv).icon, None);
    }

    #[test]
    fn missing_description_falls_back_to_classid() {
        let inv = parse_pages(&[page(vec![asset("1001", "c7", "0", "3")], vec![])]);
        let skin = one_skin(&inv);
        assert_eq!(skin.key, "class:c7");
        assert_eq!(skin.name, "classid c7");
        assert_eq!(skin.icon, None);
        assert_eq!(skin.category, None);
    }

    #[test]
    fn missing_amount_means_one_and_numeric_ids_are_read() {
        let raw = json!({"assetid": 1001, "classid": 7, "instanceid": 0});
        let inv = parse_pages(&[page(vec![raw], vec![])]);
        let record = &one_skin(&inv).records[0];
        assert_eq!(record.assetid, "1001");
        assert_eq!(record.classid, "7");
        assert_eq!(record.amount, 1);
    }

    #[test]
    fn unreadable_records_are_kept_and_counted() {
        let inv = parse_pages(&[page(
            vec![
                json!({"classid": "c1", "amount": "3"}),
                asset("1002", "c1", "0", "0"),
                asset("1003", "c1", "0", "abc"),
                json!("junk"),
                json!({"assetid": "1004", "amount": "2"}),
                asset("1005", "c1", "0", "2"),
            ],
            vec![desc("c1", "0", "Skin")],
        )]);
        assert_eq!(
            inv.unreadable,
            vec![
                Unreadable {
                    assetid: None,
                    amount: 3
                },
                Unreadable {
                    assetid: Some("1002".into()),
                    amount: 1
                },
                Unreadable {
                    assetid: Some("1003".into()),
                    amount: 1
                },
                Unreadable {
                    assetid: None,
                    amount: 1
                },
                Unreadable {
                    assetid: Some("1004".into()),
                    amount: 2
                },
            ]
        );
        assert_eq!(one_skin(&inv).total, 2);
        assert_eq!(inv.total(), 10);
    }

    #[test]
    fn merges_descriptions_across_pages() {
        let inv = parse_pages(&[
            page(vec![], vec![desc("c1", "0", "Skin")]),
            page(vec![asset("1001", "c1", "0", "1")], vec![]),
        ]);
        assert_eq!(one_skin(&inv).name, "Skin");
    }

    #[test]
    fn skins_are_ordered_by_key() {
        let inv = parse_pages(&[page(
            vec![asset("1", "c2", "0", "1"), asset("2", "c1", "0", "1")],
            vec![desc("c2", "0", "Zebra"), desc("c1", "0", "Alpha")],
        )]);
        let keys: Vec<&str> = inv.skins.iter().map(|s| s.key.as_str()).collect();
        assert_eq!(keys, vec!["Alpha", "Zebra"]);
    }

    #[tokio::test]
    async fn collects_pages_until_more_items_is_false() {
        let mut replies: VecDeque<Result<Value, SteamError>> = VecDeque::from([
            Ok(json!({"assets": [], "more_items": 1, "last_assetid": "10"})),
            Ok(json!({"assets": [], "total_inventory_count": 0})),
        ]);
        let mut starts = Vec::new();
        let pages = collect_pages(&no_stop(), |start| {
            starts.push(start);
            ready(replies.pop_front().unwrap())
        })
        .await
        .unwrap();
        assert_eq!(pages.len(), 2);
        assert_eq!(starts, vec![None, Some("10".to_string())]);
    }

    #[tokio::test]
    async fn repeated_cursor_is_a_loop() {
        let err = collect_pages(&no_stop(), |_| {
            ready(Ok(
                json!({"assets": [], "more_items": true, "last_assetid": "10"}),
            ))
        })
        .await
        .unwrap_err();
        assert_eq!(err, SteamError::PagingLoop);
    }

    #[tokio::test]
    async fn more_items_without_cursor_is_bad() {
        let err = collect_pages(&no_stop(), |_| {
            ready(Ok(json!({"assets": [], "more_items": true})))
        })
        .await
        .unwrap_err();
        assert_eq!(err, SteamError::BadResponse);
    }

    #[tokio::test]
    async fn page_that_is_not_an_inventory_is_bad() {
        for bad in [
            json!([]),
            json!({}),
            json!({"assets": "x", "total_inventory_count": 1}),
        ] {
            let err = collect_pages(&no_stop(), |_| ready(Ok(bad.clone())))
                .await
                .unwrap_err();
            assert_eq!(err, SteamError::BadResponse, "{bad}");
        }
    }

    #[tokio::test]
    async fn endless_inventory_is_too_large() {
        let mut n = 0;
        let err = collect_pages(&no_stop(), |_| {
            n += 1;
            ready(Ok(
                json!({"assets": [], "more_items": true, "last_assetid": n.to_string()}),
            ))
        })
        .await
        .unwrap_err();
        assert_eq!(err, SteamError::TooLarge);
        assert_eq!(n, MAX_PAGES);
    }

    #[tokio::test]
    async fn steam_error_is_passed_through() {
        let err = collect_pages(&no_stop(), |_| ready(Err(SteamError::Auth(401))))
            .await
            .unwrap_err();
        assert_eq!(err, SteamError::Auth(401));
    }

    /// «Остановить» нажали, пока шла первая страница: за второй не идём.
    #[tokio::test]
    async fn stop_between_pages_asks_for_no_more() {
        let stop = AtomicBool::new(false);
        let mut calls = 0;
        let err = collect_pages(&stop, |_| {
            calls += 1;
            stop.store(true, Ordering::SeqCst);
            ready(Ok(
                json!({"assets": [], "more_items": true, "last_assetid": "10"}),
            ))
        })
        .await
        .unwrap_err();
        assert_eq!(err, SteamError::Stopped);
        assert_eq!(calls, 1);
    }

    #[tokio::test]
    async fn stopped_read_asks_for_no_page() {
        let mut calls = 0;
        let err = collect_pages(&AtomicBool::new(true), |_| {
            calls += 1;
            ready(Ok(json!({"assets": [], "total_inventory_count": 0})))
        })
        .await
        .unwrap_err();
        assert_eq!(err, SteamError::Stopped);
        assert_eq!(calls, 0);
    }

    #[test]
    fn reconcile_matches_when_counts_are_equal() {
        let before = parse_pages(&[page(
            vec![asset("1", "c1", "0", "3")],
            vec![desc("c1", "0", "Skin")],
        )]);
        let after = parse_pages(&[page(
            vec![
                asset("1", "c1", "0", "1"),
                asset("2", "c1", "0", "1"),
                asset("3", "c1", "0", "1"),
            ],
            vec![desc("c1", "0", "Skin")],
        )]);
        let r = reconcile(&before, &after);
        assert_eq!(
            r,
            Reconciliation {
                before: 3,
                after: 3,
                mismatches: vec![]
            }
        );
    }

    #[test]
    fn reconcile_lists_every_changed_skin() {
        let before = parse_pages(&[page(
            vec![asset("1", "c1", "0", "3")],
            vec![desc("c1", "0", "Skin")],
        )]);
        let after = parse_pages(&[page(
            vec![asset("1", "c1", "0", "2"), asset("5", "c2", "0", "1")],
            vec![desc("c1", "0", "Skin"), desc("c2", "0", "New")],
        )]);
        let r = reconcile(&before, &after);
        assert_eq!(r.before, 3);
        assert_eq!(r.after, 3);
        assert_eq!(
            r.mismatches,
            vec![
                Mismatch {
                    key: "New".into(),
                    name: "New".into(),
                    before: 0,
                    after: 1
                },
                Mismatch {
                    key: "Skin".into(),
                    name: "Skin".into(),
                    before: 3,
                    after: 2
                },
            ]
        );
    }

    #[test]
    fn assetids_compare_numerically() {
        use std::cmp::Ordering;
        assert_eq!(cmp_assetid("9999999999", "10000000000"), Ordering::Less);
        assert_eq!(cmp_assetid("1001", "1002"), Ordering::Less);
        assert_eq!(cmp_assetid("1002", "1001"), Ordering::Greater);
        assert_eq!(cmp_assetid("1001", "1001"), Ordering::Equal);
    }
}
