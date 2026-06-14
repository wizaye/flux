import * as React from "react";
import {
  type SplitTree,
  type FileNode,
  type DropEdge,
  type DragPayload,
  type Tab,
  leaves,
  topRightLeaf,
  findLeaf,
  mapLeaves,
  insertTabAt,
  openTabInLeaf,
  removeTabFromLeaf,
  setSplitRatio,
  splitLeaf,
  edgeToSplitArgs,
  uid,
} from "@/state/editor";
import { Pane } from "./pane";
import { SplitNode } from "./split-node";

/**
 * Root component of the editor area. Owns:
 *   • the rendering loop over the split-tree (`renderNode`)
 *   • all tree-mutation glue (`setLeaf`, drop, split, divider resize)
 *   • the active-leaf / top-right-leaf / top-left-leaf bookkeeping
 *     that the shell needs to know which `Pane` carries the sidebar
 *     toggles.
 *
 * Ports `EditorArea` from `lattice/src/components/editor/EditorArea.tsx`,
 * minus the file-system / editor-body integrations (Phase 2).
 */

export type EditorAreaProps = {
  tree: SplitTree;
  vault: Map<string, FileNode>;
  activeLeafId: string;
  onChangeActiveLeaf: (leafId: string) => void;
  onTreeChange: (next: SplitTree | null) => void;
  /** Sidebar state — threaded down to the top-left / top-right Panes
   *  so they can render the reveal / collapse buttons. */
  leftSidebarCollapsed: boolean;
  rightSidebarCollapsed: boolean;
  onToggleLeftSidebar: () => void;
  onToggleRightSidebar: () => void;
  /** Extra padding-right on the top-right leaf's tabbar so it doesn't
   *  slide under the Windows caption controls. */
  topRightInsetPx: number;
  /** Extra padding-left on the top-left leaf's tabbar so it doesn't
   *  slide under the macOS traffic lights. */
  topLeftInsetPx: number;
  isMac: boolean;
};

