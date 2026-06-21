//! File system operations.
//!
//! Provides CRUD operations for files and directories with atomic writes,
//! wikilink healing, and state management.

use crate::db::{self, repo::FileRecord};
use crate::state::AppState;
use crate::types::{AppError, ArchiveEntry, EntryType, FileEntry, FileMetadata, FileState, FileTreeNode, MoveResult, RenameResult, SearchHit, TrashEntry};
use std::io::Write;
use std::path::Path;
use std::sync::Arc;
use tauri::State;
use uuid::Uuid;

pub mod common;
pub mod wikilink;

use common::{canonicalise_rel, get_db_pool_from_state, get_vault_path_from_state, validate_and_resolve_path};

// ── File Operations ───────────────────────────────────────────────────────

/// Read file contents.
///
/// Returns the raw text content of the file.
#[tauri::command]
pub async fn read_file(
    path: String,
    state: State<'_, Arc<AppState>>,
) -> Result<String, AppError> {
    let vault_path = get_vault_path_from_state(&state)?;
    let file_path = validate_and_resolve_path(&vault_path, &path)?;

    // Read file content
    let content = tokio::fs::read_to_string(&file_path)
        .await
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                AppError::NotFound(path.clone())
            } else {
                AppError::Io(e.to_string())
            }
        })?;

    Ok(content)
}

/// Read file contents as raw bytes.
///
/// Use for binary files (PDFs, images, etc.) where `read_file` would
/// fail with "stream did not contain valid UTF-8". Tauri serializes
/// `Vec<u8>` as a JS `number[]`; the frontend rewraps it as a
/// `Uint8Array` before handing it to consumers (e.g. pdf.js).
#[tauri::command]
pub async fn read_file_binary(
    path: String,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<u8>, AppError> {
    let vault_path = get_vault_path_from_state(&state)?;
    let file_path = validate_and_resolve_path(&vault_path, &path)?;

    let bytes = tokio::fs::read(&file_path).await.map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            AppError::NotFound(path.clone())
        } else {
            AppError::Io(e.to_string())
        }
    })?;

    Ok(bytes)
}

/// Return filesystem metadata for a single path: size, created /
/// modified timestamps (Unix epoch ms), and whether the path is a
/// directory. Cheap call — used by the sidebar's hover tooltip so
/// we don't have to bake every metadata field into `FileTreeNode`.
///
/// Note: `created` isn't supported on every filesystem (notably some
/// Linux configurations); when it isn't, we fall back to `modified`
/// rather than erroring.
#[tauri::command]
pub async fn get_file_metadata(
    path: String,
    state: State<'_, Arc<AppState>>,
) -> Result<FileMetadata, AppError> {
    let vault_path = get_vault_path_from_state(&state)?;
    let file_path = validate_and_resolve_path(&vault_path, &path)?;

    let metadata = tokio::fs::metadata(&file_path).await.map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            AppError::NotFound(path.clone())
        } else {
            AppError::Io(e.to_string())
        }
    })?;

    let modified_at = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    let created_at = metadata
        .created()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(modified_at);

    Ok(FileMetadata {
        size: if metadata.is_dir() { 0 } else { metadata.len() },
        created_at,
        modified_at,
        is_dir: metadata.is_dir(),
    })
}

