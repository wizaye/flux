/**
 * Editor view for `*.excalidraw` files. Pins the standard plugin
 * pane chrome (title bar) so the Excalidraw surface visually
 * matches every other plugin pane in Flux.
 *
 * The Excalidraw SDK (~2.5 MB gzip) is React.lazy-loaded so simply
 * enabling the plugin pulls only the sidebar + settings + state
 * (~50 KB). The big chunk lands only when the user actually opens
 * a `.excalidraw` file.
 */
import * as React from "react";
import { Palette } from "lucide-react";

import type { EditorViewProps } from "@flux/plugin-sdk/types";
import { PluginPaneLayout } from "@flux/plugin-sdk/layout";

const ExcalidrawMount = React.lazy(() =>
  import("./excalidraw-mount").then((m) => ({ default: m.ExcalidrawMount })),
);

function LoadingFallback() {
  return (
    <div className="flex-1 min-h-0 flex items-center justify-center text-[12px] text-muted-foreground">
      Loading Excalidraw…
    </div>
  );
}

export default function ExcalidrawView(props: EditorViewProps) {
  const display = React.useMemo(
    () => props.title.replace(/\.excalidraw$/i, ""),
    [props.title],
  );

  return (
    <PluginPaneLayout
      title={
        <span className="flex items-center gap-2 text-[13px] font-medium tracking-tight">
          <Palette className="w-3.5 h-3.5 opacity-70" />
          {display}
        </span>
      }
      bodyClassName="bg-background flex flex-col"
    >
      <React.Suspense fallback={<LoadingFallback />}>
        <ExcalidrawMount source={props.content} onChange={props.onChange} />
      </React.Suspense>
    </PluginPaneLayout>
  );
}
