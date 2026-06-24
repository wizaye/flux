/**
 * Plugin entry point — what the host imports lazily when the user
 * enables this plugin from Settings → Community plugins.
 *
 * Required exports:
 *   • `Manifest` — the raw manifest.json typed as `PluginManifest`.
 *   • `Components` — React component refs + command handlers the
 *     host wires into the activity bar / sidebar / editor / palette
 *     contribution points declared in the manifest.
 *
 * Keep this file thin. Real logic lives in `./components/*` and
 * `./lib/*` so the entry stays scannable and your bundle's first
 * eval cost is bounded.
 */
import { Sparkles } from "lucide-react";

import manifest from "../manifest.json";
import type { PluginManifest } from "@flux/plugin-sdk/types";

import { ExampleSettings } from "./settings";

export const Manifest: PluginManifest = manifest as PluginManifest;

export const Components = {
  activityBarIcon: Sparkles,
  settingsPanel: ExampleSettings,
} as const;
