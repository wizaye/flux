//! Unit tests for `flux_lib::commands::links` — pure helpers
//! (regex caches, normalisation, exclusion rules, snippet capping,
//! single-file extraction). Run with `cargo test`.

use flux_lib::commands::links::{
    extract_from_file, is_excluded_target, md_link_re, normalise_target, snippet_of, tag_re,
    wikilink_re, LinkKind,
};

mod common;

#[test]
fn normalise_target_lowercases_strips_ext_normalises_slashes() {
    assert_eq!(normalise_target("Foo"), "foo");
    assert_eq!(normalise_target("Foo.md"), "foo");
    assert_eq!(normalise_target("Folder\\Sub\\Note.md"), "folder/sub/note");
    // Uppercase extension still stripped.
    assert_eq!(normalise_target("Note.MD"), "note");
    // Surrounding whitespace trimmed.
    assert_eq!(normalise_target("   Foo  "), "foo");
}

#[test]
fn is_excluded_target_drops_metadata_paths() {
    assert!(is_excluded_target(".zenvault/core"));
    assert!(is_excluded_target(".git/HEAD"));
    assert!(is_excluded_target("notes/.archive/old"));
    assert!(is_excluded_target("foo.json"));
    assert!(is_excluded_target("vault.db"));
    assert!(is_excluded_target("pnpm-lock.lock"));
}

#[test]
fn is_excluded_target_keeps_user_notes_and_media() {
    assert!(!is_excluded_target("notes/foo"));
    assert!(!is_excluded_target("assets/image.png"));
    assert!(!is_excluded_target("docs/spec.pdf"));
}

#[test]
fn wikilink_regex_extracts_target() {
    let re = wikilink_re();
    let line = "See [[Foo]] and [[bar/baz|alias]] and [[qux#sec]]";
    let targets: Vec<&str> = re
        .captures_iter(line)
        .map(|c| c.get(1).unwrap().as_str())
        .collect();
    assert_eq!(targets, vec!["Foo", "bar/baz", "qux"]);
}

#[test]
fn md_link_regex_only_matches_md_targets() {
    let re = md_link_re();
    let line = "[a](https://example.com) [b](notes/foo.md) [c](flux-wi://x#y) [d](sub/bar.md#sec)";
    let targets: Vec<&str> = re
        .captures_iter(line)
        .map(|c| c.get(1).unwrap().as_str())
        .collect();
    // The URL + custom-scheme + non-md target are skipped.
    assert_eq!(targets, vec!["notes/foo.md", "sub/bar.md"]);
}

#[test]
fn tag_regex_matches_hashtags_but_skips_url_fragments() {
    let re = tag_re();
    let line = "intro #draft and #project/alpha but not https://x.com#frag or code#fence";
    let tags: Vec<&str> = re
        .captures_iter(line)
        .map(|c| c.get(1).unwrap().as_str())
        .collect();
    assert_eq!(tags, vec!["draft", "project/alpha"]);
}

#[test]
fn snippet_of_caps_at_160_chars() {
    let short = snippet_of("  hello  ");
    assert_eq!(short, "hello");

    let long = "x".repeat(500);
    let snip = snippet_of(&long);
    // 160 chars + ellipsis.
    let count = snip.chars().count();
    assert_eq!(count, 161);
    assert!(snip.ends_with('…'));
}

#[test]
fn extract_from_file_skips_fenced_code_blocks() {
    let (_dir, vault) = common::fresh_vault();
    let f = common::write_file(
        &vault,
        "note.md",
        "Top [[Foo]]\n```\n[[Inside]]\n```\nAfter [[Bar]]\n",
    );
    let mut links = Vec::new();
    let mut tags = Vec::new();
    let mut skipped = 0u32;
    extract_from_file(&f, &vault, &mut links, &mut tags, &mut skipped).unwrap();
    let targets: Vec<&str> = links.iter().map(|l| l.target.as_str()).collect();
    assert_eq!(targets, vec!["Foo", "Bar"]);
    assert_eq!(skipped, 0);
}

#[test]
fn extract_from_file_records_tags_and_md_links() {
    let (_dir, vault) = common::fresh_vault();
    let f = common::write_file(&vault, "n.md", "#draft\nSee [the spec](docs/spec.md)\n");
    let mut links = Vec::new();
    let mut tags = Vec::new();
    let mut skipped = 0u32;
    extract_from_file(&f, &vault, &mut links, &mut tags, &mut skipped).unwrap();
    assert_eq!(links.len(), 1);
    assert_eq!(links[0].kind, LinkKind::Markdown);
    assert_eq!(links[0].target_norm, "docs/spec");
    assert_eq!(tags.len(), 1);
    assert_eq!(tags[0].tag, "draft");
}

#[test]
fn extract_from_file_skips_oversize_files() {
    let (_dir, vault) = common::fresh_vault();
    // 5 MiB > MAX_FILE_BYTES (4 MiB).
    let big = "a".repeat(5 * 1024 * 1024);
    let f = common::write_file(&vault, "big.md", &big);
    let mut links = Vec::new();
    let mut tags = Vec::new();
    let mut skipped = 0u32;
    let scanned = extract_from_file(&f, &vault, &mut links, &mut tags, &mut skipped).unwrap();
    assert!(!scanned);
    assert_eq!(skipped, 1);
}
