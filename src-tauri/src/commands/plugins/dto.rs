//! Wire DTOs shared between Rust and TypeScript for the plugin
//! subsystem. These types form the stable plugin API contract —
//! breaking changes here MUST bump the SDK `apiVersion`.

use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::BTreeMap;

// ── Manifest mirrors ──────────────────────────────────────────────────────
//
// Mirrors of the structs in `manifest.rs`, but separated so the
// wire format never accidentally couples to internal validation
// types. `serde(rename_all = "camelCase")` on every struct keeps
// the TS surface idiomatic without hand-written DTOs.

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PluginActivityBarItemDto {
    pub id: String,
    /// Resolved to an `asset://` URL by the scanner before the
    /// manifest crosses the IPC boundary, OR an inline icon spec
    /// like `lucide:layout-grid` which the frontend renders
    /// without fetching a file.
    pub icon_url: String,
    pub tooltip: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub placement: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PluginSidebarPanelDto {
    pub id: String,
    pub bundle_url: String,
    pub placement: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PluginEditorViewDto {
    pub extensions: Vec<String>,
    pub bundle_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PluginCommandDto {
    pub id: String,
    pub label: String,
    pub palette: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PluginSettingsPanelDto {
    pub label: String,
    pub bundle_url: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PluginContributesDto {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub activity_bar_item: Option<PluginActivityBarItemDto>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sidebar_panel: Option<PluginSidebarPanelDto>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub editor_views: Option<Vec<PluginEditorViewDto>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commands: Option<Vec<PluginCommandDto>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub settings_panel: Option<PluginSettingsPanelDto>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PluginCapabilitiesDto {
    pub required: Vec<String>,
    #[serde(default)]
    pub optional: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifestDto {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_app_version: Option<String>,
    pub api_version: String,
    pub capabilities: PluginCapabilitiesDto,
    pub contributes: PluginContributesDto,
}

// ── Scanner / install responses ───────────────────────────────────────────

/// One entry returned from [`scanner::scan_vault_plugins`]. The
/// frontend uses `plugin_dir` to construct the dynamic `import()`
/// URL via `convertFileSrc(plugin_dir + "/dist/index.js")`.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ScannedPlugin {
    pub manifest: PluginManifestDto,
    /// Absolute path to the plugin folder (vault-relative parent
    /// is `.zenvault/plugins/<id>/`). Frontend uses this to resolve
    /// bundle URLs.
    pub plugin_dir: String,
    /// Path to the entry bundle, defaults to
    /// `<plugin_dir>/dist/index.js`. Set explicitly so the frontend
    /// doesn't have to hard-code the convention.
    pub entry_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult {
    pub manifest: PluginManifestDto,
    pub plugin_dir: String,
    pub entry_path: String,
    /// True when an existing plugin with the same id was overwritten.
    pub replaced: bool,
}

// ── Broker request/response ───────────────────────────────────────────────

/// A single privileged action a plugin asks the host to perform.
///
/// `capability` MUST be one of the strings in
/// [`manifest::ALLOWED_CAPABILITIES`] AND MUST appear in the
/// plugin's granted capability list — the broker enforces both.
///
/// `payload` is a JSON-encoded string. Modelling it as a string
/// keeps the IPC contract specta-typeable (specta has no `Type`
/// impl for `serde_json::Value`) and forces both sides to be
/// explicit about serialisation — a plugin can't accidentally
/// rely on JS object reference identity surviving the wire.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PluginBackendRequest {
    pub plugin_id: String,
    pub api_version: String,
    pub capability: String,
    pub contract: String,
    pub action: String,
    pub payload_json: String,
}

/// Discriminated success/error to keep the frontend's typed wrapper
/// dead simple — `ok: true` means `data_json` is a valid encoded
/// payload for the contract+action, `ok: false` means look at
/// `error.code`.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", tag = "ok")]
pub enum PluginBackendResponse {
    #[serde(rename = "true")]
    Ok { data_json: String },
    #[serde(rename = "false")]
    Err { error: PluginBackendError },
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PluginBackendError {
    pub code: String,
    pub message: String,
}

impl PluginBackendError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

// ── Helper conversions ────────────────────────────────────────────────────

impl PluginManifestDto {
    /// Lookup table that the broker uses to verify a capability is
    /// granted before dispatch. Returns required ∪ optional.
    pub fn granted_capabilities(&self) -> BTreeMap<String, bool> {
        let mut out = BTreeMap::new();
        for cap in &self.capabilities.required {
            out.insert(cap.clone(), true);
        }
        for cap in &self.capabilities.optional {
            out.entry(cap.clone()).or_insert(true);
        }
        out
    }
}
