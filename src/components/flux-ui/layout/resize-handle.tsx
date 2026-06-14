import * as React from "react";
import { cn } from "@/lib/utils";
import { useDragResize } from "@/hooks/use-drag-resize";
import { RESIZE_ZONE_W } from "@/lib/layout-constants";

/**
 * Full-window-height transparent overlay handle for resizing the
 * sidebars. Positioned by the parent — absolute coordinates flow in
 * via the `style` prop. Visual indicator: a 1-px purple line at its
 * centre that thickens to 2 px on hover / drag (matches `--resize-line`
 * from lattice).
 */

interface ResizeHandleProps {
  /** Snapshots starting width — fired on pointerdown BEFORE drag math. */
  onBegin?: () => void;
  onDelta: (dx: number) => void;
  onEnd?: () => void;
  /** Absolute positioning + any extra classes. */
  className?: string;
  style?: React.CSSProperties;
  title?: string;
}

export function ResizeHandle({
  onBegin,
  onDelta,
  onEnd,
  className,
  style,
  title,
}: ResizeHandleProps) {
  const [dragging, setDragging] = React.useState(false);

  const handlePointerDown = useDragResize(
    "x",
    onDelta,
    React.useCallback(() => {
      setDragging(false);
      onEnd?.();
    }, [onEnd]),
  );

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      title={title}
      onPointerDown={(e) => {
        onBegin?.();
        setDragging(true);
        handlePointerDown(e);
      }}
      className={cn(
        "absolute top-0 bottom-0 z-50 cursor-ew-resize bg-transparent group",
        className,
      )}
      style={{ width: RESIZE_ZONE_W, ...style }}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-0 bottom-0 left-1/2 -translate-x-1/2 transition-[width,background] duration-75",
          dragging
            ? "w-[2px] bg-[#7f6df2]"
            : "w-px bg-transparent group-hover:w-[2px] group-hover:bg-[#7f6df2]",
        )}
      />
    </div>
  );
}
