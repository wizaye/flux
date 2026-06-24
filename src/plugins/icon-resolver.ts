/**
 * Resolve a plugin manifest `iconUrl` to a renderable artefact for
 * the activity-strip / sidebar header.
 *
 * Three flavours, in priority order:
 *
 *   * `lucide:<name>` → named icon from `lucide-react`. Returns a
 *     React component so callers can render it inline.
 *   * Relative path (e.g. `dist/icon.svg`) → resolved via Tauri's
 *     `convertFileSrc` to an `asset://` URL the webview can render
 *     in an `<img>` tag. Requires the plugin's `pluginDir`.
 *   * Already-absolute URL (`https://`, `data:`, `asset://`,
 *     leading `/`) → returned verbatim.
 */
import * as React from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import * as Lucide from "lucide-react";
import { usePluginStore } from "@/state/plugin-store";

export type PluginIconResolution =
  | { kind: "component"; Component: React.ComponentType<{ className?: string }> }
  | { kind: "url"; url: string }
  | { kind: "fallback" };

/** Resolve the activity-bar / panel icon for one plugin. Falls back
 *  to `{ kind: "fallback" }` so callers can render a neutral
 *  placeholder square (icon missing, malformed manifest entry,
 *  hydration race, etc.). */
export function resolvePluginIcon(
  pluginId: string,
  iconUrl: string | undefined,
): PluginIconResolution {
  const components = usePluginStore.getState().builtinComponents[pluginId];
  // First-class React icon shipped by the plugin's Components export
  // always wins — bundled plugins use this path; external plugins may
  // export it from their `index.ts` too.
  if (components?.activityBarIcon) {
    return {
      kind: "component",
      Component: components.activityBarIcon,
    };
  }
  if (!iconUrl) return { kind: "fallback" };

  if (iconUrl.startsWith("lucide:")) {
    const name = iconUrl.slice("lucide:".length);
    const Comp = lookupLucide(name);
    if (Comp) return { kind: "component", Component: Comp };
    return { kind: "fallback" };
  }

  if (/^(https?:|data:|asset:|\/)/.test(iconUrl)) {
    return { kind: "url", url: iconUrl };
  }

  // Relative path inside the plugin folder. Resolution lives on the
  // store entry so we can build the `asset://` URL only when we have
  // a real `pluginDir`. Bundled plugins never reach this branch
  // because their iconUrl is always `lucide:…`.
  const plugin = usePluginStore
    .getState()
    .plugins.find((p) => p.id === pluginId);
  if (!plugin?.pluginDir) return { kind: "fallback" };
  const absolute = `${plugin.pluginDir}/${iconUrl}`.replace(/\\/g, "/");
  return { kind: "url", url: convertFileSrc(absolute) };
}

/** Convert kebab-case (`layout-grid`) / lowercase (`box`) lucide
 *  names into the PascalCase component the lucide-react module
 *  exports. Returns `undefined` for unknown names so the caller can
 *  render a placeholder. */
function lookupLucide(
  rawName: string,
): React.ComponentType<{ className?: string }> | undefined {
  const pascal = rawName
    .split(/[-_]+/)
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");
  const candidate = (Lucide as unknown as Record<string, unknown>)[pascal];
  if (typeof candidate === "function" || typeof candidate === "object") {
    return candidate as React.ComponentType<{ className?: string }>;
  }
  return undefined;
}
