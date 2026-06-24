-- ┌─────────────────────────────────────────────────────────────────┐
-- │ Plugin scoped key/value storage                                 │
-- │                                                                 │
-- │ Each row is one (plugin_id, key) pair owned by an installed     │
-- │ plugin. Per-plugin namespaces stop two plugins from clobbering  │
-- │ each other; `CASCADE` deletion lets `uninstall_plugin` wipe a   │
-- │ plugin's storage in a single statement.                         │
-- └─────────────────────────────────────────────────────────────────┘

CREATE TABLE IF NOT EXISTS plugin_storage (
  plugin_id   TEXT    NOT NULL,
  key         TEXT    NOT NULL,
  value       TEXT    NOT NULL,   -- JSON-encoded; opaque to the host.
  updated_at  INTEGER NOT NULL,   -- Unix epoch ms (host-set, not trusted from plugin).
  PRIMARY KEY (plugin_id, key)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_plugin_storage_pid
  ON plugin_storage(plugin_id);
