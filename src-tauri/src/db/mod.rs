//! Database layer for Flux.
//!
//! Handles SQLite connection pool, migrations, and repository pattern.
//! All blocking DB calls run inside `tokio::task::spawn_blocking`.
use anyhow::Result;
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::Connection;
use rusqlite_migration::{Migrations, M};
use std::path::Path;

pub mod repo;

/// SQLite connection pool type.
pub type DbPool = Pool<SqliteConnectionManager>;

/// Initialize the database pool with proper PRAGMAs and migrations.
///
/// Creates the database file if it doesn't exist.
/// Runs pending migrations before returning the pool.
pub fn init_pool(db_path: &Path) -> Result<DbPool> {
    // Ensure parent directory exists
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let manager = SqliteConnectionManager::file(db_path).with_init(|conn| {
        // WAL mode for better concurrency
        conn.pragma_update(None, "journal_mode", "WAL")?;
        // NORMAL synchronous is safe with WAL
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        // Enable foreign keys
        conn.pragma_update(None, "foreign_keys", "ON")?;
        // 5 second busy timeout
        conn.pragma_update(None, "busy_timeout", 5_000)?;
        // Keep temp tables in memory
        conn.pragma_update(None, "temp_store", "MEMORY")?;
        // 256MB memory-mapped I/O
        conn.pragma_update(None, "mmap_size", 268_435_456_i64)?;
        Ok(())
    });

    // Build pool with 8 max connections
    let pool = Pool::builder().max_size(8).build(manager)?;

    // Run migrations on a pooled connection
    {
        let mut conn = pool.get()?;
        run_migrations(&mut conn)?;
    }

    Ok(pool)
}

/// Run database migrations.
fn run_migrations(conn: &mut Connection) -> Result<()> {
    let migrations = Migrations::new(vec![
        M::up(include_str!("../../migrations/001_init.sql")),
        // Future migrations go here
    ]);

    migrations.to_latest(conn)?;
    Ok(())
}

/// Execute a blocking database operation on a background thread.
///
/// This ensures that synchronous rusqlite calls don't block the async runtime.
pub async fn run_blocking<F, T>(pool: &DbPool, f: F) -> Result<T>
where
    F: FnOnce(&Connection) -> Result<T> + Send + 'static,
    T: Send + 'static,
{
    let pool = pool.clone();
    tokio::task::spawn_blocking(move || {
        let conn = pool.get()?;
        f(&conn)
    })
    .await?
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_init_pool_creates_database() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");

        let pool = init_pool(&db_path).expect("Failed to initialize pool");

        // Verify database file exists
        assert!(db_path.exists());

        // Verify we can get a connection
        let conn = pool.get().expect("Failed to get connection");

        // Verify PRAGMAs are set correctly
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
    async fn test_run_blocking() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        let pool = init_pool(&db_path).unwrap();

        let result = run_blocking(&pool, |conn| {
            let count: i64 = conn.query_row("SELECT 1 + 1", [], |row| row.get(0))?;
            Ok(count)
        })
        .await
        .unwrap();

        assert_eq!(result, 2);
    }
}
