//! Plugin install / uninstall.
//!
//! Two install transports today, both with byte-for-byte the same
//! safety story: the source contents are first staged into a temp
//! folder, parsed + validated end-to-end, and only then atomically
//! renamed into the plugin slot. A bad payload never leaves a
//! half-written plugin folder behind.
//!
//! Source transports:
//!   * **Folder** — `install_from_folder(src_dir)` copies a local
//!     directory the user picked. Used during plugin development
//!     and for sideloading from a friend's USB stick.
//!   * **Zip** — `install_from_zip(zip_path)` unzips the archive.
//!     The archive is expected to contain a single top-level
//!     `manifest.json` + `dist/`. Trailing slashes inside the zip
//!     are normalised; entries that try to escape via `..` are
//!     rejected outright.
//!
//! Uninstall is `rmtree(<vault>/.zenvault/plugins/<id>)` plus a
//! sweep of [`crate::commands::plugins::storage`] rows owned by
//! that plugin (CASCADE-like behaviour without a real FK).

use crate::commands::fs::common::{get_db_pool, get_vault_path};
use crate::commands::plugins::dto::{InstallResult, ScannedPlugin};
use crate::commands::plugins::manifest::parse_manifest;
use crate::commands::plugins::scanner::{load_plugin_at, plugins_dir, ENTRY_REL_PATH};
use crate::commands::plugins::storage;
use crate::state::AppState;
use crate::types::AppError;
use std::fs;
use std::io::{self, Read};
use std::path::{Component, Path, PathBuf};

/// Maximum compressed zip size accepted by the installer (8 MiB).
/// Plugins are presentation code, not media — anything larger is
/// almost certainly malicious or misuses the plugin slot.
pub const MAX_ZIP_BYTES: u64 = 8 * 1024 * 1024;

/// Maximum total uncompressed size of all zip entries combined.
/// Caps zip-bomb expansion at 32 MiB.
pub const MAX_UNCOMPRESSED_BYTES: u64 = 32 * 1024 * 1024;

/// Install a plugin by copying a local folder into the vault.
pub fn install_from_folder(src: &Path, state: &AppState) -> Result<InstallResult, AppError> {
    if !src.is_dir() {
        return Err(AppError::InvalidPath(format!(
            "plugin source is not a directory: {}",
            src.display()
        )));
    }
    let staging = stage_dir(state)?;
    copy_tree(src, &staging)?;
    finalise_install(staging, state)
}

/// Install a plugin by unzipping a `.zip` archive into the vault.
pub fn install_from_zip(zip_path: &Path, state: &AppState) -> Result<InstallResult, AppError> {
    let meta = fs::metadata(zip_path).map_err(AppError::from)?;
    if meta.len() > MAX_ZIP_BYTES {
        return Err(AppError::Other(format!(
            "plugin zip too large ({} > {} bytes)",
            meta.len(),
            MAX_ZIP_BYTES
        )));
    }
    let staging = stage_dir(state)?;
    extract_zip(zip_path, &staging)?;
    finalise_install(staging, state)
}

/// Install a plugin from an in-memory byte buffer. Used by the
/// marketplace install flow — the frontend downloads a zip from
/// a registry URL, optionally verifies its sha256 against an
/// `expected_sha256` digest using WebCrypto, then hands the bytes
/// here.
///
/// The host doesn't compute sha256 itself (we'd need to add the
/// `sha2` crate). The frontend SHOULD verify the digest before
/// calling this; if the user pasted a raw URL with no checksum,
/// this command still works — they are explicitly trusting the
/// URL they pasted, the same as `install_from_folder`.
pub fn install_from_bytes(
    bytes: &[u8],
    state: &AppState,
) -> Result<InstallResult, AppError> {
    if bytes.len() as u64 > MAX_ZIP_BYTES {
        return Err(AppError::Other(format!(
            "plugin zip too large ({} > {} bytes)",
            bytes.len(),
            MAX_ZIP_BYTES
        )));
    }
    // Stage the bytes into a temp `.zip` so `install_from_zip` can
    // open it via the standard zip reader. The temp file lives
    // inside the vault's plugins-staging dir; we clean up after
    // the install attempt regardless of outcome.
    let vault = get_vault_path(state)?;
    let tmp_root = vault.join(".zenvault").join("plugins-staging");
    fs::create_dir_all(&tmp_root)?;
    let tmp = tmp_root.join(format!("{}.zip", uuid::Uuid::new_v4().simple()));
    fs::write(&tmp, bytes)?;
    let result = install_from_zip(&tmp, state);
    let _ = fs::remove_file(&tmp);
    result
}

