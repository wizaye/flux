import * as React from "react";
import { cn } from "@/lib/utils";
import { accentBg } from "@/lib/lattice-tokens";
import type { DropEdge } from "@/state/editor";

/**
 * Translucent edge / center indicator painted over a pane while a tab
 * or file is being dragged into it. Mirrors lattice's
 * `.drop-overlay.{left,right,top,bottom,center}` rules:
 *  - left/right occupy 50% of the pane horizontally
 *  - top/bottom occupy 50% vertically
 *  - center fills the pane (merge into the leaf)
 *
 * Always pointer-events:none so it never blocks the drop event.
 */
export function DropOverlay({ edge }: { edge: DropEdge }) {
  const placement: React.CSSProperties = (() => {
    switch (edge) {
      case "left":   return { top: 0, bottom: 0, left: 0, width: "50%" };
      case "right":  return { top: 0, bottom: 0, right: 0, width: "50%" };
      case "top":    return { left: 0, right: 0, top: 0, height: "50%" };
      case "bottom": return { left: 0, right: 0, bottom: 0, height: "50%" };
      case "center": return { inset: 0 };
    }
  })();
  return (
    <div
      aria-hidden
      className={cn(
        "absolute pointer-events-none z-10 opacity-[0.18]",
        // Fade-in to match lattice's `drop-overlay-fade` keyframes
        // (110 ms ease-out). We use a transition-on-mount trick via
        // `animate-[drop-overlay-fade_110ms_ease-out]` which Tailwind
        // doesn't ship by default — fall back to opacity transition
        // since the parent only mounts the overlay while hovering.
        accentBg,
      )}
      style={placement}
    />
  );
}

/**
 * 2 px vertical insertion marker painted between two tabs in the
 * tabbar while a drag is hovering over it. `left` is measured in
 * pixels relative to the `.pane-tabs` container.
 *
 * Mirrors lattice's `.tab-insertion` (`top: 4px; bottom: 4px;
 * width: 2px; box-shadow: 0 0 6px rgba(127, 109, 242, 0.6);`).
 */
export function TabInsertionMarker({ left }: { left: number }) {
  return (
    <div
      aria-hidden
      className={cn(
        "absolute top-1 bottom-1 w-[2px] rounded-[1px] pointer-events-none z-[4]",
        accentBg,
      )}
      style={{
        left,
        transform: "translateX(-1px)",
        boxShadow: "0 0 6px rgba(127, 109, 242, 0.6)",
      }}
    />
  );
}
