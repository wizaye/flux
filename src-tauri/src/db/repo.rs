//! Repository pattern for file database operations.
//!
//! All functions here operate on a `&Connection` and are synchronous.
//! The caller (command layer) wraps these in `spawn_blocking`.
use crate::types::FileState;
use anyhow::{Context, Result};
use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

/// File record in the database.
#[derive(Debug, Clone)]
pub struct FileRecord {
    pub id: Uuid,
    pub relative_path: String,
    pub title: String,
    pub blake3_hash: Vec<u8>,
    pub modified_at: i64,
    pub state: FileState,
    pub size_bytes: u64,
    pub created_at: i64,
}

impl FileRecord {
    /// Insert (or upsert) a file record. Uses
    /// `ON CONFLICT(relative_path)` so a redundant insert never
    /// fails with a UNIQUE-constraint error — common when the
    /// frontend retries a save after a transient FS error, or when
    /// the canonical-path normalisation collapses two casings.
    ///
    /// Behaviour:
    ///   • New path → fresh row with the provided UUID.
    ///   • Existing path → updates everything EXCEPT the original
    ///     `id` and `created_at` (preserves stable identity even
    ///     when the user manually edits the file off-app).
    pub fn insert(conn: &Connection, record: &FileRecord) -> Result<()> {
        conn.execute(
            "INSERT INTO files (id, relative_path, title, blake3_hash, modified_at, state, size_bytes, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(relative_path) DO UPDATE SET
                title = excluded.title,
                blake3_hash = excluded.blake3_hash,
                modified_at = excluded.modified_at,
                state = excluded.state,
                size_bytes = excluded.size_bytes",
            params![
                record.id.as_bytes(),
                &record.relative_path,
                &record.title,
                &record.blake3_hash,
                record.modified_at,
                record.state.as_str(),
                record.size_bytes as i64,
                record.created_at,
            ],
        )
        .context("Failed to insert file record")?;
        Ok(())
    }

    /// Update an existing file record by path.
    pub fn update_by_path(conn: &Connection, path: &str, record: &FileRecord) -> Result<()> {
        let updated = conn.execute(
            "UPDATE files 
             SET title = ?1, blake3_hash = ?2, modified_at = ?3, size_bytes = ?4
             WHERE relative_path = ?5",
            params![
                &record.title,
                &record.blake3_hash,
                record.modified_at,
                record.size_bytes as i64,
                path,
            ],
        )?;

        if updated == 0 {
            anyhow::bail!("File not found: {}", path);
        }

        Ok(())
    }

    /// Get a file record by relative path.
    pub fn get_by_path(conn: &Connection, path: &str) -> Result<Option<FileRecord>> {
        let mut stmt = conn.prepare(
            "SELECT id, relative_path, title, blake3_hash, modified_at, state, size_bytes, created_at
             FROM files WHERE relative_path = ?1",
        )?;

        let record = stmt
            .query_row(params![path], |row| {
                let id_bytes: Vec<u8> = row.get(0)?;
                let state_str: String = row.get(5)?;
                let state = match state_str.as_str() {
                    "active" => FileState::Active,
                    "archived" => FileState::Archived,
                    "trashed" => FileState::Trashed,
                    _ => FileState::Active,
                };

                Ok(FileRecord {
                    id: Uuid::from_slice(&id_bytes).unwrap(),
                    relative_path: row.get(1)?,
                    title: row.get(2)?,
                    blake3_hash: row.get(3)?,
                    modified_at: row.get(4)?,
                    state,
                    size_bytes: row.get::<_, i64>(6)? as u64,
                    created_at: row.get(7)?,
                })
            })
            .optional()?;

        Ok(record)
    }

    /// Update file state (active/archived/trashed).
    ///
    /// No-op when the path isn't indexed yet (the file may exist on
    /// disk without a row — e.g. files discovered by the vault
    /// scanner but never touched by `write_file`). The filesystem is
    /// the source of truth; the DB is just a derived index.
    pub fn update_state(conn: &Connection, path: &str, state: FileState) -> Result<()> {
        conn.execute(
            "UPDATE files SET state = ?1 WHERE relative_path = ?2",
            params![state.as_str(), path],
        )?;
        Ok(())
    }

    /// Update file path (for rename/move operations).
    ///
    /// No-op when the path isn't indexed yet (same rationale as
    /// `update_state`).
    pub fn update_path(conn: &Connection, old_path: &str, new_path: &str) -> Result<()> {
        conn.execute(
            "UPDATE files SET relative_path = ?1 WHERE relative_path = ?2",
            params![new_path, old_path],
        )?;
        Ok(())
    }

