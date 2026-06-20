-- Full-text search index over file titles + bodies.
--
-- Why FTS5: built into bundled SQLite, no extra deps, sub-millisecond
-- prefix/phrase/token queries up to a million-doc vault. Used by the
-- left-sidebar search panel and by the plugin host `SearchApi`
-- contract.
--
-- We use the `contentless` pattern: FTS5 owns the indexed text in its
-- own table; we delete/insert on every file write. This keeps the
-- main `files` table free of body blobs and lets the watcher / write
-- pipeline reindex incrementally without rebuilding the world.

CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
    -- Vault-relative path (joinable back to `files.relative_path`).
    relative_path UNINDEXED,
    -- Display title (frontmatter or first H1).
    title,
    -- Raw markdown body, no preprocessing.
    body,
    tokenize = 'unicode61 remove_diacritics 2'
);
