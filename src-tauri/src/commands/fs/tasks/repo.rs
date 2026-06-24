//! SQLite repository for the `tasks` table. Mirrors the
//! `db::repo` conventions: every public function takes a
//! `&Connection` so the caller controls transaction scope.
//!
//! The indexer wraps `reindex_file_tasks` in a single transaction
//! per file: delete-then-insert keeps the row set canonical
//! without diffing.

use crate::commands::fs::tasks::parse::{ParsedTask, TaskStatus};
use anyhow::Result;
use blake3::Hasher;
use rusqlite::{Connection, OptionalExtension, params};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TaskRecord {
    pub id: String,
    pub file_id: String,
    pub block_anchor: Option<String>,
    pub line_hint: u32,
    pub status: TaskStatus,
    pub raw_text: String,
    pub indexed_at: i64,
}

/// Derive the stable id for a task.
///
/// Block-anchored tasks key off `(file_id, anchor)` so re-ordering
/// the file doesn't churn ids. Un-anchored tasks fall back to
/// `(file_id, raw_text)` — that's the best we can do without an
/// anchor and matches the spec's "fuzzy match on raw_text" idea.
pub fn task_id(file_id: &str, anchor: Option<&str>, raw_text: &str) -> String {
    let mut h = Hasher::new();
    h.update(file_id.as_bytes());
    h.update(b"\0");
    match anchor {
        Some(a) => {
            h.update(b"a:");
            h.update(a.as_bytes());
        }
        None => {
            h.update(b"r:");
            h.update(raw_text.as_bytes());
        }
    }
    // 16 hex chars (64 bits) is enough for a within-vault key.
    let hex = h.finalize().to_hex();
    hex[..16].to_string()
}

/// Replace every task row for `file_id` with the parsed list.
/// Caller wraps in a transaction.
pub fn reindex_file_tasks(
    conn: &Connection,
    file_id: &str,
    tasks: &[ParsedTask],
    indexed_at: i64,
) -> Result<()> {
    conn.execute(
        "DELETE FROM tasks WHERE file_id = ?1",
        params![file_id],
    )?;
    let mut stmt = conn.prepare(
        "INSERT INTO tasks (id, file_id, block_anchor, line_hint, status, raw_text, indexed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(id) DO UPDATE
           SET block_anchor = excluded.block_anchor,
               line_hint    = excluded.line_hint,
               status       = excluded.status,
               raw_text     = excluded.raw_text,
               indexed_at   = excluded.indexed_at",
    )?;
    for t in tasks {
        let id = task_id(file_id, t.block_anchor.as_deref(), &t.raw_text);
        stmt.execute(params![
            id,
            file_id,
            t.block_anchor.as_deref(),
            t.line as u32,
            t.status.as_str(),
            t.raw_text,
            indexed_at,
        ])?;
    }
    Ok(())
}

/// Fetch a single task by its stable id. Returns `None` when the
/// row was reindexed away (file deleted, task removed).
pub fn get_task(conn: &Connection, id: &str) -> Result<Option<TaskRecord>> {
    let row = conn
        .query_row(
            "SELECT id, file_id, block_anchor, line_hint, status, raw_text, indexed_at
             FROM tasks WHERE id = ?1",
            params![id],
            |row| {
                Ok(TaskRecord {
                    id: row.get(0)?,
                    file_id: row.get(1)?,
                    block_anchor: row.get(2)?,
                    line_hint: row.get::<_, u32>(3)?,
                    status: TaskStatus::from_db_str(&row.get::<_, String>(4)?),
                    raw_text: row.get(5)?,
                    indexed_at: row.get(6)?,
                })
            },
        )
        .optional()?;
    Ok(row)
}

