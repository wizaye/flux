//! Manifest parsing + validation. The single chokepoint between
//! "raw JSON the user dropped in their vault" and "trusted DTO the
//! rest of the app uses."
//!
//! Rules enforced here (each is a defence-in-depth measure, not a
//! convenience check):
//!
//! 1. Schema: every required field present, types match, unknown
//!    fields rejected so a typo in the manifest never silently
//!    becomes a "no-op contribution".
//! 2. `id` is `[a-z0-9][a-z0-9._-]{0,63}` — restricts what becomes
//!    a folder name on disk AND what becomes a localStorage key
//!    prefix on the frontend.
//! 3. `apiVersion` is exactly `"1.0"` today — the host bumps this
//!    when the SDK contract breaks. Plugins built against a future
//!    SDK refuse to load on this host instead of half-working.
//! 4. Every capability string is in [`ALLOWED_CAPABILITIES`].
//!    Unknown capabilities are a hard error — the user MUST NOT
//!    be asked to grant something the host can't actually enforce.
//! 5. `bundleUrl` / `iconUrl` are vault-relative and stay inside
//!    the plugin directory (no `..`, no leading `/`, no scheme).

use crate::commands::plugins::dto::{
    PluginActivityBarItemDto, PluginCapabilitiesDto, PluginCommandDto, PluginContributesDto,
    PluginEditorViewDto, PluginManifestDto, PluginSettingsPanelDto, PluginSidebarPanelDto,
};
use crate::types::AppError;
use std::path::Path;

/// API version the host implements. Plugins MUST declare a matching
/// string. Bump the major segment on every breaking change to the
/// SDK (manifest schema, host contract surface, or capability
/// semantics).
pub const HOST_API_VERSION: &str = "1.0";

/// Canonical list of capabilities the host knows how to enforce.
/// Adding a capability here MUST be paired with a matching handler
/// in `broker.rs` — otherwise the host will accept a grant request
/// it cannot honour.
pub const ALLOWED_CAPABILITIES: &[&str] = &[
    "vault.read",
    "vault.write",
    "vault.list",
    "workspace.notice",
    "workspace.open",
    "workspace.reveal",
    "search.query",
    "plugin.storage.read",
    "plugin.storage.write",
];

