//! Vault-root `.gitignore` matcher. Layered on top of the
//! hard-coded `is_ignored_in_tree` / `is_ignored_by_watcher`
//! predicates in [`super::paths`] so a user dropping a `node_modules`
//! pattern into their root `.gitignore` does the same job as the
//! built-in deny-list — and patterns like `Drafts/` / `*.bak` start
//! working without any code change.
//!
//! Scope (intentionally narrow this round):
//!   * Reads `<vault>/.gitignore` only. Nested `.gitignore` files
//!     are NOT honoured. The 95% case is "node_modules + a few
//!     personal patterns at the root"; a future pass can swap this
//!     for `ignore::WalkBuilder` if real-world vaults need nested
//!     support.
//!   * The matcher is constructed once per walk (cheap — parsing
//!     a few-line ignore file is microseconds) and never cached.
//!     `.gitignore` edits take effect on the next refresh.
//!   * Negation patterns (`!important.md`) are supported because
//!     they are part of the `Gitignore` semantics; nothing here
//!     does anything special with them.

use ignore::Match;
use ignore::gitignore::{Gitignore, GitignoreBuilder};
use std::path::Path;

/// Load `<vault_root>/.gitignore` into a matcher.
///
/// Returns `None` when the file doesn't exist or is unreadable —
/// callers fall through to the hard-coded predicates and continue
/// normally.
pub fn load_root_gitignore(vault_root: &Path) -> Option<Gitignore> {
    let gi_path = vault_root.join(".gitignore");
    if !gi_path.is_file() {
        return None;
    }
    let mut builder = GitignoreBuilder::new(vault_root);
    // `.add` returns Some(err) on failure; log + ignore so a busted
    // `.gitignore` never breaks the file tree.
    if let Some(err) = builder.add(&gi_path) {
        tracing::warn!(?gi_path, ?err, "gitignore: failed to load, ignoring");
        return None;
    }
    match builder.build() {
        Ok(gi) => Some(gi),
        Err(err) => {
            tracing::warn!(?gi_path, ?err, "gitignore: build failed, ignoring");
            None
        }
    }
}

/// True if the `Gitignore` matcher tells us to hide this entry.
///
/// `rel` is a vault-relative path with forward-slash separators
/// (matches our `canonicalise_rel` convention). `is_dir` is required
/// because gitignore semantics treat `foo/` differently from `foo`.
///
/// Uses `matched_path_or_any_parents` so a file inside an ignored
/// directory (e.g. `Drafts/note.md` with a `Drafts/` pattern) is
/// caught even though the watcher emits events for the leaf path,
/// not the parent dir — `matched()` alone misses those.
pub fn matches_gitignore(gi: &Gitignore, rel: &str, is_dir: bool) -> bool {
    matches!(
        gi.matched_path_or_any_parents(rel, is_dir),
        Match::Ignore(_)
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn write_root_gitignore(root: &Path, body: &str) {
        fs::write(root.join(".gitignore"), body).unwrap();
    }

    #[test]
    fn returns_none_without_file() {
        let tmp = tempdir().unwrap();
        assert!(load_root_gitignore(tmp.path()).is_none());
    }

    #[test]
    fn matches_simple_directory_pattern() {
        let tmp = tempdir().unwrap();
        write_root_gitignore(tmp.path(), "node_modules/\n");
        let gi = load_root_gitignore(tmp.path()).unwrap();
        assert!(matches_gitignore(&gi, "node_modules", true));
        // File with same name is NOT ignored — trailing `/` is
        // explicit "directory only".
        assert!(!matches_gitignore(&gi, "node_modules", false));
    }

    #[test]
    fn matches_glob() {
        let tmp = tempdir().unwrap();
        write_root_gitignore(tmp.path(), "*.bak\n");
        let gi = load_root_gitignore(tmp.path()).unwrap();
        assert!(matches_gitignore(&gi, "notes.bak", false));
        assert!(matches_gitignore(&gi, "deep/path/notes.bak", false));
        assert!(!matches_gitignore(&gi, "notes.md", false));
    }

    #[test]
    fn negation_pattern_keeps_file() {
        let tmp = tempdir().unwrap();
        write_root_gitignore(tmp.path(), "Drafts/\n!Drafts/keep.md\n");
        let gi = load_root_gitignore(tmp.path()).unwrap();
        assert!(matches_gitignore(&gi, "Drafts", true));
        assert!(matches_gitignore(&gi, "Drafts/throwaway.md", false));
        // Negated re-include wins.
        assert!(!matches_gitignore(&gi, "Drafts/keep.md", false));
    }

    #[test]
    fn unreadable_gitignore_returns_none_not_panic() {
        // Pointing at a directory under the same name forces the
        // build to fail — we should swallow the error and degrade.
        let tmp = tempdir().unwrap();
        fs::create_dir(tmp.path().join(".gitignore")).unwrap();
        // `.gitignore` is a directory now; load_root_gitignore should
        // return None because is_file() is false.
        assert!(load_root_gitignore(tmp.path()).is_none());
    }
}
