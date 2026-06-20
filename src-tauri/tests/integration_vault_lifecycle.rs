//! Integration tests for vault lifecycle (create / open / close /
//! get-info). Drives the `*_impl` async functions directly against
//! a real tempdir-backed vault; no Tauri runtime needed.

use flux_lib::commands::vault::{
    close_vault_impl, create_vault_impl, get_vault_info_impl, open_vault_impl,
};
use flux_lib::state::AppState;
use flux_lib::types::AppError;
use std::sync::Arc;
use tempfile::tempdir;

mod common;

fn fresh_state() -> Arc<AppState> {
    Arc::new(AppState::default())
}

#[tokio::test]
async fn create_open_close_full_lifecycle() {
    let dir = tempdir().unwrap();
    let vault_path = dir.path().join("test-vault");
    let path_str = vault_path.to_str().unwrap().to_string();

    let state = fresh_state();

    // Create.
    let handle = create_vault_impl(path_str.clone(), &state)
        .await
        .expect("create_vault_impl");
    assert_eq!(handle.name, "test-vault");
    assert_eq!(handle.file_count, 0);

    // The vault skeleton was materialised on disk.
    assert!(vault_path.join(".zenvault").exists());
    assert!(vault_path.join(".trash").exists());
    assert!(vault_path.join(".archive").exists());
    assert!(vault_path.join(".zenvault").join(".gitignore").exists());

    // State now points at the new vault.
    let stored_path = state.vault_path.lock().unwrap().clone();
    assert_eq!(stored_path, Some(path_str.clone()));

    // Close drops the state.
    close_vault_impl(&state).await.expect("close_vault_impl");
    let stored_path = state.vault_path.lock().unwrap().clone();
    assert_eq!(stored_path, None);
}

#[tokio::test]
async fn open_nonexistent_vault_returns_invalid_path_error() {
    let state = fresh_state();
    let result = open_vault_impl("/definitely/does/not/exist".to_string(), &state).await;
    assert!(matches!(result, Err(AppError::InvalidVaultPath(_))));
}

#[tokio::test]
async fn close_without_open_returns_no_vault_error() {
    let state = fresh_state();
    let result = close_vault_impl(&state).await;
    assert!(matches!(result, Err(AppError::NoVaultOpen)));
}

#[tokio::test]
async fn get_vault_info_reflects_open_state() {
    let dir = tempdir().unwrap();
    let vault_path = dir.path().join("test-vault");
    let path_str = vault_path.to_str().unwrap().to_string();

    let state = fresh_state();
    create_vault_impl(path_str.clone(), &state).await.unwrap();

    let info = get_vault_info_impl(&state).await.unwrap();
    assert_eq!(info.name, "test-vault");
    assert_eq!(info.path, path_str);
}

#[tokio::test]
async fn reopen_same_vault_replaces_state() {
    let dir = tempdir().unwrap();
    let vault_path = dir.path().join("test-vault");
    let path_str = vault_path.to_str().unwrap().to_string();

    let state = fresh_state();
    create_vault_impl(path_str.clone(), &state).await.unwrap();
    // Open again — should not error, just reuse the state slot.
    open_vault_impl(path_str.clone(), &state).await.unwrap();
    let stored = state.vault_path.lock().unwrap().clone();
    assert_eq!(stored, Some(path_str));
}

#[test]
fn common_helpers_compile_against_lib() {
    // Sanity that the `common` module compiles within this test
    // binary — fresh_vault/write_file are exercised by every other
    // integration test.
    let (_dir, vault) = common::fresh_vault();
    let p = common::write_file(&vault, "smoke.md", "# Smoke");
    assert!(p.exists());
}
