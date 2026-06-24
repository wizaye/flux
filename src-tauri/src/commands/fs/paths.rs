//! Path constants + ignore / indexable predicates.
//!
//! Every directory name string the rest of the backend cares about
//! lives here so callers don't sprinkle `.zenvault` / `.trash` /
//! `.git` literals through their code. Three call sites have
//! materially different *policies* (watcher, tree-walk, wikilink),
//! so each gets its own predicate — but the underlying sets are
//! shared.
//!
//! Adding a new "noise" directory should be a one-line change here,
//! not a 15-place grep-and-replace.

use std::path::Path;

// ── Vault-owned directories ──────────────────────────────────────────────
//
// These belong to the app and are never user-edited directly. The
// filesystem is the source of truth (see PROJECT_PLAN.md §3) but
// `.zenvault/index.db` is *derived* and explicitly excluded from
// sync.

/// Per-vault metadata: SQLite index, settings, etc.
pub const VAULT_META_DIR: &str = ".zenvault";
/// Soft-deleted files, kept until janitor purge.
pub const TRASH_DIR: &str = ".trash";
/// Archived files, retained indefinitely.
pub const ARCHIVE_DIR: &str = ".archive";

/// Every directory the app reserves for its own use under a vault root.
pub const VAULT_RESERVED_DIRS: &[&str] = &[VAULT_META_DIR, TRASH_DIR, ARCHIVE_DIR];

// ── External "noise" directories ─────────────────────────────────────────
//
// VCS / dependency / build artefacts that show up *inside* a vault
// when users keep notes alongside source code. We never index or
// surface these in the tree.

const VCS_AND_DEPS: &[&str] = &[".git", "node_modules"];

const IDE_AND_BUILD: &[&str] = &[
    ".vscode",
    ".idea",
    "target",
    "dist",
    "build",
    ".next",
    ".cache",
    ".turbo",
    "coverage",
];

const OS_ARTIFACTS: &[&str] = &[".DS_Store", "Thumbs.db"];

// ── Indexable text extensions ────────────────────────────────────────────
//
// FTS5 only tokenises text-like content. Binary files get their FTS
// row dropped on the next write so search results stay clean.

const INDEXABLE_EXTENSIONS: &[&str] = &["md", "markdown", "txt", "mdx", "rst", "canvas"];

// ── Predicates ───────────────────────────────────────────────────────────

/// Does this path component name a directory the app reserves?
pub fn is_vault_metadata(name: &str) -> bool {
    VAULT_RESERVED_DIRS.contains(&name)
}

/// **Watcher policy** — should the file-system watcher *ignore* this
/// vault-relative path?
///
/// Rejects:
///   • empty paths,
///   • atomic-write artifacts (`*.tmp`),
///   • anything inside a vault-reserved or VCS/dep directory,
///   • any dotted component beyond the root (hidden files / folders).
pub fn is_ignored_by_watcher(rel: &str) -> bool {
    if rel.is_empty() {
        return true;
    }
    if rel.ends_with(".tmp") {
        return true;
    }
    for part in rel.split('/') {
        if is_vault_metadata(part) || VCS_AND_DEPS.contains(&part) {
            return true;
        }
        // Any component starting with `.` (and not the empty `"."`) is
        // treated as hidden — covers `.obsidian`, `.terraform`, etc.
        // without listing every possible name.
        if part.len() > 1 && part.starts_with('.') {
            return true;
        }
    }
    false
}

/// **Tree-walk policy** — should the file explorer hide an entry
/// with this *single-component* name?
///
/// Hides external noise (VCS, deps, IDE caches, build artefacts, OS
/// junk). Does NOT hide vault metadata — the caller is expected to
/// handle that with `is_vault_metadata` since it's surfaced through
/// different UI (Trash dialog, etc.).
pub fn is_ignored_in_tree(name: &str) -> bool {
    VCS_AND_DEPS.contains(&name)
        || IDE_AND_BUILD.contains(&name)
        || OS_ARTIFACTS.contains(&name)
}

