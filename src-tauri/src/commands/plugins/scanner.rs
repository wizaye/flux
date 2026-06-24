//! Filesystem scanner — walks `<vault>/.zenvault/plugins/` and
//! returns a [`ScannedPlugin`] entry for every subdirectory whose
//! `manifest.json` passes [`manifest::parse_manifest`].
//!
//! Invariants:
//!   * One folder per plugin id; the folder name MUST equal the
//!     manifest's `id` field — mismatch is a hard error so the user
//!     can't end up with two enables for what they think is one
//!     plugin.
//!   * Failed parses are logged + skipped; one bad plugin does not
//!     poison the whole scan.

use crate::commands::plugins::dto::ScannedPlugin;
use crate::commands::plugins::manifest::{parse_manifest, ManifestError};
use std::path::{Path, PathBuf};

pub const PLUGINS_SUBDIR: &str = ".zenvault/plugins";
pub const ENTRY_REL_PATH: &str = "dist/index.js";

/// Resolve the plugins directory inside a vault root. Caller does
/// not need to ensure it exists — the scanner just reports an empty
/// list in that case.
pub fn plugins_dir(vault_root: &Path) -> PathBuf {
    vault_root.join(".zenvault").join("plugins")
}

/// Scan a vault for installed plugins. Pure function over a path
/// — no `AppState`, no async, no IPC — so it is trivially
/// testable.
pub fn scan_vault_plugins(vault_root: &Path) -> Vec<ScannedPlugin> {
    let dir = plugins_dir(vault_root);
    if !dir.is_dir() {
        return vec![];
    }

    let read = match std::fs::read_dir(&dir) {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!(?dir, error = %e, "plugin scan: read_dir failed");
            return vec![];
        }
    };

    let mut out = Vec::new();
    for entry in read.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        match load_plugin_at(&path) {
            Ok(scanned) => out.push(scanned),
            Err(e) => {
                tracing::warn!(?path, error = %e, "plugin scan: skipped");
            }
        }
    }
    // Stable order so the frontend sees a deterministic load
    // sequence run-to-run (helps reproducible bug reports).
    out.sort_by(|a, b| a.manifest.id.cmp(&b.manifest.id));
    out
}

/// Load a single plugin folder. Validates that the folder name
/// matches the manifest id and that the entry bundle exists.
pub fn load_plugin_at(plugin_dir: &Path) -> Result<ScannedPlugin, ManifestError> {
    let folder_name = plugin_dir
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| ManifestError::Invalid {
            field: "<folder>",
            reason: "non-utf8 folder name".into(),
        })?
        .to_string();

    let manifest = parse_manifest(plugin_dir)?;
    if manifest.id != folder_name {
        return Err(ManifestError::Invalid {
            field: "id",
            reason: format!(
                "folder name {folder_name:?} does not match manifest id {:?}",
                manifest.id
            ),
        });
    }

    let entry_path = plugin_dir.join(ENTRY_REL_PATH);
    if !entry_path.is_file() {
        return Err(ManifestError::Invalid {
            field: "<entry>",
            reason: format!(
                "missing entry bundle at {}",
                entry_path.display()
            ),
        });
    }

    Ok(ScannedPlugin {
        manifest,
        plugin_dir: plugin_dir.to_string_lossy().to_string(),
        entry_path: entry_path.to_string_lossy().to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::plugins::manifest::HOST_API_VERSION;
    use std::fs;
    use tempfile::tempdir;

    fn write_plugin(root: &Path, id: &str, with_entry: bool) {
        let dir = plugins_dir(root).join(id);
        fs::create_dir_all(dir.join("dist")).unwrap();
        let manifest = serde_json::json!({
            "id": id,
            "name": id,
            "version": "0.1.0",
            "author": "tests",
            "description": "test",
            "apiVersion": HOST_API_VERSION,
            "capabilities": { "required": [] },
            "contributes": {},
        });
        fs::write(dir.join("manifest.json"), manifest.to_string()).unwrap();
        if with_entry {
            fs::write(dir.join("dist").join("index.js"), "export const Manifest = {};").unwrap();
        }
    }

    #[test]
    fn empty_vault_returns_empty() {
        let tmp = tempdir().unwrap();
        let plugins = scan_vault_plugins(tmp.path());
        assert!(plugins.is_empty());
    }

    #[test]
    fn valid_plugin_is_discovered() {
        let tmp = tempdir().unwrap();
        write_plugin(tmp.path(), "demo", true);
        let plugins = scan_vault_plugins(tmp.path());
        assert_eq!(plugins.len(), 1);
        assert_eq!(plugins[0].manifest.id, "demo");
        assert!(plugins[0].entry_path.ends_with("index.js"));
    }

    #[test]
    fn entry_missing_skips_plugin() {
        let tmp = tempdir().unwrap();
        write_plugin(tmp.path(), "broken", false);
        assert!(scan_vault_plugins(tmp.path()).is_empty());
    }

    #[test]
    fn folder_id_mismatch_rejected() {
        let tmp = tempdir().unwrap();
        let dir = plugins_dir(tmp.path()).join("wrong-folder");
        fs::create_dir_all(dir.join("dist")).unwrap();
        let manifest = serde_json::json!({
            "id": "real-id",
            "name": "x",
            "version": "0.1.0",
            "author": "t",
            "description": "d",
            "apiVersion": HOST_API_VERSION,
            "capabilities": { "required": [] },
            "contributes": {},
        });
        fs::write(dir.join("manifest.json"), manifest.to_string()).unwrap();
        fs::write(dir.join("dist/index.js"), "").unwrap();
        assert!(scan_vault_plugins(tmp.path()).is_empty());
    }

    #[test]
    fn plugins_returned_sorted_by_id() {
        let tmp = tempdir().unwrap();
        write_plugin(tmp.path(), "zeta", true);
        write_plugin(tmp.path(), "alpha", true);
        let plugins = scan_vault_plugins(tmp.path());
        let ids: Vec<&str> = plugins.iter().map(|p| p.manifest.id.as_str()).collect();
        assert_eq!(ids, vec!["alpha", "zeta"]);
    }
}
