-- 003_canonicalise_paths.sql
--
-- One-time repair migration: rewrite every existing `relative_path`
-- so it uses forward-slashes and has no leading slash. This matches
-- the new `canonicalise_rel()` helper that all command-layer code
-- now passes paths through.
--
-- Why this migration exists, not just a runtime fix:
--   Older builds wrote rows with the raw `\` flavour Windows gave
--   them via `Path::strip_prefix(...).to_string_lossy()`. After we
--   started canonicalising at the boundary, every fresh save uses
--   the slash form — but the OLD rows still have backslashes,
--   meaning the link indexer's join key disagrees with the file
--   tree until the user resaves each file. This migration does the
--   resaving for them, on first vault-open with the new build.
--
-- Conflict handling: if both `notes/a.md` AND `notes\a.md` exist
-- (a real possibility on Windows vaults that survived the upgrade
-- window), the slash form wins — its rowid is older OR it's the
-- one the file-tree builder will keep emitting going forward, so
-- pointing both to the same key avoids dangling references.

-- Step 1: For each row with a backslash, see if a canonical
-- (forward-slash) twin already exists. If so, delete the backslash
-- row — the canonical one is the keeper.
DELETE FROM files
WHERE relative_path LIKE '%\%'
  AND EXISTS (
    SELECT 1 FROM files f2
    WHERE f2.relative_path = REPLACE(REPLACE(files.relative_path, '\', '/'), '//', '/')
      AND f2.rowid <> files.rowid
  );

-- Step 2: Rewrite the remaining backslash rows in-place. The
-- UNIQUE constraint can no longer trip because step 1 cleared
-- every collision.
UPDATE files
SET relative_path = REPLACE(REPLACE(relative_path, '\', '/'), '//', '/')
WHERE relative_path LIKE '%\%';

-- Step 3: Strip any stray leading slash so '/notes/a.md' →
-- 'notes/a.md'. SQLite's CASE expression keeps the no-op branch
-- cheap when the path is already correct.
UPDATE files
SET relative_path = SUBSTR(relative_path, 2)
WHERE relative_path LIKE '/%';

-- Step 4: Same cleanup on the FTS index. FTS5 doesn't enforce
-- uniqueness, so we just normalise every row in place. Collisions
-- here are harmless (search just gets a duplicate hit which the
-- frontend dedupes by `relativePath`).
UPDATE files_fts
SET relative_path = REPLACE(REPLACE(relative_path, '\', '/'), '//', '/')
WHERE relative_path LIKE '%\%';

UPDATE files_fts
SET relative_path = SUBSTR(relative_path, 2)
WHERE relative_path LIKE '/%';
