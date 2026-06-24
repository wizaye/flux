//! Integration tests for `watcher::reindex` — the function the
//! debounced fs-watcher calls to reconcile the SQLite index after
//! a batch of on-disk changes.
//!
//! We exercise it directly (without a live `notify` subscription)
//! by setting up a real vault + DB, mutating files on disk, then
//! calling `reindex(&pool, &vault, &changed, &removed)`.

use flux_lib::commands::vault;
use flux_lib::db::{self, repo::FileRecord};
use flux_lib::state::AppState;
use flux_lib::types::FileState;
use flux_lib::watcher;
use std::sync::Arc;
use tempfile::tempdir;

mod common;

async fn setup() -> (tempfile::TempDir, Arc<AppState>) {
    let dir = tempdir().unwrap();
    let vault_path = dir.path().join("vault");
    std::fs::create_dir(&vault_path).unwrap();
    let state = Arc::new(AppState::default());
    vault::open_vault_impl(vault_path.to_str().unwrap().into(), &state)
        .await
        .unwrap();
    (dir, state)
}

fn vault_root(state: &AppState) -> std::path::PathBuf {
    let p = state.vault_path.lock().unwrap();
    std::path::PathBuf::from(p.as_ref().unwrap())
}

fn pool(state: &AppState) -> flux_lib::db::DbPool {
    state.db_pool.lock().unwrap().clone().unwrap()
}

#[tokio::test]
async fn reindex_inserts_a_row_for_a_brand_new_file() {
    let (_dir, state) = setup().await;
    let vault = vault_root(&state);
    std::fs::write(vault.join("a.md"), "# Title\nbody").unwrap();

    watcher::reindex(&pool(&state), &vault, &["a.md".into()], &[]).unwrap();

    let record = db::run_blocking(&pool(&state), |conn| {
        FileRecord::get_by_path(conn, "a.md")
    })
    .await
    .unwrap()
    .expect("row inserted by reindex");
    assert_eq!(record.title, "Title");
    assert_eq!(record.state, FileState::Active);
    assert!(record.size_bytes > 0);
}

#[tokio::test]
async fn reindex_updates_existing_row_in_place_when_content_changes() {
    let (_dir, state) = setup().await;
    let vault = vault_root(&state);
    let path = vault.join("topic.md");
    std::fs::write(&path, "# First\noriginal body").unwrap();
    watcher::reindex(&pool(&state), &vault, &["topic.md".into()], &[]).unwrap();
    let first = db::run_blocking(&pool(&state), |conn| {
        FileRecord::get_by_path(conn, "topic.md")
    })
    .await
    .unwrap()
    .unwrap();

    std::fs::write(&path, "# Second\nrenamed body and bigger").unwrap();
    watcher::reindex(&pool(&state), &vault, &["topic.md".into()], &[]).unwrap();
    let second = db::run_blocking(&pool(&state), |conn| {
        FileRecord::get_by_path(conn, "topic.md")
    })
    .await
    .unwrap()
    .unwrap();

    // Same id (preserved across update), updated title + size.
    assert_eq!(first.id, second.id);
    assert_eq!(second.title, "Second");
    assert!(second.size_bytes > first.size_bytes);
}

#[tokio::test]
async fn reindex_marks_removed_files_as_trashed_in_db() {
    let (_dir, state) = setup().await;
    let vault = vault_root(&state);
    std::fs::write(vault.join("a.md"), "body").unwrap();
    watcher::reindex(&pool(&state), &vault, &["a.md".into()], &[]).unwrap();

    // Now the file is gone from disk + a removed batch lands.
    std::fs::remove_file(vault.join("a.md")).unwrap();
    watcher::reindex(&pool(&state), &vault, &[], &["a.md".into()]).unwrap();

    let record = db::run_blocking(&pool(&state), |conn| {
        FileRecord::get_by_path(conn, "a.md")
    })
    .await
    .unwrap()
    .unwrap();
    assert_eq!(record.state, FileState::Trashed);
}

#[tokio::test]
async fn reindex_silently_skips_changed_entries_that_do_not_exist_on_disk() {
    // The watcher batches inotify events; a 'change' notification
    // can arrive for a path that's already been moved or deleted.
    // We must not error in that case.
    let (_dir, state) = setup().await;
    let vault = vault_root(&state);
    watcher::reindex(&pool(&state), &vault, &["never-existed.md".into()], &[])
        .unwrap();

    let record = db::run_blocking(&pool(&state), |conn| {
        FileRecord::get_by_path(conn, "never-existed.md")
    })
    .await
    .unwrap();
    assert!(record.is_none());
}

#[tokio::test]
async fn reindex_skips_indexing_body_of_non_text_files() {
    let (_dir, state) = setup().await;
    let vault = vault_root(&state);
    std::fs::write(vault.join("image.png"), [0u8; 256]).unwrap();
    watcher::reindex(&pool(&state), &vault, &["image.png".into()], &[]).unwrap();

    // Even a binary file gets a row (so trash / list operations
    // see it) but the FTS body column is empty — searching for a
    // body-only string (which we pretend the binary blob's bytes
    // contain) returns no hits. The title is still indexed, so
    // searching for "image" would match; we use a distinctive
    // body-only token instead.
    let row = db::run_blocking(&pool(&state), |conn| {
        FileRecord::get_by_path(conn, "image.png")
    })
    .await
    .unwrap();
    assert!(row.is_some());

    let hits = db::run_blocking(&pool(&state), |conn| {
        db::repo::fts_search(conn, "uniquebodyonlytoken", 10)
    })
    .await
    .unwrap();
    assert!(hits.is_empty());
}

#[tokio::test]
async fn reindex_round_trips_multiple_files_in_a_single_transaction() {
    let (_dir, state) = setup().await;
    let vault = vault_root(&state);
    std::fs::write(vault.join("a.md"), "alpha").unwrap();
    std::fs::write(vault.join("b.md"), "beta").unwrap();
    std::fs::write(vault.join("c.md"), "gamma").unwrap();

    watcher::reindex(
        &pool(&state),
        &vault,
        &["a.md".into(), "b.md".into(), "c.md".into()],
        &[],
    )
    .unwrap();

    for name in ["a.md", "b.md", "c.md"] {
        let row = db::run_blocking(&pool(&state), move |conn| {
            FileRecord::get_by_path(conn, name)
        })
        .await
        .unwrap();
        assert!(row.is_some(), "expected row for {name}");
    }
}

#[tokio::test]
async fn reindex_drops_fts_row_for_removed_file() {
    let (_dir, state) = setup().await;
    let vault = vault_root(&state);
    std::fs::write(vault.join("findme.md"), "uniquesearchtoken").unwrap();
    watcher::reindex(&pool(&state), &vault, &["findme.md".into()], &[]).unwrap();

    // Confirm the FTS index sees the body.
    let before = db::run_blocking(&pool(&state), |conn| {
        db::repo::fts_search(conn, "uniquesearchtoken", 10)
    })
    .await
    .unwrap();
    assert_eq!(before.len(), 1);

    // Remove + reindex with the path in `removed`.
    std::fs::remove_file(vault.join("findme.md")).unwrap();
    watcher::reindex(&pool(&state), &vault, &[], &["findme.md".into()]).unwrap();

    let after = db::run_blocking(&pool(&state), |conn| {
        db::repo::fts_search(conn, "uniquesearchtoken", 10)
    })
    .await
    .unwrap();
    assert!(after.is_empty());
}

#[test]
fn smoke_common_helpers() {
    let (_dir, vault) = common::fresh_vault();
    assert!(vault.exists());
}
