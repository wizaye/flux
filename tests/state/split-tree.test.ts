/**
 * Unit tests for split-tree.ts
 *
 * split-tree contains only pure functions that return new tree
 * references — no Zustand, no Tauri, no DOM.  Every test creates
 * fixture trees from scratch so there is no shared mutable state.
 *
 * Covered functions:
 *   findLeaf, leaves, topRightLeaf, mapLeaves,
 *   replaceLeaf, openTabInLeaf, insertTabAt,
 *   moveTabWithinLeaf, removeTabFromLeaf, splitLeaf
 */
import { describe, it, expect } from "vitest";
import type { SplitTree, Tab } from "@/state/editor/types";
import {
  findLeaf,
  leaves,
  topRightLeaf,
  mapLeaves,
  replaceLeaf,
  openTabInLeaf,
  insertTabAt,
  moveTabWithinLeaf,
  removeTabFromLeaf,
  splitLeaf,
} from "@/state/editor/split-tree";

// ── Fixture helpers ────────────────────────────────────────────────────────

/** Build a Tab with sensible defaults. fileId mirrors the id so
 *  "same-file" dedup logic in openTabInLeaf / insertTabAt is testable. */
function tab(id: string, fileId: string | null = id): Tab {
  return { id, fileId, title: `Tab ${id}`, viewMode: "source" };
}

/** Build a leaf with explicit tab ids. activeTabId defaults to the
 *  first tab so tests don't have to repeat it. */
function leaf(
  id: string,
  tabIds: string[],
  activeTabId?: string,
): Extract<SplitTree, { kind: "leaf" }> {
  const tabs = tabIds.map((t) => tab(t));
  return {
    kind: "leaf",
    id,
    tabs,
    activeTabId: activeTabId ?? tabs[0]?.id ?? "",
  };
}

/** Build a horizontal split. */
function hsplit(
  id: string,
  a: SplitTree,
  b: SplitTree,
  ratio = 0.5,
): Extract<SplitTree, { kind: "split" }> {
  return { kind: "split", id, direction: "horizontal", ratio, a, b };
}

/** Build a vertical split. */
function vsplit(
  id: string,
  a: SplitTree,
  b: SplitTree,
  ratio = 0.5,
): Extract<SplitTree, { kind: "split" }> {
  return { kind: "split", id, direction: "vertical", ratio, a, b };
}

// ── findLeaf ───────────────────────────────────────────────────────────────

describe("findLeaf", () => {
  it("returns the leaf when the tree is a single leaf with a matching id", () => {
    const l = leaf("l1", ["t1"]);
    expect(findLeaf(l, "l1")).toBe(l);
  });

  it("returns null when the id does not exist in a single leaf", () => {
    expect(findLeaf(leaf("l1", ["t1"]), "missing")).toBeNull();
  });

  it("finds the left child of a horizontal split", () => {
    const left = leaf("left", ["t1"]);
    const right = leaf("right", ["t2"]);
    expect(findLeaf(hsplit("s1", left, right), "left")).toBe(left);
  });

  it("finds the right child of a horizontal split", () => {
    const left = leaf("left", ["t1"]);
    const right = leaf("right", ["t2"]);
    expect(findLeaf(hsplit("s1", left, right), "right")).toBe(right);
  });

  it("finds a deeply nested leaf", () => {
    const l1 = leaf("l1", ["t1"]);
    const l2 = leaf("l2", ["t2"]);
    const l3 = leaf("l3", ["t3"]);
    const tree = vsplit("outer", hsplit("inner", l1, l2), l3);
    expect(findLeaf(tree, "l2")).toBe(l2);
  });

  it("returns null when searching a split tree for a non-existent id", () => {
    const tree = hsplit("s1", leaf("l1", ["t1"]), leaf("l2", ["t2"]));
    expect(findLeaf(tree, "nowhere")).toBeNull();
  });
});

// ── leaves ─────────────────────────────────────────────────────────────────

describe("leaves", () => {
  it("returns [leaf] for a single leaf", () => {
    const l = leaf("l1", ["t1"]);
    expect(leaves(l)).toEqual([l]);
  });

  it("returns both leaves for a flat split in a→b order", () => {
    const l1 = leaf("l1", ["t1"]);
    const l2 = leaf("l2", ["t2"]);
    expect(leaves(hsplit("s1", l1, l2))).toEqual([l1, l2]);
  });

  it("returns all leaves in document order for a nested tree", () => {
    const l1 = leaf("l1", ["t1"]);
    const l2 = leaf("l2", ["t2"]);
    const l3 = leaf("l3", ["t3"]);
    const tree = vsplit("outer", hsplit("inner", l1, l2), l3);
    expect(leaves(tree).map((l) => l.id)).toEqual(["l1", "l2", "l3"]);
  });
});

