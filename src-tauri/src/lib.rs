pub mod commands;
pub mod inventory;
pub mod journal;
pub mod plan;
pub mod runner;
pub mod settings;
pub mod steam;
pub mod token;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
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
