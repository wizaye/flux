/**
 * Built-in plugin registry.
 *
 * Imports every first-party plugin under `plugins/` and registers
 * them with `usePluginStore` at boot. After this runs, the UI's
 * activity bar, sidebar, palette, settings, and pane dispatch can
 * read their contributions through the store just like external
 * plugins will once the broker lands.
 *
 * Plugins are registered as **disabled by default** — users opt in
 * from Settings → Community plugins. This matches the contract in
 * `docs/plugin-system.md` §1: install/enable is intentional.
 *
 * Timing: this runs **at module import** (not inside a React effect)
 * so the store's `builtinComponents` map is populated BEFORE the
 * first render of any subscriber. Otherwise the activity strip
 * paints a broken-image / "Loading plugin…" placeholder for the
 * one-frame window between mount and effect.
 */
import { usePluginStore } from "@/state/plugin-store";
import { KanbanComponents, KanbanManifest } from "@flux/plugin-kanban";
import { CanvasComponents, CanvasManifest } from "@flux/plugin-canvas";

let initialised = false;

export function registerBuiltinPlugins() {
  if (initialised) return;
  initialised = true;

  usePluginStore.getState().registerBuiltin(
    KanbanManifest,
    KanbanComponents as never,
    /* defaultEnabled */ false,
  );
  usePluginStore.getState().registerBuiltin(
    CanvasManifest,
    CanvasComponents as never,
    /* defaultEnabled */ false,
  );
}

// Eagerly register on module load so component refs are available
// for the first render. The `useEffect` call inside `App.tsx` is
// kept as a belt-and-braces no-op (idempotent guard above).
registerBuiltinPlugins();
