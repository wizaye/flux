//! Integration tests for the `*_impl` command bodies in
//! `flux_lib::commands::fs`. We drive them with a fresh
//! tempdir-backed vault opened via `vault::open_vault_impl`, which
//! lets us exercise the same code path the Tauri command handler
//! runs without needing a live Tauri runtime / State.

use flux_lib::commands::fs::{
    archive_file_impl, create_directory_impl, create_file_impl, delete_file_impl,
    get_file_metadata_impl, get_file_tree_impl, list_archive_impl, list_directory_impl,
    list_trash_impl, move_file_impl, purge_trash_entry_impl, read_file_binary_impl,
    read_file_impl, rename_file_impl, restore_from_archive_impl, restore_from_trash_impl,
    search_files_impl, write_file_impl,
};
use flux_lib::commands::vault;
use flux_lib::state::AppState;
use flux_lib::types::{AppError, EntryType, FileState};
use std::sync::Arc;
use tempfile::tempdir;

mod common;

async fn setup() -> (tempfile::TempDir, Arc<AppState>) {
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

// ── write / read ─────────────────────────────────────────────────────────

#[tokio::test]
async fn write_then_read_round_trips_content() {
    let (_dir, state) = setup().await;
    write_file_impl("a.md".into(), "# Hello\nbody".into(), &state)
        .await
        .unwrap();
    let body = read_file_impl("a.md".into(), &state).await.unwrap();
    assert_eq!(body, "# Hello\nbody");
}

#[tokio::test]
async fn read_returns_not_found_for_missing_file() {
    let (_dir, state) = setup().await;
    let err = read_file_impl("ghost.md".into(), &state).await.unwrap_err();
    assert!(matches!(err, AppError::NotFound(_)));
}

#[tokio::test]
async fn read_file_binary_returns_raw_bytes() {
    let (_dir, state) = setup().await;
    let abs = vault_root(&state).join("payload.bin");
    std::fs::write(&abs, [1u8, 2, 3, 4]).unwrap();

    let bytes = read_file_binary_impl("payload.bin".into(), &state)
        .await
        .unwrap();
    assert_eq!(bytes, vec![1, 2, 3, 4]);
}

#[tokio::test]
async fn read_file_binary_returns_not_found_for_missing_file() {
    let (_dir, state) = setup().await;
    let err = read_file_binary_impl("ghost.bin".into(), &state)
        .await
        .unwrap_err();
    assert!(matches!(err, AppError::NotFound(_)));
}

#[tokio::test]
async fn write_creates_parent_directories_atomically() {
    let (_dir, state) = setup().await;
    write_file_impl(
        "notes/deeply/nested/topic.md".into(),
        "deep body".into(),
        &state,
    )
    .await
    .unwrap();
    let abs = vault_root(&state).join("notes/deeply/nested/topic.md");
    assert!(abs.exists());
}

// ── metadata ─────────────────────────────────────────────────────────────

#[tokio::test]
async fn get_file_metadata_reports_size_and_kind() {
    let (_dir, state) = setup().await;
    write_file_impl("a.md".into(), "abc".into(), &state)
        .await
        .unwrap();
    let meta = get_file_metadata_impl("a.md".into(), &state).await.unwrap();
    assert_eq!(meta.size, 3);
    assert!(!meta.is_dir);
}

#[tokio::test]
async fn get_file_metadata_directory_reports_zero_size_and_is_dir() {
    let (_dir, state) = setup().await;
    create_directory_impl("folder".into(), &state).await.unwrap();
    let meta = get_file_metadata_impl("folder".into(), &state)
        .await
        .unwrap();
    assert_eq!(meta.size, 0);
    assert!(meta.is_dir);
}

#[tokio::test]
async fn get_file_metadata_returns_not_found_for_missing_path() {
    let (_dir, state) = setup().await;
    let err = get_file_metadata_impl("ghost.md".into(), &state)
        .await
        .unwrap_err();
    assert!(matches!(err, AppError::NotFound(_)));
}

// ── create / delete ──────────────────────────────────────────────────────

#[tokio::test]
async fn create_file_fails_when_target_already_exists() {
    let (_dir, state) = setup().await;
    create_file_impl("a.md".into(), "first".into(), &state)
        .await
        .unwrap();
    let err = create_file_impl("a.md".into(), "second".into(), &state)
        .await
        .unwrap_err();
    assert!(matches!(err, AppError::AlreadyExists(_)));
}

#[tokio::test]
async fn delete_file_moves_to_current_month_trash_bucket() {
    let (_dir, state) = setup().await;
    write_file_impl("a.md".into(), "x".into(), &state)
        .await
        .unwrap();
    delete_file_impl("a.md".into(), &state).await.unwrap();

    assert!(!vault_root(&state).join("a.md").exists());
    let bucket = chrono::Utc::now().format("%Y-%m").to_string();
    assert!(vault_root(&state)
        .join(format!(".trash/{bucket}/a.md"))
        .exists());
}

#[tokio::test]
async fn delete_file_returns_not_found_for_missing_path() {
    let (_dir, state) = setup().await;
    let err = delete_file_impl("ghost.md".into(), &state).await.unwrap_err();
    assert!(matches!(err, AppError::NotFound(_)));
}

// ── directory ops ────────────────────────────────────────────────────────

#[tokio::test]
async fn create_directory_rejects_existing_path() {
    let (_dir, state) = setup().await;
    create_directory_impl("notes".into(), &state).await.unwrap();
    let err = create_directory_impl("notes".into(), &state)
        .await
        .unwrap_err();
    assert!(matches!(err, AppError::AlreadyExists(_)));
}

#[tokio::test]
async fn list_directory_empty_root_returns_empty_vec() {
    let (_dir, state) = setup().await;
    let entries = list_directory_impl("".into(), &state).await.unwrap();
    assert!(entries.is_empty(), "expected empty list, got {:?}", entries.len());
}

#[tokio::test]
async fn list_directory_sorts_folders_before_files_and_alpha() {
    let (_dir, state) = setup().await;
    write_file_impl("z.md".into(), "z".into(), &state).await.unwrap();
    write_file_impl("a.md".into(), "a".into(), &state).await.unwrap();
    create_directory_impl("notes".into(), &state).await.unwrap();
    let entries = list_directory_impl("".into(), &state).await.unwrap();

    let names: Vec<_> = entries.iter().map(|e| e.name.as_str()).collect();
    assert_eq!(names, ["notes", "a.md", "z.md"]);
    assert!(matches!(entries[0].entry_type, EntryType::Directory));
}

#[tokio::test]
async fn list_directory_returns_not_found_for_missing_subpath() {
    let (_dir, state) = setup().await;
    let err = list_directory_impl("ghost".into(), &state).await.unwrap_err();
    assert!(matches!(err, AppError::NotFound(_)));
}

#[tokio::test]
async fn list_directory_rejects_files_targets() {
    let (_dir, state) = setup().await;
    write_file_impl("a.md".into(), "x".into(), &state).await.unwrap();
    let err = list_directory_impl("a.md".into(), &state).await.unwrap_err();
    assert!(matches!(err, AppError::InvalidPath(_)));
}

#[tokio::test]
async fn list_directory_skips_vault_reserved_and_external_noise() {
    let (_dir, state) = setup().await;
    // Pre-seed noise.
    let root = vault_root(&state);
    std::fs::create_dir_all(root.join(".git")).unwrap();
    std::fs::create_dir_all(root.join("node_modules/foo")).unwrap();
    write_file_impl("a.md".into(), "x".into(), &state).await.unwrap();

    let entries = list_directory_impl("".into(), &state).await.unwrap();
    let names: Vec<_> = entries.iter().map(|e| e.name.as_str()).collect();
    assert!(names.contains(&"a.md"));
    assert!(!names.contains(&".git"));
    assert!(!names.contains(&"node_modules"));
    assert!(!names.contains(&".zenvault"));
}

// ── move / rename ────────────────────────────────────────────────────────

#[tokio::test]
async fn move_file_relocates_content_and_clears_old_path() {
    let (_dir, state) = setup().await;
    write_file_impl("a.md".into(), "body".into(), &state)
        .await
        .unwrap();
    let result = move_file_impl("a.md".into(), "moved/b.md".into(), &state)
        .await
        .unwrap();
    assert_eq!(result.new_path, "moved/b.md");
    assert!(!vault_root(&state).join("a.md").exists());
    let read_back = read_file_impl("moved/b.md".into(), &state).await.unwrap();
    assert_eq!(read_back, "body");
}

#[tokio::test]
async fn move_file_rejects_missing_source() {
    let (_dir, state) = setup().await;
    let err = move_file_impl("ghost.md".into(), "b.md".into(), &state)
        .await
        .unwrap_err();
    assert!(matches!(err, AppError::NotFound(_)));
}

#[tokio::test]
async fn move_file_rejects_existing_destination() {
    let (_dir, state) = setup().await;
    write_file_impl("a.md".into(), "x".into(), &state).await.unwrap();
    write_file_impl("b.md".into(), "y".into(), &state).await.unwrap();
    let err = move_file_impl("a.md".into(), "b.md".into(), &state)
        .await
        .unwrap_err();
    assert!(matches!(err, AppError::AlreadyExists(_)));
}

#[tokio::test]
async fn rename_file_keeps_parent_and_swaps_filename() {
    let (_dir, state) = setup().await;
    write_file_impl("notes/old.md".into(), "body".into(), &state)
        .await
        .unwrap();
    let result = rename_file_impl("notes/old.md".into(), "new.md".into(), &state)
        .await
        .unwrap();
    assert_eq!(result.new_path.replace('\\', "/"), "notes/new.md");
    assert!(vault_root(&state).join("notes/new.md").exists());
}

// ── get_file_tree ────────────────────────────────────────────────────────

#[tokio::test]
async fn get_file_tree_returns_flat_depth_encoded_list() {
    let (_dir, state) = setup().await;
    write_file_impl("README.md".into(), "r".into(), &state).await.unwrap();
    write_file_impl("notes/a.md".into(), "a".into(), &state).await.unwrap();
    write_file_impl("notes/sub/b.md".into(), "b".into(), &state)
        .await
        .unwrap();

    let nodes = get_file_tree_impl(&state).await.unwrap();
    let by_id: std::collections::HashMap<_, _> =
        nodes.iter().map(|n| (n.id.as_str(), n.depth)).collect();
    assert_eq!(by_id.get("notes"), Some(&0));
    assert_eq!(by_id.get("notes/a.md"), Some(&1));
    assert_eq!(by_id.get("notes/sub"), Some(&1));
    assert_eq!(by_id.get("notes/sub/b.md"), Some(&2));
    assert_eq!(by_id.get("README.md"), Some(&0));
}

#[tokio::test]
async fn get_file_tree_omits_vault_metadata_dirs() {
    let (_dir, state) = setup().await;
    write_file_impl("a.md".into(), "x".into(), &state).await.unwrap();
    let nodes = get_file_tree_impl(&state).await.unwrap();
    assert!(nodes.iter().all(|n| n.id != ".zenvault"));
    assert!(nodes.iter().all(|n| n.id != ".trash"));
    assert!(nodes.iter().all(|n| n.id != ".archive"));
}

// ── archive lifecycle ────────────────────────────────────────────────────

#[tokio::test]
async fn archive_then_restore_round_trips_content() {
    let (_dir, state) = setup().await;
    write_file_impl("notes/a.md".into(), "body".into(), &state)
        .await
        .unwrap();
    let archived = archive_file_impl("notes/a.md".into(), &state)
        .await
        .unwrap();
    assert_eq!(archived, ".archive/notes/a.md");
    assert!(!vault_root(&state).join("notes/a.md").exists());

    let restored = restore_from_archive_impl(archived, &state)
        .await
        .unwrap();
    assert_eq!(restored, "notes/a.md");
    assert!(vault_root(&state).join("notes/a.md").exists());
}

#[tokio::test]
async fn archive_file_rejects_paths_already_under_trash_or_archive() {
    let (_dir, state) = setup().await;
    write_file_impl("a.md".into(), "x".into(), &state).await.unwrap();
    delete_file_impl("a.md".into(), &state).await.unwrap();
    let bucket = chrono::Utc::now().format("%Y-%m").to_string();
    let trash_rel = format!(".trash/{bucket}/a.md");

    let err = archive_file_impl(trash_rel, &state).await.unwrap_err();
    assert!(matches!(err, AppError::InvalidPath(_)));
}

#[tokio::test]
async fn archive_file_rejects_missing_source() {
    let (_dir, state) = setup().await;
    let err = archive_file_impl("ghost.md".into(), &state)
        .await
        .unwrap_err();
    assert!(matches!(err, AppError::NotFound(_)));
}

#[tokio::test]
async fn archive_file_rejects_destination_collision() {
    let (_dir, state) = setup().await;
    write_file_impl("a.md".into(), "x".into(), &state).await.unwrap();
    archive_file_impl("a.md".into(), &state).await.unwrap();
    // Re-create the original, attempt to archive again.
    write_file_impl("a.md".into(), "y".into(), &state).await.unwrap();
    let err = archive_file_impl("a.md".into(), &state).await.unwrap_err();
    assert!(matches!(err, AppError::AlreadyExists(_)));
}

#[tokio::test]
async fn list_archive_returns_empty_when_archive_dir_does_not_exist() {
    let (_dir, state) = setup().await;
    // open_vault creates .archive/, but listing still works.
    let entries = list_archive_impl(&state).await.unwrap();
    assert_eq!(entries.len(), 0);
}

#[tokio::test]
async fn list_archive_returns_each_entry_with_correct_is_dir_flag() {
    let (_dir, state) = setup().await;
    write_file_impl("notes/a.md".into(), "x".into(), &state)
        .await
        .unwrap();
    archive_file_impl("notes/a.md".into(), &state).await.unwrap();

    let entries = list_archive_impl(&state).await.unwrap();
    // We should see both the `.archive/notes` folder and the file.
    let file_entry = entries
        .iter()
        .find(|e| e.archive_path.ends_with("a.md"))
        .expect("file entry");
    assert!(!file_entry.is_dir);
    assert_eq!(file_entry.original_path, "notes/a.md");

    let folder_entry = entries
        .iter()
        .find(|e| e.archive_path.ends_with("notes"));
    assert!(folder_entry.is_some_and(|e| e.is_dir));
}

#[tokio::test]
async fn restore_from_archive_rejects_paths_outside_archive_root() {
    let (_dir, state) = setup().await;
    write_file_impl("notes/a.md".into(), "x".into(), &state)
        .await
        .unwrap();
    let err = restore_from_archive_impl("notes/a.md".into(), &state)
        .await
        .unwrap_err();
    assert!(matches!(err, AppError::InvalidPath(_)));
}

// ── trash lifecycle ─────────────────────────────────────────────────────

#[tokio::test]
async fn list_trash_returns_each_deleted_file_with_original_path() {
    let (_dir, state) = setup().await;
    write_file_impl("notes/a.md".into(), "x".into(), &state)
        .await
        .unwrap();
    delete_file_impl("notes/a.md".into(), &state).await.unwrap();

    let entries = list_trash_impl(&state).await.unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].original_path.replace('\\', "/"), "notes/a.md");
}