/// **Wikilink-heal policy** — should the markdown walker skip this
/// *single-component* name?
///
/// Skips vault-reserved dirs, VCS/dep dirs, OS junk, and every other
/// dot-prefixed entry (catch-all so we don't walk `.obsidian/`,
/// `.terraform/`, etc.).
pub fn is_ignored_in_wikilink(name: &str) -> bool {
    if is_vault_metadata(name)
        || VCS_AND_DEPS.contains(&name)
        || OS_ARTIFACTS.contains(&name)
    {
        return true;
    }
    name.len() > 1 && name.starts_with('.')
}

/// Should this path be indexed for full-text search?
///
/// True for the text-like extensions we know how to tokenise (md /
/// markdown / txt / mdx / rst / canvas). Case-insensitive.
pub fn is_indexable_text(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    let ext = Path::new(&lower)
        .extension()
        .and_then(|e| e.to_str());
    matches!(ext, Some(e) if INDEXABLE_EXTENSIONS.contains(&e))
}

// ── Trash / archive boundary helpers ─────────────────────────────────────
//
// Both restore commands need to (1) verify the input lives under
// the expected reserved root and (2) derive the file's original
// vault-relative path. Extracting these as pure functions over the
// vault-relative path string makes them testable without spinning
// up a real vault, and gives every call site a consistent error
// type.

/// Outcome of deriving an original vault-relative path from a
/// trashed-file's `.trash/YYYY-MM/<original>` path.
#[derive(Debug, PartialEq, Eq)]
pub enum TrashPathError {
    /// First path component is not `.trash`.
    NotInTrash,
    /// Path is `.trash` itself, or `.trash/<bucket>` with no file
    /// inside the month bucket — nothing to derive.
    Empty,
}

/// Strip `.trash/<YYYY-MM>/` from a vault-relative path and return
/// the file's original vault-relative path.
///
/// Errors:
///   • [`TrashPathError::NotInTrash`] if the first component isn't
///     `.trash`.
///   • [`TrashPathError::Empty`] if the path has no component after
///     the month bucket (or no bucket at all).
pub fn derive_original_path_from_trash(rel: &str) -> Result<String, TrashPathError> {
    let normalised = rel.replace('\\', "/");
    let mut parts = normalised.split('/').filter(|p| !p.is_empty());
    if parts.next() != Some(TRASH_DIR) {
        return Err(TrashPathError::NotInTrash);
    }
    // Skip the month bucket; if there's no bucket at all the
    // remaining iterator is empty and we'll fall through to Empty.
    if parts.next().is_none() {
        return Err(TrashPathError::Empty);
    }
    let rest: Vec<&str> = parts.collect();
    if rest.is_empty() {
        return Err(TrashPathError::Empty);
    }
    Ok(rest.join("/"))
}

/// Outcome of deriving an original vault-relative path from an
/// archived-file's `.archive/<original>` path.
#[derive(Debug, PartialEq, Eq)]
pub enum ArchivePathError {
    /// First path component is not `.archive`.
    NotInArchive,
    /// Path is `.archive` itself with no file inside.
    Empty,
}

/// Strip `.archive/` from a vault-relative path and return the
/// file's original vault-relative path.
pub fn derive_original_path_from_archive(rel: &str) -> Result<String, ArchivePathError> {
    let normalised = rel.replace('\\', "/");
    let mut parts = normalised.split('/').filter(|p| !p.is_empty());
    if parts.next() != Some(ARCHIVE_DIR) {
        return Err(ArchivePathError::NotInArchive);
    }
    let rest: Vec<&str> = parts.collect();
    if rest.is_empty() {
        return Err(ArchivePathError::Empty);
    }
    Ok(rest.join("/"))
}

