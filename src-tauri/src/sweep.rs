//! Periodic mtime drift sweep — safety net for the notify watcher.
//!
//! On very large vaults the OS file-event APIs run out of watch
//! handles (`fs.inotify.max_user_watches`, FSEvents stream limits,
//! ReadDirectoryChangesW queue overflow) and silently drop events.
//! This module re-discovers the drift after the fact by walking
//! the vault on a slow interval and comparing each `.md` file's
//! disk mtime against the index's `modified_at`.
//!
//! Two guarantees:
//!
//!   * The notify watcher remains the primary path — sweeps are
//!     idempotent and only emit events for files that genuinely
//!     drifted, so a healthy watcher generates ~zero sweep work.
//!   * The sweep is bounded: it walks the indexable subset only
//!     (skips `.zenvault`, `node_modules`, `.gitignore`-matched
//!     paths), pages SQLite reads in one snapshot, and exits early
//!     when the snapshot is empty (newly-opened vaults).

use crate::commands::fs::gitignore::{load_root_gitignore, matches_gitignore};
use crate::commands::fs::paths::{is_ignored_by_watcher, is_indexable_text};
use crate::db::DbPool;
use rusqlite::params;
use std::collections::HashMap;
use std::path::Path;
use std::time::Duration;

/// Sweep cadence. Slow enough to be free on healthy systems, fast
/// enough to recover from a missed event before the user notices.
/// 5 minutes is the cron-style "sane default" for FS drift sweeps.
pub const SWEEP_INTERVAL: Duration = Duration::from_secs(5 * 60);

/// Indexable file count cap for a single sweep. A vault bigger than
/// this almost certainly has a different problem (inotify limits,
/// dedicated background sync, etc.); the sweep just walks until it
/// runs out of budget and stops — better than allocating 200k path
/// strings into memory at once.
pub const MAX_FILES_PER_SWEEP: usize = 50_000;

/// Compute the vault-relative paths whose disk mtime no longer
/// matches the indexed `files.modified_at`. Returned in walk order,
/// deduplicated, capped at `MAX_FILES_PER_SWEEP`.
///
/// The returned list is suitable for [`super::reindex`] —
/// missing-on-disk files are NOT reported here (the notify watcher
/// is the right surface for deletion events; missing-on-disk would
/// require a follow-up sweep to enumerate removed paths).
pub fn drift_paths(vault_path: &Path, pool: &DbPool) -> Vec<String> {
    let mtimes_indexed = match snapshot_indexed_mtimes(pool) {
        Ok(m) => m,
        Err(e) => {
            tracing::warn!(error = %e, "sweep: snapshot failed");
            return vec![];
        }
    };

    let gi = load_root_gitignore(vault_path);
    let mut drifted = Vec::new();
    let mut seen = 0usize;
    let walker = walkdir::WalkDir::new(vault_path)
        .follow_links(false)
        .into_iter();

    for entry in walker.flatten() {
        if seen >= MAX_FILES_PER_SWEEP {
            tracing::info!(seen, "sweep: hit MAX_FILES_PER_SWEEP cap");
            break;
        }
        let rel = match entry.path().strip_prefix(vault_path) {
            Ok(r) => r.to_string_lossy().replace('\\', "/"),
            Err(_) => continue,
        };
        if rel.is_empty() {
            continue;
        }
        if is_ignored_by_watcher(&rel) {
            continue;
        }
        if let Some(gi) = gi.as_ref() {
            if matches_gitignore(gi, &rel, entry.file_type().is_dir()) {
                continue;
            }
        }
        if !entry.file_type().is_file() || !is_indexable_text(&rel) {
            continue;
        }
        seen += 1;

        let disk_mtime = match entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
        {
            Some(t) => t,
            None => continue,
        };

        // Use a 1-second epsilon. Several filesystems (FAT32, some
        // tar pipelines) store mtime at second resolution, so a
        // pure equality check would emit false positives every
        // sweep. 1s is enough to absorb the rounding without
        // hiding genuine writes.
        let drifted_here = match mtimes_indexed.get(&rel) {
            Some(indexed) => (disk_mtime - indexed).abs() > 1000,
            None => true, // not indexed yet → re-index it.
        };
        if drifted_here {
            drifted.push(rel);
        }
    }

    drifted
}

fn snapshot_indexed_mtimes(pool: &DbPool) -> anyhow::Result<HashMap<String, i64>> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT relative_path, modified_at FROM files WHERE state = 'active'",
    )?;
    let rows = stmt
        .query_map(params![], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })?
        .collect::<Result<Vec<_>, rusqlite::Error>>()?;
    Ok(rows.into_iter().collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use std::fs;
    use std::thread;
    use tempfile::tempdir;

    fn open_pool() -> (tempfile::TempDir, DbPool) {
        let tmp = tempdir().unwrap();
        let pool = db::init_pool(&tmp.path().join("index.db")).unwrap();
        (tmp, pool)
    }

    fn insert_file_row(pool: &DbPool, rel: &str, modified_at: i64) {
        let conn = pool.get().unwrap();
        conn.execute(
            "INSERT INTO files (id, relative_path, title, blake3_hash, modified_at, state, size_bytes)
             VALUES (randomblob(16), ?1, 'x', randomblob(32), ?2, 'active', 0)",
            params![rel, modified_at],
        )
        .unwrap();
    }

    #[test]
    fn empty_vault_returns_empty() {
        let (tmp, pool) = open_pool();
        let drift = drift_paths(tmp.path(), &pool);
        assert!(drift.is_empty());
    }

    #[test]
    fn never_indexed_file_shows_up_as_drift() {
        let (tmp, pool) = open_pool();
        fs::write(tmp.path().join("note.md"), "body").unwrap();
        let drift = drift_paths(tmp.path(), &pool);
        assert_eq!(drift, vec!["note.md"]);
    }

    #[test]
    fn matching_mtime_is_not_drift() {
        let (tmp, pool) = open_pool();
        let p = tmp.path().join("note.md");
        fs::write(&p, "body").unwrap();
        let mtime_ms = fs::metadata(&p)
            .unwrap()
            .modified()
            .unwrap()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;
        insert_file_row(&pool, "note.md", mtime_ms);
        let drift = drift_paths(tmp.path(), &pool);
        assert!(drift.is_empty(), "expected no drift, got {drift:?}");
    }

    #[test]
    fn out_of_date_index_reports_drift() {
        let (tmp, pool) = open_pool();
        let p = tmp.path().join("note.md");
        fs::write(&p, "body").unwrap();
        // Index claims this file was last touched at epoch 0 — the
        // file actually written above is "now", so drift > 1s.
        insert_file_row(&pool, "note.md", 0);
        thread::sleep(Duration::from_millis(10));
        let drift = drift_paths(tmp.path(), &pool);
        assert_eq!(drift, vec!["note.md"]);
    }

    #[test]
    fn ignores_non_indexable_extensions() {
        let (tmp, pool) = open_pool();
        fs::write(tmp.path().join("image.png"), "PNGDATA").unwrap();
        let drift = drift_paths(tmp.path(), &pool);
        assert!(drift.is_empty());
    }

    #[test]
    fn respects_gitignore() {
        let (tmp, pool) = open_pool();
        fs::write(tmp.path().join(".gitignore"), "ignored.md\n").unwrap();
        fs::write(tmp.path().join("ignored.md"), "no").unwrap();
        fs::write(tmp.path().join("kept.md"), "yes").unwrap();
        let drift = drift_paths(tmp.path(), &pool);
        assert_eq!(drift, vec!["kept.md"]);
    }
}
