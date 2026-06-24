//! End-to-end integration tests for the plugin subsystem:
//! install (folder + zip) → scan → broker dispatch.
//!
//! These bypass Tauri and drive the `*_impl` / pure modules
//! directly so they run inside `cargo test` without a webview.

use flux_lib::commands::plugins::dto::{PluginBackendRequest, PluginBackendResponse};
use flux_lib::commands::plugins::install::{install_from_folder, install_from_zip};
use flux_lib::commands::plugins::manifest::HOST_API_VERSION;
use flux_lib::commands::plugins::scanner::{plugins_dir, scan_vault_plugins};
use flux_lib::commands::plugins::{broker, storage};
use flux_lib::db;
use flux_lib::state::AppState;
use serde_json::json;
use std::fs;
use std::io::Write;
use std::path::Path;
use std::sync::Arc;
use tempfile::TempDir;

mod common;

fn open_vault_state() -> (TempDir, Arc<AppState>) {
    let tmp = tempfile::tempdir().unwrap();
    let vault = tmp.path().join("vault");
    fs::create_dir_all(vault.join(".zenvault")).unwrap();
    let pool = db::init_pool(&vault.join(".zenvault").join("index.db")).unwrap();
    let state = Arc::new(AppState::default());
    *state.vault_path.lock().unwrap() = Some(vault.to_string_lossy().to_string());
    *state.db_pool.lock().unwrap() = Some(pool);
    (tmp, state)
}

fn write_plugin_source(dir: &Path, id: &str, with_capability: bool) {
    fs::create_dir_all(dir.join("dist")).unwrap();
    let mut required = vec![];
    if with_capability {
        required.push("plugin.storage.read");
        required.push("plugin.storage.write");
    }
    let manifest = json!({
        "id": id,
        "name": id,
        "version": "0.1.0",
        "author": "tests",
        "description": "demo plugin",
        "apiVersion": HOST_API_VERSION,
        "capabilities": { "required": required, "optional": [] },
        "contributes": {},
    });
    fs::write(dir.join("manifest.json"), manifest.to_string()).unwrap();
    fs::write(dir.join("dist").join("index.js"), "export const Manifest = {};").unwrap();
}

#[test]
fn install_from_folder_then_scan_returns_plugin() {
    let (_tmp, state) = open_vault_state();
    let src_holder = tempfile::tempdir().unwrap();
    let src = src_holder.path().join("demo-plugin");
    write_plugin_source(&src, "demo", false);

    let installed = install_from_folder(&src, &state).unwrap();
    assert_eq!(installed.manifest.id, "demo");
    assert!(!installed.replaced);

    let vault_path = state.vault_path.lock().unwrap().clone().unwrap();
    let scanned = scan_vault_plugins(Path::new(&vault_path));
    assert_eq!(scanned.len(), 1);
    assert_eq!(scanned[0].manifest.id, "demo");
}

#[test]
fn install_overwrites_existing_with_replaced_flag() {
    let (_tmp, state) = open_vault_state();
    let src_holder = tempfile::tempdir().unwrap();
    let src = src_holder.path().join("demo");
    write_plugin_source(&src, "demo", false);

    let first = install_from_folder(&src, &state).unwrap();
    assert!(!first.replaced);
    let second = install_from_folder(&src, &state).unwrap();
    assert!(second.replaced);
}

#[test]
fn install_rejects_payload_without_entry_bundle() {
    let (_tmp, state) = open_vault_state();
    let src_holder = tempfile::tempdir().unwrap();
    let src = src_holder.path().join("no-entry");
    fs::create_dir_all(&src).unwrap();
    let manifest = json!({
        "id": "no-entry",
        "name": "x",
        "version": "0",
        "author": "t",
        "description": "d",
        "apiVersion": HOST_API_VERSION,
        "capabilities": { "required": [] },
        "contributes": {},
    });
    fs::write(src.join("manifest.json"), manifest.to_string()).unwrap();
    let err = install_from_folder(&src, &state).unwrap_err();
    assert!(format!("{err}").to_lowercase().contains("missing"));
}

#[test]
fn install_from_zip_round_trips_through_scan() {
    let (_tmp, state) = open_vault_state();
    let zip_holder = tempfile::tempdir().unwrap();
    let zip_path = zip_holder.path().join("plugin.zip");

    let file = fs::File::create(&zip_path).unwrap();
    let mut zw = zip::ZipWriter::new(file);
    let options =
        zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Stored);

    zw.start_file("manifest.json", options).unwrap();
    let manifest = json!({
        "id": "fromzip",
        "name": "From Zip",
        "version": "1.0.0",
        "author": "tests",
        "description": "via zip",
        "apiVersion": HOST_API_VERSION,
        "capabilities": { "required": [] },
        "contributes": {},
    });
    zw.write_all(manifest.to_string().as_bytes()).unwrap();
    zw.start_file("dist/index.js", options).unwrap();
    zw.write_all(b"export const Manifest = {};").unwrap();
    zw.finish().unwrap();

    let installed = install_from_zip(&zip_path, &state).unwrap();
    assert_eq!(installed.manifest.id, "fromzip");

    let vault_path = state.vault_path.lock().unwrap().clone().unwrap();
    let scanned = scan_vault_plugins(Path::new(&vault_path));
    assert_eq!(scanned.len(), 1);
    assert_eq!(scanned[0].manifest.id, "fromzip");
}

