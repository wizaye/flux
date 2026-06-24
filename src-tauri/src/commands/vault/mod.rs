//! Vault lifecycle operations.
//!
//! Handles opening, creating, and closing vaults. Sets up the database and
//! file watcher for the active vault.

use crate::db;
use crate::state::AppState;
use crate::types::{AppError, VaultHandle};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};

pub mod last_vault;

// ── Last-opened vault persistence ───────────────────────────────────
//
// AppHandle-based wrappers around the pure helpers in
// [`last_vault`]. We keep the wrappers tiny so the testable surface
// stays inside the pure module.

fn config_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok()
}

fn remember_last_vault(app: &AppHandle, path: &str) {
    if let Some(dir) = config_dir(app) {
        last_vault::write_last_vault(&dir, path);
    }
}

fn forget_last_vault(app: &AppHandle) {
    if let Some(dir) = config_dir(app) {
        last_vault::forget_last_vault(&dir);
    }
}

/// Return the path of the most-recently-opened vault, if any.
///
/// The frontend calls this at startup and, when it returns a path
/// that still exists on disk, automatically reopens that vault
/// instead of showing the vault picker.
#[tauri::command]
pub async fn get_last_vault_path(app: AppHandle) -> Result<Option<String>, AppError> {
    Ok(config_dir(&app).and_then(|d| last_vault::read_last_vault(&d)))
}

