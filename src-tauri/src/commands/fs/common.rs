//! Common helper functions for file system operations.
//!
//! Shared utilities for path validation, state access, etc.

use crate::state::AppState;
use crate::types::AppError;
use std::path::{Path, PathBuf};

/// Get the current vault path from the app state.
///
/// Command bodies have been refactored to take `&AppState` directly
/// (the `*_impl` variants), so this is the only flavour we still
/// keep. The Tauri runtime invokes the `#[tauri::command]` shims
/// which call `*_impl(args, &state)` — `State<'_, Arc<AppState>>`
/// derefs cleanly to `&AppState` at the call site.
pub(crate) fn get_vault_path(state: &AppState) -> Result<PathBuf, AppError> {
    let vault_path = state.vault_path.lock().unwrap();
    vault_path
        .as_ref()
        .map(PathBuf::from)
        .ok_or(AppError::NoVaultOpen)
}

/// Get the database pool from the app state. See [`get_vault_path`].
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

    // Reject null bytes (filesystem APIs interpret them as terminators)
    // and Windows NTFS Alternate Data Stream syntax (`file.txt:zone.id`).
    if relative.contains('\0') {
        return Err(AppError::InvalidPath("Null byte in path".to_string()));
    }

    // Check for path traversal attempts. We match `..` ONLY as a
    // whole path component (`foo/../bar`, `..`, `../baz`), NOT as a
    // substring of a filename — that previously rejected legitimate
    // names like `release-notes-v1..3.md`.
    if relative.split('/').any(|seg| seg == "..") {
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

/// Canonicalise a vault-relative path for DB / index keys.
///
/// Two flavours of the same path collide on the SQLite UNIQUE
/// constraint — `"notes/a.md"` and `"notes\\a.md"` are the same
/// file on disk but two distinct strings to the index. Worse, the
/// frontend sometimes emits one form and the watcher emits the
/// other, so an "insert if missing" check fails to find the existing
/// row and triggers UNIQUE-violations or duplicate inserts.
///
/// We collapse:
///   • backslashes → forward slashes
///   • repeated slashes (`a//b` → `a/b`)
///   • leading slash (`/a/b` → `a/b`)
///   • trailing slash (`a/b/` → `a/b`)
///
/// We deliberately do NOT lowercase: macOS / Linux are case-sensitive
/// so `Notes/A.md` and `notes/a.md` are different files. Windows
/// filesystems usually fold case but treating "physics.md" and
/// "Physics.md" as the same row would lose data on case-sensitive
/// platforms.
pub fn canonicalise_rel(path: &str) -> String {
    let slashed = path.replace('\\', "/");
    let mut out = String::with_capacity(slashed.len());
    let mut prev_slash = false;
    for ch in slashed.chars() {
        if ch == '/' {
            if prev_slash {
                continue;
            }
            prev_slash = true;
        } else {
            prev_slash = false;
        }
        out.push(ch);
    }
    let trimmed = out.trim_start_matches('/').trim_end_matches('/');
    trimmed.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[test]
    fn test_get_vault_path_when_closed() {
        let state = AppState::default();
        let err = get_vault_path(&state).unwrap_err();
        assert!(matches!(err, AppError::NoVaultOpen));
    }

    #[test]
    fn test_get_vault_path_when_open() {
        let state = AppState {
            vault_path: Mutex::new(Some("/my/test/vault".to_string())),
            ..Default::default()
        };
        let path = get_vault_path(&state).unwrap();
        assert_eq!(path, PathBuf::from("/my/test/vault"));
    }

    #[test]
    fn test_get_db_pool_when_closed() {
        let state = AppState::default();
        let err = get_db_pool(&state).unwrap_err();
        assert!(matches!(err, AppError::NoVaultOpen));
    }
}
