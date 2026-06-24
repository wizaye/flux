//! Domain types for the Flux file system contract.
//!
//! These types are shared between Rust and TypeScript via tauri-specta,
//! and form the stable API contract that both the frontend and plugins use.
use serde::{Deserialize, Serialize};
use specta::Type;

// ── Vault ─────────────────────────────────────────────────────────────────

/// Handle representing an open vault.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct VaultHandle {
    /// Absolute path to the vault root directory.
    pub path: String,
    /// Display name (derived from folder name).
    pub name: String,
    /// Total number of files indexed.
    pub file_count: u32,
    /// Timestamp when the vault was opened (Unix epoch ms).
    pub opened_at: i64,
}

// ── File System ───────────────────────────────────────────────────────────

/// File state in the vault lifecycle.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum FileState {
    /// Active file, indexed and searchable.
    Active,
    /// Archived file, hidden from main view but preserved.
    Archived,
    /// Trashed file, scheduled for deletion after retention period.
    Trashed,
}

impl FileState {
    /// Lower-case canonical string used in the `state` column of
    /// the `files` table. Pair with [`FileState::from_db_str`].
    pub fn as_str(&self) -> &'static str {
        match self {
            FileState::Active => "active",
            FileState::Archived => "archived",
            FileState::Trashed => "trashed",
        }
    }

    /// Parse the canonical lower-case string stored in SQLite.
    ///
    /// Unknown / corrupt values are treated as `Active` so a row
    /// that survives an upgrade with new states never disappears
    /// from the user's view. This is the symmetric inverse of
    /// [`FileState::as_str`].
    pub fn from_db_str(raw: &str) -> Self {
        match raw {
            "archived" => FileState::Archived,
            "trashed" => FileState::Trashed,
            _ => FileState::Active,
        }
    }
}

/// File or directory entry in the vault.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    /// Relative path from vault root.
    pub path: String,
    /// File or directory name (last component of path).
    pub name: String,
    /// Entry type.
    #[serde(rename = "type")]
    pub entry_type: EntryType,
    /// File state (only for files, not directories).
    pub state: Option<FileState>,
    /// File size in bytes (only for files).
    pub size: Option<u64>,
    /// Last modified timestamp (Unix epoch ms).
    pub modified_at: i64,
}

/// Type of file system entry.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum EntryType {
    File,
    Directory,
}

/// Flat file tree node with depth encoding for virtualized rendering.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FileTreeNode {
    /// Unique identifier (absolute path).
    pub id: String,
    /// Entry type.
    #[serde(rename = "type")]
    pub entry_type: EntryType,
    /// Display name.
    pub name: String,
    /// Depth in the tree (0 = vault root children).
    pub depth: u32,
    /// Parent ID (null for root-level entries).
    pub parent_id: Option<String>,
    /// Is this folder open? (only for directories)
    pub is_open: Option<bool>,
    /// File state (only for files).
    pub state: Option<FileState>,
    /// Number of children (only for directories).
    pub child_count: Option<u32>,
    /// File size in bytes (only for files).
    pub size: Option<u64>,
    /// Last modified timestamp (Unix epoch ms).
    pub modified_at: i64,
}

// ── File Operations ───────────────────────────────────────────────────────

/// Result of a file move operation.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MoveResult {
    /// New path after the move.
    pub new_path: String,
    /// Number of wikilinks that were rewritten in referrer files.
    pub links_healed: u32,
    /// Number of referrer files that were updated.
    pub files_updated: u32,
}

/// Result of a file rename operation.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RenameResult {
    /// New path after the rename.
    pub new_path: String,
    /// Number of wikilinks that were rewritten.
    pub links_healed: u32,
    /// Number of referrer files that were updated.
    pub files_updated: u32,
}

