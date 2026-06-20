//! Integration tests for the SQLite layer: pool init, PRAGMA
//! configuration, blocking-task wrapper, and basic FileRecord CRUD.

use flux_lib::db::{self, init_pool, repo::FileRecord};
use flux_lib::types::FileState;
use tempfile::tempdir;
use uuid::Uuid;

mod common;

#[tokio::test]
async fn init_pool_creates_db_file_with_correct_pragmas() {
    let dir = tempdir().unwrap();
    let db_path = dir.path().join("flux.db");
    let pool = init_pool(&db_path).unwrap();
    assert!(db_path.exists());

    let conn = pool.get().unwrap();
    let journal_mode: String = conn
        .pragma_query_value(None, "journal_mode", |row| row.get(0))
        .unwrap();
    assert_eq!(journal_mode.to_lowercase(), "wal");

    let foreign_keys: i32 = conn
        .pragma_query_value(None, "foreign_keys", |row| row.get(0))
        .unwrap();
    assert_eq!(foreign_keys, 1);
}

#[tokio::test]
async fn run_blocking_executes_on_pool_thread() {
    let dir = tempdir().unwrap();
    let pool = init_pool(&dir.path().join("t.db")).unwrap();

    let result = db::run_blocking(&pool, |conn| {
        let n: i64 = conn.query_row("SELECT 1 + 1", [], |row| row.get(0))?;
        Ok(n)
    })
    .await
    .unwrap();
    assert_eq!(result, 2);
}

#[tokio::test]
async fn file_record_round_trips_via_repo() {
    let dir = tempdir().unwrap();
    let pool = init_pool(&dir.path().join("t.db")).unwrap();
    let now = chrono::Utc::now().timestamp_millis();

    let record = FileRecord {
        id: Uuid::now_v7(),
        relative_path: "notes/a.md".into(),
        title: "A".into(),
        blake3_hash: vec![1u8; 32],
        modified_at: now,
        state: FileState::Active,
        size_bytes: 12,
        created_at: now,
    };
    let inserted = record.clone();
    db::run_blocking(&pool, move |conn| FileRecord::insert(conn, &inserted))
        .await
        .unwrap();

    let fetched = db::run_blocking(&pool, |conn| {
        FileRecord::get_by_path(conn, "notes/a.md")
    })
    .await
    .unwrap()
    .expect("file row present");
    assert_eq!(fetched.title, "A");
    assert_eq!(fetched.state, FileState::Active);
    assert_eq!(fetched.size_bytes, 12);
}

#[tokio::test]
async fn file_record_update_by_path_rewrites_title_and_size() {
    let dir = tempdir().unwrap();
    let pool = init_pool(&dir.path().join("t.db")).unwrap();
    let now = chrono::Utc::now().timestamp_millis();

    let original = FileRecord {
        id: Uuid::now_v7(),
        relative_path: "notes/b.md".into(),
        title: "Original".into(),
        blake3_hash: vec![2u8; 32],
        modified_at: now,
        state: FileState::Active,
        size_bytes: 5,
        created_at: now,
    };
    let r1 = original.clone();
    db::run_blocking(&pool, move |conn| FileRecord::insert(conn, &r1))
        .await
        .unwrap();

    let mut updated = original.clone();
    updated.title = "Renamed".into();
    updated.size_bytes = 99;
    let r2 = updated.clone();
    db::run_blocking(&pool, move |conn| {
        FileRecord::update_by_path(conn, "notes/b.md", &r2)
    })
    .await
    .unwrap();

    let fetched = db::run_blocking(&pool, |conn| {
        FileRecord::get_by_path(conn, "notes/b.md")
    })
    .await
    .unwrap()
    .unwrap();
    assert_eq!(fetched.title, "Renamed");
    assert_eq!(fetched.size_bytes, 99);
}

#[tokio::test]
async fn file_record_update_state_marks_trashed() {
    let dir = tempdir().unwrap();
    let pool = init_pool(&dir.path().join("t.db")).unwrap();
    let now = chrono::Utc::now().timestamp_millis();

    let record = FileRecord {
        id: Uuid::now_v7(),
        relative_path: "notes/c.md".into(),
        title: "C".into(),
        blake3_hash: vec![3u8; 32],
        modified_at: now,
        state: FileState::Active,
        size_bytes: 1,
        created_at: now,
    };
    let r = record.clone();
    db::run_blocking(&pool, move |conn| FileRecord::insert(conn, &r))
        .await
        .unwrap();

    db::run_blocking(&pool, |conn| {
        FileRecord::update_state(conn, "notes/c.md", FileState::Trashed)
    })
    .await
    .unwrap();

    let fetched = db::run_blocking(&pool, |conn| {
        FileRecord::get_by_path(conn, "notes/c.md")
    })
    .await
    .unwrap()
    .unwrap();
    assert_eq!(fetched.state, FileState::Trashed);
}

#[test]
fn smoke_common_helpers() {
    // Sanity-check the shared helpers within this binary too.
    let (_dir, vault) = common::fresh_vault();
    common::write_file(&vault, "x.md", "ok");
    assert!(vault.join("x.md").is_file());
}
