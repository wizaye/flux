// Core modules
pub mod commands;
pub mod db;
pub mod state;
pub mod types;
pub mod watcher;

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
            commands::vault::get_last_vault_path,
            // File system commands
            commands::fs::read_file,
            commands::fs::read_file_binary,
            commands::fs::get_file_metadata,
            commands::fs::write_file,
            commands::fs::write_external_file,
            commands::fs::create_file,
            commands::fs::delete_file,
            commands::fs::move_file,
            commands::fs::rename_file,
            commands::fs::create_directory,
            commands::fs::list_directory,
            commands::fs::get_file_tree,
            commands::fs::list_trash,
            commands::fs::restore_from_trash,
            commands::fs::purge_trash_entry,
            commands::fs::archive_file,
            commands::fs::list_archive,
            commands::fs::restore_from_archive,
            // Link / tag indexer
            commands::links::scan_vault_links,
            commands::links::scan_vault_links_subset,
            // Export
            commands::export::export_markdown_to_pdf,
            // Plugins
            commands::plugins::scan_plugins,
            commands::plugins::install_plugin_from_folder,
            commands::plugins::install_plugin_from_zip,
            commands::plugins::uninstall_plugin,
            commands::plugins::plugin_backend_call,
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
