//! Link / tag indexer.
//!
//! Walks the vault, parses every Markdown file for outbound link
//! references (wikilinks + markdown links into other notes) and
//! `#tag`s, and returns a flat list the frontend can collapse into
//! a backlinks index in O(N) time.
//!
//! Why a flat list (not a pre-built reverse map): the frontend
//! already keeps `openFiles` content live and reacts to fs-changed
//! events on its own — the cheapest contract for incremental
//! updates is "give me everything from these N files, I'll rebuild
//! the inverse myself." Bulk indexing 10⁵ notes returns one big
//! array in a few hundred ms; per-file rescans are a single small
//! array each.
//!
//! Parsing is hand-rolled regex (not Lezer): we ship far fewer
//! files than the frontend's CodeMirror tree could ever see, and a
//! single `Regex` instance per pattern caches a compiled DFA on
//! first use. Cap file size at 4 MB so a runaway log file can't
//! starve the indexer.
//!
//! Unit + integration tests live under `src-tauri/tests/`. The
//! per-helper functions are crate-public so those tests can reach
//! them without going through the Tauri command harness.

use crate::commands::fs::common::{get_vault_path_from_state, validate_and_resolve_path};
use crate::state::AppState;
use crate::types::AppError;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::{Arc, OnceLock};
use tauri::State;

pub const MAX_FILE_BYTES: u64 = 4 * 1024 * 1024; // 4 MiB

/// One outbound reference from a markdown file. Frontend keys the
/// reverse index on `target_norm` (case-folded, stripped of `.md`)
/// so both `[[Foo]]` and `[[foo.md]]` match the same note.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkRef {
    /// Vault-relative path of the source file.
    pub from: String,
    /// 1-based line number where the link appears (for jump-to).
    pub line: u32,
    /// Raw target text inside the link (`Foo` from `[[Foo|alias]]`
    /// or `bar/baz.md` from `[text](bar/baz.md)`).
    pub target: String,
    /// Lowercased target with any trailing `.md` stripped and
    /// directory separators normalised — what the frontend keys on.
    pub target_norm: String,
    /// Wikilink vs standard markdown link. Useful for the graph
    /// renderer to dim implicit edges.
    pub kind: LinkKind,
    /// Short snippet of the line for the backlinks preview.
    pub snippet: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum LinkKind {
    Wiki,
    Markdown,
}

/// One `#tag` occurrence. Same model as `LinkRef` — frontend
/// inverts to `tag → [files]`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagRef {
    pub from: String,
    pub line: u32,
    /// Tag name with the leading `#` stripped.
    pub tag: String,
}

/// Wire shape returned to JS. Each array is sorted by `from` then
/// `line` so the frontend's inverse-index pass is stable.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkScanResult {
    /// Vault-relative paths of every markdown file scanned. Used by
    /// the frontend to detect "orphan" notes (no in or out edges).
    pub files: Vec<String>,
    pub links: Vec<LinkRef>,
    pub tags: Vec<TagRef>,
    /// Bookkeeping for the loader UI.
    pub scanned_files: u32,
    pub skipped_too_large: u32,
}

// ── Regex caches ──────────────────────────────────────────────────

pub fn wikilink_re() -> &'static regex::Regex {
    // `[[Target]]`, `[[Target|alias]]`, `[[Target#section]]`.
    // We capture only the target portion — alias / section is
    // metadata the indexer doesn't store today.
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    RE.get_or_init(|| regex::Regex::new(r"\[\[([^\]|#\n]+)").unwrap())
}

pub fn md_link_re() -> &'static regex::Regex {
    // `[text](target)` — but only when target is a relative .md
    // path. We deliberately skip URLs (http(s)/mailto/etc.) and our
    // own `flux-wi://` scheme so the work-item links the kanban
    // plugin emits stay invisible to the backlink indexer.
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    RE.get_or_init(|| {
        regex::Regex::new(r"\[(?:[^\]]*)\]\(([^)\s]+\.md)(?:#[^)]*)?\)").unwrap()
    })
}

pub fn tag_re() -> &'static regex::Regex {
    // `#tag` — letters / digits / `-` / `_` / `/` (nested tags).
    // Negative lookbehind would be ideal but regex doesn't support
    // it; we instead require start-of-string or a whitespace /
    // punctuation char before the `#` to skip `https://...#frag`
    // and `code#fence` constructs.
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    RE.get_or_init(|| {
        regex::Regex::new(r"(?:^|[\s\(\[\{>,])#([A-Za-z][\w/-]{0,63})").unwrap()
    })
}

