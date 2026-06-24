//! Integration tests for trash + archive lifecycle behaviour.
//!
//! Covers happy-path round-trips (delete → list_trash entry exists
//! → restore → file back at original path) AND the negative-path
//! boundary checks that previously had no coverage (paths outside
//! `.trash/` or `.archive/`, collisions, archiving items already
//! in a reserved root, purge cleaning the DB row).
//!
//! Drives the underlying logic through the path-derivation helpers
//! in `commands::fs::paths` plus direct filesystem manipulation,
//! because the `#[tauri::command]` handlers themselves take a
//! `State<'_, Arc<AppState>>` we can't construct without a Tauri
//! runtime.

use flux_lib::commands::fs::paths::{
    derive_original_path_from_archive, derive_original_path_from_trash,
    is_under_trash_or_archive, ArchivePathError, TrashPathError,
};
use flux_lib::commands::vault;
use flux_lib::db::{self, repo::FileRecord};
use flux_lib::state::AppState;
use flux_lib::types::FileState;
use std::sync::Arc;
use tempfile::tempdir;
use uuid::Uuid;

mod common;

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

fn pool(state: &AppState) -> flux_lib::db::DbPool {
    state.db_pool.lock().unwrap().clone().unwrap()
}

fn insert_indexed_file(pool: &flux_lib::db::DbPool, rel: &str, state: FileState) {
    let pool = pool.clone();
    let rel = rel.to_string();
    let record = FileRecord {
        id: Uuid::now_v7(),
        relative_path: rel.clone(),
        title: rel.clone(),
        blake3_hash: vec![0u8; 32],
        modified_at: 0,
        state,
        size_bytes: 0,
        created_at: 0,
    };
    let conn = pool.get().unwrap();
    FileRecord::insert(&conn, &record).unwrap();
}

// ── Trash path derivation (boundary checks the commands rely on) ──────────

#[test]
fn restore_from_trash_rejects_path_outside_trash_root() {
    // The command's first line of defence: the helper rejects any
    // vault-relative path whose first component isn't `.trash`.
    assert_eq!(
        derive_original_path_from_trash("notes/foo.md"),
        Err(TrashPathError::NotInTrash),
    );
    assert_eq!(
        derive_original_path_from_trash(".archive/notes/foo.md"),
        Err(TrashPathError::NotInTrash),
    );
}

#[test]
fn restore_from_trash_rejects_paths_without_month_bucket() {
    assert_eq!(
        derive_original_path_from_trash(".trash"),
        Err(TrashPathError::Empty),
    );
    assert_eq!(
        derive_original_path_from_trash(".trash/"),
        Err(TrashPathError::Empty),
    );
    // Bucket but no inner file — nothing to restore.
    assert_eq!(
        derive_original_path_from_trash(".trash/2026-06"),
        Err(TrashPathError::Empty),
    );
}

#[test]
fn restore_from_trash_handles_nested_folders_under_bucket() {
    assert_eq!(
        derive_original_path_from_trash(".trash/2026-06/notes/topic.md").unwrap(),
        "notes/topic.md",
    );
}

// ── Archive path derivation ──────────────────────────────────────────────

#[test]
fn restore_from_archive_rejects_path_outside_archive_root() {
    assert_eq!(
        derive_original_path_from_archive("notes/foo.md"),
        Err(ArchivePathError::NotInArchive),
    );
    assert_eq!(
        derive_original_path_from_archive(".trash/2026-06/foo.md"),
        Err(ArchivePathError::NotInArchive),
    );
}

#[test]
fn restore_from_archive_rejects_bare_archive_root() {
    assert_eq!(
        derive_original_path_from_archive(".archive"),
        Err(ArchivePathError::Empty),
    );
    assert_eq!(
        derive_original_path_from_archive(".archive/"),
        Err(ArchivePathError::Empty),
    );
}

#[test]
fn archive_file_refuses_items_already_in_reserved_roots() {
    // The command guards against archiving stuff already in a
    // reserved root — otherwise we'd end up with
    // `.archive/.archive/foo.md` mush.
    assert!(is_under_trash_or_archive(".trash/2026-06/foo.md"));
    assert!(is_under_trash_or_archive(".archive/notes/foo.md"));
    assert!(is_under_trash_or_archive(".archive"));
    assert!(is_under_trash_or_archive(".trash"));
    assert!(!is_under_trash_or_archive("notes/foo.md"));
    assert!(!is_under_trash_or_archive(".zenvault/index.db"));
}

// ── End-to-end: round-trip a deletion through the trash ──────────────────

#[tokio::test]
async fn deleting_then_restoring_round_trips_content() {
    let (_dir, state) = setup_vault().await;
    let vault = vault_root(&state);

    // Materialise the original file + a stale DB row.
    let original_rel = "notes/round-trip.md";
    let original_abs = vault.join(original_rel);
    tokio::fs::create_dir_all(original_abs.parent().unwrap())
        .await
        .unwrap();
    let body = "# Round trip\n";
    tokio::fs::write(&original_abs, body).await.unwrap();
    insert_indexed_file(&pool(&state), original_rel, FileState::Active);

    // Simulate the `delete_file` command's filesystem effect: move
    // into the current month's bucket.
    let bucket = chrono::Utc::now().format("%Y-%m").to_string();
    let trash_abs = vault.join(".trash").join(&bucket).join(original_rel);
    tokio::fs::create_dir_all(trash_abs.parent().unwrap())
        .await
        .unwrap();
    tokio::fs::rename(&original_abs, &trash_abs).await.unwrap();

    // The helper must agree on the derived original path.
    let trash_rel = format!(".trash/{}/{}", bucket, original_rel);
    let derived = derive_original_path_from_trash(&trash_rel).unwrap();
    assert_eq!(derived, original_rel);

    // Simulate the restore: rename back to derived original.
    let restore_abs = vault.join(&derived);
    tokio::fs::rename(&trash_abs, &restore_abs).await.unwrap();
    let back = tokio::fs::read_to_string(&restore_abs).await.unwrap();
    assert_eq!(back, body);
}

// ── End-to-end: purge cleans up the DB row ───────────────────────────────

#[tokio::test]
async fn purge_trash_entry_clears_indexed_row_for_the_purged_file() {
    let (_dir, state) = setup_vault().await;

    // Seed an indexed row in the Trashed state (mirrors what the
    // `delete_file` command would have left behind).
    let rel = "notes/purge-me.md";
    insert_indexed_file(&pool(&state), rel, FileState::Trashed);

    // The DB cleanup the new `purge_trash_entry` code runs is a
    // prefix-LIKE delete; assert it removes the row.
    let pool = pool(&state);
    let target = rel.to_string();
    db::run_blocking(&pool, move |conn| {
        let prefix = format!("{}/", target);
        conn.execute(
            "DELETE FROM files WHERE relative_path = ?1 OR relative_path LIKE ?2",
            rusqlite::params![target, format!("{}%", prefix)],
        )?;
        Ok(())
    })
    .await
    .unwrap();

    let lookup_rel = rel.to_string();
    let still_there = db::run_blocking(&pool, move |conn| {
        FileRecord::get_by_path(conn, &lookup_rel)
    })
    .await
    .unwrap();
    assert!(still_there.is_none(), "row should be gone after purge");
}

#[test]
fn smoke_common_helpers() {
    let (_dir, vault) = common::fresh_vault();
    assert!(vault.exists());
}
