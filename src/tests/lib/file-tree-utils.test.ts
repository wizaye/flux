/**
 * Unit tests for tree<->flat conversion helpers used to bridge the
 * backend `FileTreeNode[]` (flat with depth) and the frontend
 * nested `FileNode[]` structure.
 */
import { describe, expect, it } from "vitest";

import type { FileTreeNode } from "@/bindings";
import type { FileNode } from "@/state/editor/types";
import {
  fileNodesToFileTree,
  fileTreeToFileNodes,
  kindForFile,
} from "@/lib/file-tree-utils";

// Helper to build a flat backend node with sensible defaults.
function flat(
  id: string,
  name: string,
  depth: number,
  type: "directory" | "file",
): FileTreeNode {
  return {
    id,
    name,
    depth,
    type,
    parentId: null,
    isOpen: false,
    state: null,
    childCount: null,
    size: null,
    modifiedAt: 0,
  };
}

describe("kindForFile", () => {
  it("returns 'pdf' for PDF extensions (case-insensitive)", () => {
    expect(kindForFile("paper.pdf")).toBe("pdf");
    expect(kindForFile("PAPER.PDF")).toBe("pdf");
    expect(kindForFile("path/to/x.Pdf")).toBe("pdf");
  });

  it("returns 'canvas' for .canvas files", () => {
    expect(kindForFile("board.canvas")).toBe("canvas");
    expect(kindForFile("Whiteboard.CANVAS")).toBe("canvas");
  });

  it("returns 'file' for plain text / markdown / unknown", () => {
    expect(kindForFile("note.md")).toBe("file");
    expect(kindForFile("plain.txt")).toBe("file");
    expect(kindForFile("no-extension")).toBe("file");
  });
});

describe("fileTreeToFileNodes", () => {
  it("returns [] for empty input", () => {
    expect(fileTreeToFileNodes([])).toEqual([]);
  });

  it("converts a single root file", () => {
    const out = fileTreeToFileNodes([flat("a.md", "a.md", 0, "file")]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("a.md");
    expect(out[0].kind).toBe("file");
    expect(out[0].children).toBeUndefined();
  });

  it("nests children under their parent folder by depth", () => {
    const out = fileTreeToFileNodes([
      flat("notes", "notes", 0, "directory"),
      flat("notes/a.md", "a.md", 1, "file"),
      flat("notes/b.md", "b.md", 1, "file"),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("folder");
    expect(out[0].children).toHaveLength(2);
    expect(out[0].children!.map((c) => c.id)).toEqual([
      "notes/a.md",
      "notes/b.md",
    ]);
  });

  it("handles a deep mixed tree with siblings", () => {
    const out = fileTreeToFileNodes([
      flat("notes", "notes", 0, "directory"),
      flat("notes/sub", "sub", 1, "directory"),
      flat("notes/sub/deep.md", "deep.md", 2, "file"),
      flat("notes/top.md", "top.md", 1, "file"),
      flat("README.md", "README.md", 0, "file"),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe("notes");
    expect(out[0].children).toHaveLength(2);
    const sub = out[0].children!.find((c) => c.id === "notes/sub")!;
    expect(sub.children).toHaveLength(1);
    expect(sub.children![0].id).toBe("notes/sub/deep.md");
    expect(out[1].id).toBe("README.md");
  });

  it("propagates kindForFile through nested files", () => {
    const out = fileTreeToFileNodes([
      flat("docs", "docs", 0, "directory"),
      flat("docs/paper.pdf", "paper.pdf", 1, "file"),
      flat("docs/board.canvas", "board.canvas", 1, "file"),
      flat("docs/note.md", "note.md", 1, "file"),
    ]);
    const children = out[0].children!;
    expect(children.find((c) => c.id === "docs/paper.pdf")!.kind).toBe("pdf");
    expect(children.find((c) => c.id === "docs/board.canvas")!.kind).toBe(
      "canvas",
    );
    expect(children.find((c) => c.id === "docs/note.md")!.kind).toBe("file");
  });

  it("creates empty children arrays for empty folders", () => {
    const out = fileTreeToFileNodes([
      flat("empty", "empty", 0, "directory"),
    ]);
    expect(out[0].kind).toBe("folder");
    expect(out[0].children).toEqual([]);
  });
});

describe("fileNodesToFileTree (round trip)", () => {
  it("returns [] for empty input", () => {
    expect(fileNodesToFileTree([])).toEqual([]);
  });

  it("flattens a nested tree with correct depth ordering", () => {
    const tree: FileNode[] = [
      {
        id: "notes",
        name: "notes",
        kind: "folder",
        children: [
          { id: "notes/a.md", name: "a.md", kind: "file" },
          {
            id: "notes/sub",
            name: "sub",
            kind: "folder",
            children: [{ id: "notes/sub/x.md", name: "x.md", kind: "file" }],
          },
        ],
      },
      { id: "top.md", name: "top.md", kind: "file" },
    ];
    const flat = fileNodesToFileTree(tree);
    expect(flat.map((n) => [n.id, n.depth])).toEqual([
      ["notes", 0],
      ["notes/a.md", 1],
      ["notes/sub", 1],
      ["notes/sub/x.md", 2],
      ["top.md", 0],
    ]);
  });

  it("round-trips: tree → flat → tree preserves ids and shape", () => {
    const tree: FileNode[] = [
      {
        id: "a",
        name: "a",
        kind: "folder",
        children: [
          { id: "a/b.md", name: "b.md", kind: "file" },
          {
            id: "a/c",
            name: "c",
            kind: "folder",
            children: [{ id: "a/c/d.md", name: "d.md", kind: "file" }],
          },
        ],
      },
    ];
    const flat = fileNodesToFileTree(tree);
    const back = fileTreeToFileNodes(flat);
    const collectIds = (nodes: FileNode[]): string[] =>
      nodes.flatMap((n) => [n.id, ...(n.children ? collectIds(n.children) : [])]);
    expect(collectIds(back)).toEqual(collectIds(tree));
  });
});
