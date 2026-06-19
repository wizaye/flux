import * as React from "react";
import { cn } from "@/lib/utils";
import { ActivityStrip, type LeftView, type StripActionId } from "./activity-strip";
import { LeftSidebar } from "./left-sidebar";
import { RightSidebar, type RightView } from "./right-sidebar";
import { StatusPill } from "./status-pill";
import { ResizeHandle } from "./resize-handle";
import {
  bgApp,
  bgEditor,
  bgHeader,
  bgStrip,
  borderSoftBg,
  borderTabBg,
} from "@/lib/lattice-tokens";
import {
  HEADER_H,
  LEFT_COLLAPSE_AT,
  LEFT_DEFAULT,
  LEFT_MIN,
  PUSH_ANIM_MS,
  RIGHT_COLLAPSE_AT,
  RIGHT_DEFAULT,
  RIGHT_MIN,
  SIDEBAR_ANIM_MS,
  STRIP_W,
  WIN_CONTROLS_W,
} from "@/lib/layout-constants";
import { IcPanelLeft } from "@/components/flux-ui/common/icons";
import { IconButton } from "@/components/flux-ui/common/icon-button";
import { TerminalPalette } from "@/components/flux-ui/common/terminal-palette";
import { SettingsDialog } from "@/components/flux-ui/modals/settings-dialog";
import { FilePickerDialog } from "@/components/flux-ui/modals/file-picker-dialog";
import { FrontmatterEditor } from "@/components/flux-ui/modals/frontmatter-editor";
import { PdfExportDialog } from "@/components/flux-ui/modals/pdf-export-dialog";
import { AddBookmarkDialog } from "@/components/flux-ui/modals/add-bookmark-dialog";
import { ConfirmDialog } from "@/components/flux-ui/common/confirm-dialog";
import { readFile as backendReadFile, writeFile as backendWriteFile } from "@/bindings";
import { VaultPicker } from "@/components/flux-ui/modals/vault-picker";
import { EditorArea } from "@/components/flux-ui/editor";
import { WindowControls } from "@/components/flux-ui/layout/window-controls";
import { useSettingsStore, matchesBinding } from "@/state/settings-store";
import { useVaultStore } from "@/state/vault-store";
import { useEditorStore } from "@/state/editor-store";
import { useTabSyncStore } from "@/state/tab-sync-store";
import { useFileOperations } from "@/hooks/use-file-operations";
import {
  type SplitTree,
  type Tab,
  type FileNode,
  MOCK_VAULT,
  MOCK_VAULT_TREE,
  flattenVault,
  uid,
} from "@/state/editor";
import { mapLeaves, openTabInLeaf, findLeaf } from "@/state/editor";

/**
 * Top-level shell ported from `lattice/src/App.tsx`. Owns:
 *  - left/right sidebar view + collapse + width state
 *  - drag-resize math with snap-to-collapse threshold AND
 *    push-the-opposing-sidebar-inward when the editor gets squeezed
 *  - sidebar slide animation gating (only animate on toggle, not drag)
 *  - localStorage persistence under the `flux.*` namespace
 *  - macOS vs Windows chrome decisions:
 *      • lstrip column header is empty on macOS, shows the panel-toggle
 *        button on Windows (lattice mirrors this exactly)
 *      • left sidebar header pads 40px-left on macOS and renders an
 *        extra collapse toggle on the right edge of its header
 *      • right sidebar header pads 138px-right on Windows so the win-
 *        controls cluster doesn't overlap tab icons
 *
 * Editor column renders a placeholder for now; real editor + pane
 * tree will land in a subsequent pass.
 *
 * Layout structure (mirrors `.lattice-app` in lattice/src/App.css):
 *
 *   ┌──────┬───────────┬─────────────────────┬───────────┐
 *   │lstrip│ lsidebar  │       editor        │ rsidebar  │
 *   └──────┴───────────┴─────────────────────┴───────────┘
 *
 * Resize handles are full-window-height absolute overlays positioned
 * at viewport-pixel coordinates so both handles align sub-pixel-
 * precisely. They are HIDDEN while a sidebar is mid-animation so the
 * handle doesn't snap to the final position before the column catches
 * up.
 */

const LS_KEYS = {
  leftView: "flux.leftView",
  leftCollapsed: "flux.leftCollapsed",
  leftWidth: "flux.leftWidth",
  rightView: "flux.rightView",
  rightCollapsed: "flux.rightCollapsed",
  rightWidth: "flux.rightWidth",
  editorTree: "flux.editorTree",
  activeLeafId: "flux.activeLeafId",
} as const;

function detectIsMac(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const platformStr =
    typeof navigator.platform === "string" ? navigator.platform : "";
  return /Mac|iPhone|iPad/.test(platformStr) || /Mac OS X/.test(ua);
}

function readNumber(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

function readBool(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === "1" || raw === "true";
  } catch {
    return fallback;
  }
}

function readEnum<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
  } catch {
    return fallback;
  }
}

const LEFT_VIEWS = ["files", "search", "bookmarks", "changes", "calendar", "canvas"] as const;
const RIGHT_VIEWS = ["links", "outgoing", "tags", "outline"] as const;

// ── Editor-tree persistence helpers ─────────────────────────────────
function freshTree(): SplitTree {
  const tab: Tab = { id: uid("tab"), fileId: null, title: "New tab" };
  return {
    kind: "leaf",
    id: uid("leaf"),
    tabs: [tab],
    activeTabId: tab.id,
  };
}

function isValidTree(x: unknown): x is SplitTree {
  if (!x || typeof x !== "object") return false;
  const o = x as { kind?: string };
  if (o.kind === "leaf") {
    const l = x as { id?: unknown; tabs?: unknown; activeTabId?: unknown };
    return (
      typeof l.id === "string" &&
      Array.isArray(l.tabs) &&
      l.tabs.length > 0 &&
      typeof l.activeTabId === "string"
    );
  }
  if (o.kind === "split") {
    const s = x as { id?: unknown; direction?: unknown; ratio?: unknown; a?: unknown; b?: unknown };
    return (
      typeof s.id === "string" &&
      (s.direction === "horizontal" || s.direction === "vertical") &&
      typeof s.ratio === "number" &&
      isValidTree(s.a) &&
      isValidTree(s.b)
    );
  }
  return false;
}

function readEditorTree(): SplitTree {
  try {
    const raw = localStorage.getItem(LS_KEYS.editorTree);
    if (!raw) return freshTree();
    const parsed = JSON.parse(raw) as unknown;
    if (isValidTree(parsed)) return parsed;
    return freshTree();
  } catch {
    return freshTree();
  }
}