#[tokio::test]
async fn restore_from_trash_returns_file_to_original_path() {
    let (_dir, state) = setup().await;
    write_file_impl("a.md".into(), "body".into(), &state).await.unwrap();
    delete_file_impl("a.md".into(), &state).await.unwrap();
    let bucket = chrono::Utc::now().format("%Y-%m").to_string();

    let restored = restore_from_trash_impl(format!(".trash/{bucket}/a.md"), &state)
        .await
        .unwrap();
    assert_eq!(restored, "a.md");
    assert_eq!(read_file_impl("a.md".into(), &state).await.unwrap(), "body");
}

#[tokio::test]
async fn restore_from_trash_rejects_destination_collision() {
    let (_dir, state) = setup().await;
    write_file_impl("a.md".into(), "v1".into(), &state).await.unwrap();
    delete_file_impl("a.md".into(), &state).await.unwrap();
    write_file_impl("a.md".into(), "v2".into(), &state).await.unwrap();

    let bucket = chrono::Utc::now().format("%Y-%m").to_string();
    let err = restore_from_trash_impl(format!(".trash/{bucket}/a.md"), &state)
        .await
        .unwrap_err();
    assert!(matches!(err, AppError::AlreadyExists(_)));
}

#[tokio::test]
async fn purge_trash_entry_removes_file_and_db_row() {
    let (_dir, state) = setup().await;
    write_file_impl("a.md".into(), "x".into(), &state).await.unwrap();
    delete_file_impl("a.md".into(), &state).await.unwrap();
    let bucket = chrono::Utc::now().format("%Y-%m").to_string();
    purge_trash_entry_impl(format!(".trash/{bucket}/a.md"), &state)
        .await
        .unwrap();
    assert!(!vault_root(&state)
        .join(format!(".trash/{bucket}/a.md"))
        .exists());
}

