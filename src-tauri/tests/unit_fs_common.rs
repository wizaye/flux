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
