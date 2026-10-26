//! Журнал для кнопки «Скопировать журнал». Сюда не пишутся токен и полный SteamID.

use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

pub const MAX_LINES: usize = 2000;

#[derive(Default)]
pub struct Journal {
    lines: Mutex<VecDeque<String>>,
}

impl Journal {
    pub fn add(&self, line: impl AsRef<str>) {
        let secs = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        self.push(format!("{} {}", clock(secs), line.as_ref()));
    }

    fn push(&self, line: String) {
        let mut lines = self.lines.lock().unwrap_or_else(|e| e.into_inner());
        if lines.len() == MAX_LINES {
            lines.pop_front();
        }
        lines.push_back(line);
    }

    pub fn text(&self) -> String {
        let lines = self.lines.lock().unwrap_or_else(|e| e.into_inner());
        lines
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>()
            .join("\n")
    }
}

/// Время суток по UTC: «14:03:27Z».
fn clock(secs: u64) -> String {
    let s = secs % 86_400;
    format!("{:02}:{:02}:{:02}Z", s / 3600, s % 3600 / 60, s % 60)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clock_is_utc_time_of_day() {
        assert_eq!(clock(0), "00:00:00Z");
        assert_eq!(clock(86_400 + 3_600 * 14 + 60 * 3 + 27), "14:03:27Z");
    }

    #[test]
    fn lines_are_joined_and_stamped() {
        let journal = Journal::default();
        journal.add("first");
        journal.add(String::from("second"));
        let text = journal.text();
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines.len(), 2);
        assert!(lines[0].ends_with("Z first"), "{text}");
        assert!(lines[1].ends_with("Z second"), "{text}");
    }

    #[test]
    fn keeps_only_the_last_lines() {
        let journal = Journal::default();
        for i in 0..MAX_LINES + 5 {
            journal.add(format!("line {i}"));
        }
        let text = journal.text();
        assert_eq!(text.lines().count(), MAX_LINES);
        assert!(text.lines().next().unwrap().ends_with("line 5"));
    }
}