export function EditorArea(props: EditorAreaProps) {
  const {
    tree,
    vault,
    activeLeafId,
    onChangeActiveLeaf,
    onTreeChange,
    leftSidebarCollapsed,
    rightSidebarCollapsed,
    onToggleLeftSidebar,
    onToggleRightSidebar,
    topRightInsetPx,
    topLeftInsetPx,
    isMac,
  } = props;

  // ── divider-drag state ───────────────────────────────────────────
  // Surfaces up to every Pane so they can disable their padding
  // transition while a divider is being dragged (matches the
  // shell-level pattern).
  const [dividerDragging, setDividerDragging] = React.useState(false);

  // ── derived: which leaves own the corners? ───────────────────────
  const topLeftLeafId = React.useMemo(() => leaves(tree)[0]?.id ?? null, [tree]);
  const topRightLeafId = React.useMemo(() => topRightLeaf(tree).id, [tree]);

  // ── tree mutation helpers ────────────────────────────────────────
  const setLeaf = React.useCallback(
    (
      leafId: string,
      fn: (
        leaf: Extract<SplitTree, { kind: "leaf" }>,
      ) => Extract<SplitTree, { kind: "leaf" }> | null,
    ) => {
      const next = mapLeaves(tree, (leaf) =>
        leaf.id === leafId ? fn(leaf) : leaf,
      );
      onTreeChange(next);
    },
    [tree, onTreeChange],
  );

  const handleSplit = React.useCallback(
    (leafId: string, edge: "left" | "right" | "top" | "bottom") => {
      const leaf = findLeaf(tree, leafId);
      if (!leaf) return;
      const active = leaf.tabs.find((t) => t.id === leaf.activeTabId);
      // The new pane starts with a clone of the active tab so users see
      // their current document on both sides — matches Obsidian / lattice.
      const newTab: Tab = active
        ? { ...active, id: uid("tab") }
        : { id: uid("tab"), fileId: null, title: "New tab" };
      const newLeaf: Extract<SplitTree, { kind: "leaf" }> = {
        kind: "leaf",
        id: uid("leaf"),
        tabs: [newTab],
        activeTabId: newTab.id,
      };
      const { direction, placeAfter } = edgeToSplitArgs(edge);
      const next = splitLeaf(tree, leafId, direction, newLeaf, placeAfter);
      onTreeChange(next);
      onChangeActiveLeaf(newLeaf.id);
    },
    [tree, onTreeChange, onChangeActiveLeaf],
  );

  const handleDrop = React.useCallback(
    (
      targetLeafId: string,
      edge: DropEdge,
      payload: DragPayload,
      insertIndex: number | null,
    ) => {
      const targetLeaf = findLeaf(tree, targetLeafId);
      if (!targetLeaf) return;

      // ── Drop into center (merge into leaf) or onto tabbar ──────
      if (edge === "center") {
        if (payload.kind === "tab") {
          // Same-leaf reorder
          if (payload.leafId === targetLeafId) {
            const idx = insertIndex ?? targetLeaf.tabs.length;
            setLeaf(targetLeafId, (l) => {
              const curIdx = l.tabs.findIndex((t) => t.id === payload.tabId);
              if (curIdx < 0) return l;
              const adjusted = idx > curIdx ? idx - 1 : idx;
              const final = Math.max(0, Math.min(l.tabs.length - 1, adjusted));
              if (final === curIdx) return l;
              const tabs = [...l.tabs];
              const [moved] = tabs.splice(curIdx, 1);
              tabs.splice(final, 0, moved);
              return { ...l, tabs, activeTabId: payload.tabId };
            });
            return;
          }
          // Cross-leaf move: pull tab from source, insert into target.
          const srcLeaf = findLeaf(tree, payload.leafId);
          if (!srcLeaf) return;
          const moving = srcLeaf.tabs.find((t) => t.id === payload.tabId);
          if (!moving) return;

          // Do BOTH mutations against the same `tree` snapshot so the
          // second mapLeaves doesn't see the result of the first.
          const next = mapLeaves(tree, (leaf) => {
            if (leaf.id === payload.leafId) {
              return removeTabFromLeaf(leaf, payload.tabId);
            }
            if (leaf.id === targetLeafId) {
              if (insertIndex == null) return openTabInLeaf(leaf, moving);
              return insertTabAt(leaf, moving, insertIndex);
            }
            return leaf;
          });
          onTreeChange(next);
          onChangeActiveLeaf(targetLeafId);
          return;
        }
        if (payload.kind === "file") {
          // Open the file in the target leaf as a new tab.
          const file = vault.get(payload.fileId);
          if (!file) return;
          setLeaf(targetLeafId, (l) =>
            openTabInLeaf(l, {
              id: uid("tab"),
              fileId: payload.fileId,
              title: file.name,
            }),
          );
          onChangeActiveLeaf(targetLeafId);
          return;
        }
      }

      // ── Drop on an edge → split the target leaf ────────────────
      if (edge === "left" || edge === "right" || edge === "top" || edge === "bottom") {
        // Build the new leaf with the dragged content.
        let newLeaf: Extract<SplitTree, { kind: "leaf" }> | null = null;
        if (payload.kind === "tab") {
          const srcLeaf = findLeaf(tree, payload.leafId);
          const moving = srcLeaf?.tabs.find((t) => t.id === payload.tabId);
          if (!moving) return;
          newLeaf = {
            kind: "leaf",
            id: uid("leaf"),
            tabs: [moving],
            activeTabId: moving.id,
          };
          // First remove from source, then split target with newLeaf.
          // Note: removeTabFromLeaf may delete the source leaf if it
          // becomes empty (mapLeaves collapses null children); the
          // target split happens against that already-trimmed tree.
          const trimmed = mapLeaves(tree, (leaf) =>
            leaf.id === payload.leafId
              ? removeTabFromLeaf(leaf, payload.tabId)
              : leaf,
          );
          if (!trimmed) {
            // We removed the only tab in the only leaf — replace the
            // whole tree with the new split's contents.
            onTreeChange(newLeaf);
            onChangeActiveLeaf(newLeaf.id);
            return;
          }
          // After trim, the target leaf may have been collapsed away
          // if the source WAS the target — in that case the moving
          // tab is back where it started; no-op.
          if (!findLeaf(trimmed, targetLeafId)) {
            onTreeChange(trimmed);
            return;
          }
          const { direction, placeAfter } = edgeToSplitArgs(edge);
          const split = splitLeaf(trimmed, targetLeafId, direction, newLeaf, placeAfter);
          onTreeChange(split);
          onChangeActiveLeaf(newLeaf.id);
          return;
        }
        if (payload.kind === "file") {
          const file = vault.get(payload.fileId);
          if (!file) return;
          const t: Tab = { id: uid("tab"), fileId: payload.fileId, title: file.name };
          newLeaf = { kind: "leaf", id: uid("leaf"), tabs: [t], activeTabId: t.id };
          const { direction, placeAfter } = edgeToSplitArgs(edge);
          const split = splitLeaf(tree, targetLeafId, direction, newLeaf, placeAfter);
          onTreeChange(split);
          onChangeActiveLeaf(newLeaf.id);
          return;
        }
      }
    },
    [tree, vault, setLeaf, onTreeChange, onChangeActiveLeaf],
  );

  const handleSplitResize = React.useCallback(
    (splitId: string, ratio: number) => {
      onTreeChange(setSplitRatio(tree, splitId, ratio));
    },
    [tree, onTreeChange],
  );

  // ── recursive renderer ───────────────────────────────────────────
  const renderNode = React.useCallback(
    (node: SplitTree): React.ReactNode => {
      if (node.kind === "leaf") {
        return (
          <Pane
            key={node.id}
            leaf={node}
            vault={vault}
            activeLeafId={activeLeafId}
            isTopRightLeaf={node.id === topRightLeafId}
            isTopLeftLeaf={node.id === topLeftLeafId}
            topRightInsetPx={topRightInsetPx}
            topLeftInsetPx={topLeftInsetPx}
            dragging={dividerDragging}
            rightSidebarCollapsed={rightSidebarCollapsed}
            leftSidebarCollapsed={leftSidebarCollapsed}
            onToggleRightSidebar={onToggleRightSidebar}
            onToggleLeftSidebar={onToggleLeftSidebar}
            isMac={isMac}
            onActivateLeaf={onChangeActiveLeaf}
            onMutateLeaf={setLeaf}
            onDropOnLeaf={handleDrop}
            onSplitLeaf={handleSplit}
          />
        );
      }
      return (
        <SplitNode
          key={node.id}
          node={node}
          renderChild={renderNode}
          onResize={handleSplitResize}
          onDragChange={setDividerDragging}
        />
      );
    },
    [
      vault,
      activeLeafId,
      topRightLeafId,
      topLeftLeafId,
      topRightInsetPx,
      topLeftInsetPx,
      dividerDragging,
      rightSidebarCollapsed,
      leftSidebarCollapsed,
      onToggleRightSidebar,
      onToggleLeftSidebar,
      isMac,
      onChangeActiveLeaf,
      setLeaf,
      handleDrop,
      handleSplit,
      handleSplitResize,
    ],
  );

  return (
    <div className="relative flex flex-1 min-h-0 min-w-0 flex-col">
      {renderNode(tree)}
    </div>
  );
}
