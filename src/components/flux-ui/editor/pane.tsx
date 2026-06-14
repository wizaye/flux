import * as React from "react";
import { cn } from "@/lib/utils";
import {
  bgHeader,
  bgEditor,
  borderTabBg,
  textMuted,
} from "@/lib/lattice-tokens";
import { HEADER_H } from "@/lib/layout-constants";
import { IconButton } from "@/components/flux-ui/common/icon-button";
import {
  IcPlus,
  IcPanelLeft,
  IcPanelRight,
} from "@/components/flux-ui/common/icons";
import {
  type SplitTree,
  type Tab,
  type FileNode,
  type DropEdge,
  type DragPayload,
  uid,
} from "@/state/editor";
import { readDragPayload } from "./drag-ghost";
import { TabButton } from "./tab-button";
import { EmptyTab } from "./empty-tab";
import { DropOverlay, TabInsertionMarker } from "./drop-overlay";
import { TabbarOptionsMenu } from "./tabbar-options-menu";
import { CodeMirrorEditor } from "./views/codemirror-editor";
import { MarkdownPreview } from "./views/markdown-preview";
import { SlidesView } from "./views/slides-view";
import { PdfView } from "./views/pdf-view";
import { GraphView } from "./views/graph-view";
import type { EditorViewProps, PaneActions } from "./views/types";
import { useEditorStore } from "@/state/editor-store";

/**
 * A single editor pane: tabbar (with sidebar-toggle insets) + doc-header
 * + pane-body + drop overlay. Owns its own drag-tracking state but is
 * otherwise driven entirely by props — every mutation goes through
 * `onMutateLeaf` on the parent `EditorArea`, which folds the result
 * back into the immutable split-tree.
 *
 * Ports `Pane` from `lattice/src/components/editor/EditorArea.tsx`.
 */

export type PaneProps = {
  leaf: Extract<SplitTree, { kind: "leaf" }>;
  vault: Map<string, FileNode>;
  activeLeafId: string;
  /** True when this is the leaf at the top-right of the tree. */
  isTopRightLeaf: boolean;
  /** True when this is the leaf at the top-left of the tree. */
  isTopLeftLeaf: boolean;
  /** Extra padding-right on the tabbar when the R-sidebar is collapsed
   *  and we're on Windows — so the tabbar doesn't slide under the
   *  caption controls. Already accounts for the toggle button width. */
  topRightInsetPx: number;
  /** Extra padding-left on the tabbar when the L-sidebar is collapsed
   *  and we're on macOS — to clear the traffic lights. */
  topLeftInsetPx: number;
  /** True while a sidebar / divider is mid-drag — disables transitions
   *  on the tabbar padding so the toggle button doesn't visibly jump
   *  before sliding back out. */
  dragging: boolean;
  rightSidebarCollapsed: boolean;
  leftSidebarCollapsed: boolean;
  onToggleRightSidebar: () => void;
  onToggleLeftSidebar: () => void;
  /** True on macOS — moves the L-sidebar reveal button into the
   *  top-left leaf's tabbar (since the lstrip header is empty there). */
  isMac: boolean;
  // ── Tree-mutation callbacks ─────────────────────────────────────
  onActivateLeaf: (leafId: string) => void;
  onMutateLeaf: (
    leafId: string,
    fn: (
      leaf: Extract<SplitTree, { kind: "leaf" }>,
    ) => Extract<SplitTree, { kind: "leaf" }> | null,
  ) => void;
  onDropOnLeaf: (
    targetLeafId: string,
    edge: DropEdge,
    payload: DragPayload,
    insertIndex: number | null,
  ) => void;
  onSplitLeaf: (
    leafId: string,
    edge: "left" | "right" | "top" | "bottom",
  ) => void;
};

