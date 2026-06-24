//! Persistent "last opened vault" pointer — pure file IO so it can
//! be unit-tested without spinning up a Tauri runtime.
//!
//! The on-disk format is a single UTF-8 path inside the host's
//! per-app config dir. We keep it dumb on purpose: a JSON / TOML
//! wrapper would gain nothing and complicate migrations.

use std::path::{Path, PathBuf};

/// File name inside `<app_config_dir>/` that stores the last vault.
pub const LAST_VAULT_FILE_NAME: &str = "last-vault.txt";

fn last_vault_file_in(config_dir: &Path) -> PathBuf {
    config_dir.join(LAST_VAULT_FILE_NAME)
}

/// Persist the freshly-opened vault path so the next launch can
/// auto-reopen. Best-effort — a write failure is logged but never
/// surfaces to the user (the vault open already succeeded).
pub fn write_last_vault(config_dir: &Path, vault_path: &str) {
    let file = last_vault_file_in(config_dir);
    if let Some(parent) = file.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Err(e) = std::fs::write(&file, vault_path) {
        tracing::warn!("Failed to persist last-vault path: {e}");
    }
}

/// Forget the recorded vault. Called from `close_vault` so a
/// subsequent launch shows the picker.
pub fn forget_last_vault(config_dir: &Path) {
    let _ = std::fs::remove_file(last_vault_file_in(config_dir));
}

/// Load the recorded vault path, if any.
///
/// Returns `None` (and best-effort cleans the stale pointer) when:
///   • the file is missing,
///   • the file is empty / whitespace-only,
///   • the recorded path no longer exists on disk.
pub fn read_last_vault(config_dir: &Path) -> Option<String> {
    let file = last_vault_file_in(config_dir);
    match std::fs::read_to_string(&file) {
        Ok(raw) => {
            let trimmed = raw.trim().to_string();
            if trimmed.is_empty() {
                None
            } else if !Path::new(&trimmed).exists() {
                // Stale pointer — clean it up so the next launch
                // doesn't keep trying a moved/deleted folder.
                forget_last_vault(config_dir);
                None
            } else {
                Some(trimmed)
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => {
            tracing::warn!("Failed to read last-vault file: {e}");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn write_then_read_round_trips_the_path() {
        let config = tempdir().unwrap();
        let vault = tempdir().unwrap();
        let vault_str = vault.path().to_str().unwrap().to_string();
        write_last_vault(config.path(), &vault_str);
        assert_eq!(read_last_vault(config.path()), Some(vault_str));
    }

    #[test]
    fn read_returns_none_when_file_missing() {
        let config = tempdir().unwrap();
        assert_eq!(read_last_vault(config.path()), None);
    }

    #[test]
    fn read_returns_none_and_cleans_stale_pointer() {
        let config = tempdir().unwrap();
        // Recorded path that doesn't exist on disk.
        std::fs::write(
            config.path().join(LAST_VAULT_FILE_NAME),
            "/definitely/does/not/exist",
        )
        .unwrap();
        assert_eq!(read_last_vault(config.path()), None);
        // The stale pointer should be removed.
        assert!(!config.path().join(LAST_VAULT_FILE_NAME).exists());
    }

    #[test]
    fn read_returns_none_for_empty_or_whitespace_pointer() {
        let config = tempdir().unwrap();
        std::fs::write(config.path().join(LAST_VAULT_FILE_NAME), "   \n  ").unwrap();
        assert_eq!(read_last_vault(config.path()), None);
    }

    #[test]
    fn forget_is_a_no_op_when_file_missing() {
        let config = tempdir().unwrap();
        forget_last_vault(config.path());
        assert!(!config.path().join(LAST_VAULT_FILE_NAME).exists());
    }

    #[test]
    fn write_creates_parent_config_dir_if_missing() {
        let parent = tempdir().unwrap();
        // Point at a nested config dir that doesn't exist yet.
        let nested = parent.path().join("nested/config");
        let vault = tempdir().unwrap();
        let vault_str = vault.path().to_str().unwrap().to_string();
        write_last_vault(&nested, &vault_str);
        assert!(nested.join(LAST_VAULT_FILE_NAME).exists());
    }
}
