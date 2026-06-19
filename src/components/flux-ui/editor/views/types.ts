/**
 * Shared contract every editor-pane view component implements.
 *
 * Flux supports several "views" inside a pane (source editor, reading
 * preview, slides, PDF, graph — and more landing later: kanban,
 * canvas, calendar). Rather than letting each view sprout its own
 * sibling component and chrome, every view:
 *
 *   1. accepts a uniform `EditorViewProps` payload from `Pane`
 *   2. wraps its body in `<EditorPaneLayout/>` (see ./editor-pane-layout)
 *      so the outer geometry (flex column, overflow handling, optional
 *      header strip, optional floating overlay) is consistent
 *   3. opts in to the standard pane-doc-header by accepting it via
 *      `header` — or opts out entirely (graph) and renders its own
 *      controls via `overlay` / inline UI
 *
 * The contract is intentionally narrow: per-view options (graph
 * settings, slide nav, PDF zoom, etc) live INSIDE the view, not on
 * this type, so adding a new view type doesn't ripple through `Pane`.
 *
 * Mirrors the pattern at lattice/src/components/editor/EditorArea.tsx
 * where the doc-header is conditionally rendered per `isGraphTab` /
 * `isKanbanTab` / `isCanvasTab` flags — but pushes the decision out of
 * the host pane and into each view, so views own their own chrome.
 */

import type { FileNode, Tab } from "@/state/editor";

/**
 * Snapshot of the file / tab + vault context each view receives.
 * Source content is resolved by the host pane (so unsaved overrides
 * are visible to every surface), file metadata comes straight from
 * the vault map.
 */
export type EditorViewContext = {
  tab: Tab;
  file: FileNode;
  /** Live source for this tab — pulls from the editor store's
   *  unsaved override if present, otherwise the on-disk content. */
  content: string;
  vault: Map<string, FileNode>;
};

/**
 * Pane-level actions a view may surface in its own chrome (typically
 * inside a `<PaneDocHeader/>` it owns, or graph's floating overlay).
 * All are file-scoped — the host pane bound them to the current tab
 * before passing the bundle in.
 */
export type PaneActions = {
  onSplit: (edge: "left" | "right" | "top" | "bottom") => void;
  onToggleReading: () => void;
  onSetSlides: () => void;
  /** Switch the active tab to live-preview (CodeMirror + decorations). */
  onSetLive: () => void;
  /** Switch the active tab to raw-source CodeMirror. */
  onSetSource?: () => void;
  onRename: () => void;
  onCopyPath: () => void;
  onShowInExplorer: () => void;
  onRevealInNav: () => void;
  onDelete: () => void;
  /** Drag is in progress — disables transitions inside chrome. */
  dragging?: boolean;
  /** Extra right-padding so chrome dodges Windows caption controls. */
  topRightInsetPx?: number;

  // ── Extended commands (Obsidian-parity, all optional so older
  // call sites that haven't migrated still type-check) ──
  onSplitRight?: () => void;
  onSplitDown?: () => void;
  onOpenInNewWindow?: () => void;
  onMoveTo?: () => void;
  onToggleBookmark?: () => void;
  isBookmarked?: boolean;
  onMerge?: () => void;
  onAddProperty?: () => void;
  onExportPdf?: () => void;
  onFind?: () => void;
  onReplace?: () => void;
  onVersionHistory?: () => void;
  onOpenLocalGraph?: () => void;
  onOpenBacklinks?: () => void;
  onOpenOutgoingLinks?: () => void;
  onOpenFileProperties?: () => void;
  onOpenOutline?: () => void;
  onOpenInDefaultApp?: () => void;
};

/**
 * Callbacks every view may invoke against the host. Most are
 * optional — graph never calls `onChange`, codemirror never calls
 * `onOpenWikilink`, etc.
 */
export type EditorViewCallbacks = {
  /** Edits to the document body (source mode only). */
  onChange?: (next: string) => void;
  /** Ctrl/Cmd+S inside the surface. */
  onSave?: () => void;
  /** Wikilink click — host resolves the target and opens a tab. */
  onOpenWikilink?: (target: string) => void;
  /** File-path click (graph node, PDF outline, etc). */
  onOpenFile?: (fileId: string) => void;
};

export type EditorViewProps = EditorViewContext &
  EditorViewCallbacks & {
    paneActions: PaneActions;
  };

/**
 * No-op fallback used by views when destructuring `paneActions` so a
 * stale HMR snapshot (view code updated but parent `Pane` not yet)
 * can't blow up with `Cannot read properties of undefined (reading
 * 'onSplit')`. Real renders always receive the bound bundle from
 * `Pane` — this is purely a dev-time safety net.
 */
export const EMPTY_PANE_ACTIONS: PaneActions = {
  onSplit: () => {},
  onToggleReading: () => {},
  onSetSlides: () => {},
  onSetLive: () => {},
  onRename: () => {},
  onCopyPath: () => {},
  onShowInExplorer: () => {},
  onRevealInNav: () => {},
  onDelete: () => {},
  dragging: false,
  topRightInsetPx: 0,
};