export function Pane(props: PaneProps) {
  const {
    leaf,
    vault,
    activeLeafId,
    isTopRightLeaf,
    isTopLeftLeaf,
    topRightInsetPx,
    // `topLeftInsetPx` is currently derived in-line via `showLeftReveal`
    // (which keys off `isMac + leftSidebarCollapsed`) — kept on the
    // prop surface so future tweaks can expose a different inset value
    // than the implicit 40px traffic-light width.
    topLeftInsetPx: _topLeftInsetPx,
    dragging,
    rightSidebarCollapsed,
    leftSidebarCollapsed,
    onToggleRightSidebar,
    onToggleLeftSidebar,
    isMac,
    onActivateLeaf,
    onMutateLeaf,
    onDropOnLeaf,
    onSplitLeaf,
  } = props;

  const activeTab = leaf.tabs.find((t) => t.id === leaf.activeTabId) ?? null;
  const isActiveLeaf = activeLeafId === leaf.id;

  // ── drag-tracking state ──────────────────────────────────────────
  // We track the drop-edge with refs (mutated inside dragover) and
  // mirror them into React state every render-relevant change. Keeping
  // the ref source-of-truth avoids re-renders on every pixel of
  // movement — only edge changes trigger a setState.
  const [hoverEdge, setHoverEdge] = React.useState<DropEdge | null>(null);
  const [tabInsertX, setTabInsertX] = React.useState<number | null>(null);

  const bodyRef = React.useRef<HTMLDivElement>(null);
  const tabsRef = React.useRef<HTMLDivElement>(null);

  const calcEdge = React.useCallback((e: React.DragEvent): DropEdge => {
    const el = bodyRef.current;
    if (!el) return "center";
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    // 20% margins — matches lattice's edge math
    const m = 0.2;
    if (x < m) return "left";
    if (x > 1 - m) return "right";
    if (y < m) return "top";
    if (y > 1 - m) return "bottom";
    return "center";
  }, []);

  const calcTabInsert = React.useCallback(
    (e: React.DragEvent): { index: number; px: number } | null => {
      const el = tabsRef.current;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left;
      const tabs = Array.from(el.querySelectorAll<HTMLElement>("[role='tab']"));
      let index = tabs.length;
      let px = 0;
      for (let i = 0; i < tabs.length; i++) {
        const tr = tabs[i].getBoundingClientRect();
        const midX = tr.left - r.left + tr.width / 2;
        if (x < midX) {
          index = i;
          px = tr.left - r.left;
          break;
        }
      }
      if (index === tabs.length) {
        const last = tabs[tabs.length - 1];
        px = last ? last.getBoundingClientRect().right - r.left : 0;
      }
      return { index, px };
    },
    [],
  );

  const handleBodyDragOver = React.useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const edge = calcEdge(e);
      setHoverEdge((prev) => (prev === edge ? prev : edge));
      // Don't show tab-insertion when hovering over body
      setTabInsertX(null);
    },
    [calcEdge],
  );

  const handleTabbarDragOver = React.useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      // When hovering over the tabbar, force-show "center" overlay
      // (the drop = append/insert) and compute the insertion x.
      setHoverEdge((prev) => (prev === "center" ? prev : "center"));
      const insert = calcTabInsert(e);
      setTabInsertX(insert ? insert.px : null);
    },
    [calcTabInsert],
  );

  const handleDragLeave = React.useCallback((e: React.DragEvent) => {
    // Only clear when leaving the pane element entirely. Using
    // relatedTarget so child dragenter/leave doesn't flicker.
    const rt = e.relatedTarget as Node | null;
    const root = bodyRef.current?.parentElement;
    if (rt && root && root.contains(rt)) return;
    setHoverEdge(null);
    setTabInsertX(null);
  }, []);

  const handleDrop = React.useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const payload = readDragPayload(e);
      if (!payload) {
        setHoverEdge(null);
        setTabInsertX(null);
        return;
      }
      // Did we drop on the tabbar (= "center", insertion index) or on
      // the body (= an edge)?
      const onTabbar = tabsRef.current?.contains(e.target as Node) ?? false;
      let edge: DropEdge;
      let insertIndex: number | null;
      if (onTabbar) {
        edge = "center";
        insertIndex = calcTabInsert(e)?.index ?? null;
      } else {
        edge = calcEdge(e);
        insertIndex = null;
      }
      setHoverEdge(null);
      setTabInsertX(null);
      onDropOnLeaf(leaf.id, edge, payload, insertIndex);
    },
    [leaf.id, onDropOnLeaf, calcEdge, calcTabInsert],
  );

  // ── tab-level callbacks ───────────────────────────────────────────
  const activateTab = (tabId: string) => {
    onActivateLeaf(leaf.id);
    onMutateLeaf(leaf.id, (l) => ({ ...l, activeTabId: tabId }));
  };
  const closeTab = (tabId: string) => {
    onMutateLeaf(leaf.id, (l) => {
      const idx = l.tabs.findIndex((t) => t.id === tabId);
      if (idx < 0) return l;
      const tabs = l.tabs.filter((t) => t.id !== tabId);
      if (tabs.length === 0) return null;
      const wasActive = l.activeTabId === tabId;
      const activeTabId = wasActive
        ? tabs[Math.max(0, idx - 1)].id
        : l.activeTabId;
      return { ...l, tabs, activeTabId };
    });
  };
  const togglePin = (tabId: string) => {
    onMutateLeaf(leaf.id, (l) => ({
      ...l,
      tabs: l.tabs.map((t) =>
        t.id === tabId ? { ...t, isPinned: !t.isPinned } : t,
      ),
    }));
  };
  const toggleReading = (tabId: string) => {
    onMutateLeaf(leaf.id, (l) => ({
      ...l,
      tabs: l.tabs.map((t) =>
        t.id === tabId
          ? {
              ...t,
              viewMode: t.viewMode === "preview" ? "source" : "preview",
            }
          : t,
      ),
    }));
  };
  const setViewMode = (tabId: string, mode: "source" | "preview" | "slides") => {
    onMutateLeaf(leaf.id, (l) => ({
      ...l,
      tabs: l.tabs.map((t) => (t.id === tabId ? { ...t, viewMode: mode } : t)),
    }));
  };
  // Open the first matching markdown file (by base name) in the active tab.
  const openByName = React.useCallback(
    (targetName: string) => {
      const wanted = targetName.toLowerCase().replace(/\.md$/i, "");
      let match: FileNode | null = null;
      for (const node of vault.values()) {
        if (node.kind !== "file") continue;
        const base = node.name.toLowerCase().replace(/\.md$/i, "");
        if (base === wanted) {
          match = node;
          break;
        }
      }
      if (!match) return;
      const file = match;
      onMutateLeaf(leaf.id, (l) => ({
        ...l,
        tabs: l.tabs.map((t) =>
          t.id === l.activeTabId
            ? { ...t, fileId: file.id, title: file.name.replace(/\.md$/i, "") }
            : t,
        ),
      }));
    },
    [leaf.id, onMutateLeaf, vault],
  );
  const newTab = () => {
    onMutateLeaf(leaf.id, (l) => {
      const t: Tab = { id: uid("tab"), fileId: null, title: "New tab" };
      return { ...l, tabs: [...l.tabs, t], activeTabId: t.id };
    });
  };
  const closeAll = () => {
    onMutateLeaf(leaf.id, () => null);
  };
  const closeOthers = (tabId: string) => {
    onMutateLeaf(leaf.id, (l) => {
      const keep = l.tabs.find((t) => t.id === tabId);
      if (!keep) return l;
      return { ...l, tabs: [keep], activeTabId: keep.id };
    });
  };

  // ── render ────────────────────────────────────────────────────────
  const showLeftReveal = isMac && isTopLeftLeaf && leftSidebarCollapsed;
  const showRightToggle = isTopRightLeaf;

  return (
    <div
      className={cn("relative flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden", bgEditor)}
      onClick={() => !isActiveLeaf && onActivateLeaf(leaf.id)}
      data-leaf-id={leaf.id}
      data-active={isActiveLeaf || undefined}
    >
      {/* ── pane tabbar ─────────────────────────────────────────────── */}
      <div
        className={cn("relative flex items-center shrink-0", bgHeader)}
        style={{
          // Lattice `--header-h: 36px`. Critical: this MUST match the
          // L-sidebar / L-strip header height so their bottom hairlines
          // line up into one continuous horizontal seam across the
          // whole window. Tabs themselves remain 32px tall and sit
          // vertically centered inside this 36px bar (lattice `.tab`).
          height: HEADER_H,
          // Lattice `.pane-tabbar` uses `padding: 0 0 0 16px`. Left
          // gutter gives the first tab breathing room from the sidebar
          // splitter. When the L-sidebar is collapsed on macOS this
          // gutter expands to clear the traffic-lights AND host the
          // reveal button (40px + 6px).
          // Right padding clears the Windows caption controls when the
          // R-sidebar is collapsed AND this is the top-right leaf.
          paddingLeft: showLeftReveal ? 40 + 6 : 16,
          paddingRight: !isMac && rightSidebarCollapsed && isTopRightLeaf ? topRightInsetPx + 6 : 6,
          // Match the column-width animation so the toggle button
          // slides instead of jumping. Disabled mid-drag.
          transition: dragging
            ? "none"
            : "padding 200ms cubic-bezier(0.32, 0.72, 0, 1)",
          // Defence-in-depth: never let tabs/+ paint past the column
          // edge into the right sidebar when the pane is squeezed thin.
          overflow: "hidden",
          minWidth: 0,
        }}
        data-tauri-drag-region
        onDragOver={handleTabbarDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Mac-only L-sidebar reveal button — top-left leaf only. */}
        {showLeftReveal && (
          <div className="flex items-center pr-1.5 shrink-0" data-tauri-drag-region={false}>
            <IconButton
              size="tiny"
              aria-label="Show left sidebar"
              onClick={onToggleLeftSidebar}
            >
              <IcPanelLeft open={false} />
            </IconButton>
          </div>
        )}

        {/* Tabs container — Chrome-style shrink-to-fit.
              flex: 0 1 max-content
                → natural width = sum of children's max-content (= N × 220px)
                → flex-grow:0 prevents eating extra empty space
                → flex-shrink:1 + min-width:0 lets the row compress equally
                  when N × 220px > available width.
              overflow: hidden so the rightmost child clips cleanly
              (tabs themselves shrink first, so clipping is rare). */}
        <div
          ref={tabsRef}
          className="relative flex items-center"
          style={{ flex: "0 1 max-content", minWidth: 0, overflow: "hidden" }}
          data-tauri-drag-region={false}
        >
          {leaf.tabs.map((tab, i) => {
            const isLast = i === leaf.tabs.length - 1;
            const nextTab = !isLast ? leaf.tabs[i + 1] : null;
            const nextIsActive = nextTab?.id === leaf.activeTabId;
            // Lattice `.tab:not(.active)::after` separator rules:
            //   • hidden on last tab in row (`:last-child::after`)
            //   • hidden when next sibling is the active tab
            //     (`:has(+ .tab.active)::after`)
            //   • the tab itself omits when it's active
            //     (`:not(.active)`)
            return (
              <TabButton
                key={tab.id}
                tab={tab}
                leafId={leaf.id}
                isActive={tab.id === leaf.activeTabId}
                tabCount={leaf.tabs.length}
                showRightSeparator={!isLast && !nextIsActive}
                onActivate={() => activateTab(tab.id)}
                onClose={() => closeTab(tab.id)}
                onTogglePin={() => togglePin(tab.id)}
                onToggleReading={() => toggleReading(tab.id)}
                onSplitRight={() => onSplitLeaf(leaf.id, "right")}
                onSplitDown={() => onSplitLeaf(leaf.id, "bottom")}
                onCopyPath={() => copyToClipboard(tab.fileId ?? "")}
                onShowInExplorer={() => {}}
                onOpenInDefault={() => {}}
                onRename={() => {}}
                onDelete={() => closeTab(tab.id)}
                onCloseOthers={() => closeOthers(tab.id)}
                onCloseAll={closeAll}
              />
            );
          })}
          {/* Drop-insertion indicator between tabs */}
          {tabInsertX !== null && <TabInsertionMarker left={tabInsertX} />}
        </div>

        {/* "+" new-tab button — sibling AFTER `.pane-tabs` (lattice
            `.tab-new`). Sits flush with the last tab thanks to the
            shrink-to-fit container above. `ml-2` (8px) matches lattice
            `.tab-new { margin-left: 8px }`. Height fills the 36px bar
            (lattice `.tab-new { height: var(--header-h) }`) so its
            hover-pill stays vertically centered on the tab row. */}
        <button
          type="button"
          aria-label="New tab"
          onClick={newTab}
          data-tauri-drag-region={false}
          className={cn(
            "relative inline-flex items-center justify-center shrink-0",
            "w-7 h-9 ml-2",
            textMuted,
            "hover:text-foreground",
            "transition-[color,transform] duration-100 ease-out",
            "active:scale-[0.92]",
            // Tight hover-pill inside the larger hit-area (matches
            // lattice's `::before` 24×24 pill: inset-y = (36-24)/2 = 6).
            "before:content-[''] before:absolute before:inset-y-1.5 before:inset-x-0.5",
            "before:rounded-[4px] before:bg-transparent",
            "hover:before:bg-black/[0.06] dark:hover:before:bg-white/[0.07]",
            "before:transition-colors before:duration-100",
            "[&_svg]:relative [&_svg]:size-[14px]",
          )}
        >
          <IcPlus />
        </button>

        {/* Drag-region spacer — fills any leftover space so the
            window remains draggable when there are few tabs. */}
        <div className="flex-1 min-w-0 h-full" data-tauri-drag-region />

        {/* Right cluster: tabbar options + (top-right only) R-sidebar toggle */}
        <div className="flex items-center px-1 gap-0.5 shrink-0" data-tauri-drag-region={false}>
          <TabbarOptionsMenu
            stackTabs={false}
            onToggleStack={() => { /* stub */ }}
            onCloseAll={closeAll}
            onNewTab={newTab}
          />
          {showRightToggle && (
            <IconButton
              size="tiny"
              aria-label={rightSidebarCollapsed ? "Show right sidebar" : "Hide right sidebar"}
              onClick={onToggleRightSidebar}
            >
              <IcPanelRight open={!rightSidebarCollapsed} />
            </IconButton>
          )}
        </div>

        {/* Bottom hairline */}
        <span
          aria-hidden
          className={cn("pointer-events-none absolute left-0 right-0 bottom-0 h-px", borderTabBg)}
        />
      </div>

      {/* ── body + drop overlay ─────────────────────────────────────── */}
      {/* NB: there is intentionally NO unconditional <PaneDocHeader/>
          here anymore. Each editor view implements the EditorViewProps
          contract and wraps its body in <EditorPaneLayout/>, which
          renders the doc-header itself when the view opts in
          (markdown / slides / pdf / codemirror) and OMITS it entirely
          when the view owns its own chrome (graph). See
          flux/src/components/flux-ui/editor/views/types.ts and
          ./views/editor-pane-layout.tsx for the contract. */}
      <div
        ref={bodyRef}
        className="relative flex-1 min-h-0 min-w-0 flex"
        onDragOver={handleBodyDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <PaneBody
          tab={activeTab}
          vault={vault}
          paneActions={{
            onSplit: (edge) => onSplitLeaf(leaf.id, edge),
            onToggleReading: () => activeTab && toggleReading(activeTab.id),
            onSetSlides: () => activeTab && setViewMode(activeTab.id, "slides"),
            onRename: () => { /* stub — vault rename lands later */ },
            onCopyPath: () => activeTab && copyToClipboard(activeTab.fileId ?? ""),
            onShowInExplorer: () => { /* stub — Tauri FS reveal lands later */ },
            onRevealInNav: () => { /* stub — left-sidebar reveal lands later */ },
            onDelete: () => activeTab && closeTab(activeTab.id),
            // The doc-header sits BELOW the 36px-tall window controls
            // cluster (which lives in the tabbar row above). So Split /
            // Reading-view / More-options are free to slide all the
            // way to the editor column's right edge — no inset
            // reservation needed regardless of sidebar state.
            topRightInsetPx: 0,
            dragging,
          }}
          onNewTab={newTab}
          onCloseTab={() => activeTab && closeTab(activeTab.id)}
          onOpenWikilink={openByName}
        />
        {hoverEdge && <DropOverlay edge={hoverEdge} />}
      </div>
    </div>
  );
}

