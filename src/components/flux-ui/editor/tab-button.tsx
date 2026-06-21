import * as React from "react";
import { cn } from "@/lib/utils";
import {
  bgEditor,
  textMuted,
  textNormal,
  borderTab,
} from "@/lib/lattice-tokens";
import {
  IcClose,
  IcPin,
  IcCloseAll,
  IcPinned,
  IcEye,
  IcArrowRight,
  IcArrowDown,
  IcCopy,
  IcFolderOpened,
  IcLinkExternal,
  IcEdit,
  IcTrash,
} from "@/components/flux-ui/common/icons";
import { DRAG_MIME, type Tab } from "@/state/editor";
import { setDragImageBelowCursor } from "./drag-ghost";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";

/**
 * Single tab in the pane tabbar. Owns:
 *   • draggable=true with `application/x-flux-tab` payload
 *   • close button (`×`) — replaced by pin icon when `isPinned`
 *   • 140 ms close animation (skipped when dirty)
 *   • right-click → shadcn `ContextMenu` (Radix)
 *
 * Ports `TabButton` from `lattice/src/components/editor/EditorArea.tsx`.
 */

type Props = {
  tab: Tab;
  leafId: string;
  isActive: boolean;
  tabCount: number;
  isDirty?: boolean;
  /** Tabs render their separator on the right side except for the
   *  last tab in a leaf — same rule as lattice's `.pane-tab + .pane-tab`
   *  divider. */
  showRightSeparator: boolean;
  onActivate: () => void;
  onClose: () => void;
  onTogglePin: () => void;
  onToggleReading: () => void;
  onSplitRight: () => void;
  onSplitDown: () => void;
  onCopyPath: () => void;
  onShowInExplorer: () => void;
  onOpenInDefault: () => void;
  onRename: () => void;
  onDelete: () => void;
  onCloseOthers: () => void;
  onCloseAll: () => void;
  /** Called when the user starts dragging this tab. */
  onDragStart?: () => void;
  onDragEnd?: () => void;
  /** Optional handlers for tab-internal HTML5 DnD (used by Pane to
   *  show the insertion indicator between tabs). */
  onTabDragOver?: (e: React.DragEvent) => void;
};

