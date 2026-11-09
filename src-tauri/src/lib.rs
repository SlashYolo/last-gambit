/// Desktop shell for The Last Gambit. The game itself is the web build in ../dist;
/// the store plugin keeps the player's profile (settings, progress, achievements, saved run)
/// in profile.json inside the app data folder.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .run(tauri::generate_context!())
        .expect("error while running The Last Gambit");
}