/// Is this vault-relative path under the reserved trash or archive
/// directories? Used to refuse the user trying to *re-*archive or
/// archive a trashed item (which would produce a nested
/// `.archive/.trash/...` mess).
pub fn is_under_trash_or_archive(rel: &str) -> bool {
    let normalised = rel.replace('\\', "/");
    let first = normalised
        .split('/')
        .find(|p| !p.is_empty());
    matches!(first, Some(TRASH_DIR) | Some(ARCHIVE_DIR))
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── is_vault_metadata ──────────────────────────────────────────

    #[test]
    fn is_vault_metadata_matches_reserved_dirs() {
        for name in VAULT_RESERVED_DIRS {
            assert!(is_vault_metadata(name), "expected reserved: {}", name);
        }
    }

    #[test]
    fn is_vault_metadata_rejects_user_content() {
        for name in &["notes", "README.md", ".obsidian", "src"] {
            assert!(!is_vault_metadata(name), "expected not reserved: {}", name);
        }
    }

    // ── is_ignored_by_watcher ──────────────────────────────────────

    #[test]
    fn watcher_ignores_metadata_and_vcs() {
        for rel in &[
            ".zenvault/index.db",
            ".trash/2026-06/note.md",
            ".archive/old/x.md",
            ".git/HEAD",
            "node_modules/foo/index.js",
        ] {
            assert!(is_ignored_by_watcher(rel), "expected ignored: {}", rel);
        }
    }

    #[test]
    fn watcher_ignores_dotted_components_beyond_root() {
        for rel in &[".obsidian/workspace.json", "notes/.draft/scratch.md"] {
            assert!(is_ignored_by_watcher(rel));
        }
    }

    #[test]
    fn watcher_ignores_empty_and_tmp() {
        assert!(is_ignored_by_watcher(""));
        assert!(is_ignored_by_watcher("notes/.draft.tmp"));
        assert!(is_ignored_by_watcher("foo.tmp"));
    }

    #[test]
    fn watcher_keeps_user_files() {
        for rel in &["README.md", "notes/topic.md", "folder/sub/file.txt"] {
            assert!(!is_ignored_by_watcher(rel));
        }
    }

    #[test]
    fn watcher_keeps_filenames_with_a_dot_in_the_middle() {
        // Regression: only *components* starting with `.` are hidden,
        // not filenames containing a `.` (which is every file with an
        // extension).
        assert!(!is_ignored_by_watcher("notes/foo.bar.md"));
    }

    // ── is_ignored_in_tree ─────────────────────────────────────────

    #[test]
    fn tree_walk_hides_external_noise() {
        for name in &[
            "node_modules",
            ".git",
            ".vscode",
            ".idea",
            "target",
            "dist",
            "build",
            ".next",
            ".cache",
            ".turbo",
            "coverage",
            ".DS_Store",
            "Thumbs.db",
        ] {
            assert!(is_ignored_in_tree(name), "expected hidden in tree: {}", name);
        }
    }

    #[test]
    fn tree_walk_keeps_user_folders_and_files() {
        for name in &["notes", "README.md", "Projects", "my-folder"] {
            assert!(!is_ignored_in_tree(name));
        }
    }

    #[test]
    fn tree_walk_does_not_hide_vault_metadata_directly() {
        // The Files panel hides `.zenvault` etc. via a separate
        // `is_vault_metadata` check — tree-walk's responsibility is
        // external noise only.
        assert!(!is_ignored_in_tree(".zenvault"));
        assert!(!is_ignored_in_tree(".trash"));
    }

    // ── is_ignored_in_wikilink ─────────────────────────────────────

    #[test]
    fn wikilink_skips_reserved_and_dotted_dirs() {
        for name in &[
            ".zenvault",
            ".trash",
            ".archive",
            ".git",
            "node_modules",
            ".obsidian",
            ".DS_Store",
            "Thumbs.db",
        ] {
            assert!(is_ignored_in_wikilink(name), "expected skipped: {}", name);
        }
    }

    #[test]
    fn wikilink_keeps_user_folders() {
        for name in &["notes", "Projects", "drafts"] {
            assert!(!is_ignored_in_wikilink(name));
        }
    }

    // ── is_indexable_text ──────────────────────────────────────────

    #[test]
    fn indexable_text_accepts_known_extensions_case_insensitively() {
        for path in &[
            "note.md",
            "NOTE.MD",
            "topic.markdown",
            "spec.rst",
            "fancy.mdx",
            "plain.txt",
            "board.canvas",
        ] {
            assert!(is_indexable_text(path), "expected indexable: {}", path);
        }
    }

    #[test]
    fn indexable_text_rejects_binary_and_extensionless() {
        for path in &["doc.pdf", "image.png", "video.mp4", "archive.tar.gz", "no_ext"] {
            assert!(!is_indexable_text(path), "expected NOT indexable: {}", path);
        }
    }

    // ── derive_original_path_from_trash ────────────────────────────

    #[test]
    fn trash_derive_strips_month_bucket() {
        assert_eq!(
            derive_original_path_from_trash(".trash/2026-06/note.md").unwrap(),
            "note.md",
        );
        assert_eq!(
            derive_original_path_from_trash(".trash/2026-06/folder/note.md").unwrap(),
            "folder/note.md",
        );
    }

    #[test]
    fn trash_derive_normalises_backslashes() {
        assert_eq!(
            derive_original_path_from_trash(".trash\\2026-06\\note.md").unwrap(),
            "note.md",
        );
    }

    #[test]
    fn trash_derive_rejects_paths_outside_trash() {
        assert_eq!(
            derive_original_path_from_trash("notes/foo.md"),
            Err(TrashPathError::NotInTrash),
        );
        assert_eq!(
            derive_original_path_from_trash(""),
            Err(TrashPathError::NotInTrash),
        );
    }

    #[test]
    fn trash_derive_rejects_missing_month_bucket_or_file() {
        // `.trash` itself
        assert_eq!(
            derive_original_path_from_trash(".trash"),
            Err(TrashPathError::Empty),
        );
        // `.trash/<bucket>` with no inner file
        assert_eq!(
            derive_original_path_from_trash(".trash/2026-06"),
            Err(TrashPathError::Empty),
        );
        assert_eq!(
            derive_original_path_from_trash(".trash/2026-06/"),
            Err(TrashPathError::Empty),
        );
    }

    // ── derive_original_path_from_archive ──────────────────────────

    #[test]
    fn archive_derive_strips_archive_prefix() {
        assert_eq!(
            derive_original_path_from_archive(".archive/notes/foo.md").unwrap(),
            "notes/foo.md",
        );
        assert_eq!(
            derive_original_path_from_archive(".archive/a.md").unwrap(),
            "a.md",
        );
    }

    #[test]
    fn archive_derive_rejects_paths_outside_archive() {
        assert_eq!(
            derive_original_path_from_archive("notes/foo.md"),
            Err(ArchivePathError::NotInArchive),
        );
        assert_eq!(
            derive_original_path_from_archive(".trash/foo.md"),
            Err(ArchivePathError::NotInArchive),
        );
    }

    #[test]
    fn archive_derive_rejects_bare_archive_root() {
        assert_eq!(
            derive_original_path_from_archive(".archive"),
            Err(ArchivePathError::Empty),
        );
        assert_eq!(
            derive_original_path_from_archive(".archive/"),
            Err(ArchivePathError::Empty),
        );
    }

    // ── is_under_trash_or_archive ──────────────────────────────────

    #[test]
    fn under_trash_or_archive_detects_reserved_roots() {
        for rel in &[
            ".trash/2026-06/x.md",
            ".trash/x.md",
            ".archive/x.md",
            ".archive/folder/x.md",
            ".trash",
            ".archive",
        ] {
            assert!(is_under_trash_or_archive(rel), "expected under: {}", rel);
        }
    }

    #[test]
    fn under_trash_or_archive_keeps_user_content() {
        for rel in &["notes/x.md", "README.md", ".zenvault/index.db", ""] {
            assert!(!is_under_trash_or_archive(rel), "expected NOT under: {}", rel);
        }
    }

    #[test]
    fn under_trash_or_archive_handles_backslashes_and_leading_slash() {
        assert!(is_under_trash_or_archive(".trash\\2026-06\\x.md"));
        assert!(is_under_trash_or_archive("/.trash/x.md"));
    }
}