// ── topRightLeaf ───────────────────────────────────────────────────────────

describe("topRightLeaf", () => {
  it("returns itself for a plain leaf", () => {
    const l = leaf("l1", ["t1"]);
    expect(topRightLeaf(l)).toBe(l);
  });

  it("returns b (rightmost) for a horizontal split", () => {
    const l1 = leaf("l1", ["t1"]);
    const l2 = leaf("l2", ["t2"]);
    expect(topRightLeaf(hsplit("s", l1, l2))).toBe(l2);
  });

  it("returns a (topmost) for a vertical split", () => {
    const l1 = leaf("l1", ["t1"]);
    const l2 = leaf("l2", ["t2"]);
    expect(topRightLeaf(vsplit("s", l1, l2))).toBe(l1);
  });

  it("recurses: returns the top-right corner of a complex tree", () => {
    // Layout:  [ l1 | [ l2 / l3 ] ]
    // topRight → b side → vertical split → a (top) = l2
    const l1 = leaf("l1", ["t1"]);
    const l2 = leaf("l2", ["t2"]);
    const l3 = leaf("l3", ["t3"]);
    const tree = hsplit("h", l1, vsplit("v", l2, l3));
    expect(topRightLeaf(tree)).toBe(l2);
  });
});

// ── mapLeaves ──────────────────────────────────────────────────────────────

describe("mapLeaves", () => {
  it("transforms every leaf through the callback", () => {
    const l1 = leaf("l1", ["t1"]);
    const l2 = leaf("l2", ["t2"]);
    const tree = hsplit("s", l1, l2);
    const result = mapLeaves(tree, (l) => ({ ...l, id: l.id + "-mapped" }));
    expect(leaves(result!).map((l) => l.id)).toEqual(["l1-mapped", "l2-mapped"]);
  });

  it("collapses a split to the surviving sibling when one leaf is nulled", () => {
    const l1 = leaf("l1", ["t1"]);
    const l2 = leaf("l2", ["t2"]);
    const tree = hsplit("s", l1, l2);
    const result = mapLeaves(tree, (l) => (l.id === "l1" ? null : l));
    expect(result).toBe(l2);
  });

  it("returns null when all leaves are nulled", () => {
    const l = leaf("l1", ["t1"]);
    expect(mapLeaves(l, () => null)).toBeNull();
  });

  it("returns a new split node reference but preserves unchanged leaves", () => {
    const l1 = leaf("l1", ["t1"]);
    const l2 = leaf("l2", ["t2"]);
    const tree = hsplit("s", l1, l2);
    // Only transform l1; l2 should come back as the same reference
    const result = mapLeaves(tree, (l) => (l.id === "l1" ? { ...l } : l)) as Extract<
      SplitTree,
      { kind: "split" }
    >;
    expect(result.b).toBe(l2);
  });
});

// ── replaceLeaf ────────────────────────────────────────────────────────────

describe("replaceLeaf", () => {
  it("replaces a single-leaf tree with the replacement", () => {
    const old = leaf("old", ["t1"]);
    const newLeaf = leaf("new", ["t2"]);
    expect(replaceLeaf(old, "old", newLeaf)).toBe(newLeaf);
  });

  it("returns null when the only leaf is removed (null replacement)", () => {
    expect(replaceLeaf(leaf("l1", ["t1"]), "l1", null)).toBeNull();
  });

  it("collapses a split to its surviving child when one child is removed", () => {
    const l1 = leaf("l1", ["t1"]);
    const l2 = leaf("l2", ["t2"]);
    expect(replaceLeaf(hsplit("s", l1, l2), "l1", null)).toBe(l2);
  });

  it("replaces only the targeted leaf, leaving the sibling intact", () => {
    const l1 = leaf("l1", ["t1"]);
    const l2 = leaf("l2", ["t2"]);
    const replacement = leaf("l1-new", ["t3"]);
    const result = replaceLeaf(hsplit("s", l1, l2), "l1", replacement) as Extract<
      SplitTree,
      { kind: "split" }
    >;
    expect(result.a).toBe(replacement);
    expect(result.b).toBe(l2);
  });

  it("does not mutate the original tree (original split still has old leaf)", () => {
    const l1 = leaf("l1", ["t1"]);
    const l2 = leaf("l2", ["t2"]);
    const tree = hsplit("s", l1, l2);
    replaceLeaf(tree, "l1", leaf("new", ["t3"]));
    expect((tree as Extract<SplitTree, { kind: "split" }>).a).toBe(l1);
  });
});

// ── openTabInLeaf ──────────────────────────────────────────────────────────

