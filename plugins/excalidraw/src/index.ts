/**
 * Public surface of the Excalidraw plugin — what
 * `src/plugins/registry.ts` (or the external-plugin loader)
 * imports to register the plugin with the host.
 */
import { Palette } from "lucide-react";

import manifest from "../manifest.json";
import type { PluginManifest } from "@flux/plugin-sdk/types";

import ExcalidrawSidebar from "./sidebar";
import ExcalidrawView from "./view";
import ExcalidrawSettings from "./settings";

export const ExcalidrawManifest = manifest as PluginManifest;

export const ExcalidrawComponents = {
  activityBarIcon: Palette,
  sidebarPanel: ExcalidrawSidebar,
  settingsPanel: ExcalidrawSettings,
  editorViews: {
    ".excalidraw": ExcalidrawView,
  },
  commandHandlers: {
    "excalidraw.new": () => {
      window.dispatchEvent(new CustomEvent("flux-excalidraw-new"));
    },
  },
} as const;
