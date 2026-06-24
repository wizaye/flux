//! Integration tests for the link/tag scanner commands.
//!
//! Exercises `scan_vault_links_impl` (full sweep) and
//! `scan_vault_links_subset_impl` (incremental) against a real
//! vault. The extractor itself is unit-tested in
//! `tests/unit_links.rs`; here we focus on the orchestration path.

use flux_lib::commands::links::{scan_vault_links_impl, scan_vault_links_subset_impl};
use flux_lib::commands::vault;
use flux_lib::state::AppState;
use std::sync::Arc;
use tempfile::tempdir;

mod common;

async fn setup_vault_with_files(files: &[(&str, &str)]) -> (tempfile::TempDir, Arc<AppState>) {
    let dir = tempdir().unwrap();
    let vault_path = dir.path().join("vault");
    std::fs::create_dir(&vault_path).unwrap();
    let state = Arc::new(AppState::default());
    vault::open_vault_impl(vault_path.to_str().unwrap().into(), &state)
        .await
        .unwrap();

    for (rel, body) in files {
        let abs = vault_path.join(rel);
        if let Some(parent) = abs.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(&abs, body).unwrap();
    }
    (dir, state)
}

#[tokio::test]
async fn scan_vault_links_returns_empty_for_empty_vault() {
    let (_dir, state) = setup_vault_with_files(&[]).await;
    let result = scan_vault_links_impl(&state).await.unwrap();
    assert!(result.files.is_empty());
    assert!(result.links.is_empty());
    assert!(result.tags.is_empty());
    assert_eq!(result.scanned_files, 0);
}

#[tokio::test]
async fn scan_vault_links_indexes_wikilinks_md_links_and_tags() {
    let (_dir, state) = setup_vault_with_files(&[
        ("a.md", "Refers to [[b]] and [other](b.md) #draft\n"),
        ("b.md", "no links here\n"),
    ])
    .await;
    let result = scan_vault_links_impl(&state).await.unwrap();
    // 2 markdown files registered.
    let normalised: Vec<String> = result
        .files
        .iter()
        .map(|p| p.replace('\\', "/"))
        .collect();
    assert!(normalised.contains(&"a.md".to_string()));
    assert!(normalised.contains(&"b.md".to_string()));
    // Two outbound links from a.md (one wiki, one md) and one tag.
    assert_eq!(result.links.iter().filter(|l| l.from == "a.md").count(), 2);
    assert_eq!(result.tags.iter().filter(|t| t.from == "a.md").count(), 1);
    assert!(result.tags.iter().any(|t| t.tag == "draft"));
}

#[tokio::test]
async fn scan_vault_links_skips_metadata_and_external_noise_dirs() {
    let (dir, state) = setup_vault_with_files(&[
        ("a.md", "user note\n"),
    ])
    .await;
    let vault = dir.path().join("vault");
    // Seed noise that the walker must skip.
    std::fs::create_dir_all(vault.join(".git")).unwrap();
    std::fs::write(vault.join(".git/note.md"), "secret\n").unwrap();
    std::fs::create_dir_all(vault.join("node_modules/foo")).unwrap();
    std::fs::write(vault.join("node_modules/foo/x.md"), "junk\n").unwrap();
    std::fs::create_dir_all(vault.join(".zenvault")).unwrap();
    std::fs::write(vault.join(".zenvault/inner.md"), "meta\n").unwrap();

    let result = scan_vault_links_impl(&state).await.unwrap();
    let normalised: Vec<String> = result
        .files
        .iter()
        .map(|p| p.replace('\\', "/"))
        .collect();
    assert!(normalised.iter().any(|f| f == "a.md"));
    assert!(normalised.iter().all(|f| !f.starts_with(".git/")));
    assert!(normalised.iter().all(|f| !f.starts_with("node_modules/")));
    assert!(normalised.iter().all(|f| !f.starts_with(".zenvault/")));
}

#[tokio::test]
async fn scan_vault_links_subset_only_rescans_provided_paths() {
    let (_dir, state) = setup_vault_with_files(&[
        ("a.md", "Refers to [[b]]\n"),
        ("b.md", "#draft only\n"),
    ])
    .await;

    let result = scan_vault_links_subset_impl(vec!["b.md".into()], &state)
        .await
        .unwrap();
    let normalised: Vec<String> = result
        .files
        .iter()
        .map(|p| p.replace('\\', "/"))
        .collect();
    assert_eq!(normalised, vec!["b.md".to_string()]);
    // Only b.md's contribution; a.md is untouched.
    assert!(result.links.iter().all(|l| l.from == "b.md"));
    assert!(result.tags.iter().any(|t| t.tag == "draft"));
}

#[tokio::test]
async fn scan_vault_links_subset_emits_deleted_paths_so_frontend_can_drop_rows() {
    // File doesn't exist on disk but is in the subset list.
    let (_dir, state) = setup_vault_with_files(&[]).await;
    let result = scan_vault_links_subset_impl(vec!["ghost.md".into()], &state)
        .await
        .unwrap();
    let normalised: Vec<String> = result
        .files
        .iter()
        .map(|p| p.replace('\\', "/"))
        .collect();
    assert_eq!(normalised, vec!["ghost.md".to_string()]);
    // No outbound contribution because there's nothing to read.
    assert!(result.links.is_empty());
    assert!(result.tags.is_empty());
}

#[tokio::test]
async fn scan_vault_links_subset_ignores_non_md_extensions() {
    let (_dir, state) = setup_vault_with_files(&[("a.md", "alpha")]).await;
    let result = scan_vault_links_subset_impl(
        vec!["image.png".into(), "doc.pdf".into(), "a.md".into()],
        &state,
    )
    .await
    .unwrap();
    let normalised: Vec<String> = result
        .files
        .iter()
        .map(|p| p.replace('\\', "/"))
        .collect();
    // Only the .md path made it through; image and pdf were silently
    // filtered (the frontend already filters too, but defence-in-depth).
    assert_eq!(normalised, vec!["a.md".to_string()]);
}

#[tokio::test]
async fn scan_vault_links_subset_silently_drops_paths_that_escape_the_vault() {
    let (_dir, state) = setup_vault_with_files(&[]).await;
    let result = scan_vault_links_subset_impl(
        vec!["../etc/passwd".into(), "/abs/path.md".into()],
        &state,
    )
    .await
    .unwrap();
    assert!(result.files.is_empty());
}

#[tokio::test]
async fn scan_vault_links_rejects_when_no_vault_open() {
    let state = Arc::new(AppState::default());
    let err = scan_vault_links_impl(&state).await.unwrap_err();
    assert!(matches!(err, flux_lib::types::AppError::NoVaultOpen));
}

#[test]
fn smoke_common_helpers() {
    let (_dir, vault) = common::fresh_vault();
    assert!(vault.exists());
}
