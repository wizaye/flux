/**
 * Tests for the wikilink completion source filter.
 *
 * Contract:
 *   • `[[…]]` completions only ever surface user-meaningful files
 *     (markdown notes + supported media). Plugin manifests, indexed
 *     caches, sqlite files, anything under a dotfolder — all hidden.
 *   • Display name for `.md` files drops the extension; everything
 *     else keeps it (so the link target is unambiguous when two
 *     files share a stem).
 */
import { describe, expect, it } from "vitest";

import {
  collectMarkdownFiles,
  isInternalPath,
} from "@/components/flux-ui/editor/views/codemirror-editor";
import type { FileNode } from "@/state/editor";

function file(id: string, kind: FileNode["kind"] = "file"): FileNode {
  const name = id.split(/[\\/]/).pop() ?? id;
  return { id, name, kind } as FileNode;
}

function vaultOf(...nodes: FileNode[]): Map<string, FileNode> {
  const m = new Map<string, FileNode>();
  for (const n of nodes) m.set(n.id, n);
  return m;
}

describe("isInternalPath", () => {
  it("flags any segment that starts with a dot", () => {
    expect(isInternalPath(".zenvault/index.db")).toBe(true);
    expect(isInternalPath(".git/HEAD")).toBe(true);
    expect(isInternalPath("notes/.archive/old.md")).toBe(true);
    expect(isInternalPath("notes/.git/secret.md")).toBe(true);
  });

  it("handles Windows backslash separators", () => {
    expect(isInternalPath("notes\\.archive\\old.md")).toBe(true);
    expect(isInternalPath(".zenvault\\plugins\\state.json")).toBe(true);
  });

  it("does NOT flag user-facing files", () => {
    expect(isInternalPath("notes/a.md")).toBe(false);
    expect(isInternalPath("Daily/2026-06-21.md")).toBe(false);
    expect(isInternalPath("assets/cover.png")).toBe(false);
  });

  it("treats a lone `.` as the cwd (not internal)", () => {
    // First segment of length 1 (just `.`) is the cwd marker, not a
    // dotfolder. Anything beyond that still scrutinised.
    expect(isInternalPath(".")).toBe(false);
  });
});

describe("collectMarkdownFiles", () => {
  it("strips the .md extension from the display name", () => {
    const v = vaultOf(file("/notes/intro.md"));
    expect(collectMarkdownFiles(v)).toEqual([
      { name: "intro", id: "/notes/intro.md" },
    ]);
  });

  it("keeps the extension for non-markdown media so stems stay unambiguous", () => {
    const v = vaultOf(file("/assets/cover.png"));
    expect(collectMarkdownFiles(v)).toEqual([
      { name: "cover.png", id: "/assets/cover.png" },
    ]);
  });

  it("drops folders", () => {
    const v = vaultOf(file("/notes", "folder"), file("/notes/a.md"));
    expect(collectMarkdownFiles(v).map((f) => f.id)).toEqual([
      "/notes/a.md",
    ]);
  });

  it("drops canvas files (opened by a plugin, not wikilinked)", () => {
    const v = vaultOf(file("/board.canvas", "canvas"));
    expect(collectMarkdownFiles(v)).toEqual([]);
  });

  it("drops every file inside a dotfolder", () => {
    const v = vaultOf(
      file("/.zenvault/index.db"),
      file("/.zenvault/plugins/state.json"),
      file("/.git/HEAD"),
      file("/.archive/notes/old.md"),
      file("/notes/clean.md"),
    );
    expect(collectMarkdownFiles(v).map((f) => f.id)).toEqual([
      "/notes/clean.md",
    ]);
  });

  it("drops backend / lock / config artefacts by extension", () => {
    const v = vaultOf(
      file("/notes/clean.md"),
      file("/state.json"),
      file("/pnpm-lock.yaml"),
      file("/Cargo.lock"),
      file("/vault.db"),
      file("/data.sqlite"),
      file("/cache.log"),
      file("/board.yaml"),
    );
    expect(collectMarkdownFiles(v).map((f) => f.id)).toEqual([
      "/notes/clean.md",
    ]);
  });

  it("keeps the supported media types (png/jpg/pdf/svg/webp/gif)", () => {
    const v = vaultOf(
      file("/a.png"),
      file("/b.jpg"),
      file("/c.jpeg"),
      file("/d.gif"),
      file("/e.webp"),
      file("/f.svg"),
      file("/g.pdf"),
    );
    expect(collectMarkdownFiles(v).map((f) => f.name).sort()).toEqual([
      "a.png",
      "b.jpg",
      "c.jpeg",
      "d.gif",
      "e.webp",
      "f.svg",
      "g.pdf",
    ].sort());
  });

  it("handles both .md and .markdown extensions", () => {
    const v = vaultOf(file("/a.md"), file("/b.markdown"));
    const names = collectMarkdownFiles(v).map((f) => f.name).sort();
    expect(names).toEqual(["a", "b.markdown"]);
    // `.md` stripped, `.markdown` kept because it's media-style — the
    // current spec only strips the canonical `.md` form. Adjust this
    // assertion if the policy ever changes.
  });
});
