//! Wikilink healer.
//!
//! When a file is moved or renamed, every `[[Old Name]]` reference in
//! other notes must be rewritten to the new name; otherwise links
//! silently rot. This module walks the vault, scans each markdown
//! file for wikilink syntax, rewrites matches, and writes the
//! updated content back atomically.
//!
//! Supported wikilink forms:
//!   • `[[Old Name]]`               → display + target
//!   • `[[Old Name|Alias]]`         → display + alias preserved
//!   • `[[Old Name#Section]]`       → heading link preserved
//!   • `[[Old Name#Section|Alias]]` → heading + alias preserved
//!   • `[[path/to/Old Name]]`       → matched by name OR path
//!
//! Matching strategy: we compare the link's target against the file
//! stem (`Old Name`) AND the vault-relative path without `.md`
//! (`path/to/Old Name`). Either match triggers a rewrite to the new
//! stem / new relative path.
//!
//! Pure helpers are crate-public so tests under `src-tauri/tests/`
//! can exercise the parsing / rewriting paths without spinning up
//! a vault. IO helpers (`walk_md`, `atomic_write`) remain pub for
//! the link indexer + file commands.

use std::io::Write;
use std::path::Path;

/// Result of healing one file.
pub struct HealStats {
    /// Number of distinct wikilinks rewritten in this file.
    pub links_healed: usize,
}

/// Walk `vault_path` and rewrite every wikilink that points at
/// `src_rel` (vault-relative, with or without `.md`) so it points at
/// `dst_rel`. Skips `.zenvault/`, `.git/`, `node_modules/`, dotfiles.
///
/// Returns `(total_links_healed, files_updated)`.
pub fn heal_links(
    vault_path: &Path,
    src_rel: &str,
    dst_rel: &str,
) -> std::io::Result<(usize, usize)> {
    // Old / new keys: both the bare stem and the full relative path
    // without the `.md` suffix are accepted as link targets.
    let src_stem = stem_no_ext(src_rel);
    let dst_stem = stem_no_ext(dst_rel);
    let src_path_key = strip_md(src_rel);
    let dst_path_key = strip_md(dst_rel);

    let mut total_links = 0usize;
    let mut files_updated = 0usize;

    walk_md(vault_path, &mut |p: &Path| -> std::io::Result<()> {
        // Skip the file being moved itself — its links to other
        // notes don't need to be touched here, and the on-disk path
        // is mid-flight (caller has already done the rename).
        if p == vault_path.join(dst_rel) {
            return Ok(());
        }

        let original = std::fs::read_to_string(p)?;
        let (rewritten, n) = rewrite_links(
            &original,
            &src_stem,
            &src_path_key,
            &dst_stem,
            &dst_path_key,
        );
        if n > 0 {
            atomic_write(p, &rewritten)?;
            total_links += n;
            files_updated += 1;
        }
        Ok(())
    })?;

    Ok((total_links, files_updated))
}

pub fn stem_no_ext(rel: &str) -> String {
    let stem = Path::new(rel)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(rel);
    stem.to_string()
}

pub fn strip_md(rel: &str) -> String {
    let normalised = rel.replace('\\', "/");
    if let Some(rest) = normalised.strip_suffix(".md") {
        rest.to_string()
    } else if let Some(rest) = normalised.strip_suffix(".MD") {
        rest.to_string()
    } else {
        normalised
    }
}

