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
    SplitSelected { keys: Vec<String> },
    CombineSelected { keys: Vec<String> },
    SplitOff { key: String, count: u32 },
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

/// Раскладка скина после операции.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkinAfter {
    pub key: String,
    /// По убыванию.
    pub stacks: Vec<u32>,
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
    pub after: Vec<SkinAfter>,
}

struct SkinPart {
    steps: Vec<Step>,
    queue: Vec<QueueItem>,
    after: SkinAfter,
}

pub fn build(inventory: &Inventory, operation: &Operation) -> Plan {
    let selected: Option<HashSet<&str>> = match operation {
        Operation::SplitAll | Operation::CombineAll => None,
        Operation::SplitSelected { keys } | Operation::CombineSelected { keys } => {
            Some(keys.iter().map(String::as_str).collect())
        }
        Operation::SplitOff { key, .. } => Some(HashSet::from([key.as_str()])),
    };
    let mut skins: Vec<&Skin> = inventory
        .skins
        .iter()
        .filter(|s| {
            selected
                .as_ref()
                .is_none_or(|keys| keys.contains(s.key.as_str()))
        })
        .collect();
    skins.sort_by(|a, b| b.total.cmp(&a.total).then_with(|| a.name.cmp(&b.name)));

    let (mut steps, mut queue, mut after) = (Vec::new(), Vec::new(), Vec::new());
    for skin in skins {
        let part = match operation {
            Operation::SplitAll | Operation::SplitSelected { .. } => split_skin(skin, u32::MAX),
            Operation::SplitOff { count, .. } => split_skin(skin, *count),
            Operation::CombineAll | Operation::CombineSelected { .. } => combine_skin(skin),
        };
        if let Some(part) = part {
            steps.extend(part.steps);
            queue.extend(part.queue);
            after.push(part.after);
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
        after,
    }
}

/// Отделить по одному не больше `limit` штук, начиная с самой большой записи.
fn split_skin(skin: &Skin, limit: u32) -> Option<SkinPart> {
    let mut left = limit;
    let (mut steps, mut queue, mut stacks, mut singles) =
        (Vec::new(), Vec::new(), Vec::new(), 0u32);
    for record in &skin.records {
        let n = record.amount.saturating_sub(1).min(left);
        left -= n;
        for _ in 0..n {
            steps.push(Step::Split {
                key: skin.key.clone(),
                assetid: record.assetid.clone(),
            });
        }
        if n > 0 {
            queue.push(QueueItem {
                key: skin.key.clone(),
                amount: record.amount,
                requests: n,
            });
        }
        singles += n;
        match record.amount - n {
            1 => singles += 1,
            rest => stacks.push(rest),
        }
    }
    if steps.is_empty() {
        return None;
    }
    stacks.sort_unstable_by(|a, b| b.cmp(a));
    Some(SkinPart {
        steps,
        queue,
        after: SkinAfter {
            key: skin.key.clone(),
            stacks,
            singles,
        },
    })
}

/// Собрать каждую группу (`classid`, `instanceid`) в её самую большую запись.
fn combine_skin(skin: &Skin) -> Option<SkinPart> {
    let mut groups: BTreeMap<(&str, &str), Vec<&Record>> = BTreeMap::new();
    for record in &skin.records {
        groups
            .entry((record.classid.as_str(), record.instanceid.as_str()))
            .or_default()
            .push(record);
    }
    let (mut steps, mut queue, mut amounts) = (Vec::new(), Vec::new(), Vec::new());
    for records in groups.values() {
        // Записи уже по убыванию amount: первая — назначение.
        let dest = records[0];
        let total: u32 = records.iter().map(|r| r.amount).sum();
        for from in &records[1..] {
            steps.push(Step::Combine {
                key: skin.key.clone(),
                from: (*from).clone(),
                dest: dest.clone(),
                quantity: from.amount,
            });
        }
        if records.len() > 1 {
            queue.push(QueueItem {
                key: skin.key.clone(),
                amount: total,
                requests: records.len() as u32 - 1,
            });
        }
        amounts.push(total);
    }
    if steps.is_empty() {
        return None;
    }
    let singles = amounts.iter().filter(|a| **a == 1).count() as u32;
    let mut stacks: Vec<u32> = amounts.into_iter().filter(|a| *a > 1).collect();
    stacks.sort_unstable_by(|a, b| b.cmp(a));
    Some(SkinPart {
        steps,
        queue,
        after: SkinAfter {
            key: skin.key.clone(),
            stacks,
            singles,
        },
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

    fn after(key: &str, stacks: Vec<u32>, singles: u32) -> SkinAfter {
        SkinAfter {
            key: key.into(),
            stacks,
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

    #[test]
    fn split_all_needs_a_minus_one_requests_per_stack() {
        let inventory = inv(vec![skin(
            "A",
            vec![rec("1", "0", 5), rec("2", "0", 4), rec("3", "0", 1)],
        )]);
        let plan = build(&inventory, &Operation::SplitAll);
        assert_eq!(plan.requests, 7);
        assert_eq!(plan.stacks, 2);
        assert_eq!(split_ids(&plan), vec!["1", "1", "1", "1", "2", "2", "2"]);
        assert_eq!(plan.after, vec![after("A", vec![], 10)]);
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
        assert_eq!(plan.after, vec![after("A", vec![], 2)]);
    }

    #[test]
    fn split_all_with_only_singles_is_empty() {
        let plan = build(
            &inv(vec![skin("A", vec![rec("1", "0", 1), rec("2", "0", 1)])]),
            &Operation::SplitAll,
        );
        assert_eq!(plan.requests, 0);
        assert!(plan.steps.is_empty() && plan.after.is_empty() && plan.queue.is_empty());
    }

    #[test]
    fn split_selected_touches_only_selected_skins() {
        let inventory = inv(vec![
            skin("A", vec![rec("1", "0", 3)]),
            skin("B", vec![rec("2", "0", 3)]),
        ]);
        let plan = build(
            &inventory,
            &Operation::SplitSelected {
                keys: vec!["B".into()],
            },
        );
        assert_eq!(split_ids(&plan), vec!["2", "2"]);
        assert_eq!(plan.after, vec![after("B", vec![], 3)]);
    }

    #[test]
    fn split_off_takes_from_the_largest_stack_first() {
        let inventory = inv(vec![skin("A", vec![rec("1", "0", 5), rec("2", "0", 4)])]);
        let plan = build(
            &inventory,
            &Operation::SplitOff {
                key: "A".into(),
                count: 6,
            },
        );
        assert_eq!(split_ids(&plan), vec!["1", "1", "1", "1", "2", "2"]);
        assert_eq!(plan.after, vec![after("A", vec![2], 7)]);
    }

    #[test]
    fn split_off_never_exceeds_a_minus_one() {
        let plan = build(
            &inv(vec![skin("A", vec![rec("1", "0", 3)])]),
            &Operation::SplitOff {
                key: "A".into(),
                count: 10,
            },
        );
        assert_eq!(plan.requests, 2);
        assert_eq!(plan.after, vec![after("A", vec![], 3)]);
    }

    #[test]
    fn split_off_keeps_the_rest_as_a_stack() {
        let plan = build(
            &inv(vec![skin("A", vec![rec("1", "0", 8)])]),
            &Operation::SplitOff {
                key: "A".into(),
                count: 2,
            },
        );
        assert_eq!(plan.requests, 2);
        assert_eq!(plan.after, vec![after("A", vec![6], 2)]);
    }

    #[test]
    fn split_off_zero_does_nothing() {
        let plan = build(
            &inv(vec![skin("A", vec![rec("1", "0", 8)])]),
            &Operation::SplitOff {
                key: "A".into(),
                count: 0,
            },
        );
        assert_eq!(plan.requests, 0);
    }

    #[test]
    fn combine_all_merges_into_the_largest_record() {
        let inventory = inv(vec![skin(
            "A",
            vec![rec("1", "0", 5), rec("2", "0", 4), rec("3", "0", 1)],
        )]);
        let plan = build(&inventory, &Operation::CombineAll);
        assert_eq!(
            plan.steps,
            vec![
                Step::Combine {
                    key: "A".into(),
                    from: rec("2", "0", 4),
                    dest: rec("1", "0", 5),
                    quantity: 4
                },
                Step::Combine {
                    key: "A".into(),
                    from: rec("3", "0", 1),
                    dest: rec("1", "0", 5),
                    quantity: 1
                },
            ]
        );
        assert_eq!(plan.stacks, 1);
        assert_eq!(plan.queue, vec![queued("A", 10, 2)]);
        assert_eq!(plan.after, vec![after("A", vec![10], 0)]);
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
            vec![Step::Combine {
                key: "A".into(),
                from: rec("3", "0", 1),
                dest: rec("1", "0", 3),
                quantity: 1
            }]
        );
        assert_eq!(plan.after, vec![after("A", vec![4, 2], 0)]);
    }

    #[test]
    fn combine_tie_goes_to_the_smaller_assetid() {
        let plan = build(
            &inv(vec![skin("A", vec![rec("20", "0", 2), rec("10", "0", 2)])]),
            &Operation::CombineAll,
        );
        assert_eq!(
            plan.steps,
            vec![Step::Combine {
                key: "A".into(),
                from: rec("20", "0", 2),
                dest: rec("10", "0", 2),
                quantity: 2
            }]
        );
    }

    #[test]
    fn combine_two_singles_makes_a_stack() {
        let plan = build(
            &inv(vec![skin("A", vec![rec("1", "0", 1), rec("2", "0", 1)])]),
            &Operation::CombineAll,
        );
        assert_eq!(plan.after, vec![after("A", vec![2], 0)]);
    }

    #[test]
    fn combine_with_nothing_to_merge_is_empty() {
        let plan = build(
            &inv(vec![skin("A", vec![rec("1", "0", 5), rec("2", "9", 1)])]),
            &Operation::CombineAll,
        );
        assert_eq!(plan.requests, 0);
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
        assert_eq!(plan.after, vec![after("A", vec![2], 0)]);
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

    #[test]
    fn skins_go_by_total_then_name() {
        let inventory = inv(vec![
            skin("B", vec![rec("1", "0", 2)]),
            skin("A", vec![rec("2", "0", 2)]),
            skin("C", vec![rec("3", "0", 5)]),
        ]);
        let plan = build(&inventory, &Operation::SplitAll);
        let keys: Vec<&str> = plan.after.iter().map(|a| a.key.as_str()).collect();
        assert_eq!(keys, vec!["C", "A", "B"]);
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
        let op: Operation =
            serde_json::from_str(r#"{"kind":"splitOff","key":"Outlaw Revolver","count":2}"#)
                .unwrap();
        assert_eq!(
            op,
            Operation::SplitOff {
                key: "Outlaw Revolver".into(),
                count: 2
            }
        );
        let op: Operation =
            serde_json::from_str(r#"{"kind":"combineSelected","keys":["A"]}"#).unwrap();
        assert_eq!(
            op,
            Operation::CombineSelected {
                keys: vec!["A".into()]
            }
        );
        assert_eq!(
            serde_json::from_str::<Operation>(r#"{"kind":"splitAll"}"#).unwrap(),
            Operation::SplitAll
        );
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
        assert_eq!(json["after"][0]["singles"], 3);
    }
}