function firstLeafId(tree: SplitTree): string {
  if (tree.kind === "leaf") return tree.id;
  return firstLeafId(tree.a);
}

function leafExists(tree: SplitTree, id: string): boolean {
  if (tree.kind === "leaf") return tree.id === id;
  return leafExists(tree.a, id) || leafExists(tree.b, id);
}

/** Strip the path + `.md` extension off a file id for dialog copy. */
function shortName(id: string): string {
  const name = id.split(/[\\/]/).pop() ?? id;
  return name.replace(/\.md$/i, "");
}

export function LatticeShell() {
  const isMac = React.useMemo(detectIsMac, []);
  
  // ── Vault store ──────────────────────────────────────────────────
  // Selectors only — destructuring `useVaultStore()` would re-render
  // the entire shell on every dirty-flag flip / cache write, which
  // is the root cause of editor lag during typing.
  const vaultHandle = useVaultStore((s) => s.vaultHandle);
  const fileTree = useVaultStore((s) => s.fileTree);
  const isVaultOpen = useVaultStore((s) => s.isVaultOpen);
  const { openFile } = useFileOperations();

  // Seed the vault-store tree with `MOCK_VAULT_TREE` whenever no
  // real vault is open. Routing mock-vault data through the same
  // store means every mutation (rename, delete, merge, move) is
  // visible everywhere — the sidebar, the file pickers, and the
  // editor pane — without per-component branching on "real vs
  // mock". The seed runs ONCE per "no vault open" transition; if
  // the user later opens a real vault, `openVault` overwrites the
  // tree anyway.
  React.useEffect(() => {
    if (isVaultOpen) return;
    if (fileTree.length > 0) return; // already seeded
    useVaultStore.getState().setFileTree(MOCK_VAULT_TREE);
  }, [isVaultOpen, fileTree.length]);

  // ── Persisted sidebar state ──────────────────────────────────────
  const [leftView, setLeftView] = React.useState<LeftView>(() =>
    readEnum(LS_KEYS.leftView, LEFT_VIEWS, "files"),
  );
  const [rightView, setRightView] = React.useState<RightView>(() =>
    readEnum(LS_KEYS.rightView, RIGHT_VIEWS, "links"),
  );

  // Doc-menu "Open linked view" submenu → focus a specific right-
  // sidebar tab. Decoupled via window events so the doc-header
  // doesn't need a callback prop reaching across the editor pane.
  React.useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ view: RightView }>).detail;
      if (!detail?.view) return;
      setRightView(detail.view);
      setRightCollapsed(false);
    };
    window.addEventListener("flux-open-right-view", handler as EventListener);
    return () =>
      window.removeEventListener(
        "flux-open-right-view",
        handler as EventListener,
      );
  }, []);
  const [leftCollapsed, setLeftCollapsed] = React.useState<boolean>(() =>
    readBool(LS_KEYS.leftCollapsed, false),
  );
  const [rightCollapsed, setRightCollapsed] = React.useState<boolean>(() =>
    readBool(LS_KEYS.rightCollapsed, false),
  );
  const [leftWidth, setLeftWidth] = React.useState<number>(() =>
    readNumber(LS_KEYS.leftWidth, LEFT_DEFAULT),
  );
  const [rightWidth, setRightWidth] = React.useState<number>(() =>
    readNumber(LS_KEYS.rightWidth, RIGHT_DEFAULT),
  );

  // ── Editor tree + active-leaf id (persisted) ─────────────────────
  // The split-tree is owned by the shell so it survives sidebar
  // remounts and persists across reloads. EditorArea takes it as a
  // controlled prop and calls `onTreeChange` for every mutation.
  const [tree, setTree] = React.useState<SplitTree>(() => readEditorTree());
  const [activeLeafId, setActiveLeafId] = React.useState<string>(() => {
    const fromLs = (() => {
      try { return localStorage.getItem(LS_KEYS.activeLeafId); } catch { return null; }
    })();
    if (fromLs) return fromLs;
    return firstLeafId(tree);
  });

  // Make sure activeLeafId always points at a leaf that still exists.
  // After a split / drop / close the previously-active leaf may have
  // been collapsed away by `mapLeaves` — fall back to the first leaf.
  React.useEffect(() => {
    if (!leafExists(tree, activeLeafId)) {
      setActiveLeafId(firstLeafId(tree));
    }
  }, [tree, activeLeafId]);

  // Build the vault Map<id, FileNode> used by EditorArea / Pane to
  // resolve `tab.fileId`. Real vault files come from `fileTree`
  // (loaded from disk by useVaultOperations); when no vault is open
  // we still hand over `fileTree` because we've seeded the store
  // with `MOCK_VAULT_TREE` above. This unifies real-vs-mock data
  // flow so mutations are visible everywhere without per-component
  // branching.
  const vaultMap: Map<string, FileNode> = React.useMemo(() => {
    if (fileTree.length > 0) return flattenVault(fileTree);
    return MOCK_VAULT;
  }, [fileTree]);

  const handleTreeChange = React.useCallback((next: SplitTree | null) => {
    // If the tree would collapse entirely (every leaf removed) reset
    // to a fresh single-leaf root so the editor isn't a void.
    if (!next) {
      const fresh = freshTree();
      setTree(fresh);
      setActiveLeafId(firstLeafId(fresh));
      return;
    }
    setTree(next);
  }, []);

  /**
   * Open a vault file in the active leaf. If the file is already open
   * in that leaf, just focus the existing tab (handled by
   * `openTabInLeaf`). Otherwise append a new tab and focus it. Used
   * by the LeftSidebar's file tree click handler.
   */
  const handleOpenFile = React.useCallback(
    async (fileId: string) => {
      // Validate fileId
      if (!fileId) {
        console.error('[handleOpenFile] fileId is undefined or empty');
        return;
      }
      
      // fileId is the relative path from the vault root
      const fileName = fileId.split('/').pop() || fileId;
      const title = fileName.replace(/\.md$/i, "");
      
      // Check if current active tab is empty - if so, reuse it
      setTree((cur) => {
        const activeLeaf = findLeaf(cur, activeLeafId);
        if (!activeLeaf) return cur;
        
        const activeTab = activeLeaf.tabs.find(t => t.id === activeLeaf.activeTabId);
        
        // If current tab is empty (no fileId), replace it
        if (activeTab && !activeTab.fileId) {
          const updatedTabs = activeLeaf.tabs.map(t => 
            t.id === activeTab.id ? { ...t, fileId, title } : t
          );
          const next = mapLeaves(cur, (leaf) =>
            leaf.id === activeLeafId
              ? { ...leaf, tabs: updatedTabs }
              : leaf,
          );
          return next ?? cur;
        }
        
        // Otherwise, open in a new tab (or focus existing)
        const next = mapLeaves(cur, (leaf) =>
          leaf.id === activeLeafId
            ? openTabInLeaf(leaf, { id: uid("tab"), fileId, title })
            : leaf,
        );
        return next ?? cur;
      });

      // Background text-load — ONLY for kinds that read_file can handle
      // (UTF-8 markdown / canvas). PDFs, images, and the synthetic
      // "graph" entry must NOT round-trip through read_file or we get
      // either "NotFound" (for the synthetic graph) or "stream did not
      // contain valid UTF-8" (for binary content). Those views fetch
      // their own bytes inside the view body.
      const lower = fileName.toLowerCase();
      const isBinary =
        lower.endsWith('.pdf') ||
        lower.endsWith('.png') ||
        lower.endsWith('.jpg') ||
        lower.endsWith('.jpeg') ||
        lower.endsWith('.gif') ||
        lower.endsWith('.webp') ||
        lower.endsWith('.svg');
      if (isBinary) return;
      // Mock-vault mode (no real vault open) — content is inline on
      // each FileNode, no disk read needed. Skip the IPC roundtrip so
      // browser preview doesn't surface a "Tauri command outside the
      // Tauri runtime" toast.
      if (!isVaultOpen) return;
      try {
        await openFile(fileId);
      } catch (error) {
        console.error("Failed to open file:", error);
      }
    },
    [activeLeafId, openFile, isVaultOpen],
  );

  // Global `flux-open-file` event — fired by panels like the
  // Bookmarks sidebar list when the user wants to open a file in
  // the active editor leaf. Decoupled via window events so the
  // panel components don't need a callback prop reaching across
  // the shell.
  React.useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ fileId?: string; line?: number }>).detail;
      if (!detail?.fileId) return;
      void handleOpenFile(detail.fileId);
      // If a line was supplied (search-result click), forward it to
      // the editor so it can scroll + highlight. Done as a separate
      // event because `handleOpenFile` is async and the editor needs
      // to mount first before it can accept the jump command.
      if (detail.line && detail.line > 0) {
        // Two RAFs so the new file's editor view mounts before the
        // jump dispatch lands.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            window.dispatchEvent(
              new CustomEvent("flux-jump-to-line", {
                detail: { fileId: detail.fileId, line: detail.line },
              }),
            );
          });
        });
      }
    };
    window.addEventListener("flux-open-file", handler as EventListener);
    return () =>
      window.removeEventListener("flux-open-file", handler as EventListener);
  }, [handleOpenFile]);

  // ── Tab-sync handlers — react to delete/rename from useFileOperations.
  // Registers in a module-level Zustand store so vault file operations
  // (deep in the hook layer) can close stale tabs / rewrite renamed
  // tabs without callbacks threading through every layer.
  React.useEffect(() => {
    const closeTabsForFile = (fileId: string) => {
      const isMatch = (id: string | null | undefined) =>
        !!id && (id === fileId || id.startsWith(fileId + "/") || id.startsWith(fileId + "\\"));
      setTree((cur) => {
        const next = mapLeaves(cur, (leaf) => {
          const remaining = leaf.tabs.filter((t) => !isMatch(t.fileId));
          if (remaining.length === leaf.tabs.length) return leaf;
          if (remaining.length === 0) return null;
          const activeStillThere = remaining.some((t) => t.id === leaf.activeTabId);
          return {
            ...leaf,
            tabs: remaining,
            activeTabId: activeStillThere ? leaf.activeTabId : remaining[0].id,
          };
        });
        return next ?? freshTree();
      });
    };
    const renameTabFile = (oldPath: string, newPath: string, newName: string) => {
      const matchesPrefix = (id: string) =>
        id === oldPath || id.startsWith(oldPath + "/") || id.startsWith(oldPath + "\\");
      const rewrite = (id: string) =>
        id === oldPath ? newPath : newPath + id.slice(oldPath.length);
      setTree((cur) => {
        const next = mapLeaves(cur, (leaf) => {
          let touched = false;
          const tabs = leaf.tabs.map((t) => {
            if (!t.fileId || !matchesPrefix(t.fileId)) return t;
            touched = true;
            return {
              ...t,
              fileId: rewrite(t.fileId),
              title: t.fileId === oldPath ? newName : t.title,
            };
          });
          return touched ? { ...leaf, tabs } : leaf;
        });
        if (next) return next;
        return cur;
      });
    };
    useTabSyncStore.getState().setHandlers({ closeTabsForFile, renameTabFile });
    return () => {
      useTabSyncStore.getState().setHandlers(null);
    };
  }, []);

  React.useEffect(() => {
    try { localStorage.setItem(LS_KEYS.editorTree, JSON.stringify(tree)); } catch { /* noop */ }
  }, [tree]);
  React.useEffect(() => {
    try { localStorage.setItem(LS_KEYS.activeLeafId, activeLeafId); } catch { /* noop */ }
  }, [activeLeafId]);

  // Refs mirror state — keep pointermove closures stable.
  const leftCollapsedRef = React.useRef(leftCollapsed);
  const rightCollapsedRef = React.useRef(rightCollapsed);
  const leftWidthRef = React.useRef(leftWidth);
  const rightWidthRef = React.useRef(rightWidth);
  React.useEffect(() => { leftCollapsedRef.current = leftCollapsed; }, [leftCollapsed]);
  React.useEffect(() => { rightCollapsedRef.current = rightCollapsed; }, [rightCollapsed]);
  React.useEffect(() => { leftWidthRef.current = leftWidth; }, [leftWidth]);
  React.useEffect(() => { rightWidthRef.current = rightWidth; }, [rightWidth]);

  // Transition gate — true ONLY while the column's CSS `width` is
  // mid-flight. Derived from real `transitionstart` / `transitionend`
  // events on the column wrapper so the gate never gets cleared early
  // by an unrelated re-render (an `setTimeout`-based gate suffered a
  // visible snap because React 19 would clear it before the 220ms
  // transition had finished). Pre-armed on toggle clicks so the gate
  // is reliably true the instant the click commits, before the next
  // paint.
  const [leftTransitioning, setLeftTransitioning] = React.useState(false);
  const [rightTransitioning, setRightTransitioning] = React.useState(false);
  const leftColRef = React.useRef<HTMLDivElement>(null);
  const rightColRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = leftColRef.current;
    if (!el) return;
    const onStart = (e: TransitionEvent) => {
      if (e.target === el && e.propertyName === "width") setLeftTransitioning(true);
    };
    const onEnd = (e: TransitionEvent) => {
      if (e.target === el && e.propertyName === "width") setLeftTransitioning(false);
    };
    el.addEventListener("transitionstart", onStart);
    el.addEventListener("transitionend", onEnd);
    el.addEventListener("transitioncancel", onEnd);
    return () => {
      el.removeEventListener("transitionstart", onStart);
      el.removeEventListener("transitionend", onEnd);
      el.removeEventListener("transitioncancel", onEnd);
    };
  }, []);
  React.useEffect(() => {
    const el = rightColRef.current;
    if (!el) return;
    const onStart = (e: TransitionEvent) => {
      if (e.target === el && e.propertyName === "width") setRightTransitioning(true);
    };
    const onEnd = (e: TransitionEvent) => {
      if (e.target === el && e.propertyName === "width") setRightTransitioning(false);
    };
    el.addEventListener("transitionstart", onStart);
    el.addEventListener("transitionend", onEnd);
    el.addEventListener("transitioncancel", onEnd);
    return () => {
      el.removeEventListener("transitionstart", onStart);
      el.removeEventListener("transitionend", onEnd);
      el.removeEventListener("transitioncancel", onEnd);
    };
  }, []);

  // Track which handle is being dragged for visual feedback.
  const [dragging, setDragging] = React.useState<"left" | "right" | null>(null);

  // ── Quick-action palette (cmdk + Dialog) ─────────────────────────
  // Toggled by Cmd/Ctrl+K and by the activity strip's "terminal" entry.
  // Shadcn `CommandDialog` primitive with shell-flavored content
  // (clear / refresh / git / sync).
  const [terminalOpen, setTerminalOpen] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [vaultPickerOpen, setVaultPickerOpen] = React.useState(false);

  // ── Doc-menu dialog state ─────────────────────────────────────
  // The three doc-header ⋯ commands that need a modal live here so
  // they can be re-used from any pane (one shared dialog, one source
  // of truth for "what file are we operating on").
  const { moveFile: moveFileFn, deleteFile: deleteFileFn } = useFileOperations();
  const [moveDialog, setMoveDialog] = React.useState<{
    open: boolean;
    fileId: string | null;
  }>({ open: false, fileId: null });
  const [mergeDialog, setMergeDialog] = React.useState<{
    open: boolean;
    fileId: string | null;
  }>({ open: false, fileId: null });
  // Two-step merge: 1) pick source file 2) confirm destructive
  // operation (source file gets deleted after merge — matches
  // Obsidian's flow).
  const [mergeConfirm, setMergeConfirm] = React.useState<{
    open: boolean;
    targetId: string | null;
    sourceId: string | null;
  }>({ open: false, targetId: null, sourceId: null });
  const skipMergeConfirm = useSettingsStore((s) => s.skipMergeConfirm);
  const setSkipMergeConfirm = useSettingsStore((s) => s.setSkipMergeConfirm);
  const [frontmatterDialog, setFrontmatterDialog] = React.useState<{
    open: boolean;
    fileId: string | null;
    source: string;
  }>({ open: false, fileId: null, source: "" });

  const [pdfDialog, setPdfDialog] = React.useState<{
    open: boolean;
    fileId: string | null;
  }>({ open: false, fileId: null });

  // Add/edit bookmark dialog — fed by the `flux-edit-bookmark`
  // event so both the doc-header ⋯ → Bookmark action and the
  // Bookmarks panel's "Add" header button share one dialog.
  const [bookmarkDialog, setBookmarkDialog] = React.useState<{
    open: boolean;
    fileId: string | null;
    title?: string;
  }>({ open: false, fileId: null });

  /**
   * Read a file's source via the most authoritative cache first.
   * Order:
   *   1) Live editor buffer (unsaved edits the user expects to be
   *      part of the merge — Obsidian merges what you see).
   *   2) `useVaultStore.openFiles` cache (last disk read).
   *   3) Inline `content` on the FileNode (mock-vault files don't
   *      live on disk; this is the only available source).
   *   4) Tauri `readFile` when a real vault is open AND the file
   *      isn't already in any cache.
   * Returns `""` if nothing is available so the merge can still
   * succeed against an empty source (no surprise crashes).
   */
  const readFileSource = React.useCallback(
    async (id: string): Promise<string> => {
      const live = useEditorStore.getState().fileContents.get(id);
      if (live !== undefined) return live;
      const loaded = useVaultStore.getState().openFiles.get(id);
      if (loaded !== undefined) return loaded;
      const node = vaultMap.get(id);
      if (node?.content !== undefined) return node.content;
      if (isVaultOpen) {
        try {
          return await backendReadFile(id);
        } catch {
          /* fall through to empty string */
        }
      }
      return "";
    },
    [vaultMap, isVaultOpen],
  );

  /**
   * Run the actual merge: append `sourceId` contents to `targetId`,
   * write back, then move the source to trash. Matches Obsidian's
   * semantics — the source file is destroyed once its content is
   * folded into the target. Failures along the way are surfaced as
   * toasts and the operation aborts before the destructive step
   * runs (we read both files first, write the merged target, only
   * then delete the source).
   */
  const performMerge = React.useCallback(
    async (targetId: string, sourceId: string) => {
      try {
        const [a, b] = await Promise.all([
          readFileSource(targetId),
          readFileSource(sourceId),
        ]);
        const sep = a.endsWith("\n") ? "" : "\n";
        const merged = `${a}${sep}\n${b}`;
        if (isVaultOpen) {
          try {
            await backendWriteFile(targetId, merged);
          } catch (err) {
            // Browser preview / write failure — keep the merge in
            // the live editor buffer so the user still sees the
            // combined content, but warn about disk persistence.
            const { toast } = await import("sonner");
            const { formatError } = await import("@/lib/errors");
            toast.warning("Couldn't write target to disk", {
              description: formatError(err),
            });
          }
        }
        useEditorStore.getState().setFileContent(targetId, merged);
        useVaultStore.getState().setFileContent(targetId, merged);
        // Only delete the source once the target write succeeded —
        // otherwise a write failure would leave the user with no copy
        // of the merged content anywhere.
        try {
          if (isVaultOpen) {
            await deleteFileFn(sourceId);
          } else {
            // Mock-vault / browser preview — `deleteFile` would
            // hit the disabled backend. Just surgically remove the
            // node from the live tree + close any open tabs so the
            // user sees the result.
            useVaultStore.getState().removeNodeFromTree(sourceId);
            // The editor store doesn't currently expose a
            // remove-content method — clearing via setFileContent("")
            // is sufficient because the tab close handlers will fire
            // when the tree mutator dispatches its delete event.
            useVaultStore.getState().removeFileContent(sourceId);
          }
        } catch {
          const { toast } = await import("sonner");
          toast.warning(`Merged ${sourceId} into ${targetId}`, {
            description:
              "Couldn't delete the source file automatically — remove it from the sidebar when ready.",
          });
          return;
        }
        const { toast } = await import("sonner");
        toast.success(`Merged "${shortName(sourceId)}" into "${shortName(targetId)}"`);
      } catch (err) {
        const { toast } = await import("sonner");
        const { formatError } = await import("@/lib/errors");
        toast.error("Merge failed", { description: formatError(err) });
      }
    },
    [deleteFileFn, isVaultOpen, readFileSource],
  );

  // Bridge window events from the doc-menu (Pane.tsx) → local state.
  React.useEffect(() => {
    const onMove = (e: Event) => {
      const detail = (e as CustomEvent<{ fileId?: string }>).detail;
      if (detail?.fileId) setMoveDialog({ open: true, fileId: detail.fileId });
    };
    const onMerge = (e: Event) => {
      const detail = (e as CustomEvent<{ fileId?: string }>).detail;
      if (detail?.fileId) setMergeDialog({ open: true, fileId: detail.fileId });
    };
    const onEditFM = async (e: Event) => {
      const detail = (e as CustomEvent<{ fileId?: string }>).detail;
      const id = detail?.fileId;
      if (!id) return;
      // Prefer live editor content (unsaved edits) over disk for the
      // dialog's source — saving back from the dialog also writes
      // through the editor store path.
      const live = useEditorStore.getState().fileContents.get(id);
      const loaded = useVaultStore.getState().openFiles.get(id);
      let source = live ?? loaded ?? "";
      if (!source && isVaultOpen) {
        try {
          source = await backendReadFile(id);
        } catch {
          source = "";
        }
      }
      setFrontmatterDialog({ open: true, fileId: id, source });
    };
    window.addEventListener("flux-move-file", onMove as EventListener);
    window.addEventListener("flux-merge-file", onMerge as EventListener);
    window.addEventListener("flux-edit-frontmatter", onEditFM as EventListener);
    const onExportPdf = (e: Event) => {
      const detail = (e as CustomEvent<{ fileId?: string }>).detail;
      if (detail?.fileId) setPdfDialog({ open: true, fileId: detail.fileId });
    };
    window.addEventListener("flux-export-pdf", onExportPdf as EventListener);

    const onEditBookmark = (e: Event) => {
      const detail = (e as CustomEvent<{ fileId?: string; title?: string }>)
        .detail;
      if (!detail?.fileId) return;
      setBookmarkDialog({
        open: true,
        fileId: detail.fileId,
        title: detail.title,
      });
    };
    window.addEventListener(
      "flux-edit-bookmark",
      onEditBookmark as EventListener,
    );

    // Doc-menu ⋯ → Find / Replace → open the global left-sidebar
    // search view (VS-Code style) instead of CM's inline search
    // panel. Reveals the sidebar if collapsed, focuses + selects the
    // existing input so the user can type immediately.
    const onEditorFind = () => {
      setLeftCollapsed(false);
      setLeftView("search");
      // Give React a tick to mount the panel before we focus.
      requestAnimationFrame(() => {
        window.dispatchEvent(new CustomEvent("flux-focus-search"));
      });
    };
    window.addEventListener("flux-editor-find", onEditorFind as EventListener);
    return () => {
      window.removeEventListener("flux-move-file", onMove as EventListener);
      window.removeEventListener("flux-merge-file", onMerge as EventListener);
      window.removeEventListener(
        "flux-edit-frontmatter",
        onEditFM as EventListener,
      );
      window.removeEventListener(
        "flux-export-pdf",
        onExportPdf as EventListener,
      );
      window.removeEventListener(
        "flux-editor-find",
        onEditorFind as EventListener,
      );
      window.removeEventListener(
        "flux-edit-bookmark",
        onEditBookmark as EventListener,
      );
    };
    // isVaultOpen captured fresh on every render via the closure;
    // we intentionally don't list it as a dep so the listener stays
    // mounted exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const hotkeys = useSettingsStore((s) => s.hotkeys);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (matchesBinding(e, hotkeys.commandPalette)) {
        e.preventDefault();
        setTerminalOpen((o) => !o);
      }
      if (matchesBinding(e, hotkeys.openSettings)) {
        e.preventDefault();
        setSettingsOpen(true);
      }
      if (matchesBinding(e, hotkeys.globalSearch)) {
        e.preventDefault();
        setLeftCollapsed(false);
        setLeftView("search");
        requestAnimationFrame(() => {
          window.dispatchEvent(new CustomEvent("flux-focus-search"));
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hotkeys]);

  // Track viewport width so resize-handle X positions update on window
  // resize and the opposing-sidebar push math has a live value to
  // clamp against.
  const [windowWidth, setWindowWidth] = React.useState<number>(() =>
    typeof window !== "undefined" ? window.innerWidth : 1280,
  );
  React.useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // ── Persist on change ────────────────────────────────────────────
  React.useEffect(() => {
    try { localStorage.setItem(LS_KEYS.leftView, leftView); } catch { /* noop */ }
  }, [leftView]);
  React.useEffect(() => {
    try { localStorage.setItem(LS_KEYS.rightView, rightView); } catch { /* noop */ }
  }, [rightView]);
  React.useEffect(() => {
    try { localStorage.setItem(LS_KEYS.leftCollapsed, leftCollapsed ? "1" : "0"); } catch { /* noop */ }
  }, [leftCollapsed]);
  React.useEffect(() => {
    try { localStorage.setItem(LS_KEYS.rightCollapsed, rightCollapsed ? "1" : "0"); } catch { /* noop */ }
  }, [rightCollapsed]);
  React.useEffect(() => {
    try { localStorage.setItem(LS_KEYS.leftWidth, String(leftWidth)); } catch { /* noop */ }
  }, [leftWidth]);
  React.useEffect(() => {
    try { localStorage.setItem(LS_KEYS.rightWidth, String(rightWidth)); } catch { /* noop */ }
  }, [rightWidth]);

  // ── Dynamic max widths ───────────────────────────────────────────
  // The opposing sidebar must always retain its MIN width — so as the
  // window shrinks (or one sidebar grows), the cap on the other
  // tightens accordingly. When the opposing sidebar is collapsed, its
  // contribution is 0.
  const leftMaxDynamic = Math.max(
    LEFT_MIN,
    windowWidth - STRIP_W - (rightCollapsed ? 0 : RIGHT_MIN),
  );
  const rightMaxDynamic = Math.max(
    RIGHT_MIN,
    windowWidth - STRIP_W - (leftCollapsed ? 0 : LEFT_MIN),
  );

  // Auto-shrink on window resize — never let either sidebar exceed its
  // dynamic cap, which would push the editor below 0.
  React.useEffect(() => {
    if (leftWidth > leftMaxDynamic) setLeftWidth(leftMaxDynamic);
  }, [leftMaxDynamic, leftWidth]);
  React.useEffect(() => {
    if (rightWidth > rightMaxDynamic) setRightWidth(rightMaxDynamic);
  }, [rightMaxDynamic, rightWidth]);

  // ── Toggle helpers (animated) ────────────────────────────────────
  // Pre-arm the *Transitioning gate so the handle hides on THIS
  // render (before the next paint). The real transitionstart event
  // will keep it true, transitionend will clear it.
  const toggleLeftSidebar = React.useCallback(() => {
    setLeftTransitioning(true);
    setLeftCollapsed((c) => !c);
  }, []);
  const toggleRightSidebar = React.useCallback(() => {
    setRightTransitioning(true);
    setRightCollapsed((c) => !c);
  }, []);

  // ── View routing from the activity strip ─────────────────────────
  const routeLeftView = React.useCallback(
    (next: LeftView) => {
      const sameView = next === leftView;
      if (sameView) {
        // re-click active → toggle collapse
        toggleLeftSidebar();
      } else {
        setLeftView(next);
        if (leftCollapsedRef.current) {
          setLeftTransitioning(true);
          setLeftCollapsed(false);
        }
      }
    },
    [leftView, toggleLeftSidebar],
  );

  // ── Drag-resize math ─────────────────────────────────────────────
  // Capture starting widths once per drag so onDelta math stays
  // relative to where the user pressed — not where we currently are.
  const leftStartRef = React.useRef(LEFT_DEFAULT);
  const rightStartRef = React.useRef(RIGHT_DEFAULT);

  const beginLeftDrag = React.useCallback(() => {
    leftStartRef.current = leftWidthRef.current;
    setDragging("left");
  }, []);
  const beginRightDrag = React.useCallback(() => {
    rightStartRef.current = rightWidthRef.current;
    setDragging("right");
  }, []);
  const endDrag = React.useCallback(() => setDragging(null), []);

  const onLeftDelta = React.useCallback(
    (dx: number) => {
      const requested = leftStartRef.current + dx;
      // Snap to collapsed when dragged inward past the threshold
      if (requested < LEFT_COLLAPSE_AT) {
        if (!leftCollapsedRef.current) setLeftCollapsed(true);
        return;
      }
      // Otherwise (re-)expand and clamp
      if (leftCollapsedRef.current) setLeftCollapsed(false);
      const hardCap = Math.max(
        LEFT_MIN,
        windowWidth - STRIP_W - (rightCollapsedRef.current ? 0 : RIGHT_MIN),
      );
      const newLeft = Math.max(LEFT_MIN, Math.min(hardCap, requested));
      setLeftWidth(newLeft);
      // PUSH-OPPOSING: when the editor is squeezed below 0, push the
      // right sidebar inward to make room (never below RIGHT_MIN).
      // The right column's transition stays enabled during a LEFT
      // drag, so the push is fluidly animated instead of snapping.
      if (!rightCollapsedRef.current) {
        const remainingForRight = windowWidth - STRIP_W - newLeft;
        if (rightWidthRef.current > remainingForRight) {
          setRightWidth(Math.max(RIGHT_MIN, remainingForRight));
        }
      }
    },
    [windowWidth],
  );

  const onRightDelta = React.useCallback(
    (dx: number) => {
      // Dragging RIGHT shrinks the right sidebar — invert dx
      const requested = rightStartRef.current - dx;
      if (requested < RIGHT_COLLAPSE_AT) {
        if (!rightCollapsedRef.current) setRightCollapsed(true);
        return;
      }
      if (rightCollapsedRef.current) setRightCollapsed(false);
      const hardCap = Math.max(
        RIGHT_MIN,
        windowWidth - STRIP_W - (leftCollapsedRef.current ? 0 : LEFT_MIN),
      );
      const newRight = Math.max(RIGHT_MIN, Math.min(hardCap, requested));
      setRightWidth(newRight);
      if (!leftCollapsedRef.current) {
        const remainingForLeft = windowWidth - STRIP_W - newRight;
        if (leftWidthRef.current > remainingForLeft) {
          setLeftWidth(Math.max(LEFT_MIN, remainingForLeft));
        }
      }
    },
    [windowWidth],
  );

  // ── Resize handle viewport positions ─────────────────────────────
  // Both expressed as pixel offsets from the viewport's left edge so
  // they share a single anchor and don't drift sub-pixel under
  // fractional device-pixel ratios. Hidden while the column is mid-
  // CSS-transition so the handle doesn't snap to its final position
  // before the column has caught up.
  const leftHandleX =
    !leftCollapsed && !leftTransitioning ? STRIP_W + leftWidth - 3 : null;
  const rightHandleX =
    !rightCollapsed && !rightTransitioning ? windowWidth - rightWidth - 3 : null;

  // ── Layout values ────────────────────────────────────────────────
  const leftColWidth = leftCollapsed ? 0 : leftWidth;
  const rightColWidth = rightCollapsed ? 0 : rightWidth;

  return (
    <div className={cn("relative flex h-screen w-screen overflow-hidden flex-row", bgApp)}>
      {/* ===== L strip column ===== */}
      <div
        className={cn("relative flex flex-col shrink-0", bgStrip)}
        style={{ width: STRIP_W }}
      >
        {/* Header — Windows shows the panel-toggle button, macOS is
            empty (the toggle lives on the right edge of the left
            sidebar header on macOS). */}
        <div
          className={cn("relative flex items-center justify-center shrink-0", bgHeader)}
          style={{ height: HEADER_H }}
          data-tauri-drag-region
        >
          {!isMac && (
            <IconButton
              size="tiny"
              aria-label={leftCollapsed ? "Show left sidebar" : "Hide left sidebar"}
              data-tauri-drag-region={false}
              onClick={toggleLeftSidebar}
            >
              <IcPanelLeft open={!leftCollapsed} />
            </IconButton>
          )}
          {/* Top-strip seam */}
          <span
            aria-hidden
            className={cn("pointer-events-none absolute left-0 right-0 bottom-0 h-px", borderTabBg)}
          />
        </div>
        {/* Body */}
        <ActivityStrip
          view={leftView}
          collapsed={leftCollapsed}
          onRouteView={routeLeftView}
          onAction={(id: StripActionId) => {
            if (id === "terminal") {
              setTerminalOpen(true);
              return;
            }
            // TODO: wire up paper / publish / graph handlers
            console.log("strip action:", id);
          }}
        />
        {/* Right divider — starts below the header so the seam continues */}
        <span
          aria-hidden
          className={cn("pointer-events-none absolute right-0 bottom-0 w-px", borderSoftBg)}
          style={{ top: HEADER_H }}
        />
      </div>

      {/* ===== L sidebar column ===== */}
      <div
        ref={leftColRef}
        className="relative shrink-0 overflow-hidden"
        style={{
          width: leftColWidth,
          transition:
            dragging === "left"
              ? "none"
              : dragging === "right"
              ? `width ${PUSH_ANIM_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`
              : `width ${SIDEBAR_ANIM_MS}ms cubic-bezier(0.32, 0.72, 0, 1)`,
        }}
        aria-hidden={leftCollapsed}
      >
        {/* Inner wrapper at full expanded width so content doesn't
            reflow as the column slides to 0. Anchored to the LEFT
            edge (which stays put during the slide). */}
        <div
          className="absolute top-0 left-0 h-full"
          style={{ width: leftWidth }}
        >
          <LeftSidebar
            view={leftView}
            onChangeView={setLeftView}
            onToggleSidebar={toggleLeftSidebar}
            isMac={isMac}
            vaultName={vaultHandle?.name || "No Vault"}
            onOpenVaultPicker={() => setVaultPickerOpen(true)}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenHelp={() => console.log("Help not implemented yet")}
            vaultTree={fileTree}
            onOpenFile={handleOpenFile}
          />
        </div>
        {/* Right divider — full height when expanded */}
        {!leftCollapsed && (
          <span
            aria-hidden
            className={cn("pointer-events-none absolute right-0 top-0 bottom-0 w-px", borderSoftBg)}
          />
        )}
      </div>

      {/* ===== Editor column ===== */}
      <div
        className={cn("relative flex-1 min-w-0 overflow-hidden flex flex-col", bgEditor)}
      >
        {/* EditorArea owns its own pane-tabbar + doc-header + body.
            It also renders the L-sidebar reveal button (macOS only,
            when collapsed) inside the top-left pane's tabbar and the
            R-sidebar toggle inside the top-right pane's tabbar — so
            the shell doesn't render any chrome here directly.

            `topLeftInsetPx` reserves space for macOS traffic-lights
            when the L-sidebar is collapsed. `topRightInsetPx`
            reserves WIN_CONTROLS_W (138px) on Windows/Linux when the
            R-sidebar is collapsed so the tabbar + R-sidebar toggle
            don't slide behind our floating WindowControls cluster.
            pane.tsx itself gates application on `!isMac`, so on
            macOS this value is effectively ignored and the tabbar
            reaches the right edge. */}
        <EditorArea
          tree={tree}
          vault={vaultMap}
          activeLeafId={activeLeafId}
          onChangeActiveLeaf={setActiveLeafId}
          onTreeChange={handleTreeChange}
          leftSidebarCollapsed={leftCollapsed}
          rightSidebarCollapsed={rightCollapsed}
          onToggleLeftSidebar={toggleLeftSidebar}
          onToggleRightSidebar={toggleRightSidebar}
          topRightInsetPx={WIN_CONTROLS_W}
          topLeftInsetPx={isMac && leftCollapsed ? 40 : 0}
          isMac={isMac}
        />
      </div>

      {/* ===== R sidebar column ===== */}
      <div
        ref={rightColRef}
        className="relative shrink-0 overflow-hidden"
        style={{
          width: rightColWidth,
          transition:
            dragging === "right"
              ? "none"
              : dragging === "left"
              ? `width ${PUSH_ANIM_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`
              : `width ${SIDEBAR_ANIM_MS}ms cubic-bezier(0.32, 0.72, 0, 1)`,
        }}
        aria-hidden={rightCollapsed}
      >
        {/* Inner wrapper anchored to the LEFT edge of the column.
            The column itself is right-side, so its right edge sits at
            the viewport edge and its LEFT edge sweeps in/out during
            the open/close animation. Anchoring the inner content to
            that moving left edge makes the whole drawer (tabs, body,
            etc.) translate horizontally with the column — a real
            drawer slide. Anchoring it to right-0 instead (the old
            behavior) kept content pinned to the viewport edge and
            clipped the leftmost tabs immediately on close, leaving
            most of the animation showing empty padding. */}
        <div
          className="absolute top-0 left-0 h-full"
          style={{ width: rightWidth }}
        >
          <RightSidebar
            view={rightView}
            onChangeView={setRightView}
            isMac={isMac}
          />
        </div>
        {/* Left divider — full height when expanded. z-10 so it paints
            over the inner content (which sits at left:0 of the column
            via absolute positioning). Kept rendered during the
            collapse/expand transition so the drawer's left edge has a
            visible border the whole way in/out. */}
        {(!rightCollapsed || rightTransitioning) && (
          <span
            aria-hidden
            className={cn("pointer-events-none absolute left-0 top-0 bottom-0 w-px z-10", borderSoftBg)}
          />
        )}
      </div>

      {/* ===== Floating status pill (bottom-right) ===== */}
      <StatusPill empty />

      {/* Custom Win/Linux Min/Max/Close cluster (hidden on macOS).
          Tauri runs with `decorations: false` + `titleBarStyle:
          Overlay`, so the OS doesn't paint a title bar — we draw our
          own buttons floating at top-right inside the WIN_CONTROLS_W
          (138px) right-padding the right-sidebar header reserves. */}
      <WindowControls />

      {/* ===== Full-window-height sidebar resize handles ===== */}
      {leftHandleX !== null && (
        <ResizeHandle
          onBegin={beginLeftDrag}
          onDelta={onLeftDelta}
          onEnd={endDrag}
          style={{ left: leftHandleX }}
          title="Resize left sidebar"
          className={dragging === "left" ? "dragging" : undefined}
        />
      )}
      {rightHandleX !== null && (
        <ResizeHandle
          onBegin={beginRightDrag}
          onDelta={onRightDelta}
          onEnd={endDrag}
          style={{ left: rightHandleX }}
          title="Resize right sidebar"
          className={dragging === "right" ? "dragging" : undefined}
        />
      )}

      {/* Quick-action palette — Cmd/Ctrl+K or strip "terminal" entry. */}
      <TerminalPalette
        open={terminalOpen}
        onOpenChange={setTerminalOpen}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {/* Settings dialog — lattice-faithful 2-col shell on shadcn
          Dialog. Opened from the L-sidebar footer gear, the
          terminal-palette "Open settings" entry, or Cmd/Ctrl+,. */}
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />

      {/* Vault picker — opened from L-sidebar footer vault dropdown */}
      <VaultPicker open={vaultPickerOpen} onClose={() => setVaultPickerOpen(false)} />

      {/* Doc-menu "Move file to…" — folder picker. */}
      {moveDialog.open && moveDialog.fileId && (
        <FilePickerDialog
          open={moveDialog.open}
          title="Move file to…"
          description={`Pick a destination folder for ${moveDialog.fileId}.`}
          kind="folder"
          tree={fileTree}
          excludeIds={[moveDialog.fileId]}
          onCancel={() => setMoveDialog({ open: false, fileId: null })}
          onConfirm={async (folderId) => {
            const id = moveDialog.fileId!;
            setMoveDialog({ open: false, fileId: null });
            const name = id.split(/[\\/]/).pop() ?? id;
            const dst = folderId ? `${folderId}/${name}` : name;
            try {
              await moveFileFn(id, dst);
            } catch {
              /* moveFile already toasts errors */
            }
          }}
        />
      )}

      {/* Doc-menu "Merge entire file with…" — STEP 1: pick the
          source file. Selecting a source either runs the merge
          immediately (when "Don't ask again" was checked previously)
          or escalates to the confirm dialog below. */}
      {mergeDialog.open && mergeDialog.fileId && (
        <FilePickerDialog
          open={mergeDialog.open}
          title="Merge file with…"
          description={`Pick a source file. Its contents will be appended to "${mergeDialog.fileId}" and the source will be deleted.`}
          kind="file"
          tree={fileTree}
          excludeIds={[mergeDialog.fileId]}
          onCancel={() => setMergeDialog({ open: false, fileId: null })}
          onConfirm={async (sourceId) => {
            const targetId = mergeDialog.fileId!;
            setMergeDialog({ open: false, fileId: null });
            if (skipMergeConfirm) {
              await performMerge(targetId, sourceId);
            } else {
              setMergeConfirm({
                open: true,
                targetId,
                sourceId,
              });
            }
          }}
        />
      )}

      {/* STEP 2: destructive-action confirm. Matches Obsidian's
          "Are you sure you want to merge X into Y? X will be
          deleted." prompt with a "Don't ask again" toggle that
          flips the persistent setting. */}
      {mergeConfirm.open && mergeConfirm.targetId && mergeConfirm.sourceId && (
        <ConfirmDialog
          open={mergeConfirm.open}
          onOpenChange={(o) =>
            !o &&
            setMergeConfirm({ open: false, targetId: null, sourceId: null })
          }
          title="Merge file"
          description={
            <>
              Are you sure you want to merge{" "}
              <span className="font-medium text-[var(--text-normal)]">
                "{shortName(mergeConfirm.sourceId)}"
              </span>{" "}
              into{" "}
              <span className="font-medium text-[var(--text-normal)]">
                "{shortName(mergeConfirm.targetId)}"
              </span>
              ?{" "}
              <span className="font-medium text-[var(--text-normal)]">
                "{shortName(mergeConfirm.sourceId)}"
              </span>{" "}
              will be deleted.
            </>
          }
          confirmLabel="Merge"
          destructive
          dontAskAgain={{
            label: "Don't ask again",
            onChange: setSkipMergeConfirm,
          }}
          onConfirm={async () => {
            const t = mergeConfirm.targetId!;
            const s = mergeConfirm.sourceId!;
            await performMerge(t, s);
          }}
        />
      )}

      {/* Doc-menu "Add file property" — YAML frontmatter editor. */}
      {frontmatterDialog.open && frontmatterDialog.fileId && (
        <FrontmatterEditor
          open={frontmatterDialog.open}
          fileName={frontmatterDialog.fileId}
          source={frontmatterDialog.source}
          onCancel={() =>
            setFrontmatterDialog({ open: false, fileId: null, source: "" })
          }
          onSave={async (newSource) => {
            const id = frontmatterDialog.fileId!;
            setFrontmatterDialog({ open: false, fileId: null, source: "" });
            try {
              await backendWriteFile(id, newSource);
              useEditorStore.getState().setFileContent(id, newSource);
              useVaultStore.getState().setFileContent(id, newSource);
              const { toast } = await import("sonner");
              toast.success("File properties saved");
            } catch (err) {
              const { toast } = await import("sonner");
              const { formatError } = await import("@/lib/errors");
              toast.error("Failed to save properties", {
                description: formatError(err),
              });
            }
          }}
        />
      )}

      {/* Doc-menu "Export to PDF" — html2pdf.js export with full
          customization (page size, orientation, margin, scale,
          dark/light, include diagrams/code). */}
      {pdfDialog.open && pdfDialog.fileId && (
        <PdfExportDialog
          open={pdfDialog.open}
          defaultFilename={shortName(pdfDialog.fileId)}
          onCancel={() => setPdfDialog({ open: false, fileId: null })}
          onExport={(opts) => {
            const id = pdfDialog.fileId!;
            const node = vaultMap.get(id);
            // Close the dialog immediately so the user can keep
            // working; the export runs as a background promise and
            // reports status via sonner.
            setPdfDialog({ open: false, fileId: null });
            if (!node) return;
            const stem = opts.filename || shortName(id);
            void (async () => {
              const { toast } = await import("sonner");
              const { exportToPdf, pickPdfSavePath } = await import(
                "@/lib/doc-actions"
              );
              const { isTauri } = await import("@/bindings");
              const picked = await pickPdfSavePath(stem);
              if (picked === "cancelled") return;
              const source = await readFileSource(id);
              if (isTauri && picked) {
                // Native Rust render → blocking work happens off the
                // main thread, so toast.promise gives meaningful
                // progress feedback.
                toast.promise(exportToPdf(node, source, opts, picked), {
                  loading: `Exporting ${stem}.pdf…`,
                  success: `Saved to ${picked}`,
                  error: (err) =>
                    `PDF export failed: ${err instanceof Error ? err.message : String(err)}`,
                });
              } else {
                // Browser fallback hands off to the OS print dialog;
                // pre-firing a "loading" toast just hides behind the
                // dialog and confuses the user. Run silently.
                try {
                  await exportToPdf(node, source, opts, picked);
                } catch (err) {
                  toast.error(
                    `PDF export failed: ${err instanceof Error ? err.message : String(err)}`,
                  );
                }
              }
            })();
          }}
        />
      )}

      {/* Add/edit bookmark dialog — shared between the doc-header
          ⋯-menu and the Bookmarks panel's "Add" header button. */}
      <AddBookmarkDialog
        open={bookmarkDialog.open}
        fileId={bookmarkDialog.fileId}
        defaultTitle={bookmarkDialog.title}
        onClose={() => setBookmarkDialog({ open: false, fileId: null })}
      />
    </div>
  );
}