/// All tasks owned by one file, ordered by `line_hint`.
pub fn list_tasks_for_file(conn: &Connection, file_id: &str) -> Result<Vec<TaskRecord>> {
    let mut stmt = conn.prepare(
        "SELECT id, file_id, block_anchor, line_hint, status, raw_text, indexed_at
         FROM tasks
         WHERE file_id = ?1
         ORDER BY line_hint ASC",
    )?;
    let rows = stmt
        .query_map(params![file_id], |row| {
            Ok(TaskRecord {
                id: row.get(0)?,
                file_id: row.get(1)?,
                block_anchor: row.get(2)?,
                line_hint: row.get::<_, u32>(3)?,
                status: TaskStatus::from_db_str(&row.get::<_, String>(4)?),
                raw_text: row.get(5)?,
                indexed_at: row.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, rusqlite::Error>>()?;
    Ok(rows)
}

/// All open tasks across the vault, oldest indexed first. Used by
/// the Tasks pane's "open" view.
pub fn list_open_tasks(conn: &Connection, limit: u32) -> Result<Vec<TaskRecord>> {
    let mut stmt = conn.prepare(
        "SELECT id, file_id, block_anchor, line_hint, status, raw_text, indexed_at
         FROM tasks
         WHERE status = 'open'
         ORDER BY file_id ASC, line_hint ASC
         LIMIT ?1",
    )?;
    let rows = stmt
        .query_map(params![limit], |row| {
            Ok(TaskRecord {
                id: row.get(0)?,
                file_id: row.get(1)?,
                block_anchor: row.get(2)?,
                line_hint: row.get::<_, u32>(3)?,
                status: TaskStatus::from_db_str(&row.get::<_, String>(4)?),
                raw_text: row.get(5)?,
                indexed_at: row.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, rusqlite::Error>>()?;
    Ok(rows)
}

/// Drop every task row for `file_id` — used when a file is moved
/// out of the indexable set (e.g. extension changed) or removed.
pub fn delete_tasks_for_file(conn: &Connection, file_id: &str) -> Result<()> {
    conn.execute("DELETE FROM tasks WHERE file_id = ?1", params![file_id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::fs::tasks::parse::parse_tasks;
    use crate::db;
    use tempfile::tempdir;

    fn open() -> (tempfile::TempDir, db::DbPool) {
        let tmp = tempdir().unwrap();
        let pool = db::init_pool(&tmp.path().join("index.db")).unwrap();
        (tmp, pool)
    }

    fn seed_file_row(conn: &Connection, path: &str) {
        // Mirror `001_init.sql` shape — `files` is STRICT so column
        // names + types must match exactly. UUID v7 is BLOB(16),
        // blake3_hash is BLOB(32).
        conn.execute(
            "INSERT INTO files (id, relative_path, title, blake3_hash, modified_at, state, size_bytes)
             VALUES (randomblob(16), ?1, 'x', randomblob(32), 0, 'active', 0)",
            params![path],
        )
        .unwrap();
    }

    #[test]
    fn reindex_round_trips() {
        let (_t, pool) = open();
        let conn = pool.get().unwrap();
        seed_file_row(&conn, "n.md");
        let body = "- [ ] one\n- [x] two ^blk_zz9\n";
        let tasks = parse_tasks(body);
        reindex_file_tasks(&conn, "n.md", &tasks, 100).unwrap();
        let rows = list_tasks_for_file(&conn, "n.md").unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].status, TaskStatus::Open);
        assert_eq!(rows[1].status, TaskStatus::Done);
        assert_eq!(rows[1].block_anchor.as_deref(), Some("^blk_zz9"));
    }

    #[test]
    fn task_id_is_stable_across_reorder_when_anchored() {
        let a = task_id("n.md", Some("^blk_abc"), "buy milk");
        let b = task_id("n.md", Some("^blk_abc"), "buy milk - updated");
        assert_eq!(a, b);
    }

    #[test]
    fn task_id_diverges_when_anchorless_text_changes() {
        let a = task_id("n.md", None, "buy milk");
        let b = task_id("n.md", None, "buy eggs");
        assert_ne!(a, b);
    }

    #[test]
    fn list_open_tasks_excludes_done_and_respects_limit() {
        let (_t, pool) = open();
        let conn = pool.get().unwrap();
        seed_file_row(&conn, "a.md");
        seed_file_row(&conn, "b.md");
        let a_body = "- [ ] a1\n- [x] a2\n- [ ] a3\n";
        let b_body = "- [ ] b1\n";
        reindex_file_tasks(&conn, "a.md", &parse_tasks(a_body), 1).unwrap();
        reindex_file_tasks(&conn, "b.md", &parse_tasks(b_body), 1).unwrap();
        let all_open = list_open_tasks(&conn, 100).unwrap();
        assert_eq!(all_open.len(), 3);
        let limited = list_open_tasks(&conn, 2).unwrap();
        assert_eq!(limited.len(), 2);
    }

    #[test]
    fn reindex_replaces_previous_rows() {
        let (_t, pool) = open();
        let conn = pool.get().unwrap();
        seed_file_row(&conn, "n.md");
        let first = "- [ ] one\n- [ ] two\n";
        let second = "- [ ] only\n";
        reindex_file_tasks(&conn, "n.md", &parse_tasks(first), 1).unwrap();
        reindex_file_tasks(&conn, "n.md", &parse_tasks(second), 2).unwrap();
        assert_eq!(list_tasks_for_file(&conn, "n.md").unwrap().len(), 1);
    }

    #[test]
    fn delete_tasks_for_file_drops_all_rows() {
        let (_t, pool) = open();
        let conn = pool.get().unwrap();
        seed_file_row(&conn, "n.md");
        let body = "- [ ] a\n- [ ] b\n";
        reindex_file_tasks(&conn, "n.md", &parse_tasks(body), 1).unwrap();
        delete_tasks_for_file(&conn, "n.md").unwrap();
        assert!(list_tasks_for_file(&conn, "n.md").unwrap().is_empty());
    }
}
