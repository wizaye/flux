//! Capability-gated host broker.
//!
//! Every privileged action a plugin performs goes through
//! [`dispatch`]. The pipeline (spec §17.6):
//!
//! 1. Look up the installed plugin by id — unknown id ⇒ reject.
//! 2. Re-check the apiVersion against the host SDK version — a
//!    plugin built for a future SDK does not get to call us.
//! 3. Re-check that the requested capability is in the plugin's
//!    granted set. The frontend already verified this, but a
//!    compromised plugin could lie via direct invoke — we never
//!    trust the request payload.
//! 4. Verify that `contract`/`action`/`capability` are mutually
//!    consistent: each contract.action is owned by exactly one
//!    capability so a plugin can't escalate by changing the label.
//! 5. Decode the payload for the requested action and delegate
//!    to the corresponding host service.
//! 6. Return a typed `PluginBackendResponse`.
//!
//! All errors are returned as the `Err` arm of the response —
//! the IPC call itself succeeds so the frontend can inspect
//! `error.code` and surface a localised message.

use crate::commands::fs::common::{get_db_pool, get_vault_path};
use crate::commands::fs::{list_directory_impl, read_file_impl, search_files_impl, write_file_impl};
use crate::commands::plugins::dto::{
    PluginBackendError, PluginBackendRequest, PluginBackendResponse, PluginManifestDto,
};
use crate::commands::plugins::manifest::HOST_API_VERSION;
use crate::commands::plugins::storage;
use crate::state::AppState;
use serde::Deserialize;
use std::sync::Arc;

/// Top-level entry. Always returns `Ok(response)` — failures live
/// inside the typed response so the frontend handles them with one
/// `if (!res.ok)` instead of two layers of try/catch.
pub async fn dispatch(
    req: PluginBackendRequest,
    manifest: PluginManifestDto,
    state: Arc<AppState>,
) -> PluginBackendResponse {
    // Step 2: api version compatibility (re-checked even though the
    // scanner already filtered on it — defence in depth).
    if req.api_version != HOST_API_VERSION {
        return err(
            "api_version_mismatch",
            format!(
                "plugin requested apiVersion {}, host implements {}",
                req.api_version, HOST_API_VERSION
            ),
        );
    }

    // Step 3: capability grant lookup.
    let granted = manifest.granted_capabilities();
    if !granted.contains_key(&req.capability) {
        return err(
            "capability_denied",
            format!(
                "plugin {:?} did not declare capability {:?}",
                req.plugin_id, req.capability
            ),
        );
    }

    // Step 4: capability ↔ (contract, action) integrity.
    let expected_cap = match capability_for(&req.contract, &req.action) {
        Some(c) => c,
        None => {
            return err(
                "unknown_action",
                format!("contract {:?} action {:?}", req.contract, req.action),
            );
        }
    };
    if expected_cap != req.capability.as_str() {
        return err(
            "capability_mismatch",
            format!(
                "{}::{} requires {:?}, plugin requested {:?}",
                req.contract, req.action, expected_cap, req.capability
            ),
        );
    }

    // Step 5+6: dispatch.
    match (req.contract.as_str(), req.action.as_str()) {
        ("vault", "readText") => vault_read_text(&req, state).await,
        ("vault", "writeText") => vault_write_text(&req, state).await,
        ("vault", "listDir") => vault_list_dir(&req, state).await,
        ("workspace", "showNotice") => workspace_show_notice(&req),
        ("workspace", "openPath") => workspace_open_path(&req),
        ("workspace", "revealInSidebar") => workspace_reveal_in_sidebar(&req),
        ("search", "query") => search_query(&req, state).await,
        ("plugin.storage", "get") => storage_get(&req, state).await,
        ("plugin.storage", "set") => storage_set(&req, state).await,
        ("plugin.storage", "delete") => storage_delete(&req, state).await,
        _ => err(
            "unknown_action",
            format!("contract {:?} action {:?}", req.contract, req.action),
        ),
    }
}