/// Remove a plugin from disk + wipe its scoped storage rows.
pub fn uninstall(id: &str, state: &AppState) -> Result<(), AppError> {
    let vault = get_vault_path(state)?;
    let target = plugins_dir(&vault).join(id);
    if target.is_dir() {
        fs::remove_dir_all(&target).map_err(AppError::from)?;
    }
    // Best-effort cleanup of scoped storage. A missing pool here
    // means the vault was closed mid-uninstall — uncommon, and the
    // storage rows are namespaced by id so they're harmless either
    // way. Surface a warning so it shows up in tracing.
    if let Ok(pool) = get_db_pool(state) {
        if let Err(e) = storage::clear_plugin_storage_blocking(&pool, id) {
            tracing::warn!(plugin = id, error = ?e, "uninstall: storage cleanup failed");
        }
    }
    Ok(())
}

// ── Staging + finalisation ────────────────────────────────────────────────

fn stage_dir(state: &AppState) -> Result<PathBuf, AppError> {
    let vault = get_vault_path(state)?;
    let root = vault.join(".zenvault").join("plugins-staging");
    fs::create_dir_all(&root)?;
    // Unique per-install temp folder. uuid v4 instead of v7 because
    // we never need ordering — these folders live for milliseconds.
    let id = uuid::Uuid::new_v4().simple().to_string();
    let staging = root.join(id);
    fs::create_dir(&staging)?;
    Ok(staging)
}

fn finalise_install(staging: PathBuf, state: &AppState) -> Result<InstallResult, AppError> {
    let scoped = ScopedTempDir(Some(staging));

    // Validate the staged payload BEFORE moving it. We use
    // `parse_manifest` here (not `load_plugin_at`) because the
    // staging folder is named with a UUID and would fail the
    // folder-name-matches-id check. Once the move succeeds we run
    // `load_plugin_at` against the final destination so the final
    // record is the same one the scanner would produce.
    let manifest = parse_manifest(scoped.path()).map_err(AppError::from)?;
    enforce_entry_present(scoped.path())?;

    let vault = get_vault_path(state)?;
    let dest = plugins_dir(&vault).join(&manifest.id);
    fs::create_dir_all(dest.parent().unwrap())?;

    let replaced = dest.exists();
    if replaced {
        // Move-then-delete instead of delete-then-rename so a
        // crash leaves the previous version intact on disk.
        let trash = dest
            .parent()
            .unwrap()
            .join(format!(".trash-{}", uuid::Uuid::new_v4().simple()));
        fs::rename(&dest, &trash).map_err(AppError::from)?;
        if let Err(e) = fs::remove_dir_all(&trash) {
            tracing::warn!(?trash, error = %e, "install: failed to drop replaced plugin");
        }
    }

    // Move staging → final.
    fs::rename(scoped.path(), &dest).map_err(AppError::from)?;
    let _ = scoped.dismiss();

    // Re-load from the final destination so the entry_path reflects
    // the real folder, not the staging one.
    let final_scanned: ScannedPlugin = load_plugin_at(&dest).map_err(AppError::from)?;

    Ok(InstallResult {
        manifest: final_scanned.manifest,
        plugin_dir: final_scanned.plugin_dir,
        entry_path: final_scanned.entry_path,
        replaced,
    })
}

fn enforce_entry_present(dir: &Path) -> Result<(), AppError> {
    let entry = dir.join(ENTRY_REL_PATH);
    if !entry.is_file() {
        return Err(AppError::Other(format!(
            "plugin payload is missing {}",
            ENTRY_REL_PATH
        )));
    }
    Ok(())
}

// ── Tree copy ─────────────────────────────────────────────────────────────

fn copy_tree(src: &Path, dst: &Path) -> Result<(), AppError> {
    fs::create_dir_all(dst)?;
    for entry in walkdir::WalkDir::new(src)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
    {
        let rel = entry.path().strip_prefix(src).unwrap();
        if rel.as_os_str().is_empty() {
            continue;
        }
        let target = dst.join(rel);
        let ft = entry.file_type();
        if ft.is_dir() {
            fs::create_dir_all(&target)?;
        } else if ft.is_file() {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(entry.path(), &target)?;
        }
        // Symlinks deliberately skipped — plugins ship plain files.
    }
    Ok(())
}

