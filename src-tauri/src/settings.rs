//! Настройки: язык, пауза между запросами и масштаб окна. Файл лежит в папке настроек системы.

use std::fs;
use std::io;
use std::path::Path;

use serde::{Deserialize, Deserializer, Serialize};

pub const DEFAULT_DELAY_MS: u32 = 1500;
pub const MIN_DELAY_MS: u32 = 500;
pub const MAX_DELAY_MS: u32 = 10_000;
/// Допустимый масштаб окна, в процентах. Окно берёт тот же список (src/zoom.ts).
pub const UI_SCALES: [u16; 4] = [100, 110, 125, 150];
/// «Авто»: масштаб подбирает окно по высоте экрана. По умолчанию.
pub const UI_SCALE_AUTO: u16 = 0;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// "en", "ru" или None — язык системы.
    pub language: Option<String>,
    pub delay_ms: u32,
    /// Масштаб окна в процентах, одно из UI_SCALES, или UI_SCALE_AUTO.
    #[serde(deserialize_with = "lenient_ui_scale")]
    pub ui_scale: u16,
}

/// Масштаб из файла: что угодно, кроме целого 0..=65535 (дробь, минус, строка), — «Авто».
/// Испорченное поле не сбрасывает остальные настройки.
fn lenient_ui_scale<'de, D: Deserializer<'de>>(deserializer: D) -> Result<u16, D::Error> {
    let value = serde_json::Value::deserialize(deserializer)?;
    Ok(value
        .as_u64()
        .and_then(|n| u16::try_from(n).ok())
        .unwrap_or(UI_SCALE_AUTO))
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            language: None,
            delay_ms: DEFAULT_DELAY_MS,
            ui_scale: UI_SCALE_AUTO,
        }
    }
}

impl Settings {
    /// Пауза в допустимых границах, неизвестный язык — как в системе, масштаб не из списка — «Авто».
    pub fn normalized(mut self) -> Self {
        self.delay_ms = self.delay_ms.clamp(MIN_DELAY_MS, MAX_DELAY_MS);
        if !matches!(self.language.as_deref(), Some("en" | "ru")) {
            self.language = None;
        }
        if !UI_SCALES.contains(&self.ui_scale) {
            self.ui_scale = UI_SCALE_AUTO;
        }
        self
    }
}

/// Нет файла или он испорчен — настройки по умолчанию.
pub fn load(path: &Path) -> Settings {
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Settings>(&bytes).ok())
        .unwrap_or_default()
        .normalized()
}

pub fn save(path: &Path, settings: &Settings) -> io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let json = serde_json::to_vec_pretty(settings).map_err(io::Error::other)?;
    fs::write(path, json)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_file(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("rss-settings-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir.join("settings.json")
    }

    #[test]
    fn missing_file_gives_defaults() {
        assert_eq!(load(&temp_file("missing")), Settings::default());
    }

    #[test]
    fn broken_file_gives_defaults() {
        let path = temp_file("broken");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, b"{not json").unwrap();
        assert_eq!(load(&path), Settings::default());
    }

    #[test]
    fn partial_file_keeps_known_fields() {
        let path = temp_file("partial");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, br#"{"delayMs": 3000}"#).unwrap();
        assert_eq!(
            load(&path),
            Settings {
                language: None,
                delay_ms: 3000,
                ui_scale: 0
            }
        );
    }

    #[test]
    fn normalized_clamps_delay_and_language() {
        let s = Settings {
            language: Some("de".into()),
            delay_ms: 100,
            ..Settings::default()
        }
        .normalized();
        assert_eq!(
            s,
            Settings {
                language: None,
                delay_ms: MIN_DELAY_MS,
                ..Settings::default()
            }
        );
        let s = Settings {
            language: Some("ru".into()),
            delay_ms: 60_000,
            ..Settings::default()
        }
        .normalized();
        assert_eq!(
            s,
            Settings {
                language: Some("ru".into()),
                delay_ms: MAX_DELAY_MS,
                ..Settings::default()
            }
        );
    }

    #[test]
    fn load_clamps_values_from_the_file() {
        let path = temp_file("clamp-low");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, br#"{"language":"de","delayMs":100,"uiScale":120}"#).unwrap();
        assert_eq!(
            load(&path),
            Settings {
                language: None,
                delay_ms: MIN_DELAY_MS,
                ui_scale: 0
            }
        );
        let path = temp_file("clamp-high");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, br#"{"language":"ru","delayMs":60000,"uiScale":150}"#).unwrap();
        assert_eq!(
            load(&path),
            Settings {
                language: Some("ru".into()),
                delay_ms: MAX_DELAY_MS,
                ui_scale: 150
            }
        );
    }

    #[test]
    fn save_then_load_round_trips() {
        let path = temp_file("roundtrip");
        let s = Settings {
            language: Some("en".into()),
            delay_ms: 2500,
            ui_scale: 125,
        };
        save(&path, &s).unwrap();
        assert_eq!(load(&path), s);
    }

    #[test]
    fn json_uses_camel_case() {
        assert_eq!(
            serde_json::to_string(&Settings::default()).unwrap(),
            r#"{"language":null,"delayMs":1500,"uiScale":0}"#
        );
    }

    #[test]
    fn ui_scale_defaults_to_auto() {
        assert_eq!(Settings::default().ui_scale, 0);
        assert_eq!(Settings::default().ui_scale, UI_SCALE_AUTO);
    }

    #[test]
    fn normalized_keeps_auto_and_known_ui_scale_and_resets_unknown_to_auto() {
        let scaled = |ui_scale| {
            Settings {
                ui_scale,
                ..Settings::default()
            }
            .normalized()
            .ui_scale
        };
        assert_eq!(scaled(0), 0);
        assert_eq!(scaled(125), 125);
        assert_eq!(scaled(120), 0);
        assert_eq!(scaled(200), 0);
        for scale in UI_SCALES {
            assert_eq!(scaled(scale), scale);
        }
    }

    #[test]
    fn bad_ui_scale_in_the_file_gives_auto_and_keeps_the_rest() {
        for (i, bad) in ["125.5", "-1", "70000", r#""x""#, "null", "[125]"]
            .iter()
            .enumerate()
        {
            let path = temp_file(&format!("bad-scale-{i}"));
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            let json = format!(r#"{{"language":"ru","delayMs":2000,"uiScale":{bad}}}"#);
            fs::write(&path, json).unwrap();
            assert_eq!(
                load(&path),
                Settings {
                    language: Some("ru".into()),
                    delay_ms: 2000,
                    ui_scale: 0
                },
                "uiScale: {bad}"
            );
        }
    }

    #[test]
    fn old_file_without_ui_scale_gives_auto() {
        let path = temp_file("no-scale");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, br#"{"language":"ru","delayMs":2000}"#).unwrap();
        assert_eq!(
            load(&path),
            Settings {
                language: Some("ru".into()),
                delay_ms: 2000,
                ui_scale: 0
            }
        );
    }
}
