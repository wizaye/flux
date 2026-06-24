use crate::db::DbPool;
use std::sync::Mutex;

/// Global application state managed by Tauri and injected into commands via
/// `tauri::State<'_, AppState>`.
///
/// The watcher is stored as a type-erased `Box<dyn Any + Send>` so we never
/// need to name the complex `Debouncer<RecommendedWatcher, FileIdMap>` generic
/// in this module.  Dropping the inner value stops the watcher.
pub struct AppState {
    /// Absolute path of the currently open vault, or `None` if no vault is open.
    pub vault_path: Mutex<Option<String>>,

    /// SQLite database connection pool for the active vault.
    /// `None` when no vault is open.
    pub db_pool: Mutex<Option<DbPool>>,

    /// Unix-epoch milliseconds at which the current vault was opened.
    /// Captured once in `open_vault_impl` and returned by every
    /// `get_vault_info` call so the frontend sees a stable session
    /// start time (it powers the "vault opened X ago" status pill).
    /// Cleared on `close_vault`.
    pub vault_opened_at: Mutex<Option<i64>>,

    /// Keeps the `notify-debouncer-full` Debouncer alive.
    /// Set to `None` to stop watching; replaced on every `open_vault` call.
    pub watcher: Mutex<Option<Box<dyn std::any::Any + Send>>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            vault_path: Mutex::new(None),
            db_pool: Mutex::new(None),
            vault_opened_at: Mutex::new(None),
            watcher: Mutex::new(None),
        }
    }
}