// ── Zip extraction (with traversal + bomb guards) ─────────────────────────

fn extract_zip(zip_path: &Path, dst: &Path) -> Result<(), AppError> {
    let file = fs::File::open(zip_path)?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| AppError::Other(format!("invalid zip: {e}")))?;

    // Two-pass: first scan all entries to detect bombs / escapes,
    // then write. We don't want a partial extraction on disk if the
    // archive is rejected mid-way.
    let mut total: u64 = 0;
    let mut sanitized: Vec<(usize, PathBuf, bool)> = Vec::with_capacity(archive.len());
    for i in 0..archive.len() {
        let zf = archive
            .by_index(i)
            .map_err(|e| AppError::Other(format!("invalid zip entry {i}: {e}")))?;
        let name = zf.name().to_string();
        if let Some(rel) = sanitize_zip_path(&name)? {
            total = total
                .checked_add(zf.size())
                .ok_or_else(|| AppError::Other("zip size overflow".into()))?;
            if total > MAX_UNCOMPRESSED_BYTES {
                return Err(AppError::Other(format!(
                    "uncompressed zip exceeds {MAX_UNCOMPRESSED_BYTES} bytes (zip bomb?)"
                )));
            }
            sanitized.push((i, rel, zf.is_dir()));
        }
    }

    for (i, rel, is_dir) in sanitized {
        let target = dst.join(&rel);
        let mut zf = archive
            .by_index(i)
            .map_err(|e| AppError::Other(format!("invalid zip entry {i}: {e}")))?;
        if is_dir {
            fs::create_dir_all(&target)?;
            continue;
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut out = fs::File::create(&target)?;
        io::copy(&mut zf, &mut out)?;
    }
    Ok(())
}

/// Translate a zip entry name into a safe relative path under the
/// extraction root. Returns `None` for entries that should be
/// dropped silently (empty names, leading-`/` artefacts from
/// macOS).
fn sanitize_zip_path(raw: &str) -> Result<Option<PathBuf>, AppError> {
    if raw.is_empty() {
        return Ok(None);
    }
    if raw.contains('\0') {
        return Err(AppError::InvalidPath("null byte in zip entry".into()));
    }
    let normalised = raw.replace('\\', "/");
    let mut buf = PathBuf::new();
    for comp in Path::new(&normalised).components() {
        match comp {
            Component::Normal(s) => buf.push(s),
            Component::CurDir => {}
            // Reject anything that could escape the staging dir.
            Component::ParentDir | Component::Prefix(_) | Component::RootDir => {
                return Err(AppError::InvalidPath(format!(
                    "zip entry {raw:?} escapes plugin folder"
                )));
            }
        }
    }
    if buf.as_os_str().is_empty() {
        return Ok(None);
    }
    Ok(Some(buf))
}

// ── Tiny RAII scoped temp dir so a panic in finalise_install cleans up ───

struct ScopedTempDir(Option<PathBuf>);

impl ScopedTempDir {
    fn path(&self) -> &Path {
        self.0.as_ref().expect("staging dir consumed")
    }
    fn dismiss(mut self) -> Option<PathBuf> {
        self.0.take()
    }
}

impl Drop for ScopedTempDir {
    fn drop(&mut self) {
        if let Some(p) = self.0.take() {
            let _ = fs::remove_dir_all(&p);
        }
    }
}

// Allow callers that need to peek at a Read for sniffing.
#[allow(dead_code)]
fn read_to_vec(path: &Path) -> io::Result<Vec<u8>> {
    let mut buf = Vec::new();
    fs::File::open(path)?.read_to_end(&mut buf)?;
    Ok(buf)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_drops_empty() {
        assert!(sanitize_zip_path("").unwrap().is_none());
    }

    #[test]
    fn sanitize_drops_dotslash() {
        assert!(sanitize_zip_path("./").unwrap().is_none());
    }

    #[test]
    fn sanitize_rejects_parent() {
        assert!(sanitize_zip_path("../etc/passwd").is_err());
    }

    #[test]
    fn sanitize_rejects_absolute() {
        assert!(sanitize_zip_path("/etc/passwd").is_err());
    }

    #[test]
    fn sanitize_normalises_backslash() {
        let p = sanitize_zip_path("dist\\index.js").unwrap().unwrap();
        assert_eq!(p, PathBuf::from("dist/index.js"));
    }
}
