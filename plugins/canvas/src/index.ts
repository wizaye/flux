/**
 * Public surface of the Canvas plugin — what `src/plugins/registry.ts`
 * imports to register the plugin with the host.
 */
import { PencilRuler } from "lucide-react";

import manifest from "../manifest.json";
import type { PluginManifest } from "@flux/plugin-sdk/types";

import CanvasSidebar from "./sidebar";
import CanvasView from "./view";
import CanvasSettings from "./settings";

export const CanvasManifest = manifest as PluginManifest;

export const CanvasComponents = {
  activityBarIcon: PencilRuler,
  sidebarPanel: CanvasSidebar,
  settingsPanel: CanvasSettings,
  editorViews: {
    ".canvas": CanvasView,
  },
  commandHandlers: {
    "canvas.new": () => {
      window.dispatchEvent(new CustomEvent("flux-canvas-new"));
    },
  },
} as const;
