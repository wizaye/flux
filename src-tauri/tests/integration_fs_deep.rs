//! Deeper coverage for the trash + archive walking loops and the
//! wikilink-heal integration baked into `move_file_impl`. These
//! exercise branches that the basic happy-path tests in
//! `integration_fs_impls.rs` don't reach.

use flux_lib::commands::fs::{
    archive_file_impl, create_directory_impl, delete_file_impl, list_archive_impl,
    list_trash_impl, move_file_impl, read_file_impl, write_file_impl,
};
use flux_lib::commands::vault;
use flux_lib::state::AppState;
use flux_lib::types::AppError;
use std::sync::Arc;
use tempfile::tempdir;

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

// ── wikilink heal ────────────────────────────────────────────────────────

#[tokio::test]
async fn move_file_heals_wikilinks_in_other_notes_pointing_at_the_old_name() {
    let (_dir, state) = setup().await;
    write_file_impl("topic.md".into(), "# Topic\n".into(), &state)
        .await
        .unwrap();
    write_file_impl(
        "referer.md".into(),
        "Refers to [[topic]] and [[topic|alias]]\n".into(),
        &state,
    )
    .await
    .unwrap();

    let result = move_file_impl("topic.md".into(), "renamed.md".into(), &state)
        .await
        .unwrap();
    assert_eq!(result.new_path.replace('\\', "/"), "renamed.md");
    assert!(result.links_healed >= 2);

    // The referer's wikilinks were rewritten to the new name.
    let body = read_file_impl("referer.md".into(), &state).await.unwrap();
    assert!(body.contains("[[renamed]]"));
    assert!(body.contains("[[renamed|alias]]"));
    assert!(!body.contains("[[topic]]"));
}

#[tokio::test]
async fn move_file_into_a_subfolder_creates_missing_parents() {
    let (_dir, state) = setup().await;
    write_file_impl("a.md".into(), "body".into(), &state)
        .await
        .unwrap();
    move_file_impl("a.md".into(), "deeply/nested/folder/a.md".into(), &state)
        .await
        .unwrap();
    assert!(vault_root(&state)
        .join("deeply/nested/folder/a.md")
        .exists());
}

// ── archive: folders ────────────────────────────────────────────────────

#[tokio::test]
async fn archive_file_works_on_a_folder_with_nested_descendants() {
    let (_dir, state) = setup().await;
    write_file_impl("notes/inner/a.md".into(), "a".into(), &state)
        .await
        .unwrap();
    write_file_impl("notes/inner/b.md".into(), "b".into(), &state)
        .await
        .unwrap();
    write_file_impl("notes/top.md".into(), "top".into(), &state)
        .await
        .unwrap();

    let archived = archive_file_impl("notes".into(), &state).await.unwrap();
    assert_eq!(archived.replace('\\', "/"), ".archive/notes");
    // Folder + every descendant moved.
    let root = vault_root(&state);
    assert!(!root.join("notes/inner/a.md").exists());
    assert!(root.join(".archive/notes/inner/a.md").exists());
    assert!(root.join(".archive/notes/inner/b.md").exists());
    assert!(root.join(".archive/notes/top.md").exists());
}

#[tokio::test]
async fn archive_file_rejects_when_target_already_exists_in_archive() {
    let (_dir, state) = setup().await;
    write_file_impl("a.md".into(), "v1".into(), &state).await.unwrap();
    archive_file_impl("a.md".into(), &state).await.unwrap();
    // Pre-seed a collision: create a second file at the same path
    // and try to archive again.
    write_file_impl("a.md".into(), "v2".into(), &state).await.unwrap();
    let err = archive_file_impl("a.md".into(), &state).await.unwrap_err();
    assert!(matches!(err, AppError::AlreadyExists(_)));
}

// ── list_archive / list_trash deep walking ──────────────────────────────

#[tokio::test]
async fn list_archive_walks_deeply_nested_archive_tree() {
    let (_dir, state) = setup().await;
    write_file_impl("a/b/c/x.md".into(), "x".into(), &state)
        .await
        .unwrap();
    archive_file_impl("a/b/c/x.md".into(), &state).await.unwrap();

    let entries = list_archive_impl(&state).await.unwrap();
    // Should see every path component: a, a/b, a/b/c, a/b/c/x.md.
    let paths: Vec<String> = entries
        .iter()
        .map(|e| e.archive_path.replace('\\', "/"))
        .collect();
    assert!(paths.iter().any(|p| p.ends_with("a")));
    assert!(paths.iter().any(|p| p.ends_with("a/b")));
    assert!(paths.iter().any(|p| p.ends_with("a/b/c")));
    assert!(paths.iter().any(|p| p.ends_with("a/b/c/x.md")));
}

#[tokio::test]
async fn list_trash_walks_files_nested_inside_their_original_folders() {
    let (_dir, state) = setup().await;
    write_file_impl("notes/deep/level/x.md".into(), "x".into(), &state)
        .await
        .unwrap();
    delete_file_impl("notes/deep/level/x.md".into(), &state)
        .await
        .unwrap();

    let entries = list_trash_impl(&state).await.unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(
        entries[0].original_path.replace('\\', "/"),
        "notes/deep/level/x.md",
    );
}

#[tokio::test]
async fn list_trash_returns_entries_from_multiple_month_buckets() {
    let (_dir, state) = setup().await;
    // Real bucket — current month.
    write_file_impl("a.md".into(), "a".into(), &state).await.unwrap();
    delete_file_impl("a.md".into(), &state).await.unwrap();

    // Synthetic older bucket on disk.
    let synthetic_bucket = vault_root(&state).join(".trash").join("2024-01");
    std::fs::create_dir_all(&synthetic_bucket).unwrap();
    std::fs::write(synthetic_bucket.join("legacy.md"), "legacy").unwrap();

    let entries = list_trash_impl(&state).await.unwrap();
    let names: Vec<_> = entries.iter().map(|e| e.name.as_str()).collect();
    assert!(names.contains(&"a.md"));
    assert!(names.contains(&"legacy.md"));
}

// ── create_directory: rejects nested-target collision ───────────────────

#[tokio::test]
async fn create_directory_succeeds_for_a_path_with_missing_parents() {
    // Mirrors `mkdir -p`: the helper creates every missing
    // intermediate folder under the vault.
    let (_dir, state) = setup().await;
    create_directory_impl("deep/nested/folder".into(), &state)
        .await
        .unwrap();
    assert!(vault_root(&state).join("deep/nested/folder").is_dir());
}

#[test]
fn smoke_common_helpers() {
    let (_dir, vault) = common::fresh_vault();
    assert!(vault.exists());
}
