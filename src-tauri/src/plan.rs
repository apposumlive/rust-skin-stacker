//! Чистые функции: инвентарь и выбор пользователя → шаги. Сети здесь нет.

use std::collections::{BTreeMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::inventory::{Inventory, Record, Skin};

/// Сколько стопок показывать в очереди плана.
pub const QUEUE_PREVIEW: usize = 5;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Operation {
    SplitAll,
    CombineAll,
    CombineSelected { keys: Vec<String> },
    SplitRecords { assetids: Vec<String> },
    CombineRecords { assetids: Vec<String> },
    SplitOff { assetid: String, count: u32 },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Step {
    /// Отделить одну штуку от стопки `assetid`.
    Split { key: String, assetid: String },
    /// Перенести `quantity` штук из `from` в `dest`.
    Combine {
        key: String,
        from: Record,
        dest: Record,
        quantity: u32,
    },
}

impl Step {
    pub fn key(&self) -> &str {
        match self {
            Step::Split { key, .. } | Step::Combine { key, .. } => key,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueItem {
    pub key: String,
    /// Размер стопки, а для сборки — сколько штук будет в стопке.
    pub amount: u32,
    pub requests: u32,
}

/// Что станет с записью после операции.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardAfter {
    pub assetid: String,
    /// Сколько штук останется в записи; 0 — запись уйдёт в другую стопку.
    pub amount: u32,
    /// Сколько штук от неё отделится по одной.
    pub singles: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub operation: Operation,
    /// Окну шаги не нужны: их бывают тысячи.
    #[serde(skip)]
    pub steps: Vec<Step>,
    pub requests: u32,
    /// Сколько стопок затронет: разделяемых записей или собираемых групп.
    pub stacks: u32,
    pub queue: Vec<QueueItem>,
    /// «и ещё N» после очереди.
    pub more: u32,
    pub cards: Vec<CardAfter>,
}

struct SkinPart {
    steps: Vec<Step>,
    queue: Vec<QueueItem>,
    cards: Vec<CardAfter>,
}

/// Что выбрал пользователь: всё, скины целиком или отдельные записи.
enum Picked<'a> {
    All,
    Keys(HashSet<&'a str>),
    Records(HashSet<&'a str>),
}

impl Picked<'_> {
    fn has_skin(&self, skin: &Skin) -> bool {
        match self {
            Picked::All => true,
            Picked::Keys(keys) => keys.contains(skin.key.as_str()),
            Picked::Records(ids) => skin
                .records
                .iter()
                .any(|r| ids.contains(r.assetid.as_str())),
        }
    }

    fn has_record(&self, skin: &Skin, record: &Record) -> bool {
        match self {
            Picked::All => true,
            Picked::Keys(keys) => keys.contains(skin.key.as_str()),
            Picked::Records(ids) => ids.contains(record.assetid.as_str()),
        }
    }
}

pub fn build(inventory: &Inventory, operation: &Operation) -> Plan {
    let picked = match operation {
        Operation::SplitAll | Operation::CombineAll => Picked::All,
        Operation::CombineSelected { keys } => {
            Picked::Keys(keys.iter().map(String::as_str).collect())
        }
        Operation::SplitRecords { assetids } | Operation::CombineRecords { assetids } => {
            Picked::Records(assetids.iter().map(String::as_str).collect())
        }
        Operation::SplitOff { assetid, .. } => Picked::Records(HashSet::from([assetid.as_str()])),
    };
    let mut skins: Vec<&Skin> = inventory
        .skins
        .iter()
        .filter(|s| picked.has_skin(s))
        .collect();
    // При равном total — по ключу, а не по имени: имя зависит от языка, и смена языка
    // между предпросмотром и запуском дала бы другой порядок шагов.
    skins.sort_by(|a, b| b.total.cmp(&a.total).then_with(|| a.key.cmp(&b.key)));

    let (mut steps, mut queue, mut cards) = (Vec::new(), Vec::new(), Vec::new());
    for skin in skins {
        let part = match operation {
            Operation::SplitAll | Operation::SplitRecords { .. } => {
                split_skin(skin, &picked, u32::MAX)
            }
            Operation::SplitOff { count, .. } => split_skin(skin, &picked, *count),
            Operation::CombineAll
            | Operation::CombineSelected { .. }
            | Operation::CombineRecords { .. } => combine_skin(skin, &picked),
        };
        if let Some(part) = part {
            steps.extend(part.steps);
            queue.extend(part.queue);
            cards.extend(part.cards);
        }
    }
    let stacks = queue.len() as u32;
    let more = queue.len().saturating_sub(QUEUE_PREVIEW) as u32;
    queue.truncate(QUEUE_PREVIEW);
    Plan {
        operation: operation.clone(),
        requests: steps.len() as u32,
        steps,
        stacks,
        queue,
        more,
        cards,
    }
}

/// Отделить по одному не больше `limit` штук от выбранных записей скина, в их порядке.
fn split_skin(skin: &Skin, picked: &Picked, limit: u32) -> Option<SkinPart> {
    let mut left = limit;
    let (mut steps, mut queue, mut cards) = (Vec::new(), Vec::new(), Vec::new());
    for record in skin.records.iter().filter(|r| picked.has_record(skin, r)) {
        let n = record.amount.saturating_sub(1).min(left);
        if n == 0 {
            continue;
        }
        left -= n;
        for _ in 0..n {
            steps.push(Step::Split {
                key: skin.key.clone(),
                assetid: record.assetid.clone(),
            });
        }
        queue.push(QueueItem {
            key: skin.key.clone(),
            amount: record.amount,
            requests: n,
        });
        cards.push(CardAfter {
            assetid: record.assetid.clone(),
            amount: record.amount - n,
            singles: n,
        });
    }
    if steps.is_empty() {
        return None;
    }
    Some(SkinPart {
        steps,
        queue,
        cards,
    })
}

/// Собрать выбранные записи каждой группы (`classid`, `instanceid`) в первую из группы.
fn combine_skin(skin: &Skin, picked: &Picked) -> Option<SkinPart> {
    let mut groups: BTreeMap<(&str, &str), Vec<&Record>> = BTreeMap::new();
    for record in skin.records.iter().filter(|r| picked.has_record(skin, r)) {
        groups
            .entry((record.classid.as_str(), record.instanceid.as_str()))
            .or_default()
            .push(record);
    }
    let (mut steps, mut queue, mut cards) = (Vec::new(), Vec::new(), Vec::new());
    for records in groups.values().filter(|g| g.len() > 1) {
        // Записи уже по убыванию amount: первая — назначение.
        let dest = records[0];
        let total: u32 = records.iter().map(|r| r.amount).sum();
        cards.push(CardAfter {
            assetid: dest.assetid.clone(),
            amount: total,
            singles: 0,
        });
        for from in &records[1..] {
            steps.push(Step::Combine {
                key: skin.key.clone(),
                from: (*from).clone(),
                dest: dest.clone(),
                quantity: from.amount,
            });
            cards.push(CardAfter {
                assetid: from.assetid.clone(),
                amount: 0,
                singles: 0,
            });
        }
        queue.push(QueueItem {
            key: skin.key.clone(),
            amount: total,
            requests: records.len() as u32 - 1,
        });
    }
    if steps.is_empty() {
        return None;
    }
    Some(SkinPart {
        steps,
        queue,
        cards,
    })
}

/// Проверка перед каждым запросом (правило 3 спеки): сборка с неверными
/// данными может потерять предметы, поэтому такой шаг не отправляется.
pub fn validate(step: &Step) -> Result<(), &'static str> {
    match step {
        Step::Split { assetid, .. } if assetid.is_empty() => Err("empty assetid"),
        Step::Split { .. } => Ok(()),
        Step::Combine {
            from,
            dest,
            quantity,
            ..
        } => {
            if from.assetid == dest.assetid {
                Err("source and destination are the same item")
            } else if from.classid != dest.classid || from.instanceid != dest.instanceid {
                Err("items of different type")
            } else if *quantity == 0 || *quantity != from.amount {
                Err("quantity does not match the inventory")
            } else {
                Ok(())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rec(assetid: &str, instanceid: &str, amount: u32) -> Record {
        Record {
            assetid: assetid.into(),
            classid: "c1".into(),
            instanceid: instanceid.into(),
            amount,
            tradable: true,
            marketable: true,
            available_after: None,
        }
    }

    /// Скин как после inventory::parse_pages: записи по убыванию amount, затем по assetid.
    fn skin(key: &str, mut records: Vec<Record>) -> Skin {
        records.sort_by(|a, b| {
            b.amount
                .cmp(&a.amount)
                .then_with(|| crate::inventory::cmp_assetid(&a.assetid, &b.assetid))
        });
        Skin {
            key: key.into(),
            name: key.into(),
            icon: None,
            category: None,
            total: records.iter().map(|r| r.amount).sum(),
            records,
        }
    }

    fn inv(skins: Vec<Skin>) -> Inventory {
        Inventory {
            skins,
            unreadable: vec![],
        }
    }

    fn split_ids(plan: &Plan) -> Vec<&str> {
        plan.steps
            .iter()
            .map(|s| match s {
                Step::Split { assetid, .. } => assetid.as_str(),
                Step::Combine { .. } => panic!("combine step in a split plan"),
            })
            .collect()
    }

    fn card(assetid: &str, amount: u32, singles: u32) -> CardAfter {
        CardAfter {
            assetid: assetid.into(),
            amount,
            singles,
        }
    }

    fn queued(key: &str, amount: u32, requests: u32) -> QueueItem {
        QueueItem {
            key: key.into(),
            amount,
            requests,
        }
    }

    fn merge(key: &str, from: Record, dest: Record) -> Step {
        let quantity = from.amount;
        Step::Combine {
            key: key.into(),
            from,
            dest,
            quantity,
        }
    }

    fn ids(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    fn a_stacks() -> Inventory {
        inv(vec![skin(
            "A",
            vec![rec("1", "0", 5), rec("2", "0", 4), rec("3", "0", 1)],
        )])
    }

    #[test]
    fn split_all_needs_a_minus_one_requests_per_stack() {
        let plan = build(&a_stacks(), &Operation::SplitAll);
        assert_eq!(plan.requests, 7);
        assert_eq!(plan.stacks, 2);
        assert_eq!(split_ids(&plan), vec!["1", "1", "1", "1", "2", "2", "2"]);
        assert_eq!(plan.cards, vec![card("1", 1, 4), card("2", 1, 3)]);
        assert_eq!(plan.queue, vec![queued("A", 5, 4), queued("A", 4, 3)]);
        assert_eq!(plan.more, 0);
    }

    #[test]
    fn stack_of_two_needs_one_request() {
        let plan = build(
            &inv(vec![skin("A", vec![rec("1", "0", 2)])]),
            &Operation::SplitAll,
        );
        assert_eq!(plan.requests, 1);
        assert_eq!(plan.cards, vec![card("1", 1, 1)]);
    }

    #[test]
    fn split_all_with_only_singles_is_empty() {
        let plan = build(
            &inv(vec![skin("A", vec![rec("1", "0", 1), rec("2", "0", 1)])]),
            &Operation::SplitAll,
        );
        assert_eq!(plan.requests, 0);
        assert!(plan.steps.is_empty() && plan.cards.is_empty() && plan.queue.is_empty());
    }

    #[test]
    fn split_records_splits_only_picked_stacks() {
        let plan = build(
            &a_stacks(),
            &Operation::SplitRecords {
                assetids: ids(&["2"]),
            },
        );
        assert_eq!(split_ids(&plan), vec!["2", "2", "2"]);
        assert_eq!(plan.cards, vec![card("2", 1, 3)]);
        assert_eq!(plan.queue, vec![queued("A", 4, 3)]);
    }

    #[test]
    fn split_records_ignores_singles_and_unknown_ids() {
        let plan = build(
            &a_stacks(),
            &Operation::SplitRecords {
                assetids: ids(&["3", "x"]),
            },
        );
        assert_eq!(plan.requests, 0);
        assert!(plan.cards.is_empty() && plan.queue.is_empty());
    }

    #[test]
    fn split_records_ignores_repeated_ids() {
        let plan = build(
            &a_stacks(),
            &Operation::SplitRecords {
                assetids: ids(&["2", "2"]),
            },
        );
        assert_eq!(plan.requests, 3);
        assert_eq!(plan.cards, vec![card("2", 1, 3)]);
    }

    #[test]
    fn split_records_across_skins() {
        let inventory = inv(vec![
            skin("A", vec![rec("1", "0", 2)]),
            skin("B", vec![rec("2", "0", 3), rec("3", "0", 1)]),
        ]);
        let plan = build(
            &inventory,
            &Operation::SplitRecords {
                assetids: ids(&["1", "2"]),
            },
        );
        // B больше по total, значит идёт первым.
        assert_eq!(split_ids(&plan), vec!["2", "2", "1"]);
        assert_eq!(plan.cards, vec![card("2", 1, 2), card("1", 1, 1)]);
        assert_eq!(plan.queue, vec![queued("B", 3, 2), queued("A", 2, 1)]);
    }

    #[test]
    fn split_off_takes_only_from_that_stack() {
        let inventory = inv(vec![skin("A", vec![rec("1", "0", 5), rec("2", "0", 4)])]);
        let plan = build(
            &inventory,
            &Operation::SplitOff {
                assetid: "2".into(),
                count: 2,
            },
        );
        assert_eq!(split_ids(&plan), vec!["2", "2"]);
        assert_eq!(plan.cards, vec![card("2", 2, 2)]);
    }

    #[test]
    fn split_off_never_exceeds_a_minus_one() {
        let plan = build(
            &inv(vec![skin("A", vec![rec("1", "0", 3)])]),
            &Operation::SplitOff {
                assetid: "1".into(),
                count: 10,
            },
        );
        assert_eq!(plan.requests, 2);
        assert_eq!(plan.cards, vec![card("1", 1, 2)]);
    }

    #[test]
    fn split_off_zero_does_nothing() {
        let plan = build(
            &inv(vec![skin("A", vec![rec("1", "0", 8)])]),
            &Operation::SplitOff {
                assetid: "1".into(),
                count: 0,
            },
        );
        assert_eq!(plan.requests, 0);
        assert!(plan.cards.is_empty());
    }

    #[test]
    fn split_off_unknown_assetid_does_nothing() {
        let plan = build(
            &inv(vec![skin("A", vec![rec("1", "0", 8)])]),
            &Operation::SplitOff {
                assetid: "nope".into(),
                count: 3,
            },
        );
        assert_eq!(plan.requests, 0);
        assert!(plan.cards.is_empty());
    }

    #[test]
    fn combine_all_merges_into_the_largest_record() {
        let plan = build(&a_stacks(), &Operation::CombineAll);
        assert_eq!(
            plan.steps,
            vec![
                merge("A", rec("2", "0", 4), rec("1", "0", 5)),
                merge("A", rec("3", "0", 1), rec("1", "0", 5)),
            ]
        );
        assert_eq!(plan.stacks, 1);
        assert_eq!(plan.queue, vec![queued("A", 10, 2)]);
        assert_eq!(
            plan.cards,
            vec![card("1", 10, 0), card("2", 0, 0), card("3", 0, 0)]
        );
    }

    #[test]
    fn combine_keeps_other_instanceid_apart() {
        let inventory = inv(vec![skin(
            "A",
            vec![rec("1", "0", 3), rec("2", "9", 2), rec("3", "0", 1)],
        )]);
        let plan = build(&inventory, &Operation::CombineAll);
        assert_eq!(
            plan.steps,
            vec![merge("A", rec("3", "0", 1), rec("1", "0", 3))]
        );
        assert_eq!(plan.cards, vec![card("1", 4, 0), card("3", 0, 0)]);
    }

    #[test]
    fn combine_tie_goes_to_the_smaller_assetid() {
        let plan = build(
            &inv(vec![skin("A", vec![rec("20", "0", 2), rec("10", "0", 2)])]),
            &Operation::CombineAll,
        );
        assert_eq!(
            plan.steps,
            vec![merge("A", rec("20", "0", 2), rec("10", "0", 2))]
        );
        assert_eq!(plan.cards, vec![card("10", 4, 0), card("20", 0, 0)]);
    }

    #[test]
    fn combine_two_singles_makes_a_stack() {
        let plan = build(
            &inv(vec![skin("A", vec![rec("1", "0", 1), rec("2", "0", 1)])]),
            &Operation::CombineAll,
        );
        assert_eq!(plan.cards, vec![card("1", 2, 0), card("2", 0, 0)]);
    }

    #[test]
    fn combine_with_nothing_to_merge_is_empty() {
        let plan = build(
            &inv(vec![skin("A", vec![rec("1", "0", 5), rec("2", "9", 1)])]),
            &Operation::CombineAll,
        );
        assert_eq!(plan.requests, 0);
        assert!(plan.cards.is_empty());
    }

    #[test]
    fn combine_records_merges_picked_into_the_largest_picked() {
        let inventory = inv(vec![skin(
            "A",
            vec![
                rec("1", "0", 5),
                rec("2", "0", 4),
                rec("3", "0", 1),
                rec("4", "0", 1),
            ],
        )]);
        let plan = build(
            &inventory,
            &Operation::CombineRecords {
                assetids: ids(&["2", "3", "4"]),
            },
        );
        assert_eq!(
            plan.steps,
            vec![
                merge("A", rec("3", "0", 1), rec("2", "0", 4)),
                merge("A", rec("4", "0", 1), rec("2", "0", 4)),
            ]
        );
        assert_eq!(
            plan.cards,
            vec![card("2", 6, 0), card("3", 0, 0), card("4", 0, 0)]
        );
        assert_eq!(plan.queue, vec![queued("A", 6, 2)]);
    }

    #[test]
    fn combine_records_ignores_repeated_and_unknown_ids() {
        let inventory = inv(vec![skin("A", vec![rec("1", "0", 2), rec("2", "0", 1)])]);
        let plan = build(
            &inventory,
            &Operation::CombineRecords {
                assetids: ids(&["2", "1", "2", "zzz"]),
            },
        );
        assert_eq!(
            plan.steps,
            vec![merge("A", rec("2", "0", 1), rec("1", "0", 2))]
        );
        assert_eq!(plan.cards, vec![card("1", 3, 0), card("2", 0, 0)]);
    }

    #[test]
    fn combine_records_needs_two_of_a_kind() {
        let inventory = inv(vec![skin(
            "A",
            vec![rec("1", "0", 3), rec("2", "9", 2), rec("3", "0", 1)],
        )]);
        let one = build(
            &inventory,
            &Operation::CombineRecords {
                assetids: ids(&["1"]),
            },
        );
        assert_eq!(one.requests, 0);
        assert!(one.cards.is_empty());
        let other_type = build(
            &inventory,
            &Operation::CombineRecords {
                assetids: ids(&["1", "2"]),
            },
        );
        assert_eq!(other_type.requests, 0);
        assert!(other_type.cards.is_empty());
    }

    #[test]
    fn combine_records_across_skins_makes_a_stack_each() {
        let inventory = inv(vec![
            skin("A", vec![rec("1", "0", 2), rec("2", "0", 1)]),
            skin("B", vec![rec("3", "0", 1), rec("4", "0", 1)]),
        ]);
        let plan = build(
            &inventory,
            &Operation::CombineRecords {
                assetids: ids(&["1", "2", "3", "4"]),
            },
        );
        assert_eq!(
            plan.steps,
            vec![
                merge("A", rec("2", "0", 1), rec("1", "0", 2)),
                merge("B", rec("4", "0", 1), rec("3", "0", 1)),
            ]
        );
        assert_eq!(plan.queue, vec![queued("A", 3, 1), queued("B", 2, 1)]);
        assert_eq!(
            plan.cards,
            vec![
                card("1", 3, 0),
                card("2", 0, 0),
                card("3", 2, 0),
                card("4", 0, 0)
            ]
        );
    }

    #[test]
    fn combine_selected_touches_only_selected_skins() {
        let inventory = inv(vec![
            skin("A", vec![rec("1", "0", 1), rec("2", "0", 1)]),
            skin("B", vec![rec("3", "0", 1), rec("4", "0", 1)]),
        ]);
        let plan = build(
            &inventory,
            &Operation::CombineSelected {
                keys: vec!["A".into()],
            },
        );
        assert_eq!(plan.requests, 1);
        assert_eq!(plan.cards, vec![card("1", 2, 0), card("2", 0, 0)]);
    }

    #[test]
    fn queue_shows_five_and_counts_the_rest() {
        let skins = (0..7)
            .map(|i| skin(&format!("S{i}"), vec![rec(&i.to_string(), "0", 2)]))
            .collect();
        let plan = build(&inv(skins), &Operation::SplitAll);
        assert_eq!(plan.stacks, 7);
        assert_eq!(plan.queue.len(), QUEUE_PREVIEW);
        assert_eq!(plan.more, 2);
    }

    /// Скин с локализованным именем, которое идёт в другом порядке, чем ключ.
    fn named(key: &str, name: &str, records: Vec<Record>) -> Skin {
        Skin {
            name: name.into(),
            ..skin(key, records)
        }
    }

    #[test]
    fn skins_go_by_total_then_key() {
        let inventory = inv(vec![
            named("B", "Альфа", vec![rec("1", "0", 2)]),
            named("A", "Яблоко", vec![rec("2", "0", 2)]),
            named("C", "Бета", vec![rec("3", "0", 5)]),
        ]);
        let plan = build(&inventory, &Operation::SplitAll);
        let order: Vec<&str> = plan.cards.iter().map(|c| c.assetid.as_str()).collect();
        assert_eq!(order, vec!["3", "2", "1"]);
    }

    #[test]
    fn plan_steps_do_not_depend_on_the_language() {
        let english = inv(vec![
            named("B", "Alpha", vec![rec("1", "0", 2)]),
            named("A", "Zulu", vec![rec("2", "0", 2)]),
        ]);
        let russian = inv(vec![
            named("B", "Яблоко", vec![rec("1", "0", 2)]),
            named("A", "Альфа", vec![rec("2", "0", 2)]),
        ]);
        assert_eq!(
            build(&english, &Operation::SplitAll).steps,
            build(&russian, &Operation::SplitAll).steps
        );
    }

    #[test]
    fn validate_rejects_unsafe_steps() {
        let combine = |from: Record, dest: Record, quantity| Step::Combine {
            key: "A".into(),
            from,
            dest,
            quantity,
        };
        assert_eq!(
            validate(&combine(rec("2", "0", 3), rec("1", "0", 5), 3)),
            Ok(())
        );
        assert!(
            validate(&combine(rec("1", "0", 3), rec("1", "0", 3), 3)).is_err(),
            "same item"
        );
        assert!(
            validate(&combine(rec("2", "9", 3), rec("1", "0", 5), 3)).is_err(),
            "other instanceid"
        );
        let mut other_class = rec("2", "0", 3);
        other_class.classid = "c2".into();
        assert!(
            validate(&combine(other_class, rec("1", "0", 5), 3)).is_err(),
            "other classid"
        );
        assert!(
            validate(&combine(rec("2", "0", 3), rec("1", "0", 5), 4)).is_err(),
            "wrong quantity"
        );
        assert!(
            validate(&combine(rec("2", "0", 3), rec("1", "0", 5), 0)).is_err(),
            "zero quantity"
        );
        assert!(
            validate(&Step::Split {
                key: "A".into(),
                assetid: String::new()
            })
            .is_err()
        );
        assert_eq!(
            validate(&Step::Split {
                key: "A".into(),
                assetid: "1".into()
            }),
            Ok(())
        );
    }

    #[test]
    fn operation_reads_window_json() {
        let read = |json: &str| serde_json::from_str::<Operation>(json).unwrap();
        assert_eq!(
            read(r#"{"kind":"splitRecords","assetids":["1","2"]}"#),
            Operation::SplitRecords {
                assetids: ids(&["1", "2"])
            }
        );
        assert_eq!(
            read(r#"{"kind":"combineRecords","assetids":["3"]}"#),
            Operation::CombineRecords {
                assetids: ids(&["3"])
            }
        );
        assert_eq!(
            read(r#"{"kind":"splitOff","assetid":"1","count":2}"#),
            Operation::SplitOff {
                assetid: "1".into(),
                count: 2
            }
        );
        assert_eq!(
            read(r#"{"kind":"combineSelected","keys":["A"]}"#),
            Operation::CombineSelected {
                keys: vec!["A".into()]
            }
        );
        assert_eq!(read(r#"{"kind":"splitAll"}"#), Operation::SplitAll);
        assert_eq!(read(r#"{"kind":"combineAll"}"#), Operation::CombineAll);
    }

    #[test]
    fn plan_json_has_no_steps() {
        let plan = build(
            &inv(vec![skin("A", vec![rec("1", "0", 3)])]),
            &Operation::SplitAll,
        );
        let json = serde_json::to_value(&plan).unwrap();
        assert!(json.get("steps").is_none());
        assert_eq!(json["requests"], 2);
        assert_eq!(json["operation"]["kind"], "splitAll");
        assert_eq!(json["cards"][0]["assetid"], "1");
        assert_eq!(json["cards"][0]["amount"], 1);
        assert_eq!(json["cards"][0]["singles"], 2);
    }
}
