pub mod commands;
pub mod inventory;
pub mod journal;
pub mod plan;
pub mod runner;
pub mod settings;
pub mod steam;
pub mod token;

use tauri::Manager;
use tauri::webview::PageLoadEvent;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // Перезагрузка окна (F5, «Обновить») во время операции: новое окно начинает с экрана
        // входа и не может её остановить, поэтому ядро забывает токен и останавливает запуск.
        .on_page_load(|webview, payload| {
            if !matches!(payload.event(), PageLoadEvent::Started) {
                return;
            }
            let app = webview.app_handle().clone();
            tauri::async_runtime::spawn(async move {
                // При самой первой загрузке состояния может ещё не быть, и сбрасывать нечего.
                if let Some(state) = app.try_state::<commands::AppState>() {
                    state.reset_on_page_load().await;
                }
            });
        })
        .setup(|app| {
            let settings_path = app
                .path()
                .app_config_dir()
                .ok()
                .map(|dir| dir.join("settings.json"));
            let settings = settings_path
                .as_deref()
                .map(settings::load)
                .unwrap_or_default();
            let sleep = steam::tokio_sleep();
            let client = steam::SteamClient::new(steam::API_BASE, sleep.clone());
            app.manage(commands::AppState::new(
                client,
                sleep,
                settings,
                settings_path,
            ));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::set_token,
            commands::forget_token,
            commands::load_inventory,
            commands::preview,
            commands::start,
            commands::stop,
            commands::get_settings,
            commands::save_settings,
            commands::journal,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
