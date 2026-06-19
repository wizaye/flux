//! File system operations.
//!
//! Provides CRUD operations for files and directories with atomic writes,
//! wikilink healing, and state management.

use crate::db::{self, repo::FileRecord};
use crate::state::AppState;
use crate::types::{AppError, EntryType, FileEntry, FileMetadata, FileState, FileTreeNode, MoveResult, RenameResult, TrashEntry};
use std::io::Write;
use std::path::Path;
use std::sync::Arc;
use tauri::State;
use uuid::Uuid;

pub mod common;

#[cfg(test)]
mod tests;

use common::{get_db_pool_from_state, get_vault_path_from_state, validate_and_resolve_path};

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

    db::run_blocking(&pool, move |conn| {
        // Check if file exists in database
        if let Some(mut record) = FileRecord::get_by_path(conn, &path)? {
            // Update existing record
            record.title = title;
            record.blake3_hash = blake3_hash;
            record.modified_at = modified_at;
            record.size_bytes = size_bytes;
            FileRecord::update_by_path(conn, &path, &record)?;
        } else {
            // Insert new record
            let record = FileRecord {
                id: Uuid::now_v7(),
                relative_path: path,
                title,
                blake3_hash,
                modified_at,
                state: FileState::Active,
                size_bytes,
                created_at: modified_at,
            };
            FileRecord::insert(conn, &record)?;
        }
        Ok(())
    })
    .await
    .map_err(|e| AppError::Database(e.to_string()))?;

    Ok(())
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
    let path_for_db = path.clone();
    if let Err(e) = db::run_blocking(&pool, move |conn| {
        FileRecord::update_state(conn, &path_for_db, FileState::Trashed)
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
    let pool = get_db_pool_from_state(&state)?;
    let dst_clone = dst.clone();
    let src_for_db = src.clone();
    if let Err(e) = db::run_blocking(&pool, move |conn| {
        FileRecord::update_path(conn, &src_for_db, &dst_clone)
    })
    .await
    {
        tracing::warn!("move_file: DB index update failed (FS op succeeded): {e}");
    }

    // TODO: Implement wikilink healing (Feature 20)
    // For now, return zero healed links
    Ok(MoveResult {
        new_path: dst,
        links_healed: 0,
        files_updated: 0,
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

        let relative = entry_path
            .strip_prefix(&vault_path)
            .map_err(|_| AppError::Other("Path resolution error".to_string()))?
            .to_str()
            .ok_or_else(|| AppError::Other("Invalid UTF-8 in path".to_string()))?
            .to_string();

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

/// Extract title from file content (frontmatter or filename fallback).
fn extract_title(_content: &str, path: &str) -> String {
    // TODO: Parse frontmatter YAML for title field
    // For now, use filename without extension
    Path::new(path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Untitled")
        .to_string()
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

        // Calculate relative path from vault root (used as id for all operations)
        let relative = path
            .strip_prefix(vault_path)
            .map_err(|_| AppError::Other("Path resolution error".to_string()))?
            .to_str()
            .ok_or_else(|| AppError::Other("Invalid UTF-8 in path".to_string()))?
            .to_string();

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
    let original_for_db = original_path_str.clone();
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
