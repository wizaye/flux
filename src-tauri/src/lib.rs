// Core modules
pub mod commands;
mod db;
mod state;
mod types;

use state::AppState;
use std::sync::Arc;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize tracing subscriber for logging
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Arc::new(AppState::default()))
        .invoke_handler(tauri::generate_handler![
            // Vault commands
            commands::vault::open_vault,
            commands::vault::create_vault,
            commands::vault::close_vault,
            commands::vault::get_vault_info,
            // File system commands
            commands::fs::read_file,
            commands::fs::read_file_binary,
            commands::fs::write_file,
            commands::fs::create_file,
            commands::fs::delete_file,
            commands::fs::move_file,
            commands::fs::rename_file,
            commands::fs::create_directory,
            commands::fs::list_directory,
            commands::fs::get_file_tree,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// ── Unit tests ────────────────────────────────────────────────────────────
//
// Run with:  cargo test  (inside src-tauri/)
//
// These tests exercise the command logic directly without spinning up a
// Tauri runtime.  Integration tests that need a real AppHandle live in
// src-tauri/tests/ (added as the backend grows).
