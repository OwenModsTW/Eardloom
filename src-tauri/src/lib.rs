mod codex;
mod db;
mod world;
mod writing;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init());

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

    builder
        .manage(world::AppState::default())
        .invoke_handler(tauri::generate_handler![
            world::list_recent_worlds,
            world::forget_recent_world,
            world::default_worlds_dir,
            world::create_world,
            world::open_world,
            world::close_world,
            world::update_world_info,
            world::import_asset,
            codex::list_types,
            codex::save_type,
            codex::delete_type,
            codex::list_entries,
            codex::get_entry,
            codex::save_entry,
            codex::delete_entry,
            codex::backlinks,
            codex::search,
            writing::list_projects,
            writing::save_project,
            writing::delete_project,
            writing::list_docs,
            writing::get_doc,
            writing::save_doc,
            writing::move_docs,
            writing::delete_doc,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
