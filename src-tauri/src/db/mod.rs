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

// ── Tunables ────────────────────────────────────────────────────────────
//
// Single-source-of-truth for the magic numbers that used to be
// scattered through PRAGMA setup. Calling them out by name makes
// the trade-offs visible to readers: change one, regenerate
// coverage, profile.

/// Max simultaneous SQLite connections held by the r2d2 pool.
///
/// One connection per Tokio blocking thread under sustained load.
/// Bumping this raises memory + write contention; lowering it risks
/// pool-exhaustion stalls on the UI when several commands fire at
/// once (open + watcher reindex + search).
pub const POOL_MAX_CONNECTIONS: u32 = 8;

/// SQLite `busy_timeout` (milliseconds) — how long a connection
/// waits for a lock before returning `SQLITE_BUSY`. WAL + a
/// reasonable timeout virtually eliminates lock errors in the
/// common single-vault case.
pub const BUSY_TIMEOUT_MS: u64 = 5_000;

/// Memory-mapped I/O window (bytes). 256 MiB matches SQLite's
/// recommended sweet-spot on modern desktops with 8+ GiB RAM.
pub const MMAP_SIZE_BYTES: i64 = 268_435_456;

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
        conn.pragma_update(None, "busy_timeout", BUSY_TIMEOUT_MS as i64)?;
        // Keep temp tables in memory
        conn.pragma_update(None, "temp_store", "MEMORY")?;
        conn.pragma_update(None, "mmap_size", MMAP_SIZE_BYTES)?;
        Ok(())
    });

    let pool = Pool::builder()
        .max_size(POOL_MAX_CONNECTIONS)
        .build(manager)?;

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
        M::up(include_str!("../../migrations/002_fts.sql")),
        // 003 is a one-time repair for vaults written by builds that
        // pre-date `canonicalise_rel()` — rewrites every backslash
        // path to forward-slash and drops duplicate UNIQUE keys.
        M::up(include_str!("../../migrations/003_canonicalise_paths.sql")),
        // 004 adds the per-plugin scoped key/value store used by the
        // plugin broker's PluginStorageApi handler.
        M::up(include_str!("../../migrations/004_plugin_storage.sql")),
        // 005 adds the Markdown tasks index — feature §5.
        M::up(include_str!("../../migrations/005_tasks.sql")),
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