/// Static mapping of contract+action to the capability the caller
/// must hold. New host services MUST register their entries here AND
/// in [`crate::commands::plugins::manifest::ALLOWED_CAPABILITIES`]
/// before they will dispatch.
fn capability_for(contract: &str, action: &str) -> Option<&'static str> {
    Some(match (contract, action) {
        ("vault", "readText") => "vault.read",
        ("vault", "writeText") => "vault.write",
        ("vault", "listDir") => "vault.list",
        ("workspace", "showNotice") => "workspace.notice",
        ("workspace", "openPath") => "workspace.open",
        ("workspace", "revealInSidebar") => "workspace.reveal",
        ("search", "query") => "search.query",
        ("plugin.storage", "get") => "plugin.storage.read",
        ("plugin.storage", "set") => "plugin.storage.write",
        ("plugin.storage", "delete") => "plugin.storage.write",
        _ => return None,
    })
}

// ── Handlers ──────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct PathPayload {
    path: String,
}

#[derive(Deserialize)]
struct WritePayload {
    path: String,
    content: String,
}

#[derive(Deserialize)]
#[allow(dead_code)] // Fields are validated for shape; values surface via the frontend SDK.
struct NoticePayload {
    title: String,
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    tone: Option<String>,
}

#[derive(Deserialize)]
struct StorageGetPayload {
    key: String,
}

#[derive(Deserialize)]
struct StorageSetPayload {
    key: String,
    value: serde_json::Value,
}

#[derive(Deserialize)]
struct StorageDeletePayload {
    key: String,
}

async fn vault_read_text(
    req: &PluginBackendRequest,
    state: Arc<AppState>,
) -> PluginBackendResponse {
    let payload: PathPayload = match decode(&req.payload_json) {
        Ok(p) => p,
        Err(e) => return err("bad_payload", e),
    };
    match read_file_impl(payload.path, &state).await {
        Ok(text) => ok_value(&serde_json::Value::String(text)),
        Err(e) => err("vault_read_failed", e.to_string()),
    }
}

async fn vault_write_text(
    req: &PluginBackendRequest,
    state: Arc<AppState>,
) -> PluginBackendResponse {
    let payload: WritePayload = match decode(&req.payload_json) {
        Ok(p) => p,
        Err(e) => return err("bad_payload", e),
    };
    match write_file_impl(payload.path, payload.content, &state).await {
        Ok(_) => ok_null(),
        Err(e) => err("vault_write_failed", e.to_string()),
    }
}

async fn vault_list_dir(
    req: &PluginBackendRequest,
    state: Arc<AppState>,
) -> PluginBackendResponse {
    let payload: PathPayload = match decode(&req.payload_json) {
        Ok(p) => p,
        Err(e) => return err("bad_payload", e),
    };
    match list_directory_impl(payload.path, &state).await {
        Ok(entries) => match serde_json::to_value(entries) {
            Ok(v) => ok_value(&v),
            Err(e) => err("encode_failed", e.to_string()),
        },
        Err(e) => err("vault_list_failed", e.to_string()),
    }
}

fn workspace_show_notice(req: &PluginBackendRequest) -> PluginBackendResponse {
    let payload: NoticePayload = match decode(&req.payload_json) {
        Ok(p) => p,
        Err(e) => return err("bad_payload", e),
    };
    // The notice contract is fire-and-forget on the host side: the
    // frontend SDK shim listens for the matching response and
    // surfaces a toast. We still validate the payload server-side
    // so a plugin cannot smuggle arbitrary JSON through.
    let _ = payload;
    ok_null()
}

fn workspace_open_path(req: &PluginBackendRequest) -> PluginBackendResponse {
    let payload: PathPayload = match decode(&req.payload_json) {
        Ok(p) => p,
        Err(e) => return err("bad_payload", e),
    };
    // The broker only validates the request shape — the actual
    // "switch the active tab to this file" lives in the frontend
    // tab system. The SDK's `host.workspace.openPath()` dispatches
    // a `flux-open-file` window event after this call returns OK,
    // which the host's lattice-shell already listens for.
    let _ = payload;
    ok_null()
}

