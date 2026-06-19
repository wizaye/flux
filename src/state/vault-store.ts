/**
 * Vault store — manages the active vault, file tree, and file operations.
 * 
 * This is the main integration point with the Tauri backend. All file system
 * operations go through the backend commands defined in src/bindings.ts.
 * 
 * Key responsibilities:
 * - Vault lifecycle (open, create, close)
 * - File tree management
 * - File CRUD operations (create, read, update, delete)
 * - Dirty tracking for unsaved changes
 */

/**
 * Vault store — central state for the active vault.
 * 
 * This is the single source of truth for vault state. Import specific
 * operation hooks from @/hooks for different use cases:
 * - useVaultOperations: vault lifecycle (open, close, create)
 * - useFileOperations: file CRUD (read, write, delete, move)
 * - useDirectoryOperations: directory operations
 * - useFileContent: content & dirty tracking
 */

import { create } from 'zustand';
import type { VaultHandle } from '@/bindings';
import type { FileNode } from './editor/types';
import { kindForFile } from '@/lib/file-tree-utils';

export interface VaultState {
  // ── Vault lifecycle ────────────────────────────────────────────────
  vaultHandle: VaultHandle | null;
  isVaultOpen: boolean;
  
  // ── File tree ──────────────────────────────────────────────────────
  fileTree: FileNode[]; // Frontend format (nested)
  isLoadingTree: boolean;
  
  // ── File contents ──────────────────────────────────────────────────
  openFiles: Map<string, string>; // path -> content
  dirtyFiles: Set<string>; // paths with unsaved changes
  
  // ── State setters (used by operation hooks) ────────────────────────
  setVaultHandle: (handle: VaultHandle | null) => void;
  setVaultOpen: (open: boolean) => void;
  setFileTree: (tree: FileNode[]) => void;
  setLoadingTree: (loading: boolean) => void;
  setFileContent: (path: string, content: string) => void;
  removeFileContent: (path: string) => void;
  markDirty: (path: string) => void;
  markClean: (path: string) => void;
  clearAllState: () => void;

  // ── Surgical tree mutations ────────────────────────────────────────
  // These rewrite ONLY the affected sub-branch of `fileTree` so React
  // reconciles a single sibling and the editor's vault Map keeps the
  // same FileNode references for every untouched file. That's what
  // prevents the full-tree flicker / CodeMirror remount that a
  // backend round-trip (`getFileTree`) would otherwise trigger after
  // every rename / create / delete.
  /** Rename/move a node from `oldPath` to `newPath`. Updates the
   *  node's `id` + `name`, and rewrites descendant ids when the
   *  renamed node is a folder. */
  renameNodeInTree: (oldPath: string, newPath: string) => void;
  /** Remove a node (file or folder) from the tree. No-op if absent. */
  removeNodeFromTree: (path: string) => void;
  /** Insert a new file or folder at `path`. Creates intermediate
   *  folders if they don't exist (e.g. inserting "a/b/c.md" under a
   *  brand-new "a/b/"). No-op if a node already exists at `path`. */
  addNodeToTree: (path: string, kind: 'file' | 'folder') => void;
}

export const useVaultStore = create<VaultState>((set) => ({
  // ── Initial state ──────────────────────────────────────────────────
  vaultHandle: null,
  isVaultOpen: false,
  fileTree: [],
  isLoadingTree: false,
  openFiles: new Map(),
  dirtyFiles: new Set(),
  
  // ── State setters ──────────────────────────────────────────────────
  
  setVaultHandle: (handle) => set({ vaultHandle: handle }),
  
  setVaultOpen: (open) => set({ isVaultOpen: open }),
  
  setFileTree: (tree) => set({ fileTree: tree }),
  
  setLoadingTree: (loading) => set({ isLoadingTree: loading }),
  
  setFileContent: (path, content) =>
    set((state) => {
      const newOpenFiles = new Map(state.openFiles);
      newOpenFiles.set(path, content);
      return { openFiles: newOpenFiles };
    }),
  
  removeFileContent: (path) =>
    set((state) => {
      const newOpenFiles = new Map(state.openFiles);
      newOpenFiles.delete(path);
      return { openFiles: newOpenFiles };
    }),
  
  markDirty: (path) =>
    set((state) => {
      if (state.dirtyFiles.has(path)) return state;
      const newDirtyFiles = new Set(state.dirtyFiles);
      newDirtyFiles.add(path);
      return { dirtyFiles: newDirtyFiles };
    }),
  
  markClean: (path) =>
    set((state) => {
      if (!state.dirtyFiles.has(path)) return state;
      const newDirtyFiles = new Set(state.dirtyFiles);
      newDirtyFiles.delete(path);
      return { dirtyFiles: newDirtyFiles };
    }),
  
  clearAllState: () =>
    set({
      vaultHandle: null,
      isVaultOpen: false,
      fileTree: [],
      isLoadingTree: false,
      openFiles: new Map(),
      dirtyFiles: new Set(),
    }),

  renameNodeInTree: (oldPath, newPath) =>
    set((state) => ({ fileTree: renameInTree(state.fileTree, oldPath, newPath) })),

  removeNodeFromTree: (path) =>
    set((state) => ({ fileTree: removeFromTree(state.fileTree, path) })),

  addNodeToTree: (path, kind) =>
    set((state) => ({ fileTree: addToTree(state.fileTree, path, kind) })),
}));

