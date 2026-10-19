// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args().any(|a| a == "--mcp") {
        eardloom_lib::run_mcp_bridge();
    } else {
        eardloom_lib::run()
    }
}