/// Write file contents with atomic write.
///
/// Uses temp file + fsync + rename to ensure atomicity.
/// Updates the database index if file exists.
#[tauri::command]
pub async fn write_file(
    path: String,
    content: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), AppError> {
    let vault_path = get_vault_path_from_state(&state)?;
    let file_path = validate_and_resolve_path(&vault_path, &path)?;

    // Ensure parent directory exists
    if let Some(parent) = file_path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    // Atomic write: temp file in same directory → fsync → rename
    let temp_path = file_path.with_extension("tmp");

    {
        let mut temp_file = std::fs::File::create(&temp_path)?;
        temp_file.write_all(content.as_bytes())?;
        temp_file.sync_all()?;
    }

    std::fs::rename(&temp_path, &file_path)?;

    // Update database index
    let pool = get_db_pool_from_state(&state)?;
    let file_metadata = tokio::fs::metadata(&file_path).await?;
    let modified_at = file_metadata
        .modified()?
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;

    let blake3_hash = blake3::hash(content.as_bytes()).as_bytes().to_vec();
    let size_bytes = content.len() as u64;

    // Extract title from frontmatter or filename
    let title = extract_title(&content, &path);

    // Canonicalise the relative path before it touches the DB. This
    // collapses `notes\a.md` and `notes/a.md` into one key, and
    // strips spurious leading/trailing slashes — without this, the
    // UNIQUE constraint on `relative_path` trips when two saves of
    // the same file arrive with different slash flavours (a real
    // bug on Windows where the frontend emits backslashes).
    let db_path = canonicalise_rel(&path);

    // Body capture for FTS upsert (clone-once into the closure). We
    // skip indexing non-text files via a coarse extension check —
    // images / binaries won't tokenise meaningfully.
    let body_for_fts = if is_indexable(&path) { content.clone() } else { String::new() };
    let title_for_fts = title.clone();
    let path_for_fts = db_path.clone();

    db::run_blocking(&pool, move |conn| {
        // `FileRecord::insert` is now an UPSERT (ON CONFLICT(relative_path)
        // DO UPDATE ...), so we always feed it a fresh record. For
        // brand-new paths it inserts; for known paths SQLite applies
        // the title/hash/modified/size updates atomically. This
        // collapses the previous "fetch → branch → update OR insert"
        // dance, which had a race window where two saves arriving
        // back-to-back could both miss the existing row and try to
        // insert.
        let record = FileRecord {
            id: Uuid::now_v7(),
            relative_path: db_path,
            title,
            blake3_hash,
            modified_at,
            state: FileState::Active,
            size_bytes,
            created_at: modified_at,
        };
        FileRecord::insert(conn, &record)?;
        // Upsert FTS row (no-op body for non-indexable files just
        // removes them from search results, which is what we want).
        db::repo::fts_upsert(conn, &path_for_fts, &title_for_fts, &body_for_fts)?;
        Ok(())
    })
    .await
    // Best-effort: the file is already on disk by the time we reach
    // here, so an index failure must NOT bubble up as "save failed".
    // The DB is a derived cache; we'll re-index on the next save or
    // a manual reindex. Log loudly so we still see the bug in dev.
    .unwrap_or_else(|e| {
        tracing::warn!("write_file: DB index update failed (FS op succeeded): {e}");
    });

    Ok(())
}

/// Cheap content-type gate for the FTS index — only text-like files
/// get their body tokenised. Avoids bloating the index with binary
/// blobs that produce zero useful search hits.
fn is_indexable(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    matches!(
        Path::new(&lower).extension().and_then(|e| e.to_str()),
        Some("md") | Some("markdown") | Some("txt") | Some("mdx") | Some("rst") | Some("canvas")
    )
}

/// Write raw bytes to an absolute path outside the vault.
///
/// Intended for "Export" flows where the user picked the destination
/// via the OS save dialog (so the path is implicitly user-consented).
/// Skips the vault sandboxing and the SQLite index update that
/// `write_file` performs, because the target file isn't part of the
/// vault.
///
/// We still do basic sanity checks: the path must be absolute and
/// the parent directory must already exist (the dialog enforces this
/// — we double-check so a malicious caller can't slip a relative
/// path through).
#[tauri::command]
pub async fn write_external_file(
    path: String,
    bytes: Vec<u8>,
) -> Result<(), AppError> {
    let target = std::path::PathBuf::from(&path);
    if !target.is_absolute() {
        return Err(AppError::InvalidPath(format!(
            "expected absolute path, got `{}`",
            path
        )));
    }
    if let Some(parent) = target.parent() {
        if !parent.exists() {
            return Err(AppError::NotFound(parent.display().to_string()));
        }
    }

    // Atomic write: temp in same dir → fsync → rename. Matches the
    // safety pattern of `write_file` so a crashed export never
    // leaves a truncated PDF on disk.
    let dir = target.parent().unwrap_or(Path::new("."));
    let stem = target
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "export".into());
    let temp_path = dir.join(format!(".{}.tmp", stem));

    {
        let mut temp_file = std::fs::File::create(&temp_path)?;
        temp_file.write_all(&bytes)?;
        temp_file.sync_all()?;
    }
    std::fs::rename(&temp_path, &target)?;
    Ok(())
}

/// Create a new file with initial content.
///
/// Returns an error if the file already exists.
#[tauri::command]
pub async fn create_file(
    path: String,
    content: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), AppError> {
    let vault_path = get_vault_path_from_state(&state)?;
    let file_path = validate_and_resolve_path(&vault_path, &path)?;

    // Check if file already exists
    if file_path.exists() {
        return Err(AppError::AlreadyExists(path));
    }

    // Use write_file to create with atomic write
    write_file(path, content, state).await
}

