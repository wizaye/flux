//! Tauri command shims for the plugin subsystem. Every shim is a
//! thin adapter that decodes the args, fetches `AppState`, calls
//! the pure module, and returns the result. The bulk of behaviour
//! lives in the sibling modules.

use crate::commands::plugins::broker::dispatch;
use crate::commands::plugins::dto::{
    InstallResult, PluginBackendRequest, PluginBackendResponse, ScannedPlugin,
};
use crate::commands::plugins::install::{
    install_from_folder, install_from_zip, uninstall as uninstall_impl,
};
use crate::commands::plugins::scanner;
use crate::state::AppState;
use crate::types::AppError;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::State;

/// Scan the open vault for installed plugins.
///
/// Returns an empty list when no vault is open OR when
/// `.zenvault/plugins/` does not exist yet. Plugins that fail to
/// parse are skipped — see [`scanner::scan_vault_plugins`] for the
/// rationale.
#[tauri::command]
pub async fn scan_plugins(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<ScannedPlugin>, AppError> {
    let vault = match state.vault_path.lock().unwrap().clone() {
        Some(p) => PathBuf::from(p),
        None => return Ok(vec![]),
    };
    Ok(scanner::scan_vault_plugins(&vault))
}

/// Install a plugin from a local directory (Settings → Community
/// plugins → "Install from folder"). The source is staged + fully
/// validated before being moved into `.zenvault/plugins/<id>`.
#[tauri::command]
pub async fn install_plugin_from_folder(
    src: String,
    state: State<'_, Arc<AppState>>,
) -> Result<InstallResult, AppError> {
    install_from_folder(&PathBuf::from(src), &state)
}

/// Install a plugin from a `.zip` archive (the standard
/// distribution format for community plugins).
#[tauri::command]
pub async fn install_plugin_from_zip(
    zip_path: String,
    state: State<'_, Arc<AppState>>,
) -> Result<InstallResult, AppError> {
    install_from_zip(&PathBuf::from(zip_path), &state)
}

/// Uninstall a plugin by id. Removes the on-disk folder and wipes
/// the plugin's scoped storage rows.
#[tauri::command]
pub async fn uninstall_plugin(
    id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), AppError> {
    uninstall_impl(&id, &state)
}

/// Privileged dispatch from a plugin's `createPluginHost()` shim
/// into a host contract handler. See [`dispatch`] for the
/// validation pipeline.
#[tauri::command]
pub async fn plugin_backend_call(
    req: PluginBackendRequest,
    state: State<'_, Arc<AppState>>,
) -> Result<PluginBackendResponse, AppError> {
    let vault = match state.vault_path.lock().unwrap().clone() {
        Some(p) => PathBuf::from(p),
        None => {
            return Ok(PluginBackendResponse::Err {
                error: crate::commands::plugins::dto::PluginBackendError::new(
                    "no_vault",
                    "no vault is open",
                ),
            });
        }
    };
    // Re-derive the manifest from disk on every call so capability
    // edits in the user's installed plugin take effect without an
    // app reload. Cheap (≤256 KiB JSON per call).
    let plugins = scanner::scan_vault_plugins(&vault);
    let manifest = match plugins.into_iter().find(|p| p.manifest.id == req.plugin_id) {
        Some(p) => p.manifest,
        None => {
            return Ok(PluginBackendResponse::Err {
                error: crate::commands::plugins::dto::PluginBackendError::new(
                    "unknown_plugin",
                    format!("plugin {:?} is not installed", req.plugin_id),
                ),
            });
        }
    };
    let inner: Arc<AppState> = Arc::clone(&state);
    Ok(dispatch(req, manifest, inner).await)
}