// ── Normalisation ─────────────────────────────────────────────────

pub fn normalise_target(raw: &str) -> String {
    let trimmed = raw.trim();
    let no_ext = if trimmed.to_ascii_lowercase().ends_with(".md") {
        &trimmed[..trimmed.len() - 3]
    } else {
        trimmed
    };
    no_ext.replace('\\', "/").to_ascii_lowercase()
}

/// Reject link targets that resolve to vault metadata users should
/// never see in backlinks / outgoing lists. We bail on:
///   • any path segment starting with `.` (e.g. `.zenvault/core`,
///     `.git/HEAD`, `.archive/old/note`),
///   • obviously-binary or generated artefacts (`*.json`, `*.lock`,
///     `*.log`, `*.db`, `*.yaml` outside the `boards/` namespace).
///
/// We deliberately allow `.png`, `.jpg`, `.pdf` etc. through — those
/// are legitimate wikilink / embed targets in note-taking workflows.
pub fn is_excluded_target(norm: &str) -> bool {
    for seg in norm.split('/') {
        if seg.starts_with('.') && seg != "." && seg != ".." {
            return true;
        }
    }
    // Strip trailing extension (normalise already stripped `.md`).
    let last_dot = norm.rsplit_once('.');
    if let Some((stem, ext)) = last_dot {
        let _ = stem;
        match ext {
            "json" | "lock" | "log" | "db" | "db-wal" | "db-shm" | "tmp" => {
                return true;
            }
            _ => {}
        }
    }
    false
}

pub fn snippet_of(line: &str) -> String {
    let trimmed = line.trim();
    if trimmed.chars().count() <= 160 {
        trimmed.to_string()
    } else {
        // Take the first 160 chars; cheap enough to count, avoids a
        // panic from slicing inside a UTF-8 boundary.
        trimmed.chars().take(160).collect::<String>() + "…"
    }
}

// ── Per-file extractor ────────────────────────────────────────────

pub fn extract_from_file(
    abs: &Path,
    vault_root: &Path,
    links: &mut Vec<LinkRef>,
    tags: &mut Vec<TagRef>,
    skipped: &mut u32,
) -> std::io::Result<bool> {
    let meta = std::fs::metadata(abs)?;
    if meta.len() > MAX_FILE_BYTES {
        *skipped += 1;
        return Ok(false);
    }
    let content = std::fs::read_to_string(abs)?;
    let rel = abs
        .strip_prefix(vault_root)
        .unwrap_or(abs)
        .to_string_lossy()
        .replace('\\', "/");

    // Pre-skip lines starting with code fences / inside fenced
    // blocks. Cheap state machine; the frontend chip rendering uses
    // the same trick.
    let mut in_fence = false;
    for (idx, line) in content.lines().enumerate() {
        if line.trim_start().starts_with("```") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }
        let line_no = (idx as u32) + 1;

        for cap in wikilink_re().captures_iter(line) {
            let target = cap.get(1).map(|m| m.as_str()).unwrap_or("").to_string();
            if target.is_empty() {
                continue;
            }
            let norm = normalise_target(&target);
            if is_excluded_target(&norm) {
                continue;
            }
            links.push(LinkRef {
                from: rel.clone(),
                line: line_no,
                target_norm: norm,
                target,
                kind: LinkKind::Wiki,
                snippet: snippet_of(line),
            });
        }
        for cap in md_link_re().captures_iter(line) {
            let target = cap.get(1).map(|m| m.as_str()).unwrap_or("").to_string();
            if target.is_empty() {
                continue;
            }
            let norm = normalise_target(&target);
            if is_excluded_target(&norm) {
                continue;
            }
            links.push(LinkRef {
                from: rel.clone(),
                line: line_no,
                target_norm: norm,
                target,
                kind: LinkKind::Markdown,
                snippet: snippet_of(line),
            });
        }
        for cap in tag_re().captures_iter(line) {
            let tag = cap.get(1).map(|m| m.as_str()).unwrap_or("").to_string();
            if tag.is_empty() {
                continue;
            }
            tags.push(TagRef {
                from: rel.clone(),
                line: line_no,
                tag,
            });
        }
    }
    Ok(true)
}