/// Rewrite `[[…]]` occurrences in `text`. Returns the new text and
/// the count of replaced links.
pub fn rewrite_links(
    text: &str,
    src_stem: &str,
    src_path_key: &str,
    dst_stem: &str,
    dst_path_key: &str,
) -> (String, usize) {
    let mut out = String::with_capacity(text.len());
    let mut healed = 0usize;
    let bytes = text.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        if i + 1 < bytes.len() && bytes[i] == b'[' && bytes[i + 1] == b'[' {
            // Find the closing `]]`.
            if let Some(end_rel) = text[i + 2..].find("]]") {
                let inner = &text[i + 2..i + 2 + end_rel];
                // No newlines / nested `[[` inside a single link.
                if !inner.contains('\n') && !inner.contains("[[") {
                    let (target, alias, section) = split_link(inner);
                    // Decide whether this link points at the moved file.
                    let target_norm = target.replace('\\', "/");
                    let hit = target_norm == src_stem
                        || target_norm == src_path_key
                        || target_norm == format!("{}.md", src_stem)
                        || target_norm == format!("{}.md", src_path_key);
                    if hit {
                        // Prefer the stem form unless the original
                        // used a path; preserves authoring style.
                        let new_target = if target_norm.contains('/') {
                            dst_path_key.to_string()
                        } else {
                            dst_stem.to_string()
                        };
                        out.push_str("[[");
                        out.push_str(&new_target);
                        if let Some(s) = section {
                            out.push('#');
                            out.push_str(s);
                        }
                        if let Some(a) = alias {
                            out.push('|');
                            out.push_str(a);
                        }
                        out.push_str("]]");
                        i = i + 2 + end_rel + 2;
                        healed += 1;
                        continue;
                    }
                }
            }
        }
        // Copy one char (handle multi-byte UTF-8 safely).
        let ch = text[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    (out, healed)
}

/// Decompose `target#section|alias` into (target, alias, section).
pub fn split_link(inner: &str) -> (&str, Option<&str>, Option<&str>) {
    // Split alias first (`|` divides target side from alias side).
    let (left, alias) = match inner.find('|') {
        Some(p) => (&inner[..p], Some(inner[p + 1..].trim())),
        None => (inner, None),
    };
    let (target, section) = match left.find('#') {
        Some(p) => (&left[..p], Some(left[p + 1..].trim())),
        None => (left, None),
    };
    (target.trim(), alias, section)
}

/// Walk every `.md` file in `root`, calling `cb` for each. Skips the
/// usual ignored folders so the healer doesn't touch user-irrelevant
/// content.
pub fn walk_md<F>(root: &Path, cb: &mut F) -> std::io::Result<()>
where
    F: FnMut(&Path) -> std::io::Result<()>,
{
    fn walk_inner<F: FnMut(&Path) -> std::io::Result<()>>(
        dir: &Path,
        cb: &mut F,
    ) -> std::io::Result<()> {
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if is_ignored(&name_str) {
                continue;
            }
            let path = entry.path();
            let ft = entry.file_type()?;
            if ft.is_dir() {
                walk_inner(&path, cb)?;
            } else if ft.is_file() {
                let ext_ok = path
                    .extension()
                    .and_then(|e| e.to_str())
                    .map(|e| e.eq_ignore_ascii_case("md"))
                    .unwrap_or(false);
                if ext_ok {
                    cb(&path)?;
                }
            }
        }
        Ok(())
    }
    walk_inner(root, cb)
}

pub fn is_ignored(name: &str) -> bool {
    // Wikilink-heal walks markdown files; the policy of what to
    // skip lives in [`paths::is_ignored_in_wikilink`] so it stays
    // in sync with watcher / tree-walk semantics.
    super::paths::is_ignored_in_wikilink(name)
}

/// Atomic write: temp in same dir → fsync → rename. Matches the
/// pattern used by `write_file`.
pub(crate) fn atomic_write(path: &Path, content: &str) -> std::io::Result<()> {
    let dir = path.parent().unwrap_or_else(|| Path::new("."));
    let stem = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "tmp".into());
    let tmp = dir.join(format!(".{}.tmp", stem));
    {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(content.as_bytes())?;
        f.sync_all()?;
    }
    std::fs::rename(&tmp, path)
}

// Re-export marker so unused-warning stays quiet if a build flag
// swaps in a different implementation later.
#[allow(dead_code)]
fn _stats(_s: HealStats) {}
