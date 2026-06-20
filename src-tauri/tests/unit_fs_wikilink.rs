//! Unit tests for `flux_lib::commands::fs::wikilink` pure helpers.
//! Full healer + filesystem walk path is covered by
//! `integration_walk_md.rs` + `integration_heal_links.rs`.

use flux_lib::commands::fs::wikilink::{
    is_ignored, rewrite_links, split_link, stem_no_ext, strip_md,
};

#[test]
fn stem_no_ext_strips_md_and_path() {
    assert_eq!(stem_no_ext("foo.md"), "foo");
    assert_eq!(stem_no_ext("notes/sub/foo.md"), "foo");
    assert_eq!(stem_no_ext("plain"), "plain");
}

#[test]
fn strip_md_normalises_separators() {
    assert_eq!(strip_md("notes\\sub\\foo.md"), "notes/sub/foo");
    assert_eq!(strip_md("notes/sub/foo"), "notes/sub/foo");
    // Uppercase extension still stripped.
    assert_eq!(strip_md("Foo.MD"), "Foo");
}

#[test]
fn split_link_handles_all_four_forms() {
    assert_eq!(split_link("Foo"), ("Foo", None, None));
    assert_eq!(split_link("Foo|Alias"), ("Foo", Some("Alias"), None));
    assert_eq!(split_link("Foo#Sec"), ("Foo", None, Some("Sec")));
    assert_eq!(
        split_link("Foo#Sec|Alias"),
        ("Foo", Some("Alias"), Some("Sec"))
    );
}

#[test]
fn rewrite_links_bare_stem() {
    let (out, n) = rewrite_links(
        "See [[Old Name]] for context.",
        "Old Name",
        "Old Name",
        "New Name",
        "New Name",
    );
    assert_eq!(out, "See [[New Name]] for context.");
    assert_eq!(n, 1);
}

#[test]
fn rewrite_links_preserves_alias_and_section() {
    let (out, _) = rewrite_links(
        "[[Old#Sec|nice alias]]",
        "Old",
        "Old",
        "New",
        "New",
    );
    assert_eq!(out, "[[New#Sec|nice alias]]");
}

#[test]
fn rewrite_links_keeps_path_form_when_input_had_path() {
    let (out, _) = rewrite_links(
        "[[notes/Old]]",
        "Old",
        "notes/Old",
        "New",
        "archive/New",
    );
    assert_eq!(out, "[[archive/New]]");
}

#[test]
fn rewrite_links_does_not_touch_unrelated_links() {
    let (out, n) = rewrite_links(
        "[[Foo]] and [[Bar]]",
        "Old",
        "Old",
        "New",
        "New",
    );
    assert_eq!(out, "[[Foo]] and [[Bar]]");
    assert_eq!(n, 0);
}

#[test]
fn rewrite_links_skips_links_crossing_newlines() {
    // A literal `[[` that doesn't close on the same paragraph
    // shouldn't be treated as a link — we'd risk swallowing
    // arbitrary text otherwise.
    let (out, n) = rewrite_links(
        "[[Old\nNot a link]]",
        "Old",
        "Old",
        "New",
        "New",
    );
    assert!(out.contains("[[Old"));
    assert_eq!(n, 0);
}

#[test]
fn is_ignored_covers_metadata_folders() {
    assert!(is_ignored(".zenvault"));
    assert!(is_ignored(".git"));
    assert!(is_ignored("node_modules"));
    // Any dotfile is skipped (defensive).
    assert!(is_ignored(".hidden"));
    // But the literal `.` is fine (we'd walk into it as cwd).
    assert!(!is_ignored("."));
    assert!(!is_ignored("notes"));
}