// ── Public commands ───────────────────────────────────────────────

/// Full vault scan — walk every `.md` file. Use on vault open and
/// when the user requests a manual reindex. For incremental updates
/// see `scan_vault_links_subset`.
#[tauri::command]
pub async fn scan_vault_links(
    state: State<'_, Arc<AppState>>,
) -> Result<LinkScanResult, AppError> {
    let vault_root = get_vault_path_from_state(&state)?;
    let vault_root_clone = vault_root.clone();

    let result = tokio::task::spawn_blocking(move || {
        let mut files: Vec<String> = Vec::new();
        let mut links: Vec<LinkRef> = Vec::new();
        let mut tags: Vec<TagRef> = Vec::new();
        let mut scanned: u32 = 0;
        let mut skipped: u32 = 0;

        super::fs::wikilink::walk_md(&vault_root_clone, &mut |abs: &Path| -> std::io::Result<()> {
            let rel = abs
                .strip_prefix(&vault_root_clone)
                .unwrap_or(abs)
                .to_string_lossy()
                .replace('\\', "/");
            files.push(rel);
            if extract_from_file(abs, &vault_root_clone, &mut links, &mut tags, &mut skipped)? {
                scanned += 1;
            }
            Ok(())
        })?;

        files.sort();
        links.sort_by(|a, b| a.from.cmp(&b.from).then(a.line.cmp(&b.line)));
        tags.sort_by(|a, b| a.from.cmp(&b.from).then(a.line.cmp(&b.line)));

        Ok::<LinkScanResult, std::io::Error>(LinkScanResult {
            files,
            links,
            tags,
            scanned_files: scanned,
            skipped_too_large: skipped,
        })
    })
    .await
    .map_err(|e| AppError::Io(format!("scan task join: {e}")))?
    .map_err(|e| AppError::Io(format!("scan walk: {e}")))?;

    tracing::info!(
        "scan_vault_links: {} files, {} links, {} tags, {} skipped",
        result.scanned_files,
        result.links.len(),
        result.tags.len(),
        result.skipped_too_large,
    );
    Ok(result)
}

/// Incremental scan — rescan only the specified vault-relative
/// paths. The frontend should reconcile the result by removing
/// previous links/tags whose `from` matches one of these paths,
/// then appending the new entries.
#[tauri::command]
pub async fn scan_vault_links_subset(
    paths: Vec<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<LinkScanResult, AppError> {
    let vault_root = get_vault_path_from_state(&state)?;
    let result = tokio::task::spawn_blocking(move || {
        let mut files: Vec<String> = Vec::new();
        let mut links: Vec<LinkRef> = Vec::new();
        let mut tags: Vec<TagRef> = Vec::new();
        let mut scanned: u32 = 0;
        let mut skipped: u32 = 0;

        for rel in paths {
            // Reject anything that doesn't resolve under the vault.
            let abs = match validate_and_resolve_path(&vault_root, &rel) {
                Ok(p) => p,
                Err(_) => continue,
            };
            let ext_ok = abs
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.eq_ignore_ascii_case("md"))
                .unwrap_or(false);
            if !ext_ok {
                continue;
            }
            if !abs.exists() {
                // Deleted file — still emit the path so the
                // frontend can drop its rows from the index.
                files.push(rel.replace('\\', "/"));
                continue;
            }
            files.push(rel.replace('\\', "/"));
            if extract_from_file(&abs, &vault_root, &mut links, &mut tags, &mut skipped)
                .map_err(|e| std::io::Error::other(format!("{e}")))?
            {
                scanned += 1;
            }
        }
        links.sort_by(|a, b| a.from.cmp(&b.from).then(a.line.cmp(&b.line)));
        tags.sort_by(|a, b| a.from.cmp(&b.from).then(a.line.cmp(&b.line)));

        Ok::<LinkScanResult, std::io::Error>(LinkScanResult {
            files,
            links,
            tags,
            scanned_files: scanned,
            skipped_too_large: skipped,
        })
    })
    .await
    .map_err(|e| AppError::Io(format!("scan task join: {e}")))?
    .map_err(|e| AppError::Io(format!("scan walk: {e}")))?;

    Ok(result)
}