    /// Delete a file record.
    #[allow(dead_code)]
    pub fn delete(conn: &Connection, path: &str) -> Result<()> {
        let deleted = conn.execute("DELETE FROM files WHERE relative_path = ?1", params![path])?;

        if deleted == 0 {
            anyhow::bail!("File not found: {}", path);
        }

        Ok(())
    }

    /// List all files with a given state.
    #[allow(dead_code)]
    pub fn list_by_state(conn: &Connection, state: FileState) -> Result<Vec<FileRecord>> {
        let mut stmt = conn.prepare(
            "SELECT id, relative_path, title, blake3_hash, modified_at, state, size_bytes, created_at
             FROM files WHERE state = ?1 ORDER BY relative_path",
        )?;

        let records = stmt
            .query_map(params![state.as_str()], |row| {
                let id_bytes: Vec<u8> = row.get(0)?;
                let state_str: String = row.get(5)?;
                let state = match state_str.as_str() {
                    "active" => FileState::Active,
                    "archived" => FileState::Archived,
                    "trashed" => FileState::Trashed,
                    _ => FileState::Active,
                };

                Ok(FileRecord {
                    id: Uuid::from_slice(&id_bytes).unwrap(),
                    relative_path: row.get(1)?,
                    title: row.get(2)?,
                    blake3_hash: row.get(3)?,
                    modified_at: row.get(4)?,
                    state,
                    size_bytes: row.get::<_, i64>(6)? as u64,
                    created_at: row.get(7)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(records)
    }

    /// Count files by state.
    pub fn count_by_state(conn: &Connection, state: FileState) -> Result<u32> {
        let count: i64 =
            conn.query_row("SELECT COUNT(*) FROM files WHERE state = ?1", params![state.as_str()], |row| row.get(0))?;
        Ok(count as u32)
    }
}

// ── FTS5 helpers ────────────────────────────────────────────────────────
//
// The `files_fts` virtual table is contentless from our app's POV:
// we never JOIN it back to `files`, we always re-insert on write.
// Keeping these helpers free functions (not methods on FileRecord)
// makes it obvious they belong to a different table.

/// Replace the FTS row for `relative_path` with the new title + body.
/// Idempotent: deletes the old row (if any) then inserts the new.
pub fn fts_upsert(
    conn: &Connection,
    relative_path: &str,
    title: &str,
    body: &str,
) -> Result<()> {
    fts_delete(conn, relative_path)?;
    conn.execute(
        "INSERT INTO files_fts(relative_path, title, body) VALUES (?1, ?2, ?3)",
        params![relative_path, title, body],
    )?;
    Ok(())
}

/// Drop the FTS row for `relative_path`. Safe to call on a missing
/// path (no-op).
pub fn fts_delete(conn: &Connection, relative_path: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM files_fts WHERE relative_path = ?1",
        params![relative_path],
    )?;
    Ok(())
}

/// Single hit returned from `fts_search`.
pub struct FtsHit {
    pub relative_path: String,
    pub title: String,
    /// Snippet built from the body using SQLite's `snippet()` aux fn.
    pub snippet: String,
}

/// FTS5 search. `query` is passed through to FTS5's MATCH operator so
/// callers can use phrase / NEAR / column filters. Caller is
/// responsible for sanitising untrusted input (we escape double-
/// quotes here to prevent the simplest injection of bad operators).
pub fn fts_search(conn: &Connection, query: &str, limit: u32) -> Result<Vec<FtsHit>> {
    // Wrap each whitespace-separated token in double quotes so FTS5
    // treats them as literal phrases. Strips embedded `"` to avoid
    // breaking out of the phrase. Matches the "expected" behaviour of
    // a search-box: spaces = AND across phrases, not raw FTS syntax.
    let q = sanitize_query(query);
    if q.is_empty() {
        return Ok(vec![]);
    }
    let mut stmt = conn.prepare(
        "SELECT relative_path, title,
                snippet(files_fts, 2, '<mark>', '</mark>', '…', 16) AS snippet
         FROM files_fts
         WHERE files_fts MATCH ?1
         ORDER BY bm25(files_fts)
         LIMIT ?2",
    )?;
    let rows = stmt
        .query_map(params![q, limit as i64], |row| {
            Ok(FtsHit {
                relative_path: row.get(0)?,
                title: row.get(1)?,
                snippet: row.get(2)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

fn sanitize_query(input: &str) -> String {
    let mut out = String::new();
    let mut first = true;
    for tok in input.split_whitespace() {
        if tok.is_empty() {
            continue;
        }
        if !first {
            out.push(' ');
        }
        first = false;
        out.push('"');
        out.push_str(&tok.replace('"', ""));
        out.push('"');
        // Star at end allows prefix matching ("foo*" matches "foobar")
        // which is what users expect from incremental search.
        out.push('*');
    }
    out
}
