/**
 * Public surface of the Kanban plugin — what
 * `src/plugins/registry.ts` imports to register with the host.
 */
import { LayoutGrid } from "lucide-react";

import manifest from "../manifest.json";
import type { PluginManifest } from "@flux/plugin-sdk/types";

import KanbanSidebar from "./sidebar";
import KanbanView from "./view";
import KanbanSettings from "./settings";
import KanbanAppRoot from "./app-root";

export const KanbanManifest = manifest as PluginManifest;

export const KanbanComponents = {
  activityBarIcon: LayoutGrid,
  sidebarPanel: KanbanSidebar,
  settingsPanel: KanbanSettings,
  /** Always-mounted React root — holds the link-picker dialog so
   *  the "Link to work item" command can open it from any context
   *  (palette, future editor menu) without the sidebar being open. */
  appRoot: KanbanAppRoot,
  editorViews: {
    ".board.yaml": KanbanView,
    // Legacy formats still resolve to the same view — it auto-migrates.
    ".kanban.json": KanbanView,
    ".kanban.md": KanbanView,
    ".kanban": KanbanView,
  },
  commandHandlers: {
    "kanban.new-board": () => {
      // Bridged to the sidebar handler via a custom event so both
      // entry points share one code path.
      window.dispatchEvent(new CustomEvent("flux-kanban-new-board"));
    },
    "kanban.link-work-item": () => {
      window.dispatchEvent(new CustomEvent("flux-kanban-link-work-item"));
    },
  },
} as const;
