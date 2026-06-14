/**
 * Pure-function helpers for mutating the immutable `SplitTree`.
 * Ported from `lattice/src/state/splitTree.ts`. Every function
 * returns a new tree (or leaf) reference so React can `===`-bail
 * during reconciliation.
 *
 * The split-tree itself is owned by the EditorArea's parent (the
 * lattice shell), so these helpers don't import zustand — they're
 * pure data transforms callable from anywhere.
 */
import type { SplitTree, Tab } from "./types";

let _id = 0;
/**
 * Monotonically-increasing unique id with a coarse timestamp suffix.
 * The Date.now() part guarantees uniqueness even after a hot-reload
 * resets the in-memory counter; the integer part keeps repeated calls
 * in the same millisecond apart.
 */
export const uid = (prefix = "n") =>
  `${prefix}-${++_id}-${Date.now().toString(36)}`;

/** Find a leaf by id. Walks the tree depth-first. */
export function findLeaf(
  tree: SplitTree,
  id: string,
): Extract<SplitTree, { kind: "leaf" }> | null {
  if (tree.kind === "leaf") return tree.id === id ? tree : null;
  return findLeaf(tree.a, id) ?? findLeaf(tree.b, id);
}

/** All leaves in document order (a-then-b for splits). */
export function leaves(
  tree: SplitTree,
): Extract<SplitTree, { kind: "leaf" }>[] {
  if (tree.kind === "leaf") return [tree];
  return [...leaves(tree.a), ...leaves(tree.b)];
}

/**
 * Topmost-rightmost leaf — the pane that owns the top-right corner of
 * the editor area (where the Windows window controls float and the
 * right-sidebar toggle lives).
 *
 *   horizontal split (a | b)  → rightmost is in `b`
 *   vertical split   (a / b)  → topmost is in `a`
 */
export function topRightLeaf(
  tree: SplitTree,
): Extract<SplitTree, { kind: "leaf" }> {
  if (tree.kind === "leaf") return tree;
  if (tree.direction === "horizontal") return topRightLeaf(tree.b);
  return topRightLeaf(tree.a);
}

/**
 * Map every leaf through `fn`. Splits whose child becomes `null`
 * collapse to the surviving sibling. Returns `null` if every leaf
 * was nulled out (caller decides whether to repopulate).
 */
export function mapLeaves(
  tree: SplitTree,
  fn: (leaf: Extract<SplitTree, { kind: "leaf" }>) => SplitTree | null,
): SplitTree | null {
  if (tree.kind === "leaf") return fn(tree);
  const a = mapLeaves(tree.a, fn);
  const b = mapLeaves(tree.b, fn);
  if (!a && !b) return null;
  if (!a) return b;
  if (!b) return a;
  return { ...tree, a, b };
}

/** Replace one specific leaf. `replacement === null` removes it. */
export function replaceLeaf(
  tree: SplitTree,
  id: string,
  replacement: SplitTree | null,
): SplitTree | null {
  return mapLeaves(tree, (leaf) => (leaf.id === id ? replacement : leaf));
}

/**
 * Append a tab to a leaf, or — if a tab for the same `fileId` already
 * exists — focus the existing tab instead of duplicating.
 */
export function openTabInLeaf(
  leaf: Extract<SplitTree, { kind: "leaf" }>,
  tab: Tab,
): Extract<SplitTree, { kind: "leaf" }> {
  if (tab.fileId) {
    const existing = leaf.tabs.find((t) => t.fileId === tab.fileId);
    if (existing) return { ...leaf, activeTabId: existing.id };
  }
  return { ...leaf, tabs: [...leaf.tabs, tab], activeTabId: tab.id };
}

/**
 * Insert a tab at a specific index (clamped to [0, tabs.length]).
 * Used when a drop lands BETWEEN two tabs in the tabbar.
 *
 * Same-fileId rule: if the file is already open in this leaf, don't
 * duplicate it — MOVE the existing tab to `index` (matching
 * `moveTabWithinLeaf`'s shift logic) and focus it.
 */
