//! Common helper functions for file system operations.
//!
//! Shared utilities for path validation, state access, etc.

use crate::state::AppState;
use crate::types::AppError;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::State;

/// Get the current vault path from state.
pub(crate) fn get_vault_path_from_state(state: &State<Arc<AppState>>) -> Result<PathBuf, AppError> {
    get_vault_path(state)
}

/// Get the current vault path from Arc state.
pub(crate) fn get_vault_path(state: &AppState) -> Result<PathBuf, AppError> {
    let vault_path = state.vault_path.lock().unwrap();
    vault_path
        .as_ref()
        .map(PathBuf::from)
        .ok_or(AppError::NoVaultOpen)
}

/// Get the database pool from state.
pub(crate) fn get_db_pool_from_state(state: &State<Arc<AppState>>) -> Result<crate::db::DbPool, AppError> {
    get_db_pool(state)
}

/// Get the database pool from Arc state.
pub(crate) fn get_db_pool(state: &AppState) -> Result<crate::db::DbPool, AppError> {
    let pool = state.db_pool.lock().unwrap();
    pool.clone().ok_or(AppError::NoVaultOpen)
}

/// Validate a relative path and resolve it within the vault.
///
/// Prevents path traversal attacks (e.g., "../../../etc/passwd").
pub fn validate_and_resolve_path(vault_path: &Path, relative: &str) -> Result<PathBuf, AppError> {
    // Normalize path separators
    let relative = relative.replace('\\', "/");

    // Check for path traversal attempts
    if relative.contains("..") {
        return Err(AppError::InvalidPath(
            "Path traversal not allowed".to_string(),
        ));
    }

    // Check for absolute paths
    if relative.starts_with('/') || relative.starts_with('\\') {
        return Err(AppError::InvalidPath("Absolute paths not allowed".to_string()));
    }

    let full_path = vault_path.join(&relative);

    // Ensure the resolved path is still within the vault
    if !full_path.starts_with(vault_path) {
        return Err(AppError::InvalidPath("Path outside vault".to_string()));
    }

    Ok(full_path)
}