fn workspace_reveal_in_sidebar(req: &PluginBackendRequest) -> PluginBackendResponse {
    let payload: PathPayload = match decode(&req.payload_json) {
        Ok(p) => p,
        Err(e) => return err("bad_payload", e),
    };
    // Same pattern as `openPath` — the broker is just the
    // capability gate; the SDK fires `flux-reveal-in-sidebar`
    // after a successful response and the file explorer panel
    // scrolls + highlights the row.
    let _ = payload;
    ok_null()
}

async fn search_query(
    req: &PluginBackendRequest,
    state: Arc<AppState>,
) -> PluginBackendResponse {
    #[derive(Deserialize)]
    struct SearchPayload {
        text: String,
        #[serde(default)]
        limit: Option<u32>,
    }
    let payload: SearchPayload = match decode(&req.payload_json) {
        Ok(p) => p,
        Err(e) => return err("bad_payload", e),
    };
    // Empty query → empty result. The host's FTS5 wrapper would
    // bubble an `unrecognized token` error on this; rejecting at
    // the broker keeps the contract idempotent.
    if payload.text.trim().is_empty() {
        return ok_value(&serde_json::Value::Array(vec![]));
    }
    match search_files_impl(payload.text, payload.limit, &state).await {
        Ok(hits) => match serde_json::to_value(hits) {
            Ok(v) => ok_value(&v),
            Err(e) => err("encode_failed", e.to_string()),
        },
        Err(e) => err("search_failed", e.to_string()),
    }
}

async fn storage_get(
    req: &PluginBackendRequest,
    state: Arc<AppState>,
) -> PluginBackendResponse {
    let payload: StorageGetPayload = match decode(&req.payload_json) {
        Ok(p) => p,
        Err(e) => return err("bad_payload", e),
    };
    let pool = match get_db_pool(&state) {
        Ok(p) => p,
        Err(e) => return err("no_vault", e.to_string()),
    };
    let plugin_id = req.plugin_id.clone();
    let key = payload.key.clone();
    let raw = tokio::task::spawn_blocking(move || storage::get_blocking(&pool, &plugin_id, &key))
        .await;
    match raw {
        Ok(Ok(Some(s))) => match serde_json::from_str::<serde_json::Value>(&s) {
            Ok(v) => ok_value(&v),
            Err(e) => err("decode_failed", e.to_string()),
        },
        Ok(Ok(None)) => ok_null(),
        Ok(Err(e)) => err("storage_failed", e.to_string()),
        Err(e) => err("join_failed", e.to_string()),
    }
}

async fn storage_set(
    req: &PluginBackendRequest,
    state: Arc<AppState>,
) -> PluginBackendResponse {
    let payload: StorageSetPayload = match decode(&req.payload_json) {
        Ok(p) => p,
        Err(e) => return err("bad_payload", e),
    };
    let pool = match get_db_pool(&state) {
        Ok(p) => p,
        Err(e) => return err("no_vault", e.to_string()),
    };
    let plugin_id = req.plugin_id.clone();
    let key = payload.key.clone();
    let value = payload.value.to_string();
    let res = tokio::task::spawn_blocking(move || {
        storage::set_blocking(&pool, &plugin_id, &key, &value)
    })
    .await;
    match res {
        Ok(Ok(())) => ok_null(),
        Ok(Err(e)) => err("storage_failed", e.to_string()),
        Err(e) => err("join_failed", e.to_string()),
    }
}

async fn storage_delete(
    req: &PluginBackendRequest,
    state: Arc<AppState>,
) -> PluginBackendResponse {
    let payload: StorageDeletePayload = match decode(&req.payload_json) {
        Ok(p) => p,
        Err(e) => return err("bad_payload", e),
    };
    let pool = match get_db_pool(&state) {
        Ok(p) => p,
        Err(e) => return err("no_vault", e.to_string()),
    };
    let plugin_id = req.plugin_id.clone();
    let key = payload.key.clone();
    let res =
        tokio::task::spawn_blocking(move || storage::delete_blocking(&pool, &plugin_id, &key))
            .await;
    match res {
        Ok(Ok(())) => ok_null(),
        Ok(Err(e)) => err("storage_failed", e.to_string()),
        Err(e) => err("join_failed", e.to_string()),
    }
}

