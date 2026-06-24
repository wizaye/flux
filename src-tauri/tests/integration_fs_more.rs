//! Additional backend tests filling the remaining coverage gaps:
//!   • `write_external_file` (no vault state needed)
//!   • `repo::FileRecord::list_by_state` + `delete`
//!   • `build_file_tree` deep / nested / state-aware cases
//!   • `list_directory` returning recorded state for indexed files

use flux_lib::commands::fs::{
    create_file_impl, create_directory_impl, delete_file_impl, get_file_tree_impl,
    list_directory_impl, write_external_file, write_file_impl,
};
use flux_lib::commands::vault;
use flux_lib::db::{self, init_pool, repo::FileRecord};
use flux_lib::state::AppState;
use flux_lib::types::{AppError, FileState};
use std::sync::Arc;
use tempfile::tempdir;
use uuid::Uuid;

mod common;

async fn setup() -> (tempfile::TempDir, Arc<AppState>) {
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

// ── write_external_file ─────────────────────────────────────────────────

#[tokio::test]
async fn write_external_file_writes_atomically_when_parent_exists() {
    let dir = tempdir().unwrap();
    let target = dir.path().join("export.pdf");
    write_external_file(
        target.to_str().unwrap().into(),
        vec![0xAB, 0xCD, 0xEF],
    )
    .await
    .unwrap();
    assert_eq!(std::fs::read(&target).unwrap(), vec![0xAB, 0xCD, 0xEF]);
}

#[tokio::test]
async fn write_external_file_rejects_relative_paths() {
    let err = write_external_file("relative/path.pdf".into(), vec![1, 2, 3])
        .await
        .unwrap_err();
    assert!(matches!(err, AppError::InvalidPath(_)));
}

#[tokio::test]
async fn write_external_file_rejects_missing_parent_directory() {
    let dir = tempdir().unwrap();
    let target = dir.path().join("nonexistent-folder").join("x.pdf");
    let err = write_external_file(target.to_str().unwrap().into(), vec![1, 2])
        .await
        .unwrap_err();
    assert!(matches!(err, AppError::NotFound(_)));
}

// ── list_directory state propagation ────────────────────────────────────

#[tokio::test]
async fn list_directory_propagates_db_recorded_state_for_files() {
    let (_dir, state) = setup().await;
    write_file_impl("a.md".into(), "body".into(), &state).await.unwrap();
    // delete_file flips the DB row to Trashed.
    delete_file_impl("a.md".into(), &state).await.unwrap();
    // Recreate a new file in its place via direct fs (so the row
    // referenced by `a.md` is Trashed, but a NEW file exists).
    std::fs::write(vault_root(&state).join("a.md"), "fresh body").unwrap();

    let entries = list_directory_impl("".into(), &state).await.unwrap();
    let entry = entries
        .iter()
        .find(|e| e.name == "a.md")
        .expect("a.md visible in listing");
    // The state field IS populated from DB lookups.
    assert!(matches!(entry.state, Some(FileState::Trashed)));
}

// ── build_file_tree edge cases ──────────────────────────────────────────

#[tokio::test]
async fn get_file_tree_walks_deeply_nested_folders_with_consistent_depth() {
    let (_dir, state) = setup().await;
    create_directory_impl("a/b/c/d".into(), &state).await.unwrap();
    write_file_impl("a/b/c/d/leaf.md".into(), "x".into(), &state)
        .await
        .unwrap();
    let nodes = get_file_tree_impl(&state).await.unwrap();
    let depths: std::collections::HashMap<_, _> = nodes
        .iter()
        .map(|n| (n.id.replace('\\', "/"), n.depth))
        .collect();
    assert_eq!(depths.get("a"), Some(&0));
    assert_eq!(depths.get("a/b"), Some(&1));
    assert_eq!(depths.get("a/b/c"), Some(&2));
    assert_eq!(depths.get("a/b/c/d"), Some(&3));
    assert_eq!(depths.get("a/b/c/d/leaf.md"), Some(&4));
}

#[tokio::test]
async fn get_file_tree_skips_external_noise_directories() {
    let (_dir, state) = setup().await;
    let root = vault_root(&state);
    std::fs::create_dir_all(root.join("node_modules/foo")).unwrap();
    std::fs::write(root.join("node_modules/foo/x.md"), "ignored").unwrap();
    std::fs::create_dir_all(root.join(".git")).unwrap();
    write_file_impl("notes/keep.md".into(), "x".into(), &state).await.unwrap();

    let nodes = get_file_tree_impl(&state).await.unwrap();
    let ids: std::collections::HashSet<_> =
        nodes.iter().map(|n| n.id.replace('\\', "/")).collect();
    assert!(ids.contains("notes"));
    assert!(ids.contains("notes/keep.md"));
    assert!(!ids.iter().any(|i| i.starts_with("node_modules")));
    assert!(!ids.iter().any(|i| i.starts_with(".git")));
}

// ── repo: list_by_state + delete ────────────────────────────────────────

#[tokio::test]
async fn file_record_list_by_state_returns_only_matching_rows() {
    let dir = tempdir().unwrap();
    let pool = init_pool(&dir.path().join("flux.db")).unwrap();
    let now = chrono::Utc::now().timestamp_millis();

    for (rel, state_v) in [
        ("active1.md", FileState::Active),
        ("active2.md", FileState::Active),
        ("archived.md", FileState::Archived),
        ("trashed.md", FileState::Trashed),
    ] {
        let r = FileRecord {
            id: Uuid::now_v7(),
            relative_path: rel.into(),
            title: rel.into(),
            blake3_hash: vec![0u8; 32],
            modified_at: now,
            state: state_v,
            size_bytes: 1,
            created_at: now,
        };
        let r_clone = r.clone();
        db::run_blocking(&pool, move |conn| FileRecord::insert(conn, &r_clone))
            .await
            .unwrap();
    }

    let active = db::run_blocking(&pool, |conn| {
        FileRecord::list_by_state(conn, FileState::Active)
    })
    .await
    .unwrap();
    let names: Vec<_> = active.iter().map(|r| r.relative_path.as_str()).collect();
    assert_eq!(names.len(), 2);
    assert!(names.contains(&"active1.md"));
    assert!(names.contains(&"active2.md"));

    let archived = db::run_blocking(&pool, |conn| {
        FileRecord::list_by_state(conn, FileState::Archived)
    })
    .await
    .unwrap();
    assert_eq!(archived.len(), 1);
    assert_eq!(archived[0].relative_path, "archived.md");
}

#[tokio::test]
async fn file_record_delete_removes_row_by_path() {
    let dir = tempdir().unwrap();
    let pool = init_pool(&dir.path().join("flux.db")).unwrap();
    let r = FileRecord {
        id: Uuid::now_v7(),
        relative_path: "ephemeral.md".into(),
        title: "ephemeral".into(),
        blake3_hash: vec![0u8; 32],
        modified_at: 0,
        state: FileState::Active,
        size_bytes: 0,
        created_at: 0,
    };
    let r_clone = r.clone();
    db::run_blocking(&pool, move |conn| FileRecord::insert(conn, &r_clone))
        .await
        .unwrap();

    db::run_blocking(&pool, |conn| FileRecord::delete(conn, "ephemeral.md"))
        .await
        .unwrap();

    let row = db::run_blocking(&pool, |conn| {
        FileRecord::get_by_path(conn, "ephemeral.md")
    })
    .await
    .unwrap();
    assert!(row.is_none());
}

#[tokio::test]
async fn file_record_delete_errors_when_path_is_missing() {
    let dir = tempdir().unwrap();
    let pool = init_pool(&dir.path().join("flux.db")).unwrap();
    let err = db::run_blocking(&pool, |conn| FileRecord::delete(conn, "ghost.md"))
        .await
        .unwrap_err();
    let msg = format!("{:?}", err);
    assert!(msg.contains("ghost.md") || msg.contains("not found"));
}

// ── create_file via create_file_impl shim path ──────────────────────────

#[tokio::test]
async fn create_file_impl_creates_through_write_file_impl() {
    let (_dir, state) = setup().await;
    create_file_impl("seeded.md".into(), "initial".into(), &state)
        .await
        .unwrap();
    let abs = vault_root(&state).join("seeded.md");
    assert!(abs.exists());
    assert_eq!(std::fs::read_to_string(&abs).unwrap(), "initial");
}

#[test]
fn smoke_common_helpers() {
    let (_dir, vault) = common::fresh_vault();
    assert!(vault.exists());
}
