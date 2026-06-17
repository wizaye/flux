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
    /// Insert a new file record.
    pub fn insert(conn: &Connection, record: &FileRecord) -> Result<()> {
        conn.execute(
            "INSERT INTO files (id, relative_path, title, blake3_hash, modified_at, state, size_bytes, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
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
    pub fn update_state(conn: &Connection, path: &str, state: FileState) -> Result<()> {
        let updated = conn.execute(
            "UPDATE files SET state = ?1 WHERE relative_path = ?2",
            params![state.as_str(), path],
        )?;

        if updated == 0 {
            anyhow::bail!("File not found: {}", path);
        }

        Ok(())
    }

    /// Update file path (for rename/move operations).
    pub fn update_path(conn: &Connection, old_path: &str, new_path: &str) -> Result<()> {
        let updated = conn.execute(
            "UPDATE files SET relative_path = ?1 WHERE relative_path = ?2",
            params![new_path, old_path],
        )?;

        if updated == 0 {
            anyhow::bail!("File not found: {}", old_path);
        }

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

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite_migration::{Migrations, M};
    use uuid::Uuid;

    fn setup_test_db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();

        // Run migration
        let migrations = Migrations::new(vec![M::up(include_str!("../../migrations/001_init.sql"))]);
        migrations.to_latest(&mut conn).unwrap();

        conn
    }

    fn create_test_record() -> FileRecord {
        FileRecord {
            id: Uuid::new_v4(),
            relative_path: "test.md".to_string(),
            title: "Test Note".to_string(),
            blake3_hash: vec![0u8; 32],
            modified_at: 1234567890,
            state: FileState::Active,
            size_bytes: 100,
            created_at: 1234567890,
        }
    }

    #[test]
    fn test_insert_and_get() {
        let conn = setup_test_db();
        let record = create_test_record();

        FileRecord::insert(&conn, &record).unwrap();

        let retrieved = FileRecord::get_by_path(&conn, "test.md").unwrap().unwrap();
        assert_eq!(retrieved.relative_path, "test.md");
        assert_eq!(retrieved.title, "Test Note");
    }

    #[test]
    fn test_update_by_path() {
        let conn = setup_test_db();
        let mut record = create_test_record();

        FileRecord::insert(&conn, &record).unwrap();

        record.title = "Updated Title".to_string();
        FileRecord::update_by_path(&conn, "test.md", &record).unwrap();

        let retrieved = FileRecord::get_by_path(&conn, "test.md").unwrap().unwrap();
        assert_eq!(retrieved.title, "Updated Title");
    }

    #[test]
    fn test_update_state() {
        let conn = setup_test_db();
        let record = create_test_record();

        FileRecord::insert(&conn, &record).unwrap();

        FileRecord::update_state(&conn, "test.md", FileState::Archived).unwrap();

        let retrieved = FileRecord::get_by_path(&conn, "test.md").unwrap().unwrap();
        assert_eq!(retrieved.state, FileState::Archived);
    }

    #[test]
    fn test_update_path() {
        let conn = setup_test_db();
        let record = create_test_record();

        FileRecord::insert(&conn, &record).unwrap();

        FileRecord::update_path(&conn, "test.md", "renamed.md").unwrap();

        assert!(FileRecord::get_by_path(&conn, "test.md").unwrap().is_none());
        let retrieved = FileRecord::get_by_path(&conn, "renamed.md").unwrap().unwrap();
        assert_eq!(retrieved.relative_path, "renamed.md");
    }

    #[test]
    fn test_delete() {
        let conn = setup_test_db();
        let record = create_test_record();

        FileRecord::insert(&conn, &record).unwrap();
        FileRecord::delete(&conn, "test.md").unwrap();

        assert!(FileRecord::get_by_path(&conn, "test.md").unwrap().is_none());
    }

    #[test]
    fn test_list_by_state() {
        let conn = setup_test_db();

        let mut record1 = create_test_record();
        record1.relative_path = "active1.md".to_string();
        record1.state = FileState::Active;

        let mut record2 = create_test_record();
        record2.relative_path = "active2.md".to_string();
        record2.state = FileState::Active;

        let mut record3 = create_test_record();
        record3.relative_path = "archived.md".to_string();
        record3.state = FileState::Archived;

        FileRecord::insert(&conn, &record1).unwrap();
        FileRecord::insert(&conn, &record2).unwrap();
        FileRecord::insert(&conn, &record3).unwrap();

        let active_files = FileRecord::list_by_state(&conn, FileState::Active).unwrap();
        assert_eq!(active_files.len(), 2);

        let archived_files = FileRecord::list_by_state(&conn, FileState::Archived).unwrap();
        assert_eq!(archived_files.len(), 1);
    }

    #[test]
    fn test_count_by_state() {
        let conn = setup_test_db();

        let mut record1 = create_test_record();
        record1.relative_path = "active.md".to_string();

        let mut record2 = create_test_record();
        record2.relative_path = "archived.md".to_string();
        record2.state = FileState::Archived;

        FileRecord::insert(&conn, &record1).unwrap();
        FileRecord::insert(&conn, &record2).unwrap();

        assert_eq!(FileRecord::count_by_state(&conn, FileState::Active).unwrap(), 1);
        assert_eq!(FileRecord::count_by_state(&conn, FileState::Archived).unwrap(), 1);
        assert_eq!(FileRecord::count_by_state(&conn, FileState::Trashed).unwrap(), 0);
    }
}
