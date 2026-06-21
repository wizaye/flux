//! Unit tests for the path-canonicalisation helper.
//!
//! Goal: every relative path that touches the DB must collapse to a
//! single canonical form, so the `UNIQUE(relative_path)` constraint
//! and `get_by_path` lookups never disagree about whether a row
//! already exists.

use flux_lib::commands::fs::common::canonicalise_rel;

#[test]
fn replaces_backslashes_with_forward_slashes() {
    assert_eq!(canonicalise_rel("notes\\a.md"), "notes/a.md");
    assert_eq!(
        canonicalise_rel("Quick\\Note 2026-06-19 1930.md"),
        "Quick/Note 2026-06-19 1930.md",
    );
}

#[test]
fn collapses_repeated_slashes() {
    assert_eq!(canonicalise_rel("notes//sub///a.md"), "notes/sub/a.md");
    assert_eq!(canonicalise_rel("notes\\\\sub\\\\a.md"), "notes/sub/a.md");
}

#[test]
fn strips_leading_and_trailing_slashes() {
    assert_eq!(canonicalise_rel("/notes/a.md"), "notes/a.md");
    assert_eq!(canonicalise_rel("notes/a.md/"), "notes/a.md");
    assert_eq!(canonicalise_rel("/notes/a.md/"), "notes/a.md");
}

#[test]
fn no_op_when_already_canonical() {
    assert_eq!(canonicalise_rel("notes/a.md"), "notes/a.md");
    assert_eq!(canonicalise_rel("plain.md"), "plain.md");
}

#[test]
fn preserves_case() {
    // macOS / Linux are case-sensitive — collapsing would lose data.
    assert_eq!(canonicalise_rel("Notes/A.md"), "Notes/A.md");
    assert_eq!(canonicalise_rel("CamelCase.md"), "CamelCase.md");
}

#[test]
fn handles_empty_and_root() {
    assert_eq!(canonicalise_rel(""), "");
    assert_eq!(canonicalise_rel("/"), "");
    assert_eq!(canonicalise_rel("//"), "");
}

#[test]
fn mixed_separators_resolve_to_same_key() {
    // The whole point — two writes with different slash flavours
    // map to the same row.
    let a = canonicalise_rel("notes\\sub/file.md");
    let b = canonicalise_rel("notes/sub\\file.md");
    let c = canonicalise_rel("/notes/sub/file.md/");
    assert_eq!(a, "notes/sub/file.md");
    assert_eq!(b, "notes/sub/file.md");
    assert_eq!(c, "notes/sub/file.md");
}
