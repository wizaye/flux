-- Initial schema for Flux file system tracking.
--
-- This migration creates the `files` table that tracks all user files in the vault.
-- The file system is the source of truth; this table is derived state for indexing.

CREATE TABLE IF NOT EXISTS files (
    -- UUID v7 as 16-byte BLOB for time-ordered, merge-safe IDs
    id BLOB PRIMARY KEY NOT NULL CHECK(length(id) = 16),
    
    -- Relative path from vault root (e.g., "notes/physics.md")
    relative_path TEXT NOT NULL UNIQUE,
    
    -- File title (derived from frontmatter or filename)
    title TEXT NOT NULL,
    
    -- BLAKE3 hash of file content for change detection
    blake3_hash BLOB NOT NULL CHECK(length(blake3_hash) = 32),
    
    -- Last modified timestamp (Unix epoch milliseconds)
    modified_at INTEGER NOT NULL,
    
    -- File state: "active", "archived", or "trashed"
    state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active', 'archived', 'trashed')),
    
    -- File size in bytes
    size_bytes INTEGER NOT NULL DEFAULT 0,
    
    -- Created timestamp (Unix epoch milliseconds)
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
) STRICT;

-- Index for fast lookups by state (used in file explorer)
CREATE INDEX IF NOT EXISTS idx_files_state ON files(state);

-- Index for fast lookups by modified time (used in recent files)
CREATE INDEX IF NOT EXISTS idx_files_modified ON files(modified_at DESC);

-- Index for full-text search on title
CREATE INDEX IF NOT EXISTS idx_files_title ON files(title COLLATE NOCASE);