describe("openTabInLeaf", () => {
  it("appends a new tab and makes it active", () => {
    const l = leaf("l1", ["t1"]);
    const result = openTabInLeaf(l, tab("t2", "file-2"));
    expect(result.tabs).toHaveLength(2);
    expect(result.activeTabId).toBe("t2");
  });

  it("works on an empty leaf (no existing tabs)", () => {
    const empty: Extract<SplitTree, { kind: "leaf" }> = {
      kind: "leaf",
      id: "l1",
      tabs: [],
      activeTabId: "",
    };
    const result = openTabInLeaf(empty, tab("t1"));
    expect(result.tabs).toHaveLength(1);
    expect(result.activeTabId).toBe("t1");
  });

  it("focuses an existing tab by fileId instead of adding a duplicate", () => {
    // tab "t1" has fileId "t1" (set by fixture helper)
    const l = leaf("l1", ["t1", "t2"], "t2");
    const result = openTabInLeaf(l, tab("t-dup", "t1")); // same fileId as t1
    expect(result.tabs).toHaveLength(2); // no new tab
    expect(result.activeTabId).toBe("t1"); // focused existing
  });

  it("adds a tab whose fileId is null without dedup", () => {
    const l = leaf("l1", ["t1"]);
    const newTab: Tab = { id: "t-null", fileId: null, title: "New tab" };
    const result = openTabInLeaf(l, newTab);
    expect(result.tabs).toHaveLength(2);
  });

  it("does not mutate the original leaf", () => {
    const l = leaf("l1", ["t1"]);
    openTabInLeaf(l, tab("t2"));
    expect(l.tabs).toHaveLength(1);
  });
});

// ── insertTabAt ────────────────────────────────────────────────────────────

describe("insertTabAt", () => {
  it("inserts at index 0 (prepend)", () => {
    const l = leaf("l1", ["t1", "t2"]);
    const result = insertTabAt(l, tab("t3", "file-3"), 0);
    expect(result.tabs[0].id).toBe("t3");
  });

  it("inserts at the end", () => {
    const l = leaf("l1", ["t1", "t2"]);
    const result = insertTabAt(l, tab("t3", "file-3"), 2);
    expect(result.tabs[2].id).toBe("t3");
  });

  it("clamps an out-of-bounds index to the end", () => {
    const l = leaf("l1", ["t1"]);
    const result = insertTabAt(l, tab("t2", "file-2"), 999);
    expect(result.tabs[1].id).toBe("t2");
  });

  it("makes the inserted tab active", () => {
    const l = leaf("l1", ["t1"]);
    const result = insertTabAt(l, tab("t2", "file-2"), 1);
    expect(result.activeTabId).toBe("t2");
  });

  it("moves an existing tab by fileId instead of duplicating (dedup)", () => {
    // t1 has fileId "t1"; inserting a tab with the same fileId moves t1
    const l = leaf("l1", ["t1", "t2", "t3"]);
    const dup = tab("t-dup", "t1");
    const result = insertTabAt(l, dup, 2); // targetIndex 2, current t1 at 0 → adjusted = 2-1 = 1
    expect(result.tabs).toHaveLength(3);
    expect(result.tabs[1].id).toBe("t1");
  });
});

// ── moveTabWithinLeaf ──────────────────────────────────────────────────────

describe("moveTabWithinLeaf", () => {
  it("returns the same leaf reference for a no-op move (same position)", () => {
    const l = leaf("l1", ["t1", "t2", "t3"]);
    // t1 is at index 0; targetIndex 0 → adjusted 0 = curIdx 0 → no-op
    expect(moveTabWithinLeaf(l, "t1", 0)).toBe(l);
  });

  it("returns the same reference when tabId is not found", () => {
    const l = leaf("l1", ["t1", "t2"]);
    expect(moveTabWithinLeaf(l, "unknown", 1)).toBe(l);
  });

  it("moves a tab from the left to the right", () => {
    const l = leaf("l1", ["t1", "t2", "t3"]);
    // Move t1 (idx 0) to targetIndex 2 → adjusted = 2-1 = 1
    const result = moveTabWithinLeaf(l, "t1", 2);
    expect(result.tabs.map((t) => t.id)).toEqual(["t2", "t1", "t3"]);
  });

  it("moves a tab from the right to the left", () => {
    const l = leaf("l1", ["t1", "t2", "t3"]);
    // Move t3 (idx 2) to targetIndex 0 → adjusted = 0
    const result = moveTabWithinLeaf(l, "t3", 0);
    expect(result.tabs.map((t) => t.id)).toEqual(["t3", "t1", "t2"]);
  });

  it("does not mutate the original leaf", () => {
    const l = leaf("l1", ["t1", "t2", "t3"]);
    moveTabWithinLeaf(l, "t1", 2);
    expect(l.tabs.map((t) => t.id)).toEqual(["t1", "t2", "t3"]);
  });
});

