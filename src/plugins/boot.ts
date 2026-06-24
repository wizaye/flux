/**
 * Plugin boot orchestration. Called once per vault open:
 *
 *   1. Register the built-in plugins (canvas, kanban, …) via the
 *      lazy registry. Their components ship in this repo and load
 *      from per-plugin Vite chunks.
 *   2. Ask Rust to scan `.zenvault/plugins/` and feed the result
 *      into the store as external plugins.
 *
 * Failures in either step are logged but never thrown — a broken
 * plugin must NEVER block vault open. The user can recover via
 * Settings → Community plugins.
 */
import { registerBuiltinPlugins } from "./registry";
import { refreshExternalPlugins } from "./install";

let started = false;

/** Idempotent. Safe to call multiple times — built-in registration
 *  no-ops on re-entry, and the external scan just refreshes the
 *  store with the latest disk state. */
export async function bootPlugins(): Promise<void> {
  if (!started) {
    started = true;
    try {
      registerBuiltinPlugins();
    } catch (e) {
      console.error("[flux/plugins] built-in registration failed:", e);
    }
  }
  try {
    await refreshExternalPlugins();
  } catch (e) {
    // Most common cause: not running inside Tauri (browser preview).
    // The bindings layer already short-circuits in that case, so
    // this only logs in production when Rust returns an error.
    console.warn("[flux/plugins] external scan failed:", e);
  }
}
