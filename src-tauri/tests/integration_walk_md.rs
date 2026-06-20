//! Integration tests for the full wikilink healer (`heal_links`)
//! and the `walk_md` traversal that powers both the healer and the
//! link indexer. Builds a tempdir vault and exercises the
//! filesystem-touching paths end to end.

use flux_lib::commands::fs::wikilink::{heal_links, walk_md};

mod common;

fn collect_md(root: &std::path::Path) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    walk_md(root, &mut |abs| {
        let rel = abs
            .strip_prefix(root)
            .unwrap_or(abs)
            .to_string_lossy()
            .replace('\\', "/");
        out.push(rel);
        Ok(())
    })
    .unwrap();
    out.sort();
    out
}

#[test]
fn walk_md_visits_every_markdown_file() {
    let (_dir, vault) = common::fresh_vault();
    common::write_file(&vault, "a.md", "# A");
    common::write_file(&vault, "notes/b.md", "# B");
    common::write_file(&vault, "notes/sub/c.md", "# C");
    // Non-markdown + dotfolder content should NOT be visited.
    common::write_file(&vault, "notes/data.json", "{}");
    common::write_file(&vault, ".zenvault/cache.md", "ignored");
    common::write_file(&vault, "node_modules/lib.md", "ignored");

    let files = collect_md(&vault);
    assert_eq!(files, vec!["a.md", "notes/b.md", "notes/sub/c.md"]);
}

#[test]
fn walk_md_handles_empty_vault() {
    let (_dir, vault) = common::fresh_vault();
    assert!(collect_md(&vault).is_empty());
}

#[test]
fn walk_md_skips_dotfile_folders_in_subtrees() {
    let (_dir, vault) = common::fresh_vault();
    common::write_file(&vault, "ok.md", "");
    common::write_file(&vault, "notes/.hidden/secret.md", "");
    common::write_file(&vault, "notes/visible/page.md", "");
    let files = collect_md(&vault);
    assert_eq!(files, vec!["notes/visible/page.md", "ok.md"]);
}

#[test]
fn heal_links_rewrites_bare_stem_references() {
    let (_dir, vault) = common::fresh_vault();
    common::write_file(&vault, "Old.md", "self");
    common::write_file(&vault, "notes/ref.md", "See [[Old]] for context.");

    let (n_links, n_files) = heal_links(&vault, "Old.md", "New.md").unwrap();
    assert_eq!(n_links, 1);
    assert_eq!(n_files, 1);

    let updated = std::fs::read_to_string(vault.join("notes/ref.md")).unwrap();
    assert_eq!(updated, "See [[New]] for context.");
}

#[test]
fn heal_links_preserves_alias_and_section_on_rename() {
    let (_dir, vault) = common::fresh_vault();
    common::write_file(&vault, "Old.md", "self");
    common::write_file(
        &vault,
        "notes/ref.md",
        "Heading: [[Old#Intro|alias]] and bare [[Old]]",
    );

    let (n_links, n_files) = heal_links(&vault, "Old.md", "New.md").unwrap();
    assert_eq!(n_links, 2);
    assert_eq!(n_files, 1);

    let updated = std::fs::read_to_string(vault.join("notes/ref.md")).unwrap();
    assert_eq!(updated, "Heading: [[New#Intro|alias]] and bare [[New]]");
}

#[test]
fn heal_links_uses_path_form_when_link_was_path_keyed() {
    let (_dir, vault) = common::fresh_vault();
    common::write_file(&vault, "notes/Old.md", "self");
    common::write_file(&vault, "other.md", "See [[notes/Old]]");

    let (_n_links, _n_files) =
        heal_links(&vault, "notes/Old.md", "archive/New.md").unwrap();
    let updated = std::fs::read_to_string(vault.join("other.md")).unwrap();
    assert_eq!(updated, "See [[archive/New]]");
}

#[test]
fn heal_links_no_op_when_nothing_matches() {
    let (_dir, vault) = common::fresh_vault();
    common::write_file(&vault, "Old.md", "self");
    common::write_file(&vault, "notes/a.md", "See [[Other]]");

    let (n_links, n_files) = heal_links(&vault, "Old.md", "New.md").unwrap();
    assert_eq!(n_links, 0);
    assert_eq!(n_files, 0);

    let unchanged = std::fs::read_to_string(vault.join("notes/a.md")).unwrap();
    assert_eq!(unchanged, "See [[Other]]");
}
