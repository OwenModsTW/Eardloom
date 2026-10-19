mod backup;
mod codex;
mod db;
mod share;
mod timeline;
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
            world::read_asset,
            world::get_world_setting,
            world::set_world_setting,
            codex::list_types,
            codex::save_type,
            codex::delete_type,
            codex::list_entries,
            codex::get_entry,
            codex::save_entry,
            codex::delete_entry,
            codex::backlinks,
            codex::search,
            codex::incoming_link_counts,
            writing::list_projects,
            writing::save_project,
            writing::delete_project,
            writing::list_docs,
            writing::get_doc,
            writing::save_doc,
            writing::move_docs,
            writing::delete_doc,
            writing::writing_overview,
            writing::create_snapshot,
            writing::list_snapshots,
            writing::get_snapshot_body,
            writing::rename_snapshot,
            writing::delete_snapshot,
            writing::clipboard_rtf,
            writing::update_doc_details,
            writing::list_comments,
            writing::save_comment,
            writing::delete_comment,
            writing::comment_counts,
            share::export_world_pack,
            backup::default_backup_dir,
            backup::list_backups,
            backup::run_backup,
            share::import_world_pack,
            share::write_static_site,
            timeline::get_calendar,
            timeline::save_calendar,
            timeline::timeline_items,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