/// Open an existing vault or create it if it doesn't exist.
///
/// This command:
/// 1. Validates the vault path
/// 2. Creates vault structure (.zenvault/, .trash/, .archive/)
/// 3. Initializes the database pool
/// 4. Starts the file watcher
/// 5. Returns a VaultHandle
#[tauri::command]
pub async fn open_vault(
    path: String,
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<VaultHandle, AppError> {
    let handle = open_vault_impl(path.clone(), &state).await?;
    remember_last_vault(&app, &path);
    start_watcher(&path, &app, &state);
    Ok(handle)
}

/// Spawn the FS watcher for the freshly-opened vault, replacing any
/// previous watcher in `AppState`. Logs and continues on failure —
/// the rest of the app degrades gracefully without watcher events
/// (refresh button still works).
fn start_watcher(path: &str, app: &AppHandle, state: &Arc<AppState>) {
    let pool_opt = state.db_pool.lock().unwrap().clone();
    let Some(pool) = pool_opt else {
        tracing::warn!("start_watcher: no db pool; skipping");
        return;
    };
    match crate::watcher::start(std::path::PathBuf::from(path), app.clone(), pool) {
        Ok(boxed) => {
            *state.watcher.lock().unwrap() = Some(boxed);
            tracing::info!("file watcher started for {}", path);
        }
        Err(e) => {
            tracing::warn!("start_watcher: failed: {e}");
        }
    }
}

/// Implementation of open_vault that can be tested.
pub async fn open_vault_impl(
    path: String,
    state: &Arc<AppState>,
) -> Result<VaultHandle, AppError> {
    tracing::info!("Opening vault at path: {}", path);
    let vault_path = PathBuf::from(&path);

    // Validate path exists and is a directory
    if !vault_path.exists() {
        tracing::error!("Vault path does not exist: {:?}", vault_path);
        return Err(AppError::InvalidVaultPath(
            "Path does not exist".to_string(),
        ));
    }

    if !vault_path.is_dir() {
        tracing::error!("Vault path is not a directory: {:?}", vault_path);
        return Err(AppError::InvalidVaultPath(
            "Path is not a directory".to_string(),
        ));
    }

    tracing::info!("Vault path validated: {:?}", vault_path);
    
    // Initialize vault structure
    init_vault_structure(&vault_path)?;

    // Initialize database
    let db_path = vault_path.join(".zenvault").join("index.db");
    let pool = db::init_pool(&db_path).map_err(|e| AppError::Database(e.to_string()))?;

    // Count indexed files
    let file_count = db::run_blocking(&pool, |conn| {
        crate::db::repo::FileRecord::count_by_state(conn, crate::types::FileState::Active)
    })
    .await
    .map_err(|e| AppError::Database(e.to_string()))?;

    // Store vault path and pool in state
    let opened_at = chrono::Utc::now().timestamp_millis();
    {
        let mut vault_path_lock = state.vault_path.lock().unwrap();
        *vault_path_lock = Some(path.clone());

        let mut pool_lock = state.db_pool.lock().unwrap();
        *pool_lock = Some(pool);

        let mut opened_lock = state.vault_opened_at.lock().unwrap();
        *opened_lock = Some(opened_at);
    }

    // Get vault name from path
    let name = vault_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Unnamed Vault")
        .to_string();

    Ok(VaultHandle {
        path,
        name,
        file_count,
        opened_at,
    })
}

/// Create a new vault at the specified path.
///
/// This creates the directory if it doesn't exist, then calls open_vault.
#[tauri::command]
pub async fn create_vault(
    path: String,
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<VaultHandle, AppError> {
    let handle = create_vault_impl(path.clone(), &state).await?;
    remember_last_vault(&app, &path);
    start_watcher(&path, &app, &state);
    Ok(handle)
}

pub async fn create_vault_impl(
    path: String,
    state: &Arc<AppState>,
) -> Result<VaultHandle, AppError> {
    let vault_path = PathBuf::from(&path);

    // Create the directory if it doesn't exist
    if !vault_path.exists() {
        std::fs::create_dir_all(&vault_path)?;
    }

    // Open the vault (which will initialize structure)
    open_vault_impl(path, state).await
}

/// Close the currently open vault.
///
/// This stops the file watcher, closes the database pool, and clears state.
#[tauri::command]
pub async fn close_vault(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<(), AppError> {
    close_vault_impl(&state).await?;
    forget_last_vault(&app);
    Ok(())
}

pub async fn close_vault_impl(state: &Arc<AppState>) -> Result<(), AppError> {
    // Check if a vault is open
    {
        let vault_path = state.vault_path.lock().unwrap();
        if vault_path.is_none() {
            return Err(AppError::NoVaultOpen);
        }
    }

    // Stop watcher
    {
        let mut watcher = state.watcher.lock().unwrap();
        *watcher = None; // Dropping the watcher stops it
    }

    // Close database pool
    {
        let mut pool = state.db_pool.lock().unwrap();
        *pool = None; // Pool is dropped, connections closed
    }

    // Clear vault path
    {
        let mut vault_path = state.vault_path.lock().unwrap();
        *vault_path = None;
    }

    // Clear the opened-at marker so a subsequent `get_vault_info`
    // call (which is only valid when a vault is open) can't see a
    // stale timestamp from the previous session.
    {
        let mut opened = state.vault_opened_at.lock().unwrap();
        *opened = None;
    }

    Ok(())
}

/// Get information about the currently open vault.
#[tauri::command]
pub async fn get_vault_info(state: State<'_, Arc<AppState>>) -> Result<VaultHandle, AppError> {
    get_vault_info_impl(&state).await
}

pub async fn get_vault_info_impl(state: &Arc<AppState>) -> Result<VaultHandle, AppError> {
    // Get vault path
    let path = {
        let vault_path = state.vault_path.lock().unwrap();
        vault_path.clone().ok_or(AppError::NoVaultOpen)?
    };

    let vault_path = PathBuf::from(&path);

    // Get pool
    let pool = {
        let pool_lock = state.db_pool.lock().unwrap();
        pool_lock.clone().ok_or(AppError::NoVaultOpen)?
    };

    // Count files
    let file_count = db::run_blocking(&pool, |conn| {
        crate::db::repo::FileRecord::count_by_state(conn, crate::types::FileState::Active)
    })
    .await
    .map_err(|e| AppError::Database(e.to_string()))?;

    // Get vault name
    let name = vault_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Unnamed Vault")
        .to_string();

    // Return the stable open-session timestamp. Falling back to
    // `now()` only happens in the bizarre case where the pool exists
    // but the marker wasn't set — in practice every code path that
    // populates `db_pool` also populates `vault_opened_at`, so this
    // is defensive belt-and-suspenders, not a behaviour we expect to
    // hit.
    let opened_at = state
        .vault_opened_at
        .lock()
        .unwrap()
        .unwrap_or_else(|| chrono::Utc::now().timestamp_millis());

    Ok(VaultHandle {
        path,
        name,
        file_count,
        opened_at,
    })
}

/// Initialize vault directory structure.
///
/// Creates:
/// - .zenvault/ (hidden metadata directory)
/// - .zenvault/index.db (will be created by db init)
/// - .trash/ (trashed files by month)
/// - .archive/ (archived files)
fn init_vault_structure(vault_path: &Path) -> Result<(), AppError> {
    let zenvault_dir = vault_path.join(".zenvault");
    let trash_dir = vault_path.join(".trash");
    let archive_dir = vault_path.join(".archive");

    std::fs::create_dir_all(&zenvault_dir)?;
    std::fs::create_dir_all(&trash_dir)?;
    std::fs::create_dir_all(&archive_dir)?;

    // Create .gitignore for .zenvault to prevent syncing the index
    let gitignore_path = zenvault_dir.join(".gitignore");
    if !gitignore_path.exists() {
        std::fs::write(
            gitignore_path,
            "# Never sync the index database or logs\n\
             index.db*\n\
             logs/\n\
             swap/\n",
        )?;
    }

    Ok(())
}
