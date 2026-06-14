import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * EditorPaneLayout — the chrome contract every view component opts
 * into. Shapes the pane-body into a vertical stack with three slots:
 *
 *   ┌─────────────────────────────────────────┐
 *   │ header  (optional)                      │  ← back / fwd / title /
 *   ├─────────────────────────────────────────┤    source toggle / ⋯
 *   │  body                          [overlay]│  ← real surface (canvas,
 *   │                                         │    markdown, editor…)
 *   │                                         │    + floating top-right
 *   │                                         │    controls (graph: gear
 *   │                                         │    + wand)
 *   └─────────────────────────────────────────┘
 *
 * The body grows to fill remaining space and clips its overflow so
 * inner scrollers (markdown preview, codemirror, pdf scroller) don't
 * push the layout. `overlay` is positioned absolutely inside the body
 * region so it stays out of the canvas's hit-test path but visually
 * floats above the surface — used by `GraphView` for its gear + wand
 * controls (see lattice/src/components/editor/GraphView.tsx#L313+).
 *
 * Views that don't want the standard `<PaneDocHeader/>` simply omit
 * the `header` prop — the strip is removed entirely (no empty 32px
 * gap) and the body fills the full pane height. This is what
 * `GraphView` does so it can own its entire surface.
 */

export type EditorPaneLayoutProps = {
  /** Optional top strip (typically `<PaneDocHeader/>`). When omitted,
   *  the body fills the full pane and the view is responsible for
   *  its own chrome. */
  header?: React.ReactNode;
  /** Floating controls positioned absolute at the body's top-right.
   *  Z-indexed above the body so canvas / scroller content sits
   *  beneath, but click events still pass through transparent gaps.
   *  Used by GraphView for the gear + wand buttons. */
  overlay?: React.ReactNode;
  /** Optional extra class on the body wrapper (e.g. `bg-something`). */
  bodyClassName?: string;
  /** Optional extra class on the root flex column. */
  className?: string;
  children: React.ReactNode;
};

export function EditorPaneLayout({
  header,
  overlay,
  bodyClassName,
  className,
  children,
}: EditorPaneLayoutProps) {
  return (
    // `w-full h-full` ensures we fill our parent box regardless of
    // whether the parent uses display:flex (row), display:grid, or
    // plain block layout. `flex-1` would only cover the flex-parent
    // case — the markdown view's intrinsic text width was masking
    // this; graph canvas has no intrinsic width so the wrapper
    // collapsed and force-graph fell back to window.innerWidth.
    <div className={cn("flex flex-col w-full h-full min-h-0 min-w-0", className)}>
      {header}
      <div
        // Body is itself a flex column so inner scrollers (markdown
        // preview's `.markdown-preview-host`, codemirror's scroller,
        // pdf-view's pages list, slides container) can rely on the
        // standard `flex:1; min-height:0; overflow:auto` pattern to
        // own their scrollbar. Without flex-column here the markdown
        // host got height:0 → wheel events scrolled nothing.
        // Canvas views (graph) don't care — they read clientWidth/
        // clientHeight via ResizeObserver, which works for both block
        // and flex parents.
        className={cn(
          "relative flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden",
          bodyClassName,
        )}
      >
        {children}
        {overlay && (
          <div
            className="absolute top-2 right-2 z-10 flex items-center gap-1 pointer-events-none [&>*]:pointer-events-auto"
            // Keep the overlay container transparent to pointer events
            // so the canvas underneath still receives drag / zoom in
            // the gaps between buttons.
          >
            {overlay}
          </div>
        )}
      </div>
    </div>
  );
}
