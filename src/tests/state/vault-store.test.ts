import { describe, it, expect, beforeEach } from "vitest";
import { useVaultStore } from "@/state/vault-store";
import type { FileNode } from "@/state/editor/types";

beforeEach(() => {
  useVaultStore.getState().clearAllState();
});

describe("vaultStore - initial state", () => {
  it("starts with empty default state", () => {
    const state = useVaultStore.getState();
    expect(state.vaultHandle).toBeNull();
    expect(state.isVaultOpen).toBe(false);
    expect(state.fileTree).toEqual([]);
    expect(state.openFiles.size).toBe(0);
    expect(state.dirtyFiles.size).toBe(0);
  });
});

describe("vaultStore - state setters", () => {
  it("updates vaultHandle", () => {
    const handle = { path: "/my/vault", name: "vault", fileCount: 10, openedAt: 12345 };
    useVaultStore.getState().setVaultHandle(handle);
    expect(useVaultStore.getState().vaultHandle).toEqual(handle);
  });

  it("updates isVaultOpen", () => {
    useVaultStore.getState().setVaultOpen(true);
    expect(useVaultStore.getState().isVaultOpen).toBe(true);
  });

  it("updates fileTree", () => {
    const tree: FileNode[] = [{ id: "a.md", name: "a", kind: "file" }];
    useVaultStore.getState().setFileTree(tree);
    expect(useVaultStore.getState().fileTree).toEqual(tree);
  });

  it("updates loading tree state", () => {
    useVaultStore.getState().setLoadingTree(true);
    expect(useVaultStore.getState().isLoadingTree).toBe(true);
  });

  it("handles openFiles (setFileContent, removeFileContent)", () => {
    const { setFileContent, removeFileContent } = useVaultStore.getState();
    setFileContent("a.md", "hello");
    expect(useVaultStore.getState().openFiles.get("a.md")).toBe("hello");

    removeFileContent("a.md");
    expect(useVaultStore.getState().openFiles.has("a.md")).toBe(false);
  });

  it("handles dirtyFiles (markDirty, markClean)", () => {
    const { markDirty, markClean } = useVaultStore.getState();
    markDirty("a.md");
    expect(useVaultStore.getState().dirtyFiles.has("a.md")).toBe(true);

    // Idempotency check
    markDirty("a.md");
    expect(useVaultStore.getState().dirtyFiles.size).toBe(1);

    markClean("a.md");
    expect(useVaultStore.getState().dirtyFiles.has("a.md")).toBe(false);

    // Clean non-existent file
    const ref = useVaultStore.getState().dirtyFiles;
    markClean("nonexistent.md");
    expect(useVaultStore.getState().dirtyFiles).toBe(ref);
  });
});