/// Delete a file by moving it to trash.
///
/// Files are never permanently deleted immediately. They go to
/// .trash/YYYY-MM/ and can be restored. A janitor process will
/// purge old files based on retention settings.
#[tauri::command]
pub async fn delete_file(
    path: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), AppError> {
    let vault_path = get_vault_path_from_state(&state)?;
    let file_path = validate_and_resolve_path(&vault_path, &path)?;

    if !file_path.exists() {
        return Err(AppError::NotFound(path));
    }

    // Create trash directory for current month
    let now = chrono::Utc::now();
    let trash_month_dir = vault_path
        .join(".trash")
        .join(now.format("%Y-%m").to_string());
    tokio::fs::create_dir_all(&trash_month_dir).await?;

    // Move file to trash (preserve directory structure)
    let trash_file_path = trash_month_dir.join(&path);
    if let Some(parent) = trash_file_path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    tokio::fs::rename(&file_path, &trash_file_path).await?;

    // Update database state to trashed — best-effort. The DB index is
    // a derived cache (see PROJECT_PLAN: filesystem is the source of
    // truth); a missing or stale row must NEVER block a real FS
    // operation. We log instead of returning so the user gets the
    // "moved to trash" they asked for.
    let pool = get_db_pool_from_state(&state)?;
    let path_for_db = canonicalise_rel(&path);
    if let Err(e) = db::run_blocking(&pool, move |conn| {
        FileRecord::update_state(conn, &path_for_db, FileState::Trashed)?;
        // Trashed files don't appear in search.
        db::repo::fts_delete(conn, &path_for_db)?;
        Ok(())
    })
    .await
    {
        tracing::warn!("delete_file: DB index update failed (FS op succeeded): {e}");
    }

    Ok(())
}

/// Move/rename a file to a new location.
///
/// Handles wikilink healing automatically.
/// Returns the number of links healed and files updated.
#[tauri::command]
pub async fn move_file(
    src: String,
    dst: String,
    state: State<'_, Arc<AppState>>,
) -> Result<MoveResult, AppError> {
    let vault_path = get_vault_path_from_state(&state)?;
    let src_path = validate_and_resolve_path(&vault_path, &src)?;
    let dst_path = validate_and_resolve_path(&vault_path, &dst)?;

    if !src_path.exists() {
        return Err(AppError::NotFound(src.clone()));
    }

    if dst_path.exists() {
        return Err(AppError::AlreadyExists(dst.clone()));
    }

    // Ensure destination parent directory exists
    if let Some(parent) = dst_path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    // Move the file
    tokio::fs::rename(&src_path, &dst_path).await?;

    // Update database path — best-effort (see delete_file note).
    // We also rebuild the FTS row at the new path: the body hasn't
    // changed but the path key has, and `relative_path` is the FTS
    // join key the search panel filters on.
    let pool = get_db_pool_from_state(&state)?;
    let dst_clone = canonicalise_rel(&dst);
    let src_for_db = canonicalise_rel(&src);
    let dst_for_fts = dst_clone.clone();
    let dst_disk_path = dst_path.clone();
    if let Err(e) = db::run_blocking(&pool, move |conn| {
        FileRecord::update_path(conn, &src_for_db, &dst_clone)?;
        db::repo::fts_delete(conn, &src_for_db)?;
        // Re-read the moved file's body so the FTS index points at
        // the new path with fresh content. Skip silently if the read
        // fails — search staleness is recoverable; a failed rename
        // is not.
        if is_indexable(&dst_for_fts) {
            if let Ok(body) = std::fs::read_to_string(&dst_disk_path) {
                let title = extract_title(&body, &dst_for_fts);
                db::repo::fts_upsert(conn, &dst_for_fts, &title, &body)?;
            }
        }
        Ok(())
    })
    .await
    {
        tracing::warn!("move_file: DB index update failed (FS op succeeded): {e}");
    }

    // Wikilink healing — rewrite `[[old]]`, `[[path/old]]`,
    // `[[old|alias]]`, `[[old#section]]` in every other markdown
    // file to point at the new name/path. Runs on the blocking pool
    // because we walk the vault tree synchronously.
    let vault_for_heal = vault_path.clone();
    let src_for_heal = src.clone();
    let dst_for_heal = dst.clone();
    let (links_healed, files_updated) =
        tokio::task::spawn_blocking(move || -> Result<(usize, usize), AppError> {
            wikilink::heal_links(&vault_for_heal, &src_for_heal, &dst_for_heal)
                .map_err(|e| AppError::Io(e.to_string()))
        })
        .await
        .map_err(|e| AppError::Other(e.to_string()))?
        .unwrap_or_else(|e| {
            // Heal failure isn't fatal — the rename already succeeded
            // and the user can re-run a heal manually.
            tracing::warn!("move_file: wikilink heal failed: {e}");
            (0, 0)
        });

    Ok(MoveResult {
        new_path: dst,
        links_healed: links_healed as u32,
        files_updated: files_updated as u32,
    })
}

