//! Vault lifecycle operations.
//!
//! Handles opening, creating, and closing vaults. Sets up the database and
//! file watcher for the active vault.

use crate::db;
use crate::state::AppState;
use crate::types::{AppError, VaultHandle};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::State;

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
    state: State<'_, Arc<AppState>>,
) -> Result<VaultHandle, AppError> {
    open_vault_impl(path, &state).await
}

/// Implementation of open_vault that can be tested.
pub(crate) async fn open_vault_impl(
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
    {
        let mut vault_path_lock = state.vault_path.lock().unwrap();
        *vault_path_lock = Some(path.clone());

        let mut pool_lock = state.db_pool.lock().unwrap();
        *pool_lock = Some(pool);
    }

    // Get vault name from path
    let name = vault_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Unnamed Vault")
        .to_string();

    // Get current timestamp
    let opened_at = chrono::Utc::now().timestamp_millis();

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
    state: State<'_, Arc<AppState>>,
) -> Result<VaultHandle, AppError> {
    create_vault_impl(path, &state).await
}

async fn create_vault_impl(
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
pub async fn close_vault(state: State<'_, Arc<AppState>>) -> Result<(), AppError> {
    close_vault_impl(&state).await
}

async fn close_vault_impl(state: &Arc<AppState>) -> Result<(), AppError> {
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

    Ok(())
}

/// Get information about the currently open vault.
#[tauri::command]
pub async fn get_vault_info(state: State<'_, Arc<AppState>>) -> Result<VaultHandle, AppError> {
    get_vault_info_impl(&state).await
}

async fn get_vault_info_impl(state: &Arc<AppState>) -> Result<VaultHandle, AppError> {
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

    let opened_at = chrono::Utc::now().timestamp_millis();

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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use tempfile::tempdir;

    fn create_test_state() -> Arc<AppState> {
        Arc::new(AppState::default())
    }

    #[tokio::test]
    async fn test_create_and_open_vault() {
        let dir = tempdir().unwrap();
        let vault_path = dir.path().join("test-vault");
        let path_str = vault_path.to_str().unwrap().to_string();

        let state = create_test_state();

        // Create vault
        let handle = create_vault_impl(path_str.clone(), &state)
            .await
            .expect("Failed to create vault");

        assert_eq!(handle.name, "test-vault");
        assert_eq!(handle.file_count, 0);

        // Verify structure was created
        assert!(vault_path.join(".zenvault").exists());
        assert!(vault_path.join(".trash").exists());
        assert!(vault_path.join(".archive").exists());
        assert!(vault_path.join(".zenvault").join(".gitignore").exists());

        // Verify state was updated
        let stored_path = state.vault_path.lock().unwrap().clone();
        assert_eq!(stored_path, Some(path_str));

        // Close vault
        close_vault_impl(&state)
            .await
            .expect("Failed to close vault");

        // Verify state was cleared
        let stored_path = state.vault_path.lock().unwrap().clone();
        assert_eq!(stored_path, None);
    }

    #[tokio::test]
    async fn test_open_nonexistent_vault_fails() {
        let state = create_test_state();
        let result = open_vault_impl(
            "/nonexistent/path".to_string(),
            &state,
        )
        .await;

        assert!(result.is_err());
        match result {
            Err(AppError::InvalidVaultPath(_)) => {}
            _ => panic!("Expected InvalidVaultPath error"),
        }
    }

    #[tokio::test]
    async fn test_close_without_open_fails() {
        let state = create_test_state();
        let result = close_vault_impl(&state).await;

        assert!(result.is_err());
        match result {
            Err(AppError::NoVaultOpen) => {}
            _ => panic!("Expected NoVaultOpen error"),
        }
    }

    #[tokio::test]
    async fn test_get_vault_info() {
        let dir = tempdir().unwrap();
        let vault_path = dir.path().join("test-vault");
        let path_str = vault_path.to_str().unwrap().to_string();

        let state = create_test_state();

        // Create and open vault
        create_vault_impl(path_str.clone(), &state)
            .await
            .unwrap();

        // Get vault info
        let info = get_vault_info_impl(&state).await.unwrap();
        assert_eq!(info.name, "test-vault");
        assert_eq!(info.path, path_str);
    }
}