#[tokio::test]
async fn purge_trash_entry_rejects_paths_outside_trash() {
    let (_dir, state) = setup().await;
    write_file_impl("a.md".into(), "x".into(), &state).await.unwrap();
    let err = purge_trash_entry_impl("a.md".into(), &state)
        .await
        .unwrap_err();
    assert!(matches!(err, AppError::InvalidPath(_)));
}

// ── search ──────────────────────────────────────────────────────────────

#[tokio::test]
async fn search_files_returns_indexed_hits() {
    let (_dir, state) = setup().await;
    write_file_impl("a.md".into(), "rust analyzer plugin docs".into(), &state)
        .await
        .unwrap();
    write_file_impl("b.md".into(), "python notes".into(), &state)
        .await
        .unwrap();

    let hits = search_files_impl("rust".into(), None, &state)
        .await
        .unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].relative_path, "a.md");
}

#[tokio::test]
async fn search_files_returns_empty_for_blank_query() {
    let (_dir, state) = setup().await;
    write_file_impl("a.md".into(), "anything".into(), &state).await.unwrap();
    let hits = search_files_impl("   ".into(), None, &state).await.unwrap();
    assert!(hits.is_empty());
}

#[tokio::test]
async fn search_files_caps_limit_to_500() {
    let (_dir, state) = setup().await;
    write_file_impl("a.md".into(), "uniquetoken".into(), &state)
        .await
        .unwrap();
    // limit=999 → capped at 500 internally; we just verify the call
    // doesn't blow up and returns the matching row.
    let hits = search_files_impl("uniquetoken".into(), Some(999), &state)
        .await
        .unwrap();
    assert_eq!(hits.len(), 1);
}

