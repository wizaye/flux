//! Integration tests for the FTS5 layer: upsert / delete / search
//! round-trip plus the `sanitize_query` behaviour observed through
//! the public `fts_search` surface.

use flux_lib::db::{self, init_pool, repo};
use tempfile::tempdir;

mod common;

async fn setup() -> (tempfile::TempDir, db::DbPool) {
    let dir = tempdir().unwrap();
    let pool = init_pool(&dir.path().join("flux.db")).unwrap();
    (dir, pool)
}

#[tokio::test]
async fn fts_upsert_then_search_finds_body_term() {
    let (_dir, pool) = setup().await;
    db::run_blocking(&pool, |conn| {
        repo::fts_upsert(
            conn,
            "notes/topic.md",
            "Topic Title",
            "The quick brown fox jumps over the lazy dog.",
        )
    })
    .await
    .unwrap();

    let hits = db::run_blocking(&pool, |conn| repo::fts_search(conn, "fox", 10))
        .await
        .unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].relative_path, "notes/topic.md");
    assert_eq!(hits[0].title, "Topic Title");
    assert!(hits[0].snippet.contains("fox"));
}

#[tokio::test]
async fn fts_search_returns_empty_for_blank_query() {
    let (_dir, pool) = setup().await;
    db::run_blocking(&pool, |conn| {
        repo::fts_upsert(conn, "a.md", "A", "alpha beta gamma")
    })
    .await
    .unwrap();

    for query in &["", "   ", "\t\n  "] {
        let hits = db::run_blocking(&pool, move |conn| {
            repo::fts_search(conn, query, 10)
        })
        .await
        .unwrap();
        assert!(hits.is_empty(), "expected empty hits for blank query");
    }
}

#[tokio::test]
async fn fts_search_supports_prefix_matching_for_incremental_search() {
    // `sanitize_query` appends `*` to every token, so a partial
    // word should still hit. This guards against accidentally
    // breaking the "type as you search" UX.
    let (_dir, pool) = setup().await;
    db::run_blocking(&pool, |conn| {
        repo::fts_upsert(conn, "notes/bio.md", "Biology", "photosynthesis chlorophyll")
    })
    .await
    .unwrap();

    let hits = db::run_blocking(&pool, |conn| repo::fts_search(conn, "photo", 10))
        .await
        .unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].relative_path, "notes/bio.md");
}

#[tokio::test]
async fn fts_search_treats_spaces_as_implicit_and() {
    let (_dir, pool) = setup().await;
    db::run_blocking(&pool, |conn| {
        repo::fts_upsert(conn, "a.md", "A", "alpha beta")?;
        repo::fts_upsert(conn, "b.md", "B", "alpha gamma")
    })
    .await
    .unwrap();

    // Only `a.md` contains BOTH tokens.
    let hits = db::run_blocking(&pool, |conn| repo::fts_search(conn, "alpha beta", 10))
        .await
        .unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].relative_path, "a.md");
}

#[tokio::test]
async fn fts_search_strips_quotes_so_injection_attempts_dont_crash() {
    let (_dir, pool) = setup().await;
    db::run_blocking(&pool, |conn| {
        repo::fts_upsert(conn, "a.md", "A", "safe content")
    })
    .await
    .unwrap();

    // Embedded `"` in the user input should be removed, not break out
    // of the phrase wrap inside `sanitize_query`.
    let hits = db::run_blocking(&pool, |conn| {
        repo::fts_search(conn, "\" OR 1=1 --", 10)
    })
    .await
    .unwrap();
    // No row matches; importantly, the call doesn't error.
    assert!(hits.is_empty());
}

#[tokio::test]
async fn fts_delete_removes_row_from_search() {
    let (_dir, pool) = setup().await;
    db::run_blocking(&pool, |conn| {
        repo::fts_upsert(conn, "a.md", "A", "uniquetoken")?;
        repo::fts_upsert(conn, "b.md", "B", "uniquetoken")
    })
    .await
    .unwrap();

    let before = db::run_blocking(&pool, |conn| repo::fts_search(conn, "uniquetoken", 10))
        .await
        .unwrap();
    assert_eq!(before.len(), 2);

    db::run_blocking(&pool, |conn| repo::fts_delete(conn, "a.md"))
        .await
        .unwrap();

    let after = db::run_blocking(&pool, |conn| repo::fts_search(conn, "uniquetoken", 10))
        .await
        .unwrap();
    assert_eq!(after.len(), 1);
    assert_eq!(after[0].relative_path, "b.md");
}

#[tokio::test]
async fn fts_upsert_is_idempotent_and_replaces_body() {
    let (_dir, pool) = setup().await;
    db::run_blocking(&pool, |conn| {
        repo::fts_upsert(conn, "a.md", "A", "old token")?;
        repo::fts_upsert(conn, "a.md", "A", "fresh token")
    })
    .await
    .unwrap();

    let stale = db::run_blocking(&pool, |conn| repo::fts_search(conn, "old", 10))
        .await
        .unwrap();
    assert!(stale.is_empty(), "old body should no longer match");

    let live = db::run_blocking(&pool, |conn| repo::fts_search(conn, "fresh", 10))
        .await
        .unwrap();
    assert_eq!(live.len(), 1);
}

#[tokio::test]
async fn fts_search_honours_limit() {
    let (_dir, pool) = setup().await;
    for i in 0..5 {
        let path = format!("note_{}.md", i);
        let title = format!("Note {}", i);
        let body = "shared keyword".to_string();
        db::run_blocking(&pool, move |conn| {
            repo::fts_upsert(conn, &path, &title, &body)
        })
        .await
        .unwrap();
    }

    let hits = db::run_blocking(&pool, |conn| repo::fts_search(conn, "shared", 3))
        .await
        .unwrap();
    assert_eq!(hits.len(), 3);
}
