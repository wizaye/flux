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
import { EditorArea } from "@/components/flux-ui/editor";
import { WindowControls } from "@/components/flux-ui/layout/window-controls";
import {
  type SplitTree,
  type Tab,
  MOCK_VAULT,
  uid,
} from "@/state/editor";

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
const RIGHT_VIEWS = ["links", "outgoing", "tags", "saved", "outline"] as const;

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

export function LatticeShell() {
  const isMac = React.useMemo(detectIsMac, []);

  // ── Persisted sidebar state ──────────────────────────────────────
  const [leftView, setLeftView] = React.useState<LeftView>(() =>
    readEnum(LS_KEYS.leftView, LEFT_VIEWS, "files"),
  );
  const [rightView, setRightView] = React.useState<RightView>(() =>
    readEnum(LS_KEYS.rightView, RIGHT_VIEWS, "links"),
  );
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
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setTerminalOpen((o) => !o);
      }
      // Cmd/Ctrl + , → open settings (mirrors VS Code / macOS conv).
      if (e.key === "," && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setSettingsOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
            vaultName="My Vault"
            onOpenSettings={() => setSettingsOpen(true)}
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
          vault={MOCK_VAULT}
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
    </div>
  );
}