// ── removeTabFromLeaf ─────────────────────────────────────────────────────

describe("removeTabFromLeaf", () => {
  it("returns null when the last tab is removed", () => {
    expect(removeTabFromLeaf(leaf("l1", ["t1"]), "t1")).toBeNull();
  });

  it("returns the same reference when tabId is not found", () => {
    const l = leaf("l1", ["t1", "t2"]);
    expect(removeTabFromLeaf(l, "unknown")).toBe(l);
  });

  it("removes the targeted tab from the list", () => {
    const l = leaf("l1", ["t1", "t2", "t3"]);
    const result = removeTabFromLeaf(l, "t2");
    expect(result?.tabs.map((t) => t.id)).toEqual(["t1", "t3"]);
  });

  it("shifts active to the tab before the removed one when it was active", () => {
    // activeTabId = "t2" (index 1); removing t2 → focus t1 (index 0)
    const l = leaf("l1", ["t1", "t2", "t3"], "t2");
    expect(removeTabFromLeaf(l, "t2")?.activeTabId).toBe("t1");
  });

  it("keeps active unchanged when the removed tab was not active", () => {
    const l = leaf("l1", ["t1", "t2", "t3"]); // activeTabId = "t1"
    expect(removeTabFromLeaf(l, "t3")?.activeTabId).toBe("t1");
  });

  it("sets active to index 0 when removing the first tab (was active)", () => {
    // t1 was active, removing t1 → t2 is now at index 0 → focus t2
    const l = leaf("l1", ["t1", "t2", "t3"]); // activeTabId = "t1"
    expect(removeTabFromLeaf(l, "t1")?.activeTabId).toBe("t2");
  });

  it("does not mutate the original leaf", () => {
    const l = leaf("l1", ["t1", "t2"]);
    removeTabFromLeaf(l, "t1");
    expect(l.tabs).toHaveLength(2);
  });
});

// ── splitLeaf ──────────────────────────────────────────────────────────────

describe("splitLeaf", () => {
  it("creates a horizontal split with the new pane on the right (placeAfter=true)", () => {
    const l1 = leaf("l1", ["t1"]);
    const l2 = leaf("l2", ["t2"]);
    const result = splitLeaf(l1, "l1", "horizontal", l2, true) as Extract<
      SplitTree,
      { kind: "split" }
    >;
    expect(result.kind).toBe("split");
    expect(result.direction).toBe("horizontal");
    expect(result.a).toBe(l1);
    expect(result.b).toBe(l2);
  });

  it("creates a horizontal split with the new pane on the left (placeAfter=false)", () => {
    const l1 = leaf("l1", ["t1"]);
    const l2 = leaf("l2", ["t2"]);
    const result = splitLeaf(l1, "l1", "horizontal", l2, false) as Extract<
      SplitTree,
      { kind: "split" }
    >;
    expect(result.a).toBe(l2); // new pane on left
    expect(result.b).toBe(l1);
  });

  it("creates a vertical split", () => {
    const l1 = leaf("l1", ["t1"]);
    const l2 = leaf("l2", ["t2"]);
    const result = splitLeaf(l1, "l1", "vertical", l2, true) as Extract<
      SplitTree,
      { kind: "split" }
    >;
    expect(result.direction).toBe("vertical");
  });

  it("defaults the split ratio to 0.5", () => {
    const l1 = leaf("l1", ["t1"]);
    const l2 = leaf("l2", ["t2"]);
    const result = splitLeaf(l1, "l1", "horizontal", l2, true) as Extract<
      SplitTree,
      { kind: "split" }
    >;
    expect(result.ratio).toBe(0.5);
  });

  it("only splits the targeted leaf in a multi-leaf tree", () => {
    const l1 = leaf("l1", ["t1"]);
    const l2 = leaf("l2", ["t2"]);
    const l3 = leaf("l3", ["t3"]);
    const tree = hsplit("h", l1, l2);
    // Split l1 only
    const result = splitLeaf(tree, "l1", "vertical", l3, true) as Extract<
      SplitTree,
      { kind: "split" }
    >;
    // Outer split b should still be l2
    expect(result.b).toBe(l2);
    // Outer split a should now be a vertical split containing l1 and l3
    const inner = result.a as Extract<SplitTree, { kind: "split" }>;
    expect(inner.kind).toBe("split");
    expect(inner.direction).toBe("vertical");
  });

  it("is a no-op for a leaf id that does not exist in the tree", () => {
    const l1 = leaf("l1", ["t1"]);
    const l2 = leaf("l2", ["t2"]);
    // Splitting a non-existent id should return the tree unchanged
    const result = splitLeaf(l1, "missing", "horizontal", l2, true);
    expect(result).toBe(l1);
  });
});
