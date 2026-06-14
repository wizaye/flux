import * as React from "react";
import { cn } from "@/lib/utils";
import { accentBg, dividerBg } from "@/lib/lattice-tokens";
import type { SplitTree } from "@/state/editor";

/**
 * Recursive split renderer. Renders a flex container along `direction`
 * with two children (each may be a leaf or another split) and a 4 px
 * draggable divider between them. The divider uses pointer-capture so
 * dragging works smoothly even when the cursor strays outside the
 * dividerlimit; ratio math is done on `clientX/Y - containerRect.left/top`.
 *
 * Ported from `SplitNode` in `lattice/src/components/editor/EditorArea.tsx`.
 */

type Props = {
  node: Extract<SplitTree, { kind: "split" }>;
  renderChild: (child: SplitTree) => React.ReactNode;
  /** Called with the split's id and a new ratio in [0.05, 0.95]. */
  onResize: (splitId: string, ratio: number) => void;
  /** True while the divider is mid-drag — used to disable transitions. */
  onDragChange?: (dragging: boolean) => void;
};

export function SplitNode({ node, renderChild, onResize, onDragChange }: Props) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const dragRef = React.useRef<{
    startCoord: number;
    startRatio: number;
    size: number;
  } | null>(null);
  const [dragging, setDragging] = React.useState(false);

  const handlePointerDown = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const container = containerRef.current;
      if (!container) return;
      const r = container.getBoundingClientRect();
      const size = node.direction === "horizontal" ? r.width : r.height;
      if (size <= 0) return;
      const startCoord = node.direction === "horizontal" ? e.clientX : e.clientY;
      dragRef.current = { startCoord, startRatio: node.ratio, size };
      e.currentTarget.setPointerCapture(e.pointerId);
      document.body.style.cursor =
        node.direction === "horizontal" ? "col-resize" : "row-resize";
      setDragging(true);
      onDragChange?.(true);
    },
    [node.direction, node.ratio, onDragChange],
  );

  const handlePointerMove = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const ctx = dragRef.current;
      if (!ctx) return;
      const cur = node.direction === "horizontal" ? e.clientX : e.clientY;
      const delta = cur - ctx.startCoord;
      const ratio = (ctx.startRatio * ctx.size + delta) / ctx.size;
      onResize(node.id, ratio);
    },
    [node.direction, node.id, onResize],
  );

  const endDrag = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return;
      dragRef.current = null;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* may already be released */
      }
      document.body.style.cursor = "";
      setDragging(false);
      onDragChange?.(false);
    },
    [onDragChange],
  );

  // Safety net — if a pointerup is swallowed by the OS title bar /
  // another window / a dev overlay, the divider's own onPointerUp
  // never fires and `body.cursor` stays at `col-resize`, making the
  // ENTIRE editor area look like a giant splitter handle. Clear on
  // any of: window blur, tab hide, Escape.
  React.useEffect(() => {
    if (!dragging) return;
    const cleanup = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      document.body.style.cursor = "";
      setDragging(false);
      onDragChange?.(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") cleanup(); };
    const onVisibility = () => { if (document.hidden) cleanup(); };
    window.addEventListener("blur", cleanup);
    window.addEventListener("pointerup", cleanup);
    window.addEventListener("pointercancel", cleanup);
    window.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", cleanup);
      window.removeEventListener("pointerup", cleanup);
      window.removeEventListener("pointercancel", cleanup);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [dragging, onDragChange]);

  const horizontal = node.direction === "horizontal";
  const aSizePct = `${node.ratio * 100}%`;
  const bSizePct = `${(1 - node.ratio) * 100}%`;

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative flex-1 min-h-0 min-w-0 flex",
        horizontal ? "flex-row" : "flex-col",
      )}
    >
      <div
        className="relative min-w-0 min-h-0 flex"
        style={horizontal ? { width: aSizePct } : { height: aSizePct }}
      >
        {renderChild(node.a)}
      </div>

      {/* Divider — 4px hit-zone with a 1px visual line centred inside. */}
      <div
        role="separator"
        aria-orientation={horizontal ? "vertical" : "horizontal"}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={cn(
          "relative shrink-0 z-[2] group",
          horizontal
            ? "w-1 cursor-col-resize my-0"
            : "h-1 cursor-row-resize mx-0",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "absolute pointer-events-none",
            horizontal ? "top-0 bottom-0 left-1/2 -translate-x-1/2 w-px" : "left-0 right-0 top-1/2 -translate-y-1/2 h-px",
            dragging ? accentBg : dividerBg,
            // Subtle hover-glow when not dragging
            !dragging && "group-hover:bg-[#7f6df2] transition-colors duration-100",
          )}
        />
      </div>

      <div
        className="relative min-w-0 min-h-0 flex"
        style={horizontal ? { width: bSizePct } : { height: bSizePct }}
      >
        {renderChild(node.b)}
      </div>
    </div>
  );
}
