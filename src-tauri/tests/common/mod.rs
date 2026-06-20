//! Shared helpers for integration tests under `src-tauri/tests/`.
//!
//! Each `tests/*.rs` file is compiled as its own crate, so re-exports
//! from this module mean less duplication across vault setup, file
//! seeding, and basic tempdir bookkeeping.

use std::path::{Path, PathBuf};
use tempfile::TempDir;

/// Materialise a fresh empty vault on disk and return both the
/// guard (drop to remove) and the absolute vault root path.
pub fn fresh_vault() -> (TempDir, PathBuf) {
    let dir = tempfile::tempdir().expect("create tempdir");
    let root = dir.path().join("vault");
    std::fs::create_dir(&root).expect("mkdir vault");
    (dir, root)
}

/// Write a UTF-8 file under the vault, creating parent dirs as
/// needed. Returns the absolute path of the new file.
pub fn write_file(vault: &Path, rel: &str, content: &str) -> PathBuf {
    let abs = vault.join(rel);
    if let Some(parent) = abs.parent() {
        std::fs::create_dir_all(parent).expect("mkdir -p");
    }
    std::fs::write(&abs, content).expect("write");
    abs
}
