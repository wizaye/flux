//! File-system watcher.
//!
//! Wraps `notify-debouncer-full` so the rest of the app sees one
//! coalesced `flux://fs-changed` event per debounce window instead
//! of a flurry of low-level inotify / FSEvents callbacks.
//!
//! Lifecycle:
//!   • `start(vault_path, app, pool)` returns a boxed handle stored
//!     in `AppState.watcher`. Dropping the handle stops the watcher.
//!   • `open_vault` replaces the handle; `close_vault` sets it to
//!     `None`. No explicit teardown beyond the `Drop` impl is
//!     needed.
//!
//! On every debounced batch we:
//!   1. Filter out ignored paths (`.zenvault/`, `.git/`, dotfiles).
//!   2. Convert absolute paths to vault-relative strings.
//!   3. Re-index changed files in SQLite (FTS body + `files` row).
//!   4. Emit `flux://fs-changed` with the affected relative paths so
//!      the frontend can refresh its tree cache.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use notify::{EventKind, RecursiveMode, Watcher};
use notify_debouncer_full::{new_debouncer, DebouncedEvent, Debouncer, FileIdMap};
use serde::Serialize;
use specta::Type;
use tauri::{AppHandle, Emitter};

use crate::db::{self, repo::FileRecord, DbPool};
use crate::types::FileState;

/// Payload sent to JS on every debounced batch.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FsChangedPayload {
    /// Vault-relative paths that changed (created / modified).
    pub changed: Vec<String>,
    /// Vault-relative paths that were removed.
    pub removed: Vec<String>,
}

pub const FS_CHANGED_EVENT: &str = "flux://fs-changed";
const DEBOUNCE_MS: u64 = 250;

/// Returns a type-erased handle the caller must keep alive. Drop =
/// stop. Storing in `AppState.watcher: Mutex<Option<Box<dyn Any>>>`
/// is the canonical pattern.
pub fn start(
    vault_path: PathBuf,
    app: AppHandle,
    pool: DbPool,
) -> notify::Result<Box<dyn std::any::Any + Send>> {
    // notify-debouncer-full will give us coalesced batches every
    // DEBOUNCE_MS during sustained activity, single events when idle.
    let vault_path_for_cb = vault_path.clone();
    let mut debouncer: Debouncer<notify::RecommendedWatcher, FileIdMap> = new_debouncer(
        Duration::from_millis(DEBOUNCE_MS),
        None,
        move |result: notify_debouncer_full::DebounceEventResult| {
            match result {
                Ok(events) => {
                    let (changed, removed) =
                        partition_events(&events, &vault_path_for_cb);
                    if changed.is_empty() && removed.is_empty() {
                        return;
                    }

                    // Reindex changed files (best-effort — log on failure).
                    let pool_inner = pool.clone();
                    let vault_for_reindex = vault_path_for_cb.clone();
                    let changed_for_reindex = changed.clone();
                    let removed_for_reindex = removed.clone();
                    std::thread::spawn(move || {
                        if let Err(e) = reindex(
                            &pool_inner,
                            &vault_for_reindex,
                            &changed_for_reindex,
                            &removed_for_reindex,
                        ) {
                            tracing::warn!("watcher: reindex failed: {e}");
                        }
                    });

                    if let Err(e) = app.emit(
                        FS_CHANGED_EVENT,
                        FsChangedPayload { changed, removed },
                    ) {
                        tracing::warn!("watcher: emit failed: {e}");
                    }
                }
                Err(errors) => {
                    for e in errors {
                        tracing::warn!("watcher: notify error: {e:?}");
                    }
                }
            }
        },
    )?;

    debouncer
        .watcher()
        .watch(&vault_path, RecursiveMode::Recursive)?;

    Ok(Box::new(debouncer))
}

/// Split events into (changed, removed) deduplicated vault-relative
/// path lists. Filters out the usual ignored folders.
fn partition_events(
    events: &[DebouncedEvent],
    vault_path: &Path,
) -> (Vec<String>, Vec<String>) {
    use std::collections::BTreeSet;
    let mut changed: BTreeSet<String> = BTreeSet::new();
    let mut removed: BTreeSet<String> = BTreeSet::new();

    for ev in events {
        let kind = &ev.event.kind;
        for path in &ev.event.paths {
            let Some(rel) = to_vault_relative(path, vault_path) else {
                continue;
            };
            if is_ignored(&rel) {
                continue;
            }
            match kind {
                EventKind::Remove(_) => {
                    removed.insert(rel);
                }
                EventKind::Create(_) | EventKind::Modify(_) => {
                    changed.insert(rel);
                }
                _ => {}
            }
        }
    }
    (changed.into_iter().collect(), removed.into_iter().collect())
}

fn to_vault_relative(abs: &Path, vault_path: &Path) -> Option<String> {
    abs.strip_prefix(vault_path)
        .ok()
        .map(|p| p.to_string_lossy().replace('\\', "/"))
}

use crate::commands::fs::paths::{is_ignored_by_watcher as is_ignored, is_indexable_text as is_indexable};