function PaneBody({
  tab,
  vault,
  paneActions,
  onNewTab,
  onCloseTab,
  onOpenWikilink,
}: {
  tab: Tab | null;
  vault: Map<string, FileNode>;
  paneActions: PaneActions;
  onNewTab: () => void;
  onCloseTab: () => void;
  onOpenWikilink: (target: string) => void;
}) {
  if (!tab || tab.fileId == null) {
    return (
      <EmptyTab
        onCreate={onNewTab}
        onGoToFile={() => { /* stub — command palette lands later */ }}
        onClose={onCloseTab}
      />
    );
  }
  const file = vault.get(tab.fileId);
  const overrideContent = useEditorStore((s) => s.fileContents.get(tab.fileId!));
  const setFileContent = useEditorStore((s) => s.setFileContent);
  const markDirty = useEditorStore((s) => s.markDirty);
  const markClean = useEditorStore((s) => s.markClean);

  if (!file) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center text-muted-foreground text-sm">
        File not found.
      </div>
    );
  }

  // Resolve effective text-content once (used by markdown / slides /
  // source views; pdf + graph ignore it).
  const content = overrideContent ?? file.content ?? "";

  // Common bundle every view receives. Each view spreads what it
  // needs from this; unknown extras are simply ignored.
  const baseProps: EditorViewProps = {
    tab,
    file,
    content,
    vault,
    paneActions,
    onOpenWikilink,
    onOpenFile: (id) => onOpenWikilink(vault.get(id)?.name ?? id),
    onChange: (next) => {
      setFileContent(file.id, next);
      markDirty(file.id);
    },
    onSave: () => {
      // Mock-vault "save" — commit the in-memory override into the
      // FileNode body and clear the dirty flag. Real-vault writes
      // will replace this with a Tauri FS call.
      if (overrideContent !== undefined) {
        file.content = overrideContent;
      }
      markClean(file.id);
    },
  };

  // Kind-based dispatch — graph + pdf ignore viewMode entirely.
  if (file.kind === "graph") return <GraphView {...baseProps} />;
  if (file.kind === "pdf") return <PdfView {...baseProps} />;

  // Markdown surfaces (file + canvas treated as text for now).
  const mode = tab.viewMode ?? "source";
  if (mode === "preview") return <MarkdownPreview {...baseProps} />;
  if (mode === "slides") return <SlidesView {...baseProps} />;
  return <CodeMirrorEditor {...baseProps} />;
}

function copyToClipboard(text: string) {
  if (!text || typeof navigator === "undefined" || !navigator.clipboard) return;
  void navigator.clipboard.writeText(text);
}
