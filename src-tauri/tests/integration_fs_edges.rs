//! Targeted tests for specific error / edge branches that the
//! happy-path integration tests don't reach. Each test is named
//! after the precise behaviour it pins.

use flux_lib::commands::fs::{
    create_directory_impl, delete_file_impl, list_directory_impl, write_file_impl,
};
use flux_lib::commands::vault::{
    self, close_vault_impl, create_vault_impl, get_vault_info_impl,
};
use flux_lib::db::{self, init_pool, repo::FileRecord};
use flux_lib::state::AppState;
use flux_lib::types::{AppError, FileState};
use std::sync::Arc;
use tempfile::tempdir;
use uuid::Uuid;

mod common;

async fn open_vault() -> (tempfile::TempDir, Arc<AppState>) {
    let dir = tempdir().unwrap();
    let vault = dir.path().join("vault");
    std::fs::create_dir(&vault).unwrap();
    let state = Arc::new(AppState::default());
    vault::open_vault_impl(vault.to_str().unwrap().into(), &state)
        .await
        .unwrap();
    (dir, state)
}

fn vault_root(state: &AppState) -> std::path::PathBuf {
    let p = state.vault_path.lock().unwrap();
    std::path::PathBuf::from(p.as_ref().unwrap())
}

// ── repo: update_by_path / fts_search edge cases ─────────────────────────

#[tokio::test]
async fn file_record_update_by_path_errors_for_missing_row() {
    let dir = tempdir().unwrap();
    let pool = init_pool(&dir.path().join("flux.db")).unwrap();
    let record = FileRecord {
        id: Uuid::now_v7(),
        relative_path: "ghost.md".into(),
        title: "ghost".into(),
        blake3_hash: vec![0u8; 32],
        modified_at: 0,
        state: FileState::Active,
        size_bytes: 0,
        created_at: 0,
    };
    let err = db::run_blocking(&pool, move |conn| {
        FileRecord::update_by_path(conn, "ghost.md", &record)
    })
    .await
    .unwrap_err();
    let msg = format!("{err}");
    assert!(msg.contains("ghost.md") || msg.contains("not found"));
}

// ── vault: opening a vault when one is already open replaces state ──────

#[tokio::test]
async fn open_vault_twice_replaces_the_open_session() {
    let dir = tempdir().unwrap();
    let v1 = dir.path().join("v1");
    let v2 = dir.path().join("v2");
    std::fs::create_dir(&v1).unwrap();
    std::fs::create_dir(&v2).unwrap();
    let state = Arc::new(AppState::default());

    vault::open_vault_impl(v1.to_str().unwrap().into(), &state)
        .await
        .unwrap();
    vault::open_vault_impl(v2.to_str().unwrap().into(), &state)
        .await
        .unwrap();

    let active = state.vault_path.lock().unwrap().clone();
    assert_eq!(active.as_deref(), v2.to_str());
}

#[tokio::test]
async fn create_vault_impl_materialises_skeleton_on_first_open() {
    let dir = tempdir().unwrap();
    let vault = dir.path().join("fresh-vault");
    let state = Arc::new(AppState::default());
    create_vault_impl(vault.to_str().unwrap().into(), &state)
        .await
        .unwrap();
    assert!(vault.join(".zenvault").exists());
    assert!(vault.join(".trash").exists());
    assert!(vault.join(".archive").exists());
    assert!(vault.join(".zenvault/.gitignore").exists());
}

#[tokio::test]
async fn init_vault_structure_is_idempotent_across_reopens() {
    let dir = tempdir().unwrap();
    let vault = dir.path().join("reopen");
    let state = Arc::new(AppState::default());
    create_vault_impl(vault.to_str().unwrap().into(), &state)
        .await
        .unwrap();

    // Replace the .gitignore with user content to verify we don't
    // clobber it on re-open.
    let gitignore = vault.join(".zenvault/.gitignore");
    let user_marker = "# touched by user\n";
    std::fs::write(&gitignore, user_marker).unwrap();

    // Re-open same vault; init should NOT rewrite the existing
    // .gitignore.
    close_vault_impl(&state).await.unwrap();
    vault::open_vault_impl(vault.to_str().unwrap().into(), &state)
        .await
        .unwrap();
    assert_eq!(std::fs::read_to_string(&gitignore).unwrap(), user_marker);
}

