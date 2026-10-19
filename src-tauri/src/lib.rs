mod ai;
mod backup;
mod codex;
mod db;
mod local_ai;
mod maps;
mod share;
mod timeline;
mod world;
mod writing;

/// `Eardloom.exe --mcp` is the bridge AI apps launch; it never opens a window.
pub fn run_mcp_bridge() {
    ai::run_bridge();
}

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
        .manage(ai::AiState::default())
        .manage(local_ai::LocalAi::default())
        // The AI connector is always available while Eardloom is open.
        .setup(|app| {
            if let Err(e) = ai::ensure_server(app.handle()) {
                eprintln!("AI connector unavailable: {e}");
            }
            Ok(())
        })
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
            codex::link_graph,
            maps::list_maps,
            maps::get_map,
            maps::save_map,
            maps::delete_map,
            ai::connector_status,
            ai::connect_claude_desktop,
            ai::connect_codex,
            ai::connect_claude_code,
            ai::assistant_set_private,
            ai::assistant_resolve,
            ai::assistant_tool_specs,
            ai::assistant_read_tool,
            ai::assistant_check_proposal,
            ai::assistant_context,
            local_ai::local_ai_status,
            local_ai::local_ai_hardware,
            local_ai::local_ai_install,
            local_ai::local_ai_cancel_download,
            local_ai::local_ai_remove,
            local_ai::local_ai_start,
            local_ai::local_ai_stop,
            local_ai::local_ai_chat,
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
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // The built-in assistant's engine never outlives Eardloom.
            if let tauri::RunEvent::Exit = event {
                local_ai::shutdown(app);
            }
        });
}
