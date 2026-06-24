//! Per-plugin scoped key/value storage backed by the vault SQLite
//! database. Implements the `PluginStorageApi` contract from
//! `docs/plugin-system.md` §17.3.
//!
//! Isolation model:
//!   * Every row is keyed by `(plugin_id, key)`.
//!   * The broker calls into this module with `plugin_id` already
//!     pinned to the caller's manifest id — a plugin cannot read
//!     or write another plugin's row.
//!   * `clear_plugin_storage_blocking` is invoked on uninstall to
//!     wipe a plugin's namespace in one statement.
//!
//! Performance budget: storage calls are cheap (single-row primary
//! key lookup); we still run them inside `spawn_blocking` so the
//! UI thread never waits on SQLite.

use crate::db::DbPool;
use anyhow::Result;
use rusqlite::{params, OptionalExtension};

const MAX_VALUE_BYTES: usize = 1024 * 1024; // 1 MiB per value.

/// Synchronous variant for use under `spawn_blocking` or in tests.
pub fn get_blocking(pool: &DbPool, plugin_id: &str, key: &str) -> Result<Option<String>> {
    let conn = pool.get()?;
    let value = conn
        .query_row(
            "SELECT value FROM plugin_storage WHERE plugin_id = ?1 AND key = ?2",
            params![plugin_id, key],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    Ok(value)
}

pub fn set_blocking(
    pool: &DbPool,
    plugin_id: &str,
    key: &str,
    value: &str,
) -> Result<()> {
    if value.len() > MAX_VALUE_BYTES {
        anyhow::bail!(
            "plugin storage value exceeds {} bytes (got {})",
            MAX_VALUE_BYTES,
            value.len()
        );
    }
    let conn = pool.get()?;
    let now = chrono::Utc::now().timestamp_millis();
    conn.execute(
        "INSERT INTO plugin_storage (plugin_id, key, value, updated_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(plugin_id, key) DO UPDATE
           SET value = excluded.value, updated_at = excluded.updated_at",
        params![plugin_id, key, value, now],
    )?;
    Ok(())
}

pub fn delete_blocking(pool: &DbPool, plugin_id: &str, key: &str) -> Result<()> {
    let conn = pool.get()?;
    conn.execute(
        "DELETE FROM plugin_storage WHERE plugin_id = ?1 AND key = ?2",
        params![plugin_id, key],
    )?;
    Ok(())
}

/// Drop every row owned by `plugin_id`. Idempotent — called by the
/// uninstall path so a re-install starts with a clean namespace.
pub fn clear_plugin_storage_blocking(pool: &DbPool, plugin_id: &str) -> Result<()> {
    let conn = pool.get()?;
    conn.execute(
        "DELETE FROM plugin_storage WHERE plugin_id = ?1",
        params![plugin_id],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use tempfile::tempdir;

    fn pool() -> (tempfile::TempDir, DbPool) {
        let tmp = tempdir().unwrap();
        let path = tmp.path().join("index.db");
        let pool = db::init_pool(&path).unwrap();
        (tmp, pool)
    }

    #[test]
    fn round_trip_set_get() {
        let (_tmp, pool) = pool();
        set_blocking(&pool, "demo", "k", "v").unwrap();
        let got = get_blocking(&pool, "demo", "k").unwrap();
        assert_eq!(got.as_deref(), Some("v"));
    }

    #[test]
    fn isolated_namespaces() {
        let (_tmp, pool) = pool();
        set_blocking(&pool, "a", "shared", "from-a").unwrap();
        set_blocking(&pool, "b", "shared", "from-b").unwrap();
        assert_eq!(
            get_blocking(&pool, "a", "shared").unwrap().as_deref(),
            Some("from-a")
        );
        assert_eq!(
            get_blocking(&pool, "b", "shared").unwrap().as_deref(),
            Some("from-b")
        );
    }

    #[test]
    fn delete_removes_only_target() {
        let (_tmp, pool) = pool();
        set_blocking(&pool, "p", "x", "1").unwrap();
        set_blocking(&pool, "p", "y", "2").unwrap();
        delete_blocking(&pool, "p", "x").unwrap();
        assert!(get_blocking(&pool, "p", "x").unwrap().is_none());
        assert_eq!(
            get_blocking(&pool, "p", "y").unwrap().as_deref(),
            Some("2")
        );
    }

    #[test]
    fn clear_drops_namespace() {
        let (_tmp, pool) = pool();
        set_blocking(&pool, "p", "a", "1").unwrap();
        set_blocking(&pool, "p", "b", "2").unwrap();
        set_blocking(&pool, "q", "a", "1").unwrap();
        clear_plugin_storage_blocking(&pool, "p").unwrap();
        assert!(get_blocking(&pool, "p", "a").unwrap().is_none());
        assert!(get_blocking(&pool, "p", "b").unwrap().is_none());
        assert!(get_blocking(&pool, "q", "a").unwrap().is_some());
    }

    #[test]
    fn rejects_oversized_value() {
        let (_tmp, pool) = pool();
        let big = "x".repeat(MAX_VALUE_BYTES + 1);
        let err = set_blocking(&pool, "p", "k", &big).unwrap_err();
        assert!(err.to_string().contains("exceeds"));
    }
}
