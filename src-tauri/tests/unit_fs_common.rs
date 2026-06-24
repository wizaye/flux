//! Unit tests for `flux_lib::commands::fs::common::validate_and_resolve_path`.
//! Pure path-rewriting logic — no IO needed.

use flux_lib::commands::fs::common::validate_and_resolve_path;
use flux_lib::types::AppError;
use std::path::PathBuf;

fn vault() -> PathBuf {
    PathBuf::from("/tmp/vault")
}

#[test]
fn resolves_simple_relative_path() {
    let p = validate_and_resolve_path(&vault(), "notes/a.md").unwrap();
    assert_eq!(p, PathBuf::from("/tmp/vault/notes/a.md"));
}

#[test]
fn normalises_backslashes_to_slashes() {
    let p = validate_and_resolve_path(&vault(), "notes\\sub\\b.md").unwrap();
    // After normalisation the join still works on both OSes.
    assert!(p.ends_with("notes/sub/b.md") || p.ends_with("notes\\sub\\b.md"));
}

#[test]
fn rejects_parent_traversal() {
    for evil in &[
        "../etc/passwd",
        "../../etc/passwd",
        "notes/../../etc/passwd",
        "notes/..\\..\\etc\\passwd",
    ] {
        let err = validate_and_resolve_path(&vault(), evil).unwrap_err();
        assert!(
            matches!(err, AppError::InvalidPath(_)),
            "expected InvalidPath for {}, got {:?}",
            evil,
            err
        );
    }
}

#[test]
fn rejects_absolute_paths() {
    for evil in &["/etc/passwd", "\\Windows\\System32"] {
        let err = validate_and_resolve_path(&vault(), evil).unwrap_err();
        assert!(matches!(err, AppError::InvalidPath(_)));
    }
}

#[test]
fn accepts_empty_string_as_vault_root() {
    // Empty string resolves to the vault path itself; callers
    // are expected to reject this further up the stack but the
    // validator stays permissive.
    let p = validate_and_resolve_path(&vault(), "").unwrap();
    assert_eq!(p, vault());
}

#[test]
fn allows_double_dots_inside_filenames() {
    // Regression: a bare `contains("..")` check rejected legit
    // names like `release-notes-v1..3.md`. The component-aware
    // check accepts them.
    for ok in &[
        "release-notes-v1..3.md",
        "notes/foo..bar.md",
        "..hidden.md",
        "trailing..md",
    ] {
        let p = validate_and_resolve_path(&vault(), ok)
            .unwrap_or_else(|e| panic!("expected ok for {}: {:?}", ok, e));
        assert!(p.starts_with(vault()), "resolved path stays in vault: {}", ok);
    }
}

#[test]
fn rejects_null_byte_in_path() {
    let err = validate_and_resolve_path(&vault(), "notes/a\0.md").unwrap_err();
    assert!(matches!(err, AppError::InvalidPath(_)));
}