// ── Tree helpers ────────────────────────────────────────────────────
//
// All helpers return NEW arrays only along the changed branch — every
// untouched sibling keeps its identity so React reconciliation skips
// re-rendering them and the editor's vault Map sees the same FileNode
// references for unaffected files (no flicker on rename / create /
// delete).

const sep = (path: string): string => (path.includes("\\") ? "\\" : "/");
const splitPath = (path: string): string[] =>
  path.split(/[\\/]/).filter((p) => p.length > 0);

function withChildId(parentPath: string, name: string): string {
  if (!parentPath) return name;
  return `${parentPath}${sep(parentPath)}${name}`;
}

function rewriteSubtree(node: FileNode, oldPath: string, newPath: string): FileNode {
  // Preserve identity for descendants by keeping the rest of the
  // path intact and only swapping the prefix.
  const nextId =
    node.id === oldPath ? newPath : newPath + node.id.slice(oldPath.length);
  const newPathParts = splitPath(newPath);
  const nextName = node.id === oldPath
    ? (newPathParts[newPathParts.length - 1] ?? node.name)
    : node.name;
  if (!node.children) {
    return { ...node, id: nextId, name: nextName };
  }
  return {
    ...node,
    id: nextId,
    name: nextName,
    children: node.children.map((c) => rewriteSubtree(c, oldPath, newPath)),
  };
}

function isDescendant(childId: string, ancestorId: string): boolean {
  if (childId === ancestorId) return true;
  return (
    childId.startsWith(ancestorId + "/") || childId.startsWith(ancestorId + "\\")
  );
}

function renameInTree(
  nodes: FileNode[],
  oldPath: string,
  newPath: string,
): FileNode[] {
  // Two cases:
  //   1. Rename within the same parent (just changes the leaf name).
  //   2. Move to a different parent — delete from old location,
  //      insert under the new one. We do this by reusing the
  //      existing subtree (rewritten) so descendant identity is
  //      preserved as much as possible.
  let extracted: FileNode | null = null;
  const without = removeFromTreeCollect(nodes, oldPath, (n) => {
    extracted = n;
  });
  if (!extracted) return nodes;
  const rewritten = rewriteSubtree(extracted, oldPath, newPath);
  return addNodeAt(without, newPath, rewritten);
}

function removeFromTree(nodes: FileNode[], path: string): FileNode[] {
  return removeFromTreeCollect(nodes, path);
}

function removeFromTreeCollect(
  nodes: FileNode[],
  path: string,
  onFound?: (n: FileNode) => void,
): FileNode[] {
  let touched = false;
  const next: FileNode[] = [];
  for (const n of nodes) {
    if (n.id === path) {
      touched = true;
      onFound?.(n);
      continue;
    }
    if (n.children && isDescendant(path, n.id)) {
      const newChildren = removeFromTreeCollect(n.children, path, onFound);
      if (newChildren !== n.children) {
        touched = true;
        next.push({ ...n, children: newChildren });
        continue;
      }
    }
    next.push(n);
  }
  return touched ? next : nodes;
}

function addToTree(
  nodes: FileNode[],
  path: string,
  kind: 'file' | 'folder',
): FileNode[] {
  const parts = splitPath(path);
  const leafName = parts[parts.length - 1] ?? path;
  const fileKind: FileNode['kind'] =
    kind === 'folder' ? 'folder' : kindForFile(leafName);
  const leaf: FileNode = {
    id: path,
    name: leafName,
    kind: fileKind,
    children: kind === 'folder' ? [] : undefined,
  };
  return addNodeAt(nodes, path, leaf);
}

function addNodeAt(
  nodes: FileNode[],
  path: string,
  leaf: FileNode,
): FileNode[] {
  const parts = splitPath(path);
  if (parts.length === 0) return nodes;
  // No-op if a node already exists at `path`.
  if (findById(nodes, path)) return nodes;
  return insertRec(nodes, parts, '', leaf);
}

function insertRec(
  nodes: FileNode[],
  parts: string[],
  currentPath: string,
  leaf: FileNode,
): FileNode[] {
  if (parts.length === 1) {
    // Insert at this level, keeping folders-first / alpha order.
    const next = [...nodes, leaf];
    next.sort(compareSiblings);
    return next;
  }
  const [head, ...rest] = parts;
  const nextPath = currentPath ? withChildId(currentPath, head) : head;
  const idx = nodes.findIndex((n) => n.id === nextPath);
  if (idx === -1) {
    // Parent folder doesn't exist yet — synthesize it.
    const folder: FileNode = {
      id: nextPath,
      name: head,
      kind: 'folder',
      children: insertRec([], rest, nextPath, leaf),
    };
    const next = [...nodes, folder];
    next.sort(compareSiblings);
    return next;
  }
  const parent = nodes[idx];
  if (!parent.children) return nodes; // not a folder; can't descend
  const newChildren = insertRec(parent.children, rest, nextPath, leaf);
  if (newChildren === parent.children) return nodes;
  const next = [...nodes];
  next[idx] = { ...parent, children: newChildren };
  return next;
}

function findById(nodes: FileNode[], id: string): FileNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children) {
      const found = findById(n.children, id);
      if (found) return found;
    }
  }
  return null;
}

function compareSiblings(a: FileNode, b: FileNode): number {
  const aFolder = a.kind === 'folder';
  const bFolder = b.kind === 'folder';
  if (aFolder !== bFolder) return aFolder ? -1 : 1;
  return a.name.localeCompare(b.name);
}