/// One entry in the trash bin (`.trash/YYYY-MM/...`).
///
/// The `trash_path` is the relative-to-vault path of the file as it
/// currently lives inside `.trash/`. The `original_path` is the path
/// the file had before deletion (without the `.trash/YYYY-MM/`
/// prefix) — that's where `restore_from_trash` puts it back.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TrashEntry {
    /// Where the file lives now, relative to the vault root.
    pub trash_path: String,
    /// Where it lived before deletion, relative to the vault root.
    pub original_path: String,
    /// Display name (last path component).
    pub name: String,
    /// File size in bytes.
    pub size: u64,
    /// When the file was moved to trash (Unix epoch ms — derived from
    /// the file's modified time after the rename).
    pub trashed_at: i64,
}

/// One entry in the archive (`.archive/...`). Archive is a soft-
/// retire bucket separate from trash — files put there are not
/// scheduled for janitor purge. Unlike `.trash/YYYY-MM/...`, the
/// archive preserves the original directory structure verbatim:
/// `.archive/notes/old/foo.md` came from `notes/old/foo.md`.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveEntry {
    /// Where the file lives now, relative to the vault root
    /// (always begins with `.archive/`).
    pub archive_path: String,
    /// Where it lived before archiving, relative to the vault root.
    pub original_path: String,
    /// Display name (last path component).
    pub name: String,
    /// File size in bytes (0 for directories).
    pub size: u64,
    /// True when this entry is a directory — archived folders are
    /// kept as folders (we never tar them up).
    pub is_dir: bool,
    /// When the file was archived (Unix epoch ms — derived from the
    /// file's modified time after the rename).
    pub archived_at: i64,
}

/// Single result row returned by `search_files`. The snippet is
/// pre-highlighted HTML with `<mark>` tags wrapping the match — the
/// frontend renders it verbatim inside the result card.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub relative_path: String,
    pub title: String,
    pub snippet: String,
}

/// Lightweight filesystem metadata for a single file or directory.
/// Returned by `get_file_metadata` — used by the sidebar's hover
/// tooltip so we don't have to bake created/modified into every
/// `FileTreeNode` up front.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FileMetadata {
    /// File size in bytes. `0` for directories.
    pub size: u64,
    /// Created timestamp (Unix epoch ms). Some filesystems don't
    /// track this and will fall back to `modified_at`.
    pub created_at: i64,
    /// Last modified timestamp (Unix epoch ms).
    pub modified_at: i64,
    /// True when the path is a directory.
    pub is_dir: bool,
}

// ── Errors ────────────────────────────────────────────────────────────────

/// Application-level errors exposed to the frontend.
#[derive(Debug, thiserror::Error, Serialize, Deserialize, Type)]
#[serde(tag = "kind", content = "message")]
pub enum AppError {
    /// No vault is currently open.
    #[error("No vault is open")]
    NoVaultOpen,

    /// Vault path does not exist or is not a directory.
    #[error("Invalid vault path: {0}")]
    InvalidVaultPath(String),

    /// File or directory not found.
    #[error("Not found: {0}")]
    NotFound(String),

    /// File or directory already exists.
    #[error("Already exists: {0}")]
    AlreadyExists(String),

    /// Permission denied.
    #[error("Permission denied: {0}")]
    PermissionDenied(String),

    /// I/O error.
    #[error("I/O error: {0}")]
    Io(String),

    /// Database error.
    #[error("Database error: {0}")]
    Database(String),

    /// Invalid file path (e.g., contains `..`, absolute path outside vault).
    #[error("Invalid path: {0}")]
    InvalidPath(String),

    /// Generic error.
    #[error("{0}")]
    Other(String),
}

// Implement From conversions for common error types
impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        use std::io::ErrorKind;
        match err.kind() {
            ErrorKind::NotFound => AppError::NotFound(err.to_string()),
            ErrorKind::PermissionDenied => AppError::PermissionDenied(err.to_string()),
            ErrorKind::AlreadyExists => AppError::AlreadyExists(err.to_string()),
            _ => AppError::Io(err.to_string()),
        }
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(err: rusqlite::Error) -> Self {
        AppError::Database(err.to_string())
    }
}

impl From<r2d2::Error> for AppError {
    fn from(err: r2d2::Error) -> Self {
        AppError::Database(err.to_string())
    }
}
