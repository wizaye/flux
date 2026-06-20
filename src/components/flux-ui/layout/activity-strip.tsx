import * as React from "react";
import { cn } from "@/lib/utils";
import { IconButton } from "@/components/flux-ui/common/icon-button";
import {
  IcBook,
  IcCalendar,
  IcCloudUpload,
  IcFiles,
  IcGraph,
  IcSourceControl,
  IcTerminal,
} from "@/components/flux-ui/common/icons";
import { usePluginStore } from "@/state/plugin-store";
/**
 * Vertical activity strip — body of the `lstrip` column. The column
 * wrapper (with its own `col-header` and dividers) lives in
 * `LatticeShell`; this component only owns the icon list.
 *
 * Mirrors the 9-entry contract from
 * `lattice/src/components/layout/ActivityStrip.tsx`:
 *
 *   Graph (action)
 *   Calendar (view)
 *   SourceControl → changes (view)
 *   Grid → canvas (view)
 *   Files (view, default)
 *   Terminal (disabled)
 *   Kanban (action)
 *   Book (action)
 *   CloudUpload (action)
 *
 * View entries: re-clicking the active view collapses the sidebar;
 * clicking an inactive view expands it and switches.
 *
 * Action entries open palettes / overlays that aren't part of the
 * sidebar contract — they fire onAction with the entry id.
 */

export type LeftView = "files" | "search" | "bookmarks" | "changes" | "calendar";

export type StripActionId =
  | "graph"
  | "book"
  | "publish"
  | "terminal";

interface ActivityStripProps {
  view: LeftView;
  collapsed: boolean;
  /** Toggles a "view" entry: re-click active → collapse, click inactive → expand. */
  onRouteView: (view: LeftView) => void;
  onAction?: (id: StripActionId) => void;
  /** Currently-active plugin sidebar id (null when a built-in view
   *  is active). The plugin icon receives the same "selected" tint
   *  the built-in view icons use. */
  activePluginPanel?: string | null;
  onPluginPanel?: (pluginId: string) => void;
}

type ViewEntry = {
  kind: "view";
  id: LeftView;
  label: string;
  Icon: React.ComponentType<React.SVGAttributes<SVGElement>>;
};
type ActionEntry = {
  kind: "action";
  id: StripActionId;
  label: string;
  Icon: React.ComponentType<React.SVGAttributes<SVGElement>>;
  disabled?: boolean;
};

const ENTRIES: Array<ViewEntry | ActionEntry> = [
  { kind: "action", id: "graph", label: "Graph", Icon: IcGraph },
  { kind: "view",   id: "calendar", label: "Calendar", Icon: IcCalendar },
  { kind: "view",   id: "changes",  label: "Source Control", Icon: IcSourceControl },
  { kind: "view",   id: "files",    label: "Files",   Icon: IcFiles },
  { kind: "action", id: "terminal", label: "Run command (⌘K)", Icon: IcTerminal },
  { kind: "action", id: "book",     label: "New paper",   Icon: IcBook },
  { kind: "action", id: "publish",  label: "Publish", Icon: IcCloudUpload },
];

export function ActivityStrip({
  view,
  collapsed,
  onRouteView,
  onAction,
  activePluginPanel,
  onPluginPanel,
}: ActivityStripProps) {
  const pluginContributions = usePluginStore(
    (s) => s.activityBarContributions,
  );
  const builtinComponents = usePluginStore((s) => s.builtinComponents);
  return (
    <div className={cn("flex flex-col items-center gap-[2px] py-1.5 flex-1 min-h-0")}>
      {ENTRIES.map((entry) => {
        const isActive = entry.kind === "view" && !collapsed && entry.id === view;
        return (
          <IconButton
            key={`${entry.kind}-${entry.id}`}
            size="lstrip"
            active={isActive}
            disabled={entry.kind === "action" && entry.disabled}
            tooltip={entry.label}
            tooltipSide="right"
            onClick={() => {
              if (entry.kind === "view") {
                onRouteView(entry.id);
              } else if (!entry.disabled) {
                onAction?.(entry.id);
              }
            }}
          >
            <entry.Icon />
          </IconButton>
        );
      })}

      {pluginContributions.length > 0 && (
        <>
          <div
            className="w-[20px] h-px bg-[var(--border-strong)]/40 my-1 shrink-0"
            aria-hidden
          />
          {pluginContributions.map(({ pluginId, item }) => {
            const PluginIcon = builtinComponents[pluginId]?.activityBarIcon;
            // External plugins (Phase C) will ship an SVG via
            // `iconUrl`. The `lucide:<name>` syntax is reserved for
            // BUILT-IN plugins which provide a React component ref;
            // if the component isn't resolved yet (rare race during
            // boot) we render a neutral square instead of a broken
            // <img>.
            const looksLikeRealUrl =
              typeof item.iconUrl === "string" &&
              /^(https?:|data:|asset:|\/)/.test(item.iconUrl);
            return (
              <IconButton
                key={`plugin-${pluginId}`}
                size="lstrip"
                active={!collapsed && activePluginPanel === pluginId}
                tooltip={item.tooltip}
                tooltipSide="right"
                onClick={() => onPluginPanel?.(pluginId)}
              >
                {PluginIcon ? (
                  <PluginIcon />
                ) : looksLikeRealUrl ? (
                  <img
                    src={item.iconUrl}
                    alt={item.tooltip}
                    className="size-[18px] opacity-70"
                    aria-hidden
                  />
                ) : (
                  // Built-in plugin whose component refs haven't
                  // landed yet. Hidden placeholder keeps layout
                  // stable across the one-frame window.
                  <span
                    aria-hidden
                    className="block size-[18px] rounded-sm border border-current opacity-30"
                  />
                )}
              </IconButton>
            );
          })}
        </>
      )}
    </div>
  );
}