#[test]
fn install_from_zip_rejects_traversal_entry() {
    let (_tmp, state) = open_vault_state();
    let zip_holder = tempfile::tempdir().unwrap();
    let zip_path = zip_holder.path().join("bad.zip");

    let file = fs::File::create(&zip_path).unwrap();
    let mut zw = zip::ZipWriter::new(file);
    let options =
        zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Stored);
    zw.start_file("../escape.txt", options).unwrap();
    zw.write_all(b"x").unwrap();
    zw.finish().unwrap();

    let err = install_from_zip(&zip_path, &state).unwrap_err();
    assert!(format!("{err}").contains("escape"));
}

#[tokio::test]
async fn broker_round_trip_storage_set_get_delete() {
    let (_tmp, state) = open_vault_state();
    let src_holder = tempfile::tempdir().unwrap();
    let src = src_holder.path().join("kv");
    write_plugin_source(&src, "kv", true);
    let install = install_from_folder(&src, &state).unwrap();
    let manifest = install.manifest;

    // Set
    let req = PluginBackendRequest {
        plugin_id: "kv".into(),
        api_version: HOST_API_VERSION.into(),
        capability: "plugin.storage.write".into(),
        contract: "plugin.storage".into(),
        action: "set".into(),
        payload_json: json!({ "key": "alpha", "value": { "n": 42 } }).to_string(),
    };
    match broker::dispatch(req, manifest.clone(), state.clone()).await {
        PluginBackendResponse::Ok { data_json } => assert_eq!(data_json, "null"),
        PluginBackendResponse::Err { error } => panic!("set failed: {error:?}"),
    }

    // Get
    let req = PluginBackendRequest {
        plugin_id: "kv".into(),
        api_version: HOST_API_VERSION.into(),
        capability: "plugin.storage.read".into(),
        contract: "plugin.storage".into(),
        action: "get".into(),
        payload_json: json!({ "key": "alpha" }).to_string(),
    };
    match broker::dispatch(req, manifest.clone(), state.clone()).await {
        PluginBackendResponse::Ok { data_json } => {
            let v: serde_json::Value = serde_json::from_str(&data_json).unwrap();
            assert_eq!(v, json!({ "n": 42 }));
        }
        PluginBackendResponse::Err { error } => panic!("get failed: {error:?}"),
    }

    // Delete
    let req = PluginBackendRequest {
        plugin_id: "kv".into(),
        api_version: HOST_API_VERSION.into(),
        capability: "plugin.storage.write".into(),
        contract: "plugin.storage".into(),
        action: "delete".into(),
        payload_json: json!({ "key": "alpha" }).to_string(),
    };
    let _ = broker::dispatch(req, manifest.clone(), state.clone()).await;

    let pool = state.db_pool.lock().unwrap().clone().unwrap();
    assert!(storage::get_blocking(&pool, "kv", "alpha").unwrap().is_none());
}

#[tokio::test]
async fn broker_denies_when_capability_missing() {
    let (_tmp, state) = open_vault_state();
    let src_holder = tempfile::tempdir().unwrap();
    let src = src_holder.path().join("ro");
    // Plugin requests NO capabilities.
    write_plugin_source(&src, "ro", false);
    let install = install_from_folder(&src, &state).unwrap();

    let req = PluginBackendRequest {
        plugin_id: "ro".into(),
        api_version: HOST_API_VERSION.into(),
        capability: "plugin.storage.read".into(),
        contract: "plugin.storage".into(),
        action: "get".into(),
        payload_json: json!({ "key": "x" }).to_string(),
    };
    let resp = broker::dispatch(req, install.manifest, state).await;
    match resp {
        PluginBackendResponse::Err { error } => assert_eq!(error.code, "capability_denied"),
        _ => panic!("expected denial"),
    }
}

#[test]
fn uninstall_removes_folder_and_storage() {
    let (_tmp, state) = open_vault_state();
    let src_holder = tempfile::tempdir().unwrap();
    let src = src_holder.path().join("kill");
    write_plugin_source(&src, "kill", true);
    install_from_folder(&src, &state).unwrap();

    // Seed a storage row.
    let pool = state.db_pool.lock().unwrap().clone().unwrap();
    storage::set_blocking(&pool, "kill", "k", "v").unwrap();
    assert!(storage::get_blocking(&pool, "kill", "k").unwrap().is_some());

    flux_lib::commands::plugins::install::uninstall("kill", &state).unwrap();

    let vault_path = state.vault_path.lock().unwrap().clone().unwrap();
    let scanned = scan_vault_plugins(Path::new(&vault_path));
    assert!(scanned.is_empty());
    let plugin_folder = plugins_dir(Path::new(&vault_path)).join("kill");
    assert!(!plugin_folder.exists());
    assert!(storage::get_blocking(&pool, "kill", "k").unwrap().is_none());
}
