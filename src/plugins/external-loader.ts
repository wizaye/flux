/**
 * External plugin loader.
 *
 * Given a {@link ScannedPlugin} that Rust emitted from
 * `.zenvault/plugins/<id>/`, build a lazy loader the plugin store
 * can register. The loader resolves the entry bundle to an
 * `asset://` URL via `convertFileSrc` and dynamically `import()`s
 * it from the host webview.
 *
 * Why dynamic import (not iframe)?
 *   See `docs/plugin-system.md` §15 — the V1 trust model is
 *   "user installed the plugin from a reviewed marketplace".
 *   V2 will wrap each plugin in a sandboxed iframe with a
 *   postMessage bridge; the loader API stays the same.
 *
 * Why `convertFileSrc` (not `file://`)?
 *   Tauri's `protocol-asset` feature exposes a custom asset
 *   protocol scoped to allow-listed paths (`tauri.conf.json` →
 *   `assetProtocol.scope`). `file://` is blocked by webview CORS
 *   on every platform; `asset://` works.
 */
import { convertFileSrc } from "@tauri-apps/api/core";
import type {
  PluginManifest,
  PluginActivityBarItem,
  PluginCommand,
  PluginSettingsPanel,
} from "@flux/plugin-sdk/types";
import type { ScannedPlugin } from "@/bindings";
import type { BuiltinComponentRefs } from "@/state/plugin-store";

/**
 * Shape every plugin's `dist/index.js` must export. We accept
 * either `Components` (the spec name) or `default.Components`
 * (some bundlers wrap named exports under default) so plugin
 * authors don't trip over Rollup output shape.
 */
interface PluginModuleExports {
  Manifest?: PluginManifest;
  Components?: BuiltinComponentRefs;
  default?: { Manifest?: PluginManifest; Components?: BuiltinComponentRefs };
}

/** Translate a Rust-emitted manifest DTO into the SDK's
 *  `PluginManifest` shape. The DTO mirrors the SDK type 1:1 — this
 *  is a cast, not a deep clone, so it stays O(1). */
export function dtoToManifest(
  dto: ScannedPlugin["manifest"],
): PluginManifest {
  return dto as unknown as PluginManifest;
}

/** Default importer — the only call site of `import()` in this
 *  module. The `@vite-ignore` keeps Vite from trying to statically
 *  pre-bundle a URL it can't resolve at build time. */
const defaultImporter: PluginModuleImporter = (url) =>
  import(/* @vite-ignore */ url);

/** Allows tests to swap the dynamic-import call without going
 *  through Vite's strict module-mock guard. Production code never
 *  passes a custom importer. */
export type PluginModuleImporter = (url: string) => Promise<PluginModuleExports>;

/** Build a lazy loader closure for one scanned plugin. The closure
 *  is only invoked when the plugin is enabled, so plugins the user
 *  never touches cost nothing beyond their manifest at boot. */
export function buildExternalLoader(
  scanned: ScannedPlugin,
  importer: PluginModuleImporter = defaultImporter,
): () => Promise<BuiltinComponentRefs> {
  const url = convertFileSrc(scanned.entryPath);
  return async () => {
    let mod: PluginModuleExports;
    try {
      mod = await importer(url);
    } catch (e) {
      throw new Error(
        `failed to import plugin "${scanned.manifest.id}" from ${url}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
    const components = mod.Components ?? mod.default?.Components;
    if (!components) {
      throw new Error(
        `plugin "${scanned.manifest.id}" must export \`Components\` from its entry bundle`,
      );
    }
    return components;
  };
}

/** Convenience: take a list of `ScannedPlugin`s and return the
 *  entries shape `usePluginStore.replaceExternals` consumes. */
export function buildExternalEntries(
  scanned: readonly ScannedPlugin[],
  importer?: PluginModuleImporter,
): Array<{
  manifest: PluginManifest;
  pluginDir: string;
  loader: () => Promise<BuiltinComponentRefs>;
}> {
  return scanned.map((s) => ({
    manifest: dtoToManifest(s.manifest),
    pluginDir: s.pluginDir,
    loader: buildExternalLoader(s, importer),
  }));
}

// Re-export the helper types so callers in `boot.ts` don't have to
// reach into the SDK to thread them.
export type { PluginActivityBarItem, PluginCommand, PluginSettingsPanel };