describe("vaultStore - tree mutations", () => {
  it("adds nodes to the tree in sorted order", () => {
    const { addNodeToTree } = useVaultStore.getState();
    
    // Add folder
    addNodeToTree("folder1", "folder");
    // Add file under folder
    addNodeToTree("folder1/file1.md", "file");
    // Add sibling file
    addNodeToTree("file2.md", "file");

    const tree = useVaultStore.getState().fileTree;
    expect(tree).toHaveLength(2); // folder1, file2.md (folders first, then sorted alpha)
    expect(tree[0].id).toBe("folder1");
    expect(tree[0].kind).toBe("folder");
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children![0].id).toBe("folder1/file1.md");
    expect(tree[0].children![0].kind).toBe("file");
    expect(tree[1].id).toBe("file2.md");
    expect(tree[1].kind).toBe("file");

    // Add duplicate node - should no-op
    addNodeToTree("file2.md", "file");
    expect(useVaultStore.getState().fileTree).toHaveLength(2);
  });

  it("synthesizes parent folders automatically when adding deep nodes", () => {
    const { addNodeToTree } = useVaultStore.getState();
    addNodeToTree("deep/path/to/nested/file.md", "file");
    const tree = useVaultStore.getState().fileTree;

    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe("deep");
    expect(tree[0].children![0].id).toBe("deep/path");
    expect(tree[0].children![0].children![0].id).toBe("deep/path/to");
  });

  it("removes nodes from the tree", () => {
    const { addNodeToTree, removeNodeFromTree } = useVaultStore.getState();
    addNodeToTree("folder1", "folder");
    addNodeToTree("folder1/file1.md", "file");
    addNodeToTree("file2.md", "file");

    removeNodeFromTree("folder1/file1.md");
    let tree = useVaultStore.getState().fileTree;
    expect(tree[0].children).toHaveLength(0);

    removeNodeFromTree("folder1");
    tree = useVaultStore.getState().fileTree;
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe("file2.md");
  });

  it("renames/moves nodes in the tree", () => {
    const { addNodeToTree, renameNodeInTree } = useVaultStore.getState();
    addNodeToTree("folder1", "folder");
    addNodeToTree("folder1/file1.md", "file");
    addNodeToTree("file2.md", "file");

    // In-place rename
    renameNodeInTree("file2.md", "renamed-file.md");
    let tree = useVaultStore.getState().fileTree;
    expect(tree.map(t => t.id).sort()).toEqual(["folder1", "renamed-file.md"].sort());

    // Rename a folder (and descendants' paths should update recursively)
    renameNodeInTree("folder1", "folder2");
    tree = useVaultStore.getState().fileTree;
    const folder2 = tree.find(t => t.id === "folder2")!;
    expect(folder2).toBeDefined();
    expect(folder2.children![0].id).toBe("folder2/file1.md");

    // Move to a different folder
    renameNodeInTree("folder2/file1.md", "file1.md"); // move to root
    tree = useVaultStore.getState().fileTree;
    expect(tree.map(t => t.id).sort()).toEqual(["folder2", "renamed-file.md", "file1.md"].sort());

    // Rename non-existent node - should no-op
    const before = useVaultStore.getState().fileTree;
    renameNodeInTree("nonexistent.md", "someother.md");
    expect(useVaultStore.getState().fileTree).toBe(before);
  });
});

describe("vaultStore - tree rename edge cases", () => {
  it("renaming a folder from 'a' to 'aa' preserves descendant slash boundary", () => {
    // Regression: a naive slice(oldPath.length) implementation could
    // produce 'aab.md' instead of 'aa/b.md' when oldPath grows. The
    // current impl uses `oldPath.length` AND the descendant id
    // already starts with `oldPath + sep`, so the slice yields the
    // leading separator which the join preserves. Pin this behaviour
    // so a future refactor doesn't reintroduce the off-by-one risk.
    const { addNodeToTree, renameNodeInTree } = useVaultStore.getState();
    addNodeToTree("a", "folder");
    addNodeToTree("a/b.md", "file");
    addNodeToTree("a/sub", "folder");
    addNodeToTree("a/sub/c.md", "file");

    renameNodeInTree("a", "aa");

    const tree = useVaultStore.getState().fileTree;
    const aa = tree.find((t) => t.id === "aa");
    expect(aa).toBeDefined();
    const ids = (aa!.children ?? []).flatMap((n) => [
      n.id,
      ...((n.children ?? []).map((c) => c.id)),
    ]);
    // Every descendant id must keep its `/` separator after the rename.
    expect(ids).toContain("aa/b.md");
    expect(ids).toContain("aa/sub");
    expect(ids).toContain("aa/sub/c.md");
    // And must NOT have collapsed into the broken `aab.md` form.
    expect(ids.every((id) => !id.startsWith("aab") || id === "aab")).toBe(true);
  });

  it("renaming when no descendants share the slash boundary (case sensitivity)", () => {
    const { addNodeToTree, renameNodeInTree } = useVaultStore.getState();
    addNodeToTree("notes", "folder");
    addNodeToTree("notes/a.md", "file");
    addNodeToTree("Notes-Backup.md", "file"); // unrelated, different prefix

    renameNodeInTree("notes", "Notes");

    const tree = useVaultStore.getState().fileTree;
    expect(tree.find((t) => t.id === "Notes-Backup.md")).toBeDefined();
    const Notes = tree.find((t) => t.id === "Notes")!;
    expect(Notes.children![0].id).toBe("Notes/a.md");
  });
});