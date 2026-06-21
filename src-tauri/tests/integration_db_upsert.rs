//! Integration tests for `FileRecord::insert` upsert behaviour.
//!
//! These guard against a regression where saving a file twice (or
//! racing two saves under different slash flavours) would trip the
//! UNIQUE(relative_path) constraint and fail the second insert.
//!
//! The fix is `ON CONFLICT(relative_path) DO UPDATE` — these tests
//! verify the new contract:
//!   • Second insert with the same path updates the existing row
//!     (no error).
//!   • `id` and `created_at` are preserved across the upsert.
//!   • `title`, `blake3_hash`, `modified_at`, `size_bytes`, `state`
//!     all reflect the most recent insert's values.

use flux_lib::db::{self, init_pool, repo::FileRecord};
use flux_lib::types::FileState;
use tempfile::tempdir;
use uuid::Uuid;

mod common;

fn make_record(path: &str, title: &str, hash_byte: u8, modified: i64) -> FileRecord {
    FileRecord {
        id: Uuid::now_v7(),
        relative_path: path.into(),
        title: title.into(),
        blake3_hash: vec![hash_byte; 32],
        modified_at: modified,
        state: FileState::Active,
        size_bytes: u64::from(hash_byte),
        created_at: modified,
    }
}

#[tokio::test]
async fn second_insert_on_same_path_becomes_an_update() {
    let dir = tempdir().unwrap();
    let pool = init_pool(&dir.path().join("t.db")).unwrap();

    let first = make_record("notes/a.md", "First", 1, 1000);
    let f1 = first.clone();
    db::run_blocking(&pool, move |conn| FileRecord::insert(conn, &f1))
        .await
        .unwrap();

    // Second insert with same path — used to bomb with UNIQUE
    // constraint violation; now it upserts.
    let second = make_record("notes/a.md", "Second", 9, 2000);
    let s2 = second.clone();
    db::run_blocking(&pool, move |conn| FileRecord::insert(conn, &s2))
        .await
        .expect("upsert should succeed on duplicate path");

    let row = db::run_blocking(&pool, |conn| {
        FileRecord::get_by_path(conn, "notes/a.md")
    })
    .await
    .unwrap()
    .expect("row present");

    // Title / hash / modified / size all moved to the new values.
    assert_eq!(row.title, "Second");
    assert_eq!(row.blake3_hash, vec![9u8; 32]);
    assert_eq!(row.modified_at, 2000);
    assert_eq!(row.size_bytes, 9);
}

#[tokio::test]
async fn upsert_preserves_id_and_created_at() {
    let dir = tempdir().unwrap();
    let pool = init_pool(&dir.path().join("t.db")).unwrap();

    let first = make_record("notes/b.md", "Original", 2, 5000);
    let original_id = first.id;
    let f1 = first.clone();
    db::run_blocking(&pool, move |conn| FileRecord::insert(conn, &f1))
        .await
        .unwrap();

    // Second insert carries a fresh UUID + later timestamp — we
    // want the ON CONFLICT clause to IGNORE both fields and keep
    // the original identity.
    let second = make_record("notes/b.md", "Edited", 3, 9999);
    let s2 = second.clone();
    db::run_blocking(&pool, move |conn| FileRecord::insert(conn, &s2))
        .await
        .unwrap();

    let row = db::run_blocking(&pool, |conn| {
        FileRecord::get_by_path(conn, "notes/b.md")
    })
    .await
    .unwrap()
    .unwrap();

    // id and created_at carry over from the first insert; title +
    // modified_at reflect the second.
    assert_eq!(row.id, original_id);
    assert_eq!(row.created_at, 5000);
    assert_eq!(row.title, "Edited");
    assert_eq!(row.modified_at, 9999);
}

#[tokio::test]
async fn upsert_resets_state_to_match_new_record() {
    let dir = tempdir().unwrap();
    let pool = init_pool(&dir.path().join("t.db")).unwrap();

    let first = make_record("notes/c.md", "C", 1, 100);
    let f1 = first.clone();
    db::run_blocking(&pool, move |conn| FileRecord::insert(conn, &f1))
        .await
        .unwrap();
    db::run_blocking(&pool, |conn| {
        FileRecord::update_state(conn, "notes/c.md", FileState::Trashed)
    })
    .await
    .unwrap();

    // Re-save the file — write_file builds the record with
    // `state: Active`, so the upsert should flip the row back from
    // Trashed to Active. (Equivalent to restoring via re-save.)
    let resave = make_record("notes/c.md", "C", 1, 200);
    let r = resave.clone();
    db::run_blocking(&pool, move |conn| FileRecord::insert(conn, &r))
        .await
        .unwrap();

    let row = db::run_blocking(&pool, |conn| {
        FileRecord::get_by_path(conn, "notes/c.md")
    })
    .await
    .unwrap()
    .unwrap();
    assert_eq!(row.state, FileState::Active);
}

#[test]
fn smoke_common_helpers() {
    let (_dir, vault) = common::fresh_vault();
    common::write_file(&vault, "ping.md", "pong");
    assert!(vault.join("ping.md").is_file());
}
