-- ┌─────────────────────────────────────────────────────────────────┐
-- │ Markdown tasks index — Feature §5                               │
-- │                                                                 │
-- │ Every `- [ ]` / `- [x]` line in any indexed `.md` file gets one │
-- │ row here. The block anchor (`^blk_<base32>`) is the stable      │
-- │ identifier the toggle command uses to locate the right line on │
-- │ disk; `line_hint` is a soft cache for fast jumps. Anchors are  │
-- │ added on first toggle so legacy notes don't require migration. │
-- │                                                                 │
-- │ Why a dedicated table vs deriving from `files_fts`:             │
-- │   • Tasks need their own status column so the UI can filter on  │
-- │     "open" without scanning every file's body.                  │
-- │   • Toggling rewrites a single line — we must point at it       │
-- │     without re-tokenising the whole document.                   │
-- │   • Block anchors don't survive plain text search anyway        │
-- │     (`.zenvault/index.db` strips them as snippet artefacts).    │
-- └─────────────────────────────────────────────────────────────────┘

CREATE TABLE IF NOT EXISTS tasks (
  -- BLAKE3-derived stable id. Composed from `file_id || block_anchor`
  -- when an anchor is present, otherwise from `file_id || raw_text`.
  -- That means the same task survives editor reorderings IF it has
  -- an anchor; legacy un-anchored tasks may get new ids after a
  -- significant edit, which is acceptable (we never claim stable
  -- identity without an anchor).
  id            TEXT    NOT NULL PRIMARY KEY,
  -- Vault-relative path of the source file. Matches `files.relative_path`
  -- character-for-character (forward-slash canonical form).
  file_id       TEXT    NOT NULL,
  -- `^blk_<base32>` anchor as written in the source file, or NULL if
  -- the task line has no anchor yet. The toggle command upgrades
  -- NULL → real anchor on first edit.
  block_anchor  TEXT,
  -- 0-based line index when the task was last indexed. Drifts on
  -- external edits — treated as a hint, never as ground truth.
  line_hint     INTEGER NOT NULL,
  -- "open" | "done". String form so a future "snoozed" / "blocked"
  -- never needs a migration.
  status        TEXT    NOT NULL,
  -- Task text WITHOUT the leading `- [ ]` / `- [x]` marker and
  -- WITHOUT any trailing anchor. Stripping the anchor here means
  -- raw_text-based fuzzy match (anchor-missing fallback) works
  -- whether or not the user has anchored their tasks.
  raw_text      TEXT    NOT NULL,
  -- Unix epoch ms of the indexer pass that wrote this row. Used by
  -- the staleness sweep to drop rows for files that were deleted
  -- between scans.
  indexed_at    INTEGER NOT NULL,
  FOREIGN KEY (file_id) REFERENCES files(relative_path)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_tasks_file_id    ON tasks(file_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status     ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_indexed_at ON tasks(indexed_at);
