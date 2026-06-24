/**
 * Built-in plugin registry.
 *
 * Maps each first-party plugin's id to:
 *   1. its manifest (eagerly imported — tiny JSON, needed at boot
 *      so the store knows what plugins exist before the first
 *      paint), and
 *   2. an `async load()` function that dynamic-imports the
 *      plugin's React components on demand.
 *
 * Vite code-splits at every `import()` boundary, so each plugin's
 * actual JS (Canvas's SVG renderer, Kanban's dnd-kit chrome) lives
 * in its own chunk and is NOT in the host's startup bundle. The
 * chunk is fetched the first time the user enables the plugin from
 * Settings.
 *
 * This is the same lazy contract external plugins will use once
 * the Phase C broker lands (`import(asset://…)`). Keeping the
 * builtin path on the same async surface today means adding an
 * external plugin later is a config change, not a refactor.
 *
 * Plugins register as **disabled by default** — users opt in from
 * Settings → Community plugins. See `docs/plugin-system.md` §1.
 */
import { usePluginStore } from "@/state/plugin-store";
import type { BuiltinComponentRefs } from "@/state/plugin-store";
import type { PluginManifest } from "@flux/plugin-sdk/types";

// Eager manifest imports — JSON-only, tiny.
import canvasManifest from "@flux/plugin-canvas/manifest";
import excalidrawManifest from "@flux/plugin-excalidraw/manifest";
import kanbanManifest from "@flux/plugin-kanban/manifest";

/** Lazy loader contract for builtin plugins. */
export interface BuiltinPluginEntry {
  manifest: PluginManifest;
  load: () => Promise<BuiltinComponentRefs>;
}

/** Single source of truth for which builtins ship with this app.
 *  Adding a new builtin is one line here + an entry to the host's
 *  workspace `package.json` dependencies. */
export const BUILTIN_PLUGINS: Record<string, BuiltinPluginEntry> = {
  canvas: {
    manifest: canvasManifest as PluginManifest,
    load: async () => {
      const mod = await import("@flux/plugin-canvas");
      return mod.CanvasComponents as unknown as BuiltinComponentRefs;
    },
  },
  excalidraw: {
    manifest: excalidrawManifest as PluginManifest,
    load: async () => {
      const mod = await import("@flux/plugin-excalidraw");
      return mod.ExcalidrawComponents as unknown as BuiltinComponentRefs;
    },
  },
  kanban: {
    manifest: kanbanManifest as PluginManifest,
    load: async () => {
      const mod = await import("@flux/plugin-kanban");
      return mod.KanbanComponents as unknown as BuiltinComponentRefs;
    },
  },
};

let initialised = false;

/** Register every builtin's MANIFEST + lazy LOADER with the store.
 *  Components are NOT pulled until the user enables the plugin —
 *  the store hydrates them via `loader()` on enable. */
export function registerBuiltinPlugins() {
  if (initialised) return;
  initialised = true;

  for (const [id, entry] of Object.entries(BUILTIN_PLUGINS)) {
    usePluginStore.getState().registerBuiltinLazy(
      entry.manifest,
      entry.load,
      /* defaultEnabled */ false,
    );
    // Tag the loader so the store can re-invoke it (e.g. after a
    // disable-then-enable cycle without forcing a page reload).
    void id;
  }
}

// Eagerly register on module load so the store knows about every
// plugin before the first React render. The `useEffect` in
// `App.tsx` keeps the idempotent guard for hot-reload safety.
registerBuiltinPlugins();