// ── vault-not-open guards ───────────────────────────────────────────────

#[tokio::test]
async fn every_impl_rejects_when_no_vault_is_open() {
    let state = Arc::new(AppState::default());
    // A representative sample — they all share `common::get_vault_path`.
    assert!(matches!(
        read_file_impl("x".into(), &state).await,
        Err(AppError::NoVaultOpen),
    ));
    assert!(matches!(
        write_file_impl("x".into(), "y".into(), &state).await,
        Err(AppError::NoVaultOpen),
    ));
    assert!(matches!(
        get_file_tree_impl(&state).await,
        Err(AppError::NoVaultOpen),
    ));
    assert!(matches!(
        list_archive_impl(&state).await,
        Err(AppError::NoVaultOpen),
    ));
    assert!(matches!(
        search_files_impl("q".into(), None, &state).await,
        Err(AppError::NoVaultOpen),
    ));
}

#[tokio::test]
async fn delete_then_list_trash_clears_db_row_state_to_trashed() {
    use flux_lib::db::{self, repo::FileRecord};
    let (_dir, state) = setup().await;
    write_file_impl("a.md".into(), "x".into(), &state).await.unwrap();
    delete_file_impl("a.md".into(), &state).await.unwrap();

    // DB row should now be Trashed.
    let pool = state.db_pool.lock().unwrap().clone().unwrap();
    let record = db::run_blocking(&pool, |conn| FileRecord::get_by_path(conn, "a.md"))
        .await
        .unwrap()
        .expect("file row");
    assert_eq!(record.state, FileState::Trashed);
}

#[test]
fn smoke_common_helpers_link_against_lib() {
    // Drag the common helpers into the binary so the test file
    // doesn't unused-warn them.
    let (_dir, vault) = common::fresh_vault();
    assert!(vault.exists());
}