// ── Response helpers ──────────────────────────────────────────────────────

fn decode<T: for<'de> Deserialize<'de>>(raw: &str) -> Result<T, String> {
    if raw.is_empty() {
        return serde_json::from_str::<T>("null").map_err(|e| e.to_string());
    }
    serde_json::from_str(raw).map_err(|e| e.to_string())
}

fn ok_value(v: &serde_json::Value) -> PluginBackendResponse {
    PluginBackendResponse::Ok {
        data_json: serde_json::to_string(v).unwrap_or_else(|_| "null".into()),
    }
}

fn ok_null() -> PluginBackendResponse {
    PluginBackendResponse::Ok {
        data_json: "null".into(),
    }
}

fn err(code: &str, message: impl Into<String>) -> PluginBackendResponse {
    PluginBackendResponse::Err {
        error: PluginBackendError::new(code, message),
    }
}

// Silence unused warnings on builds that don't drag in get_vault_path.
#[allow(dead_code)]
fn _touch(state: &AppState) {
    let _ = get_vault_path(state);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::plugins::dto::PluginCapabilitiesDto;
    use crate::commands::plugins::dto::PluginContributesDto;

    fn manifest_with(caps: &[&str]) -> PluginManifestDto {
        PluginManifestDto {
            id: "demo".into(),
            name: "Demo".into(),
            version: "0.1.0".into(),
            author: "tests".into(),
            description: "d".into(),
            min_app_version: None,
            api_version: HOST_API_VERSION.into(),
            capabilities: PluginCapabilitiesDto {
                required: caps.iter().map(|s| s.to_string()).collect(),
                optional: vec![],
            },
            contributes: PluginContributesDto::default(),
        }
    }

    fn request(capability: &str, contract: &str, action: &str) -> PluginBackendRequest {
        PluginBackendRequest {
            plugin_id: "demo".into(),
            api_version: HOST_API_VERSION.into(),
            capability: capability.into(),
            contract: contract.into(),
            action: action.into(),
            payload_json: String::new(),
        }
    }

    #[tokio::test]
    async fn unknown_action_returns_error() {
        let state = Arc::new(AppState::default());
        let resp = dispatch(
            request("vault.read", "vault", "deleteEverything"),
            manifest_with(&["vault.read"]),
            state,
        )
        .await;
        match resp {
            PluginBackendResponse::Err { error } => assert_eq!(error.code, "unknown_action"),
            _ => panic!("expected err"),
        }
    }

    #[tokio::test]
    async fn missing_capability_returns_denied() {
        let state = Arc::new(AppState::default());
        let resp = dispatch(
            request("vault.read", "vault", "readText"),
            manifest_with(&[]),
            state,
        )
        .await;
        match resp {
            PluginBackendResponse::Err { error } => assert_eq!(error.code, "capability_denied"),
            _ => panic!("expected err"),
        }
    }

    #[tokio::test]
    async fn capability_mismatch_returns_mismatch() {
        let state = Arc::new(AppState::default());
        // Holds vault.read but tries to call writeText (which needs
        // vault.write) while passing the wrong capability label.
        let resp = dispatch(
            request("vault.read", "vault", "writeText"),
            manifest_with(&["vault.read"]),
            state,
        )
        .await;
        match resp {
            PluginBackendResponse::Err { error } => assert_eq!(error.code, "capability_mismatch"),
            _ => panic!("expected err"),
        }
    }

    #[tokio::test]
    async fn api_version_mismatch_returns_error() {
        let state = Arc::new(AppState::default());
        let mut req = request("vault.read", "vault", "readText");
        req.api_version = "999".into();
        let resp = dispatch(req, manifest_with(&["vault.read"]), state).await;
        match resp {
            PluginBackendResponse::Err { error } => assert_eq!(error.code, "api_version_mismatch"),
            _ => panic!("expected err"),
        }
    }
}