/// Rename a file within its current directory.
///
/// This is a convenience wrapper around move_file.
#[tauri::command]
pub async fn rename_file(
    path: String,
    new_name: String,
    state: State<'_, Arc<AppState>>,
) -> Result<RenameResult, AppError> {
    let vault_path = get_vault_path_from_state(&state)?;
    let file_path = validate_and_resolve_path(&vault_path, &path)?;

    // Construct new path in same directory
    let parent = file_path
        .parent()
        .ok_or_else(|| AppError::InvalidPath("Cannot rename root".to_string()))?;

    let new_path = parent.join(&new_name);
    let new_relative = new_path
        .strip_prefix(&vault_path)
        .map_err(|_| AppError::InvalidPath("Invalid new path".to_string()))?
        .to_str()
        .ok_or_else(|| AppError::InvalidPath("Invalid UTF-8 in path".to_string()))?
        .to_string();

    let result = move_file(path, new_relative, state).await?;

    Ok(RenameResult {
        new_path: result.new_path,
        links_healed: result.links_healed,
        files_updated: result.files_updated,
    })
}

// ── Directory Operations ──────────────────────────────────────────────────

/// Create a new directory.
#[tauri::command]
pub async fn create_directory(
    path: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), AppError> {
    let vault_path = get_vault_path_from_state(&state)?;
    let dir_path = validate_and_resolve_path(&vault_path, &path)?;

    if dir_path.exists() {
        return Err(AppError::AlreadyExists(path));
    }

    tokio::fs::create_dir_all(&dir_path).await?;
    Ok(())
}

