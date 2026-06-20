/**
 * Canvas editor view — wraps the lattice-ported `CanvasView` in the
 * SDK editor-view contract.
 *
 * The lattice component (`canvas-view.tsx`) owns the entire surface:
 * the SVG canvas, the floating tool palette, the zoom/export HUD,
 * all gestures. We only adapt props (`path/title/content/onChange`
 * → `source/onChange`) and pin the optional `PluginPaneLayout`
 * title bar so the canvas matches the chrome of every other plugin
 * pane.
 *
 * Bundle: pure React + SVG + a tiny JSON Canvas state module. Zero
 * external runtime deps beyond `lucide-react` (icons) and shadcn —
 * the entire view ships in the host bundle without lazy-loading.
 */
import * as React from "react";
import { PencilRuler } from "lucide-react";

import type { EditorViewProps } from "@flux/plugin-sdk/types";
import { PluginPaneLayout } from "@flux/plugin-sdk/layout";

import { CanvasView as InnerCanvas } from "./canvas-view";

export default function CanvasView(props: EditorViewProps) {
  const display = React.useMemo(
    () => props.title.replace(/\.canvas$/i, ""),
    [props.title],
  );

  return (
    <PluginPaneLayout
      title={
        <span className="flex items-center gap-2 text-[13px] font-medium tracking-tight">
          <PencilRuler className="w-3.5 h-3.5 opacity-70" />
          {display}
        </span>
      }
      bodyClassName="bg-background"
    >
      <InnerCanvas source={props.content} onChange={props.onChange} />
    </PluginPaneLayout>
  );
}