export function TabButton(props: Props) {
  const {
    tab,
    leafId,
    isActive,
    tabCount,
    isDirty,
    showRightSeparator,
    onActivate,
    onClose,
    onTogglePin,
    onToggleReading,
    onSplitRight,
    onSplitDown,
    onCopyPath,
    onShowInExplorer,
    onOpenInDefault,
    onRename,
    onDelete,
    onCloseOthers,
    onCloseAll,
    onDragStart,
    onDragEnd,
    onTabDragOver,
  } = props;

  // ── close animation ──────────────────────────────────────────────
  // Mirrors the legacy 140ms tab-close fade. When the user clicks ×
  // we mark the row as `closing` so the className applies the
  // collapse animation, then call onClose after the transition ends.
  // Dirty tabs skip the animation (the parent typically intercepts
  // close with a "save first?" prompt).
  const [closing, setClosing] = React.useState(false);
  const closeTimer = React.useRef<number | null>(null);

  React.useEffect(() => () => {
    if (closeTimer.current != null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const handleClose = React.useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (isDirty) {
        onClose();
        return;
      }
      if (closing) return;
      setClosing(true);
      // Match the css duration (140 ms) — we drive it from JS so the
      // parent gets the call after the animation finishes, no matter
      // how the animation is implemented.
      closeTimer.current = window.setTimeout(() => {
        closeTimer.current = null;
        onClose();
      }, 140);
    },
    [closing, isDirty, onClose],
  );

  // ── tab-mount animation ──────────────────────────────────────────
  // 180 ms fade-in for newly-opened tabs. We don't need a ref-based
  // gate because React mounts the component on first paint; the
  // tailwind `animate-in` keyframe runs once and stops.

  // ── drag-start ───────────────────────────────────────────────────
  const handleDragStart = React.useCallback(
    (e: React.DragEvent) => {
      const dt = e.dataTransfer;
      if (!dt) return;
      dt.effectAllowed = "move";
      dt.setData(
        DRAG_MIME.tab,
        JSON.stringify({ leafId, tabId: tab.id }),
      );
      dt.setData(DRAG_MIME.text, tab.title);
      setDragImageBelowCursor(e, tab.title);
      onDragStart?.();
    },
    [leafId, tab.id, tab.title, onDragStart],
  );

  // ── context menu ─────────────────────────────────────────────────
  // Now uses shadcn `ContextMenu` (Radix) — eliminates the hand-rolled
  // portal + viewport-clamp + outside-click code.
  const pinned = !!tab.isPinned;
  const reading = tab.viewMode === "preview";

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
      <div
        role="tab"
        aria-selected={isActive}
        draggable
        onDragStart={handleDragStart}
        onDragEnd={onDragEnd}
        onDragOver={onTabDragOver}
        onClick={() => !closing && onActivate()}
        onMouseDown={(e) => {
          // Middle-click closes the tab (only for non-dirty).
          if (e.button === 1) {
            e.preventDefault();
            handleClose(e as unknown as React.MouseEvent);
          }
        }}
        className={cn(
          // ── Layout ──────────────────────────────────────────────
          // Lattice `.tab`:
          //   • position: relative (anchors ::before pill + ::after sep)
          //   • inline-flex + items-center
          //   • height: 28px (a shorter pill floating inside the 36px bar)
          //   • padding: 0 8px 0 12px (asymmetric — more on left so the
          //     title doesn't kiss the rounded edge)
          //   • gap: 6px between title and close
          //   • rounded-[6px] pill corner
          //   • font-size: 12px
          "relative inline-flex items-center gap-1.5 select-none cursor-pointer",
          "pl-3 pr-2 rounded-[6px] text-[12px]",
          // ── Width / flex behavior (Chrome-style equal compression) ──
          //   width: 220px → explicit basis so `.pane-tabs`
          //     (flex: 0 1 max-content) gets natural N × 220px width.
          //   flex-shrink: 1 → siblings compress together when constrained.
          //   flex-grow: 0 → never wider than 220.
          //   min-w-0 → title can ellipsis-clip past intrinsic width.
          "min-w-0 shrink",
          // ── Colors ───────────────────────────────────────────────
          // INACTIVE at rest: NO background, NO border — just muted text.
          // Hover paints a `::before` pill (see before:* utilities below).
          // ACTIVE: bg-editor + 1px border-tab + z-3 raises it above the
          // inactive separator hairlines.
          isActive
            ? cn(bgEditor, "border", borderTab, "z-[3]", textNormal)
            : cn("bg-transparent border border-transparent", textMuted, "hover:text-foreground"),
          // ── Inactive hover-pill (::before, inset:0) ─────────────
          // Painted via Tailwind's `before:` utility. Disabled for
          // active tabs because they already have a bordered fill.
          !isActive && [
            "before:content-[''] before:absolute before:inset-0 before:rounded-[6px]",
            "before:bg-transparent before:transition-colors before:duration-100",
            "before:pointer-events-none",
            "hover:before:bg-[#ececea] dark:hover:before:bg-[#2a2a2a]",
          ],
          // ── Animations ───────────────────────────────────────────
          // Mount fade-in once on first paint. Close-collapse handled
          // by the `closing` class below + inline `style` width:0.
          "animate-in fade-in-0 zoom-in-95 duration-150",
          "transition-[background,color,width,padding,opacity] duration-100 ease-out",
          // ── Close-anim sink ──────────────────────────────────────
          closing && "opacity-0 pointer-events-none overflow-hidden",
        )}
        style={{
          // Lattice `.tab { height: 28px }` — a 28px pill centered
          // vertically in the 36px tabbar (the strip's `bg-header` shows
          // through above + below the active pill).
          height: 28,
          // 220px is the *basis*, not the cap — flex-shrink:1 lets each
          // tab compress evenly when the row can't fit N × 220px.
          width: closing ? 0 : 220,
          flexGrow: 0,
          // During close, collapse padding too so the pill shrinks all
          // the way to zero rather than leaving an 8+12 = 20px stub.
          paddingLeft: closing ? 0 : undefined,
          paddingRight: closing ? 0 : undefined,
        }}
      >
        {/* Title — lattice `.tab-title { flex:1; min-w:0; ellipsis;
            line-height:1; position:relative }`. position:relative
            ensures the text paints *above* the absolute hover-pill
            ::before below. */}
        <span
          className={cn(
            "relative flex-1 min-w-0 truncate leading-none",
            isActive ? textNormal : "text-inherit",
          )}
        >
          {tab.title || "Untitled"}
        </span>

        {/* Pin / close button. Lattice `.tab-close`:
              • 18×18, rounded-[3px]
              • opacity 0.55 at rest (always visible — Obsidian behavior),
                bumps to 0.9 on tab-hover/active, 1 on close-hover
              • hover bg = var(--hover)
              • icon 11×11 inside, stroke-width 1.6
              • position: relative so it paints over the hover-pill */}
        {tab.isPinned ? (
          <button
            type="button"
            aria-label="Unpin tab"
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin();
            }}
            className={cn(
              "relative shrink-0 inline-flex items-center justify-center",
              "w-[18px] h-[18px] rounded-[3px] text-current",
              "opacity-[0.55] hover:opacity-100 transition-opacity duration-100",
              "hover:bg-[#ececea] dark:hover:bg-[#2a2a2a]",
              "[&_svg]:size-[11px]",
            )}
          >
            <IcPin />
          </button>
        ) : (
          <button
            type="button"
            aria-label="Close tab"
            onClick={handleClose}
            className={cn(
              "relative shrink-0 inline-flex items-center justify-center",
              "w-[18px] h-[18px] rounded-[3px] text-current",
              "opacity-[0.55] hover:opacity-100",
              "transition-[opacity,background,transform] duration-100",
              "active:scale-[0.88]",
              "hover:bg-[#ececea] dark:hover:bg-[#2a2a2a]",
              "[&_svg]:size-[11px]",
              isDirty && "text-[#e36464] dark:text-[#e36464] opacity-100",
            )}
          >
            <IcClose />
          </button>
        )}

        {/* Right-edge tick separator between consecutive inactive tabs.
            Lattice `.tab:not(.active)::after`:
              • 1px wide, right:0, top:6 bottom:6 (in a 28px tab)
              • bg: var(--border-tab)
              • hidden on last tab + tab before active
            The parent Pane computes `showRightSeparator` to encode
            those two rules in one prop. */}
        {showRightSeparator && !isActive && (
          <span
            aria-hidden
            className="pointer-events-none absolute right-0 text-[#909090]/40 dark:text-[#6a6a6a]/40 text-[10px]"
            style={{ 
              top: '50%', 
              transform: 'translateY(-50%)',
              right: '-0.5px' 
            }}
          >
            |
          </span>
        )}
      </div>
      </ContextMenuTrigger>

      {/* Shadcn ContextMenu replaces the prior hand-rolled portal +
          viewport-clamp + outside-click code (~140 LOC eliminated). */}
      <ContextMenuContent className="min-w-[200px]">
        <ContextMenuItem disabled={pinned} onSelect={onClose}>
          <IcClose /> Close
        </ContextMenuItem>
        <ContextMenuItem disabled={tabCount <= 1} onSelect={onCloseOthers}>
          <IcCloseAll /> Close others
        </ContextMenuItem>
        <ContextMenuItem onSelect={onCloseAll}>
          <IcCloseAll /> Close all
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onTogglePin}>
          {pinned ? <IcPinned /> : <IcPin />}
          {pinned ? "Unpin tab" : "Pin tab"}
        </ContextMenuItem>
        <ContextMenuItem onSelect={onToggleReading}>
          <IcEye />
          {reading ? "Switch to source" : "Switch to reading view"}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onSplitRight}>
          <IcArrowRight /> Split right
        </ContextMenuItem>
        <ContextMenuItem onSelect={onSplitDown}>
          <IcArrowDown /> Split down
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onCopyPath}>
          <IcCopy /> Copy path
        </ContextMenuItem>
        <ContextMenuItem onSelect={onShowInExplorer}>
          <IcFolderOpened /> Show in system explorer
        </ContextMenuItem>
        <ContextMenuItem onSelect={onOpenInDefault}>
          <IcLinkExternal /> Open in default app
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onRename}>
          <IcEdit /> Rename…
        </ContextMenuItem>
        <ContextMenuItem variant="destructive" onSelect={onDelete}>
          <IcTrash /> Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