/// Re-index changed files into `files` + `files_fts`. Removed files
/// get their FTS row dropped and their `files` row state flipped to
/// `Trashed` (we don't hard-delete since the user might be moving a
/// file rather than deleting it).
///
/// Exposed at crate-level so integration tests can exercise the
/// reindex path without spinning up a live `notify` subscription.
pub fn reindex(
    pool: &DbPool,
    vault_path: &Path,
    changed: &[String],
    removed: &[String],
) -> Result<(), String> {
    let mut conn = pool.get().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    for rel in changed {
        let abs = vault_path.join(rel);
        if !abs.is_file() {
            continue;
        }
        let Ok(meta) = std::fs::metadata(&abs) else {
            continue;
        };
        let modified_at = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or_else(|| chrono::Utc::now().timestamp_millis());
        let size = meta.len();

        let body = if is_indexable(rel) {
            std::fs::read_to_string(&abs).unwrap_or_default()
        } else {
            String::new()
        };
        let title = crate::commands::fs::extract_title(&body, rel);
        let hash = blake3::hash(body.as_bytes()).as_bytes().to_vec();

        if let Some(mut record) =
            FileRecord::get_by_path(&tx, rel).map_err(|e| e.to_string())?
        {
            record.title = title.clone();
            record.blake3_hash = hash;
            record.modified_at = modified_at;
            record.size_bytes = size;
            FileRecord::update_by_path(&tx, rel, &record).map_err(|e| e.to_string())?;
        } else {
            let record = FileRecord {
                id: uuid::Uuid::now_v7(),
                relative_path: rel.clone(),
                title: title.clone(),
                blake3_hash: hash,
                modified_at,
                state: FileState::Active,
                size_bytes: size,
                created_at: modified_at,
            };
            FileRecord::insert(&tx, &record).map_err(|e| e.to_string())?;
        }
        db::repo::fts_upsert(&tx, rel, &title, &body).map_err(|e| e.to_string())?;
    }

    for rel in removed {
        // Soft-flip in `files`; drop from FTS so it stops appearing
        // in search results immediately.
        let _ = FileRecord::update_state(&tx, rel, FileState::Trashed);
        let _ = db::repo::fts_delete(&tx, rel);
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// `Arc<AppState>` ergonomic accessor — not used here but kept so
/// the call site in `vault::open_vault` doesn't need to reach into
/// internals.
#[allow(dead_code)]
pub fn _typecheck(_a: Arc<crate::state::AppState>) {}

// ── Unit tests (private helpers) ──────────────────────────────────────────
//
// Tests for the pure event helpers (partition_events,
// to_vault_relative). The ignore + indexable predicates re-export
// from `crate::commands::fs::paths` so they're tested in that
// module's own `tests` block to avoid duplicate coverage here.

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{CreateKind, ModifyKind, RemoveKind};
    use notify_debouncer_full::DebouncedEvent;
    use std::time::Instant;

    fn ev(kind: EventKind, abs_paths: &[&Path]) -> DebouncedEvent {
        let event = notify::Event {
            kind,
            paths: abs_paths.iter().map(|p| p.to_path_buf()).collect(),
            attrs: Default::default(),
        };
        DebouncedEvent {
            event,
            time: Instant::now(),
        }
    }

    // ── to_vault_relative ──────────────────────────────────────────

    #[test]
    fn to_vault_relative_strips_vault_prefix_and_normalises_separators() {
        let vault = Path::new("/tmp/vault");
        let abs = Path::new("/tmp/vault/notes/topic.md");
        assert_eq!(to_vault_relative(abs, vault).unwrap(), "notes/topic.md");
    }

    #[test]
    fn to_vault_relative_returns_none_for_paths_outside_vault() {
        let vault = Path::new("/tmp/vault");
        let outside = Path::new("/etc/passwd");
        assert!(to_vault_relative(outside, vault).is_none());
    }

    // ── partition_events ───────────────────────────────────────────

    #[test]
    fn partition_events_separates_create_modify_from_remove() {
        let vault = Path::new("/tmp/vault");
        let a = vault.join("a.md");
        let b = vault.join("b.md");
        let c = vault.join("c.md");
        let events = vec![
            ev(EventKind::Create(CreateKind::File), &[a.as_path()]),
            ev(EventKind::Modify(ModifyKind::Any), &[b.as_path()]),
            ev(EventKind::Remove(RemoveKind::File), &[c.as_path()]),
        ];
        let (changed, removed) = partition_events(&events, vault);
        assert_eq!(changed, vec!["a.md", "b.md"]);
        assert_eq!(removed, vec!["c.md"]);
    }

    #[test]
    fn partition_events_deduplicates_repeated_paths() {
        let vault = Path::new("/tmp/vault");
        let a = vault.join("note.md");
        let events = vec![
            ev(EventKind::Modify(ModifyKind::Any), &[a.as_path()]),
            ev(EventKind::Modify(ModifyKind::Any), &[a.as_path()]),
            ev(EventKind::Create(CreateKind::File), &[a.as_path()]),
        ];
        let (changed, removed) = partition_events(&events, vault);
        assert_eq!(changed, vec!["note.md"]);
        assert!(removed.is_empty());
    }

    #[test]
    fn partition_events_filters_ignored_paths() {
        let vault = Path::new("/tmp/vault");
        let dotfile = vault.join(".zenvault/index.db");
        let real = vault.join("notes.md");
        let events = vec![
            ev(EventKind::Modify(ModifyKind::Any), &[dotfile.as_path(), real.as_path()]),
        ];
        let (changed, removed) = partition_events(&events, vault);
        assert_eq!(changed, vec!["notes.md"]);
        assert!(removed.is_empty());
    }

    #[test]
    fn partition_events_filters_tmp_atomic_write_artifacts() {
        let vault = Path::new("/tmp/vault");
        let tmp = vault.join(".note.md.tmp");
        let events = vec![
            ev(EventKind::Create(CreateKind::File), &[tmp.as_path()]),
        ];
        let (changed, removed) = partition_events(&events, vault);
        assert!(changed.is_empty());
        assert!(removed.is_empty());
    }
}