/// List directory contents.
///
/// Returns both files and subdirectories, with metadata.
#[tauri::command]
pub async fn list_directory(
    path: String,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<FileEntry>, AppError> {
    let vault_path = get_vault_path_from_state(&state)?;
    let dir_path = if path.is_empty() {
        vault_path.clone()
    } else {
        validate_and_resolve_path(&vault_path, &path)?
    };

    if !dir_path.exists() {
        return Err(AppError::NotFound(path));
    }

    if !dir_path.is_dir() {
        return Err(AppError::InvalidPath("Not a directory".to_string()));
    }

    let mut entries = Vec::new();
    let mut dir_reader = tokio::fs::read_dir(&dir_path).await?;

    while let Some(entry) = dir_reader.next_entry().await? {
        let metadata = entry.metadata().await?;
        let entry_path = entry.path();

        // Skip .zenvault, .trash, .archive directories and common ignore patterns
        if let Some(name) = entry_path.file_name().and_then(|n| n.to_str()) {
            if name.starts_with('.') && (name == ".zenvault" || name == ".trash" || name == ".archive") {
                continue;
            }
            if should_ignore_entry(name) {
                continue;
            }
        }

        let relative = canonicalise_rel(
            entry_path
                .strip_prefix(&vault_path)
                .map_err(|_| AppError::Other("Path resolution error".to_string()))?
                .to_str()
                .ok_or_else(|| AppError::Other("Invalid UTF-8 in path".to_string()))?,
        );

        let name = entry
            .file_name()
            .to_str()
            .ok_or_else(|| AppError::Other("Invalid UTF-8 in filename".to_string()))?
            .to_string();

        let modified_at = metadata
            .modified()?
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;

        let entry_type = if metadata.is_dir() {
            EntryType::Directory
        } else {
            EntryType::File
        };

        let size = if metadata.is_file() {
            Some(metadata.len())
        } else {
            None
        };

        // Get file state from database if it's a file
        let state_value = if metadata.is_file() {
            let pool = get_db_pool_from_state(&state)?;
            let rel = relative.clone();
            db::run_blocking(&pool, move |conn| {
                FileRecord::get_by_path(conn, &rel).map(|r| r.map(|rec| rec.state))
            })
            .await
            .ok()
            .flatten()
        } else {
            None
        };

        entries.push(FileEntry {
            path: relative,
            name,
            entry_type,
            state: state_value,
            size,
            modified_at,
        });
    }

    // Sort: directories first, then by name
    entries.sort_by(|a, b| {
        match (&a.entry_type, &b.entry_type) {
            (EntryType::Directory, EntryType::File) => std::cmp::Ordering::Less,
            (EntryType::File, EntryType::Directory) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });

    Ok(entries)
}

/// Get the full file tree as a flat list with depth encoding.
///
/// This is optimized for virtualized rendering in the frontend.
/// Directories are recursively walked and encoded with depth levels.
#[tauri::command]
pub async fn get_file_tree(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<FileTreeNode>, AppError> {
    let vault_path = get_vault_path_from_state(&state)?;
    let pool = get_db_pool_from_state(&state)?;

    tracing::info!("Building file tree for vault: {:?}", vault_path);
    
    let vault_path_clone = vault_path.clone();
    let nodes = tokio::task::spawn_blocking(move || {
        build_file_tree(&vault_path_clone, &pool)
    })
    .await
    .map_err(|e| AppError::Other(e.to_string()))??;

    tracing::info!("File tree built with {} nodes", nodes.len());
    Ok(nodes)
}

// ── Helper Functions ──────────────────────────────────────────────────────

/// Extract title from file content (YAML frontmatter `title:` field
/// first, then the first H1 heading, then the filename stem). Matches
/// the precedence Obsidian + most static-site generators use.
pub(crate) fn extract_title(content: &str, path: &str) -> String {
    // Cheap fallback used by every code path below.
    let stem_fallback = || -> String {
        Path::new(path)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Untitled")
            .to_string()
    };

    let bytes = content.as_bytes();
    if !content.starts_with("---") {
        return first_h1(content).unwrap_or_else(stem_fallback);
    }
    // Find the closing `---` on its own line. Anything past the first
    // 16 KiB of YAML is almost certainly malformed; cap the search to
    // keep the scan cheap on huge files.
    let cap = bytes.len().min(16 * 1024);
    let after_first = &content[3..cap];
    let Some(end_rel) = after_first.find("\n---") else {
        return first_h1(content).unwrap_or_else(stem_fallback);
    };
    let fm = &after_first[..end_rel];

    // Tiny line-by-line `title: …` parser. Avoids pulling a full YAML
    // crate just for one scalar field; users with quoted titles get
    // the unquoted value via the trim chain.
    for line in fm.lines() {
        let trimmed = line.trim_start();
        if let Some(rest) = trimmed.strip_prefix("title:") {
            let v = rest
                .trim()
                .trim_matches('"')
                .trim_matches('\'')
                .trim()
                .to_string();
            if !v.is_empty() {
                return v;
            }
        }
    }
    first_h1(content).unwrap_or_else(stem_fallback)
}

/// Return the first `# Heading` text in `content`, if any.
fn first_h1(content: &str) -> Option<String> {
    for line in content.lines().take(200) {
        let trimmed = line.trim_start();
        if let Some(rest) = trimmed.strip_prefix("# ") {
            let h = rest.trim().to_string();
            if !h.is_empty() {
                return Some(h);
            }
        }
    }
    None
}

/// Check if a file/folder should be ignored.
fn should_ignore_entry(name: &str) -> bool {
    const IGNORE_PATTERNS: &[&str] = &[
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
    ];
    
    IGNORE_PATTERNS.contains(&name)
}

/// Recursively build file tree with depth encoding.
fn build_file_tree(
    vault_path: &Path,
    pool: &crate::db::DbPool,
) -> Result<Vec<FileTreeNode>, AppError> {
    let mut nodes = Vec::new();
    build_tree_recursive(vault_path, vault_path, 0, None, &mut nodes, pool)?;
    Ok(nodes)
}

fn build_tree_recursive(
    vault_path: &Path,
    current_path: &Path,
    depth: u32,
    parent_id: Option<String>,
    nodes: &mut Vec<FileTreeNode>,
    pool: &crate::db::DbPool,
) -> Result<(), AppError> {
    let entries = std::fs::read_dir(current_path)?;

    for entry in entries {
        let entry = entry?;
        let path = entry.path();
        let metadata = entry.metadata()?;

        // Skip ignored directories and files
        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            // Skip vault internal directories
            if name.starts_with('.') && (name == ".zenvault" || name == ".trash" || name == ".archive") {
                continue;
            }
            
            // Skip common ignore patterns (node_modules, .git, etc.)
            if should_ignore_entry(name) {
                continue;
            }
        }

        // Calculate relative path from vault root (used as id for all operations).
        // Canonicalised to forward-slashes so the frontend + DB
        // never disagree about a Windows path's flavour.
        let relative = canonicalise_rel(
            path
                .strip_prefix(vault_path)
                .map_err(|_| AppError::Other("Path resolution error".to_string()))?
                .to_str()
                .ok_or_else(|| AppError::Other("Invalid UTF-8 in path".to_string()))?,
        );

        let name = entry.file_name().to_str().unwrap().to_string();
        let modified_at = metadata
            .modified()?
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;

        if metadata.is_dir() {
            let child_count = std::fs::read_dir(&path)?.count() as u32;

            nodes.push(FileTreeNode {
                id: relative.clone(),
                entry_type: EntryType::Directory,
                name,
                depth,
                parent_id: parent_id.clone(),
                is_open: Some(false),
                state: None,
                child_count: Some(child_count),
                size: None,
                modified_at,
            });

            // Recursively process subdirectory
            build_tree_recursive(vault_path, &path, depth + 1, Some(relative), nodes, pool)?;
        } else {
            let size = metadata.len();

            // Get file state from database
            let conn = pool.get().map_err(|e| AppError::Database(e.to_string()))?;
            let file_state = FileRecord::get_by_path(&conn, &relative)
                .ok()
                .flatten()
                .map(|r| r.state);

            nodes.push(FileTreeNode {
                id: relative,
                entry_type: EntryType::File,
                name,
                depth,
                parent_id: parent_id.clone(),
                is_open: None,
                state: file_state,
                child_count: None,
                size: Some(size),
                modified_at,
            });
        }
    }

    Ok(())
}


// ── Trash Operations ──────────────────────────────────────────────────────

/// List every file currently in `.trash/`.
///
/// Walks `.trash/<YYYY-MM>/` recursively (one level for the month
/// bucket, then arbitrarily deep for files that were deleted while
/// nested in folders). The relative path INSIDE the month bucket is
/// the file's original vault path — that's where `restore_from_trash`
/// will put it back.
#[tauri::command]
pub async fn list_trash(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<TrashEntry>, AppError> {
    let vault_path = common::get_vault_path_from_state(&state)?;
    let trash_root = vault_path.join(".trash");

    if !trash_root.exists() {
        return Ok(Vec::new());
    }

    let mut entries: Vec<TrashEntry> = Vec::new();

    // First level: month buckets (YYYY-MM).
    let mut month_iter = tokio::fs::read_dir(&trash_root).await?;
    while let Some(month_entry) = month_iter.next_entry().await? {
        let month_path = month_entry.path();
        if !month_path.is_dir() {
            continue;
        }
        // Walk every file under this month bucket.
        let mut stack = vec![month_path.clone()];
        while let Some(dir) = stack.pop() {
            let mut dir_iter = tokio::fs::read_dir(&dir).await?;
            while let Some(entry) = dir_iter.next_entry().await? {
                let path = entry.path();
                let metadata = entry.metadata().await?;
                if metadata.is_dir() {
                    stack.push(path);
                    continue;
                }
                // Path relative to the vault root (what we surface to the UI).
                let trash_rel = path
                    .strip_prefix(&vault_path)
                    .map_err(|_| AppError::Other("Path resolution error".to_string()))?
                    .to_str()
                    .ok_or_else(|| AppError::Other("Invalid UTF-8 in path".to_string()))?
                    .to_string();
                // Path relative to the month bucket — this is the file's
                // original location in the vault.
                let original_rel = path
                    .strip_prefix(&month_path)
                    .map_err(|_| AppError::Other("Path resolution error".to_string()))?
                    .to_str()
                    .ok_or_else(|| AppError::Other("Invalid UTF-8 in path".to_string()))?
                    .to_string();

                let name = path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("(unnamed)")
                    .to_string();

                let trashed_at = metadata
                    .modified()?
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_millis() as i64;

                entries.push(TrashEntry {
                    trash_path: trash_rel,
                    original_path: original_rel,
                    name,
                    size: metadata.len(),
                    trashed_at,
                });
            }
        }
    }

    // Newest first.
    entries.sort_by(|a, b| b.trashed_at.cmp(&a.trashed_at));
    Ok(entries)
}

/// Restore a trashed file to its original location.
///
/// `trash_path` must point at a file inside `.trash/`. The file's
/// `original_path` (the path it had before deletion) is reconstructed
/// from the part of `trash_path` after the `YYYY-MM/` bucket prefix.
/// If `original_path` already exists, the restore fails — callers
/// should rename or delete the colliding file first.
#[tauri::command]
pub async fn restore_from_trash(
    trash_path: String,
    state: State<'_, Arc<AppState>>,
) -> Result<String, AppError> {
    let vault_path = common::get_vault_path_from_state(&state)?;
    let trashed_file = common::validate_and_resolve_path(&vault_path, &trash_path)?;

    if !trashed_file.exists() {
        return Err(AppError::NotFound(trash_path));
    }

    // Derive the original vault-relative path: strip the leading
    // `.trash/YYYY-MM/` prefix.
    let trash_rel = trashed_file
        .strip_prefix(&vault_path)
        .map_err(|_| AppError::InvalidPath("Path outside vault".to_string()))?;
    let mut components = trash_rel.components();
    let dot_trash = components.next();
    if dot_trash.and_then(|c| c.as_os_str().to_str()) != Some(".trash") {
        return Err(AppError::InvalidPath(
            "Path is not inside .trash/".to_string(),
        ));
    }
    // Skip the YYYY-MM month bucket.
    components.next();
    let original_rel: std::path::PathBuf = components.collect();
    if original_rel.as_os_str().is_empty() {
        return Err(AppError::InvalidPath(
            "Cannot determine original path".to_string(),
        ));
    }
    let destination = vault_path.join(&original_rel);

    if destination.exists() {
        return Err(AppError::AlreadyExists(
            original_rel.to_string_lossy().to_string(),
        ));
    }

    if let Some(parent) = destination.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    tokio::fs::rename(&trashed_file, &destination).await?;

    let original_path_str = original_rel
        .to_str()
        .ok_or_else(|| AppError::Other("Invalid UTF-8 in path".to_string()))?
        .to_string();

    // Flip the file's DB state back to Active.
    let pool = common::get_db_pool_from_state(&state)?;
    let original_for_db = canonicalise_rel(&original_path_str);
    let _ = db::run_blocking(&pool, move |conn| {
        FileRecord::update_state(conn, &original_for_db, FileState::Active)
    })
    .await;

    Ok(original_path_str)
}

/// Permanently delete a file from `.trash/` (no recovery possible).
#[tauri::command]
pub async fn purge_trash_entry(
    trash_path: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), AppError> {
    let vault_path = common::get_vault_path_from_state(&state)?;
    let trashed_file = common::validate_and_resolve_path(&vault_path, &trash_path)?;

    if !trashed_file.exists() {
        return Err(AppError::NotFound(trash_path));
    }
    // Only allow purging files that actually live inside .trash/.
    let rel = trashed_file
        .strip_prefix(&vault_path)
        .map_err(|_| AppError::InvalidPath("Path outside vault".to_string()))?;
    if !rel.starts_with(".trash") {
        return Err(AppError::InvalidPath(
            "Path is not inside .trash/".to_string(),
        ));
    }

    if trashed_file.is_dir() {
        tokio::fs::remove_dir_all(&trashed_file).await?;
    } else {
        tokio::fs::remove_file(&trashed_file).await?;
    }

    Ok(())
}

/// FTS5 search over the vault's indexed files.
///
/// `query` is parsed tokenwise: each whitespace-separated token is
/// wrapped in double quotes (so phrases stay literal) and gets a `*`
/// suffix for prefix matching. This matches user expectation for an
/// incremental search box (typing "az" finds "AzCiM") without
/// exposing FTS5's MATCH operator surface to the UI.
///
/// `limit` caps the result set; 200 is a sensible upper bound for
/// the sidebar panel.
///
/// Returns ranked hits (BM25) with `<mark>`-wrapped HTML snippets.
#[tauri::command]
pub async fn search_files(
    query: String,
    limit: Option<u32>,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<SearchHit>, AppError> {
    let pool = get_db_pool_from_state(&state)?;
    let cap = limit.unwrap_or(100).min(500);
    let hits = db::run_blocking(&pool, move |conn| db::repo::fts_search(conn, &query, cap))
        .await
        .map_err(|e| AppError::Database(e.to_string()))?;
    Ok(hits
        .into_iter()
        .map(|h| SearchHit {
            relative_path: h.relative_path,
            title: h.title,
            snippet: h.snippet,
        })
        .collect())
}

// ── Archive ───────────────────────────────────────────────────────────────
//
// Archive is a soft-retire bucket separate from trash. The semantic
// distinction we surface to users:
//
//   • Delete  → `.trash/YYYY-MM/<file>`   — scheduled for janitor purge
//   • Archive → `.archive/<original/path>` — kept indefinitely, intent
//                                            is "out of sight, not gone"
//
// Unlike trash, archive preserves the file's full original directory
// structure verbatim (no month bucketing). Restoring is just the
// reverse rename. Archive supports BOTH files and directories — the
// folder context menu uses this for "Archive folder".

/// Archive a file or directory by moving it to `.archive/<original>`.
///
/// Returns the new path inside `.archive/`. Fails with `AlreadyExists`
/// if the destination is taken — the user has to clear the colliding
/// archive entry first (intentional: silently overwriting would lose
/// data).
#[tauri::command]
pub async fn archive_file(
    path: String,
    state: State<'_, Arc<AppState>>,
) -> Result<String, AppError> {
    let vault_path = get_vault_path_from_state(&state)?;
    let src = validate_and_resolve_path(&vault_path, &path)?;

    if !src.exists() {
        return Err(AppError::NotFound(path));
    }
    // Block archiving inside `.archive/` or `.trash/` so users can't
    // recursively bury already-archived content.
    let norm = path.replace('\\', "/");
    if norm.starts_with(".archive/") || norm == ".archive"
        || norm.starts_with(".trash/") || norm == ".trash"
    {
        return Err(AppError::InvalidPath(
            "Cannot archive items already in .archive or .trash".to_string(),
        ));
    }

    let archive_root = vault_path.join(".archive");
    tokio::fs::create_dir_all(&archive_root).await?;

    let dest = archive_root.join(&path);
    if dest.exists() {
        return Err(AppError::AlreadyExists(format!(".archive/{path}")));
    }
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    tokio::fs::rename(&src, &dest).await?;

    // Best-effort DB index update — file rows flip to Archived, FTS
    // drops them so they don't surface in search. Folder archives
    // touch every descendant row.
    let pool = get_db_pool_from_state(&state)?;
    let path_for_db = canonicalise_rel(&path);
    let is_dir_for_db = dest.is_dir();
    if let Err(e) = db::run_blocking(&pool, move |conn| {
        if is_dir_for_db {
            // Update every row whose `relative_path` lives under
            // the archived folder.
            let prefix = format!("{}/", path_for_db);
            conn.execute(
                "UPDATE files SET state = 'archived' WHERE relative_path = ?1 OR relative_path LIKE ?2",
                rusqlite::params![path_for_db, format!("{}%", prefix)],
            )?;
            // FTS purge for every match.
            conn.execute(
                "DELETE FROM files_fts WHERE relative_path = ?1 OR relative_path LIKE ?2",
                rusqlite::params![path_for_db, format!("{}%", prefix)],
            )?;
        } else {
            FileRecord::update_state(conn, &path_for_db, FileState::Archived)?;
            db::repo::fts_delete(conn, &path_for_db)?;
        }
        Ok(())
    })
    .await
    {
        tracing::warn!("archive_file: DB index update failed (FS op succeeded): {e}");
    }

    let dest_rel = dest
        .strip_prefix(&vault_path)
        .map_err(|_| AppError::Other("Path resolution error".to_string()))?
        .to_string_lossy()
        .replace('\\', "/");
    Ok(dest_rel)
}

/// List every entry currently under `.archive/`. Returns directories
/// too (so the UI can render a tree if it wants); the `is_dir` flag
/// distinguishes them.
#[tauri::command]
pub async fn list_archive(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<ArchiveEntry>, AppError> {
    let vault_path = get_vault_path_from_state(&state)?;
    let archive_root = vault_path.join(".archive");

    if !archive_root.exists() {
        return Ok(Vec::new());
    }

    let mut entries: Vec<ArchiveEntry> = Vec::new();
    let mut stack = vec![archive_root.clone()];
    while let Some(dir) = stack.pop() {
        let mut iter = tokio::fs::read_dir(&dir).await?;
        while let Some(entry) = iter.next_entry().await? {
            let path = entry.path();
            let metadata = entry.metadata().await?;
            let is_dir = metadata.is_dir();
            if is_dir {
                stack.push(path.clone());
            }

            let archive_rel = path
                .strip_prefix(&vault_path)
                .map_err(|_| AppError::Other("Path resolution error".to_string()))?
                .to_string_lossy()
                .replace('\\', "/");
            let original_rel = path
                .strip_prefix(&archive_root)
                .map_err(|_| AppError::Other("Path resolution error".to_string()))?
                .to_string_lossy()
                .replace('\\', "/");

            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("(unnamed)")
                .to_string();

            let archived_at = metadata
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);

            entries.push(ArchiveEntry {
                archive_path: archive_rel,
                original_path: original_rel,
                name,
                size: if is_dir { 0 } else { metadata.len() },
                is_dir,
                archived_at,
            });
        }
    }

    // Newest first.
    entries.sort_by(|a, b| b.archived_at.cmp(&a.archived_at));
    Ok(entries)
}

/// Restore an archived file/folder to its original location.
/// Symmetric inverse of `archive_file`. Fails on collision.
#[tauri::command]
pub async fn restore_from_archive(
    archive_path: String,
    state: State<'_, Arc<AppState>>,
) -> Result<String, AppError> {
    let vault_path = get_vault_path_from_state(&state)?;
    let archived = validate_and_resolve_path(&vault_path, &archive_path)?;

    if !archived.exists() {
        return Err(AppError::NotFound(archive_path));
    }

    let archive_rel = archived
        .strip_prefix(&vault_path)
        .map_err(|_| AppError::InvalidPath("Path outside vault".to_string()))?;
    let mut components = archive_rel.components();
    let dot_archive = components.next();
    if dot_archive.and_then(|c| c.as_os_str().to_str()) != Some(".archive") {
        return Err(AppError::InvalidPath(
            "Path is not inside .archive/".to_string(),
        ));
    }
    let original_rel: std::path::PathBuf = components.collect();
    if original_rel.as_os_str().is_empty() {
        return Err(AppError::InvalidPath(
            "Cannot determine original path".to_string(),
        ));
    }
    let destination = vault_path.join(&original_rel);

    if destination.exists() {
        return Err(AppError::AlreadyExists(
            original_rel.to_string_lossy().to_string(),
        ));
    }
    if let Some(parent) = destination.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    tokio::fs::rename(&archived, &destination).await?;

    let original_str = canonicalise_rel(&original_rel.to_string_lossy());

    // Flip DB state back to Active (best-effort).
    let pool = get_db_pool_from_state(&state)?;
    let original_for_db = original_str.clone();
    let is_dir_for_db = destination.is_dir();
    let _ = db::run_blocking(&pool, move |conn| {
        if is_dir_for_db {
            let prefix = format!("{}/", original_for_db);
            conn.execute(
                "UPDATE files SET state = 'active' WHERE relative_path = ?1 OR relative_path LIKE ?2",
                rusqlite::params![original_for_db, format!("{}%", prefix)],
            )?;
        } else {
            FileRecord::update_state(conn, &original_for_db, FileState::Active)?;
        }
        Ok(())
    })
    .await;

    Ok(original_str)
}
