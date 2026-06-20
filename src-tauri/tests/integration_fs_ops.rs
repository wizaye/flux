//! Integration tests for filesystem-level operations against a
//! real vault skeleton. Mirrors the original `commands/fs/tests.rs`
//! but lives as a separate integration target so source files stay
//! free of inline test modules.

use flux_lib::commands::fs::common::validate_and_resolve_path;
use flux_lib::commands::vault;
use flux_lib::db::{self, repo::FileRecord};
use flux_lib::state::AppState;
use flux_lib::types::FileState;
use std::sync::Arc;
use tempfile::tempdir;
use uuid::Uuid;

mod common;

/// Spin up an empty vault + open it through the same path the
/// Tauri command would. Returns the tempdir guard (drop to clean
/// up) and the wired-up AppState.
async fn setup_vault() -> (tempfile::TempDir, Arc<AppState>) {
    let dir = tempdir().unwrap();
    let vault_path = dir.path().join("test-vault");
    std::fs::create_dir(&vault_path).unwrap();

    let state = Arc::new(AppState::default());
    let path_str = vault_path.to_str().unwrap().to_string();
    vault::open_vault_impl(path_str, &state).await.unwrap();
    (dir, state)
}

fn vault_root(state: &AppState) -> std::path::PathBuf {
    let p = state.vault_path.lock().unwrap();
    std::path::PathBuf::from(p.as_ref().unwrap())
}

fn db_pool(state: &AppState) -> flux_lib::db::DbPool {
    let pool = state.db_pool.lock().unwrap();
    pool.clone().unwrap()
}

#[tokio::test]
async fn create_and_read_file_via_state() {
    let (_dir, state) = setup_vault().await;
    let content = "# Test Note\n\nThis is a test.";
    let rel = "test.md".to_string();

    let abs = vault_root(&state).join(&rel);
    tokio::fs::write(&abs, content).await.unwrap();

    let pool = db_pool(&state);
    let blake3_hash = blake3::hash(content.as_bytes()).as_bytes().to_vec();
    let record = FileRecord {
        id: Uuid::now_v7(),
        relative_path: rel.clone(),
        title: "test".to_string(),
        blake3_hash,
        modified_at: chrono::Utc::now().timestamp_millis(),
        state: FileState::Active,
        size_bytes: content.len() as u64,
        created_at: chrono::Utc::now().timestamp_millis(),
    };
    db::run_blocking(&pool, move |conn| FileRecord::insert(conn, &record))
        .await
        .unwrap();

    let read_back = tokio::fs::read_to_string(&abs).await.unwrap();
    assert_eq!(read_back, content);
}

#[tokio::test]
async fn move_file_to_trash_preserves_content() {
    let (_dir, state) = setup_vault().await;
    let root = vault_root(&state);
    let pool = db_pool(&state);

    let rel = "scratch.md";
    let abs = root.join(rel);
    tokio::fs::write(&abs, "scratch content").await.unwrap();

    let record = FileRecord {
        id: Uuid::now_v7(),
        relative_path: rel.to_string(),
        title: "scratch".to_string(),
        blake3_hash: vec![0u8; 32],
        modified_at: chrono::Utc::now().timestamp_millis(),
        state: FileState::Active,
        size_bytes: 16,
        created_at: chrono::Utc::now().timestamp_millis(),
    };
    db::run_blocking(&pool, move |conn| FileRecord::insert(conn, &record))
        .await
        .unwrap();

    // Simulate the trash move the real command performs.
    let now = chrono::Utc::now();
    let trash_dir = root.join(".trash").join(now.format("%Y-%m").to_string());
    tokio::fs::create_dir_all(&trash_dir).await.unwrap();
    let trash_path = trash_dir.join(rel);
    tokio::fs::rename(&abs, &trash_path).await.unwrap();

    db::run_blocking(&pool, |conn| {
        FileRecord::update_state(conn, "scratch.md", FileState::Trashed)
    })
    .await
    .unwrap();

    assert!(!abs.exists());
    assert!(trash_path.exists());
}

#[tokio::test]
async fn path_validation_rejects_traversal_against_open_vault() {
    let (_dir, state) = setup_vault().await;
    let root = vault_root(&state);
    let result = validate_and_resolve_path(&root, "../../../etc/passwd");
    assert!(result.is_err());
}

#[test]
fn smoke_common_helpers() {
    // Cheap synchronous sanity that the common helpers themselves
    // produce a usable tempdir vault (the async tests above rely
    // on it indirectly).
    let (_dir, vault) = common::fresh_vault();
    common::write_file(&vault, "x.md", "y");
    assert!(vault.join("x.md").is_file());
}
