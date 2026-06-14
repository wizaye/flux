import * as React from "react";
import { cn } from "@/lib/utils";
import { IconButton } from "@/components/flux-ui/common/icon-button";
import {
  IcBook,
  IcCalendar,
  IcCloudUpload,
  IcFiles,
  IcGraph,
  IcGrid,
  IcKanban,
  IcSourceControl,
  IcTerminal,
} from "@/components/flux-ui/common/icons";

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

export type LeftView = "files" | "search" | "bookmarks" | "changes" | "calendar" | "canvas";

export type StripActionId =
  | "graph"
  | "kanban"
  | "book"
  | "publish"
  | "terminal";

interface ActivityStripProps {
  view: LeftView;
  collapsed: boolean;
  /** Toggles a "view" entry: re-click active → collapse, click inactive → expand. */
  onRouteView: (view: LeftView) => void;
  onAction?: (id: StripActionId) => void;
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
  { kind: "view",   id: "canvas",   label: "Canvas",  Icon: IcGrid },
  { kind: "view",   id: "files",    label: "Files",   Icon: IcFiles },
  { kind: "action", id: "terminal", label: "Run command (⌘K)", Icon: IcTerminal },
  { kind: "action", id: "kanban",   label: "Kanban",  Icon: IcKanban },
  { kind: "action", id: "book",     label: "New paper",   Icon: IcBook },
  { kind: "action", id: "publish",  label: "Publish", Icon: IcCloudUpload },
];

export function ActivityStrip({
  view,
  collapsed,
  onRouteView,
  onAction,
}: ActivityStripProps) {
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
    </div>
  );
}