export function insertTabAt(
  leaf: Extract<SplitTree, { kind: "leaf" }>,
  tab: Tab,
  index: number,
): Extract<SplitTree, { kind: "leaf" }> {
  if (tab.fileId) {
    const existing = leaf.tabs.find((t) => t.fileId === tab.fileId);
    if (existing) {
      const moved = moveTabWithinLeaf(leaf, existing.id, index);
      return moved.activeTabId === existing.id
        ? moved
        : { ...moved, activeTabId: existing.id };
    }
  }
  const i = Math.max(0, Math.min(leaf.tabs.length, index));
  const tabs = [...leaf.tabs.slice(0, i), tab, ...leaf.tabs.slice(i)];
  return { ...leaf, tabs, activeTabId: tab.id };
}

/**
 * Reorder an existing tab within the same leaf so it ends up at
 * `targetIndex` — the insertion slot computed BEFORE the tab is
 * removed from its current position. When `targetIndex > currentIndex`
 * the removal shifts everything after it left by one, so the effective
 * destination is `targetIndex - 1`. No-op (returns the original leaf
 * reference) when the move would land the tab back in its current slot.
 */
export function moveTabWithinLeaf(
  leaf: Extract<SplitTree, { kind: "leaf" }>,
  tabId: string,
  targetIndex: number,
): Extract<SplitTree, { kind: "leaf" }> {
  const curIdx = leaf.tabs.findIndex((t) => t.id === tabId);
  if (curIdx < 0) return leaf;
  const adjusted = targetIndex > curIdx ? targetIndex - 1 : targetIndex;
  const finalIdx = Math.max(0, Math.min(leaf.tabs.length - 1, adjusted));
  if (finalIdx === curIdx) return leaf;
  const tabs = [...leaf.tabs];
  const [moved] = tabs.splice(curIdx, 1);
  tabs.splice(finalIdx, 0, moved);
  return { ...leaf, tabs };
}

/** Remove a tab from a leaf. Returns null when the leaf would become empty. */
export function removeTabFromLeaf(
  leaf: Extract<SplitTree, { kind: "leaf" }>,
  tabId: string,
): Extract<SplitTree, { kind: "leaf" }> | null {
  const idx = leaf.tabs.findIndex((t) => t.id === tabId);
  if (idx < 0) return leaf;
  const tabs = leaf.tabs.filter((t) => t.id !== tabId);
  if (tabs.length === 0) return null;
  const wasActive = leaf.activeTabId === tabId;
  const activeTabId = wasActive ? tabs[Math.max(0, idx - 1)].id : leaf.activeTabId;
  return { ...leaf, tabs, activeTabId };
}

/**
 * Split a leaf along `direction`, putting `newLeaf` on the side
 * determined by `placeAfter` (`true` = new pane goes right/below).
 */
export function splitLeaf(
  tree: SplitTree,
  leafId: string,
  direction: "horizontal" | "vertical",
  newLeaf: Extract<SplitTree, { kind: "leaf" }>,
  placeAfter: boolean,
): SplitTree {
  const result = mapLeaves(tree, (leaf) => {
    if (leaf.id !== leafId) return leaf;
    const split: SplitTree = {
      kind: "split",
      id: uid("split"),
      direction,
      ratio: 0.5,
      a: placeAfter ? leaf : newLeaf,
      b: placeAfter ? newLeaf : leaf,
    };
    return split;
  });
  return result ?? tree;
}

/**
 * Update one split node's ratio. Clamped to [0.05, 0.95] so a child
 * never collapses to zero. Returns the original tree when the id
 * isn't found (no allocation).
 */
export function setSplitRatio(
  tree: SplitTree,
  splitId: string,
  ratio: number,
): SplitTree {
  const clamped = Math.max(0.05, Math.min(0.95, ratio));
  function walk(node: SplitTree): SplitTree {
    if (node.kind === "leaf") return node;
    if (node.id === splitId) return { ...node, ratio: clamped };
    const a = walk(node.a);
    const b = walk(node.b);
    if (a === node.a && b === node.b) return node;
    return { ...node, a, b };
  }
  return walk(tree);
}

/**
 * Convert `direction` + `placeAfter` to a `DropEdge`. Inverse of the
 * lookup done inside `splitLeaf` callers — kept here so the editor
 * doesn't have to repeat the same conditional in three places.
 */
export function edgeToSplitArgs(
  edge: "left" | "right" | "top" | "bottom",
): { direction: "horizontal" | "vertical"; placeAfter: boolean } {
  return {
    direction: edge === "left" || edge === "right" ? "horizontal" : "vertical",
    placeAfter: edge === "right" || edge === "bottom",
  };
}