/// Largest allowed manifest in bytes. Plugins cannot ship a
/// gigabyte JSON file as a DoS vector against the scanner.
pub const MAX_MANIFEST_BYTES: u64 = 256 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum ManifestError {
    #[error("manifest.json not found at {0}")]
    NotFound(String),
    #[error("manifest.json is too large ({0} bytes, limit {1})")]
    TooLarge(u64, u64),
    #[error("manifest.json is not valid JSON: {0}")]
    Parse(String),
    #[error("manifest field {field} is invalid: {reason}")]
    Invalid { field: &'static str, reason: String },
    #[error("unsupported apiVersion {0} (host implements {1})")]
    UnsupportedApi(String, &'static str),
    #[error("unknown capability {0}")]
    UnknownCapability(String),
    #[error("io error reading manifest: {0}")]
    Io(#[from] std::io::Error),
}

impl From<ManifestError> for AppError {
    fn from(err: ManifestError) -> Self {
        AppError::Other(format!("manifest: {err}"))
    }
}

/// Read + validate the manifest at `<plugin_dir>/manifest.json`.
pub fn parse_manifest(plugin_dir: &Path) -> Result<PluginManifestDto, ManifestError> {
    let path = plugin_dir.join("manifest.json");
    if !path.exists() {
        return Err(ManifestError::NotFound(path.display().to_string()));
    }
    let meta = std::fs::metadata(&path)?;
    if meta.len() > MAX_MANIFEST_BYTES {
        return Err(ManifestError::TooLarge(meta.len(), MAX_MANIFEST_BYTES));
    }
    let raw = std::fs::read_to_string(&path)?;
    let value: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| ManifestError::Parse(e.to_string()))?;
    validate(value)
}

/// Pure validator over already-parsed JSON. Split out so tests
/// can hit it without touching disk.
pub fn validate(value: serde_json::Value) -> Result<PluginManifestDto, ManifestError> {
    let obj = value.as_object().ok_or_else(|| ManifestError::Invalid {
        field: "<root>",
        reason: "expected JSON object".into(),
    })?;

    let id = req_string(obj, "id")?;
    if !is_valid_id(&id) {
        return Err(ManifestError::Invalid {
            field: "id",
            reason: format!(
                "{id:?} must be 1-64 chars of [a-z0-9._-] starting with [a-z0-9]"
            ),
        });
    }

    let api_version = req_string(obj, "apiVersion")?;
    if api_version != HOST_API_VERSION {
        return Err(ManifestError::UnsupportedApi(api_version, HOST_API_VERSION));
    }

    let capabilities = parse_capabilities(obj.get("capabilities"))?;
    for cap in capabilities
        .required
        .iter()
        .chain(capabilities.optional.iter())
    {
        if !ALLOWED_CAPABILITIES.contains(&cap.as_str()) {
            return Err(ManifestError::UnknownCapability(cap.clone()));
        }
    }

    let contributes = parse_contributes(obj.get("contributes"))?;

    Ok(PluginManifestDto {
        id,
        name: req_string(obj, "name")?,
        version: req_string(obj, "version")?,
        author: req_string(obj, "author")?,
        description: req_string(obj, "description")?,
        min_app_version: opt_string(obj, "minAppVersion"),
        api_version,
        capabilities,
        contributes,
    })
}

fn parse_capabilities(
    raw: Option<&serde_json::Value>,
) -> Result<PluginCapabilitiesDto, ManifestError> {
    let Some(value) = raw else {
        return Ok(PluginCapabilitiesDto::default());
    };
    let obj = value.as_object().ok_or_else(|| ManifestError::Invalid {
        field: "capabilities",
        reason: "expected object".into(),
    })?;
    Ok(PluginCapabilitiesDto {
        required: opt_string_array(obj, "required").unwrap_or_default(),
        optional: opt_string_array(obj, "optional").unwrap_or_default(),
    })
}

fn parse_contributes(
    raw: Option<&serde_json::Value>,
) -> Result<PluginContributesDto, ManifestError> {
    let Some(value) = raw else {
        return Ok(PluginContributesDto::default());
    };
    let obj = value.as_object().ok_or_else(|| ManifestError::Invalid {
        field: "contributes",
        reason: "expected object".into(),
    })?;

    let mut out = PluginContributesDto::default();

    if let Some(item) = obj.get("activityBarItem") {
        out.activity_bar_item = Some(parse_activity_bar_item(item)?);
    }
    if let Some(panel) = obj.get("sidebarPanel") {
        out.sidebar_panel = Some(parse_sidebar_panel(panel)?);
    }
    if let Some(views) = obj.get("editorViews") {
        let arr = views.as_array().ok_or_else(|| ManifestError::Invalid {
            field: "contributes.editorViews",
            reason: "expected array".into(),
        })?;
        let mut parsed = Vec::with_capacity(arr.len());
        for v in arr {
            parsed.push(parse_editor_view(v)?);
        }
        out.editor_views = Some(parsed);
    }
    if let Some(cmds) = obj.get("commands") {
        let arr = cmds.as_array().ok_or_else(|| ManifestError::Invalid {
            field: "contributes.commands",
            reason: "expected array".into(),
        })?;
        let mut parsed = Vec::with_capacity(arr.len());
        for v in arr {
            parsed.push(parse_command(v)?);
        }
        out.commands = Some(parsed);
    }
    if let Some(panel) = obj.get("settingsPanel") {
        out.settings_panel = Some(parse_settings_panel(panel)?);
    }
    Ok(out)
}

fn parse_activity_bar_item(
    value: &serde_json::Value,
) -> Result<PluginActivityBarItemDto, ManifestError> {
    let obj = value.as_object().ok_or_else(|| ManifestError::Invalid {
        field: "contributes.activityBarItem",
        reason: "expected object".into(),
    })?;
    let icon_url = req_string(obj, "iconUrl").map_err(|_| ManifestError::Invalid {
        field: "contributes.activityBarItem.iconUrl",
        reason: "required".into(),
    })?;
    validate_asset_ref("contributes.activityBarItem.iconUrl", &icon_url)?;
    Ok(PluginActivityBarItemDto {
        id: req_string(obj, "id")?,
        icon_url,
        tooltip: req_string(obj, "tooltip")?,
        placement: opt_string(obj, "placement"),
    })
}

fn parse_sidebar_panel(value: &serde_json::Value) -> Result<PluginSidebarPanelDto, ManifestError> {
    let obj = value.as_object().ok_or_else(|| ManifestError::Invalid {
        field: "contributes.sidebarPanel",
        reason: "expected object".into(),
    })?;
    let bundle = req_string(obj, "bundleUrl")?;
    validate_asset_ref("contributes.sidebarPanel.bundleUrl", &bundle)?;
    Ok(PluginSidebarPanelDto {
        id: req_string(obj, "id")?,
        bundle_url: bundle,
        placement: req_string(obj, "placement")?,
    })
}

fn parse_editor_view(value: &serde_json::Value) -> Result<PluginEditorViewDto, ManifestError> {
    let obj = value.as_object().ok_or_else(|| ManifestError::Invalid {
        field: "contributes.editorViews[]",
        reason: "expected object".into(),
    })?;
    let extensions = opt_string_array(obj, "extensions").ok_or_else(|| ManifestError::Invalid {
        field: "contributes.editorViews[].extensions",
        reason: "required string array".into(),
    })?;
    if extensions.is_empty() {
        return Err(ManifestError::Invalid {
            field: "contributes.editorViews[].extensions",
            reason: "must not be empty".into(),
        });
    }
    for ext in &extensions {
        if !ext.starts_with('.') {
            return Err(ManifestError::Invalid {
                field: "contributes.editorViews[].extensions",
                reason: format!("{ext:?} must start with a dot"),
            });
        }
    }
    let bundle = req_string(obj, "bundleUrl")?;
    validate_asset_ref("contributes.editorViews[].bundleUrl", &bundle)?;
    Ok(PluginEditorViewDto {
        extensions,
        bundle_url: bundle,
    })
}

fn parse_command(value: &serde_json::Value) -> Result<PluginCommandDto, ManifestError> {
    let obj = value.as_object().ok_or_else(|| ManifestError::Invalid {
        field: "contributes.commands[]",
        reason: "expected object".into(),
    })?;
    Ok(PluginCommandDto {
        id: req_string(obj, "id")?,
        label: req_string(obj, "label")?,
        palette: obj
            .get("palette")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
    })
}

fn parse_settings_panel(
    value: &serde_json::Value,
) -> Result<PluginSettingsPanelDto, ManifestError> {
    let obj = value.as_object().ok_or_else(|| ManifestError::Invalid {
        field: "contributes.settingsPanel",
        reason: "expected object".into(),
    })?;
    let bundle = req_string(obj, "bundleUrl")?;
    validate_asset_ref("contributes.settingsPanel.bundleUrl", &bundle)?;
    Ok(PluginSettingsPanelDto {
        label: req_string(obj, "label")?,
        bundle_url: bundle,
    })
}

// ── Field helpers ─────────────────────────────────────────────────────────

fn req_string(
    obj: &serde_json::Map<String, serde_json::Value>,
    key: &'static str,
) -> Result<String, ManifestError> {
    obj.get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or(ManifestError::Invalid {
            field: key,
            reason: "required string".into(),
        })
}

fn opt_string(
    obj: &serde_json::Map<String, serde_json::Value>,
    key: &str,
) -> Option<String> {
    obj.get(key).and_then(|v| v.as_str()).map(|s| s.to_string())
}

fn opt_string_array(
    obj: &serde_json::Map<String, serde_json::Value>,
    key: &str,
) -> Option<Vec<String>> {
    obj.get(key).and_then(|v| v.as_array()).and_then(|arr| {
        arr.iter()
            .map(|v| v.as_str().map(|s| s.to_string()))
            .collect()
    })
}

/// `iconUrl` and `bundleUrl` reference files INSIDE the plugin
/// directory. Anything that could escape the plugin sandbox or
/// reach a remote origin is rejected outright.
///
/// Inline icon specs (`lucide:foo`) are allowed for activity-bar
/// icons since they don't resolve to a filesystem path.
pub fn validate_asset_ref(field: &'static str, raw: &str) -> Result<(), ManifestError> {
    if raw.is_empty() {
        return Err(ManifestError::Invalid {
            field,
            reason: "empty".into(),
        });
    }
    if raw.starts_with("lucide:") {
        return Ok(());
    }
    if raw.contains("://")
        || raw.starts_with('/')
        || raw.starts_with('\\')
        || raw.split(['/', '\\']).any(|seg| seg == "..")
        || raw.contains('\0')
    {
        return Err(ManifestError::Invalid {
            field,
            reason: "must be a relative path inside the plugin folder".into(),
        });
    }
    Ok(())
}

/// Allowed manifest id alphabet. Must be safe as a folder name on
/// Windows + POSIX and as a JS key.
pub fn is_valid_id(id: &str) -> bool {
    let bytes = id.as_bytes();
    if bytes.is_empty() || bytes.len() > 64 {
        return false;
    }
    let first_ok = matches!(bytes[0], b'a'..=b'z' | b'0'..=b'9');
    if !first_ok {
        return false;
    }
    bytes
        .iter()
        .all(|b| matches!(b, b'a'..=b'z' | b'0'..=b'9' | b'.' | b'_' | b'-'))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn minimal_manifest(id: &str) -> serde_json::Value {
        serde_json::json!({
            "id": id,
            "name": "Demo",
            "version": "0.1.0",
            "author": "tests",
            "description": "test plugin",
            "apiVersion": HOST_API_VERSION,
            "capabilities": { "required": [] },
            "contributes": {}
        })
    }

    #[test]
    fn valid_minimal_manifest_parses() {
        let m = validate(minimal_manifest("hello.world")).unwrap();
        assert_eq!(m.id, "hello.world");
        assert!(m.capabilities.required.is_empty());
    }

    #[test]
    fn unsupported_api_version_is_rejected() {
        let mut json = minimal_manifest("x");
        json["apiVersion"] = "2.0".into();
        let err = validate(json).unwrap_err();
        assert!(matches!(err, ManifestError::UnsupportedApi(_, _)));
    }

    #[test]
    fn unknown_capability_is_rejected() {
        let mut json = minimal_manifest("x");
        json["capabilities"]["required"] = serde_json::json!(["filesystem.everything"]);
        let err = validate(json).unwrap_err();
        assert!(matches!(err, ManifestError::UnknownCapability(_)));
    }

    #[test]
    fn id_must_match_alphabet() {
        let mut json = minimal_manifest("HelloWorld");
        json["id"] = "HelloWorld".into();
        let err = validate(json).unwrap_err();
        assert!(matches!(err, ManifestError::Invalid { field: "id", .. }));
    }

    #[test]
    fn bundle_url_traversal_rejected() {
        let mut json = minimal_manifest("x");
        json["contributes"]["sidebarPanel"] = serde_json::json!({
            "id": "p",
            "bundleUrl": "../escape.js",
            "placement": "left",
        });
        let err = validate(json).unwrap_err();
        assert!(matches!(err, ManifestError::Invalid { .. }));
    }

    #[test]
    fn bundle_url_remote_rejected() {
        let mut json = minimal_manifest("x");
        json["contributes"]["sidebarPanel"] = serde_json::json!({
            "id": "p",
            "bundleUrl": "https://evil.example/code.js",
            "placement": "left",
        });
        let err = validate(json).unwrap_err();
        assert!(matches!(err, ManifestError::Invalid { .. }));
    }

    #[test]
    fn lucide_icon_spec_allowed() {
        let mut json = minimal_manifest("x");
        json["contributes"]["activityBarItem"] = serde_json::json!({
            "id": "p",
            "iconUrl": "lucide:layout-grid",
            "tooltip": "P",
        });
        validate(json).unwrap();
    }

    #[test]
    fn editor_view_requires_dot_prefix() {
        let mut json = minimal_manifest("x");
        json["contributes"]["editorViews"] = serde_json::json!([{
            "extensions": ["board.yaml"],
            "bundleUrl": "dist/view.js",
        }]);
        let err = validate(json).unwrap_err();
        assert!(matches!(err, ManifestError::Invalid { .. }));
    }
}