#[tokio::test]
async fn get_vault_info_propagates_count_changes_after_index_growth() {
    use flux_lib::commands::fs::write_file_impl;
    let (_dir, state) = open_vault().await;
    let first = get_vault_info_impl(&state).await.unwrap();
    assert_eq!(first.file_count, 0);

    for i in 0..3 {
        write_file_impl(format!("note-{i}.md"), "x".into(), &state)
            .await
            .unwrap();
    }
    let second = get_vault_info_impl(&state).await.unwrap();
    assert_eq!(second.file_count, 3);
}

// ── fs: error / edge branches inside the impls ──────────────────────────

#[tokio::test]
async fn write_file_impl_overwrites_existing_content_preserving_uuid() {
    let (_dir, state) = open_vault().await;
    write_file_impl("a.md".into(), "first".into(), &state)
        .await
        .unwrap();
    let pool = state.db_pool.lock().unwrap().clone().unwrap();
    let first = db::run_blocking(&pool, |conn| FileRecord::get_by_path(conn, "a.md"))
        .await
        .unwrap()
        .unwrap();

    write_file_impl("a.md".into(), "second".into(), &state)
        .await
        .unwrap();
    let second = db::run_blocking(&pool, |conn| FileRecord::get_by_path(conn, "a.md"))
        .await
        .unwrap()
        .unwrap();

    // UPSERT preserves the id; only the title/hash/size change.
    assert_eq!(first.id, second.id);
    assert!(second.size_bytes != first.size_bytes);
}

#[tokio::test]
async fn write_file_impl_skips_fts_body_for_non_text_extensions() {
    let (_dir, state) = open_vault().await;
    write_file_impl("doc.pdf".into(), "binary-ish".into(), &state)
        .await
        .unwrap();
    let pool = state.db_pool.lock().unwrap().clone().unwrap();
    // FTS lookup for a body token in the .pdf file should miss
    // (body wasn't indexed); the FileRecord row IS present.
    let row = db::run_blocking(&pool, |conn| FileRecord::get_by_path(conn, "doc.pdf"))
        .await
        .unwrap();
    assert!(row.is_some());
    let hits = db::run_blocking(&pool, |conn| db::repo::fts_search(conn, "binaryish", 10))
        .await
        .unwrap();
    assert!(hits.iter().all(|h| h.relative_path != "doc.pdf"));
}

#[tokio::test]
async fn create_directory_impl_creates_intermediate_levels_in_one_call() {
    let (_dir, state) = open_vault().await;
    create_directory_impl("a/b/c/d".into(), &state).await.unwrap();
    assert!(vault_root(&state).join("a/b/c/d").is_dir());
}

#[tokio::test]
async fn list_directory_returns_each_entry_with_modified_at_set() {
    let (_dir, state) = open_vault().await;
    write_file_impl("a.md".into(), "x".into(), &state).await.unwrap();
    let entries = list_directory_impl("".into(), &state).await.unwrap();
    let a = entries.iter().find(|e| e.name == "a.md").unwrap();
    assert!(a.modified_at > 0);
    assert_eq!(a.size, Some(1));
}

#[tokio::test]
async fn delete_file_impl_returns_invalid_path_for_path_traversal_attempts() {
    let (_dir, state) = open_vault().await;
    let err = delete_file_impl("../escape.md".into(), &state)
        .await
        .unwrap_err();
    assert!(matches!(err, AppError::InvalidPath(_)));
}

// ── vault: close-before-open guards ─────────────────────────────────────

#[tokio::test]
async fn close_vault_impl_is_idempotent_after_first_close() {
    let (_dir, state) = open_vault().await;
    close_vault_impl(&state).await.unwrap();
    let err = close_vault_impl(&state).await.unwrap_err();
    assert!(matches!(err, AppError::NoVaultOpen));
}

#[test]
fn smoke_common_helpers() {
    let (_dir, vault) = common::fresh_vault();
    assert!(vault.exists());
}
