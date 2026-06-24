/**
 * Shared Vite library-build factory for Flux plugins.
 *
 * Every plugin's `vite.config.ts` is a 3-line file that calls
 * `pluginViteConfig({ entry, name })`. This factory:
 *
 *   • Builds the plugin as a single ESM bundle under `dist/`.
 *   • Externalises React, ReactDOM, and the Flux SDK so each
 *     plugin doesn't ship its own copy. At runtime the host
 *     provides these as global modules.
 *   • Keeps `@dnd-kit/*`, `js-yaml`, `lucide-react` etc.
 *     bundled — anything plugin-specific stays in the plugin's
 *     own JS bundle.
 *   • Copies `manifest.json` into `dist/` so external plugin
 *     installs can be a single `dist/` folder.
 *
 * Why we externalise vs. bundle the SDK:
 *   • Today the host imports each plugin via a dynamic
 *     `import("@flux/plugin-canvas")` — Vite code-splits at the
 *     boundary. The SDK is part of the *host* runtime; if every
 *     plugin bundled its own copy, two plugins talking through
 *     SDK types would be exchanging incompatible class instances.
 *   • Tomorrow, when plugins ship as standalone npm packages or
 *     vault-installed bundles, the SDK is loaded once on the
 *     window and every plugin reuses that singleton via the
 *     ESM-import-map mechanism (or a tiny shim that maps
 *     `@flux/plugin-sdk` → `window.__flux_sdk__`).
 *
 * Usage:
 *
 * ```ts
 * // plugins/<name>/vite.config.ts
 * import { defineConfig } from "vite";
 * import { pluginViteConfig } from "../plugin-build-config";
 *
 * export default defineConfig(
 *   pluginViteConfig({ entry: "src/index.ts", name: "FluxCanvas" }),
 * );
 * ```
 */
import { resolve } from "node:path";
import { cpSync, existsSync } from "node:fs";
import react from "@vitejs/plugin-react";
import type { Plugin, UserConfig } from "vite";

export interface PluginBuildOptions {
  /** Vault-relative path to the plugin's TS entry point. */
  entry: string;
  /** Camel-case identifier exposed on the UMD global (rarely
   *  used — we ship ESM — but Vite requires it). */
  name: string;
  /** Optional additional Rollup external IDs the plugin's bundle
   *  should NOT include. Most plugins don't need to extend the
   *  defaults. */
  extraExternals?: (string | RegExp)[];
}

const DEFAULT_EXTERNALS: (string | RegExp)[] = [
  "react",
  "react-dom",
  /^react\/.*/,
  /^react-dom\/.*/,
  "@flux/plugin-sdk",
  /^@flux\/plugin-sdk\/.*/,
];

/** Vite plugin: copies `<root>/manifest.json` into `dist/` after
 *  the bundle is written. External installs are then a single
 *  `dist/` folder the user drops into `.zenvault/plugins/<id>/`. */
function copyManifestPlugin(): Plugin {
  return {
    name: "flux:copy-plugin-manifest",
    apply: "build",
    closeBundle() {
      const src = resolve(process.cwd(), "manifest.json");
      if (!existsSync(src)) return;
      const dst = resolve(process.cwd(), "dist/manifest.json");
      cpSync(src, dst);
    },
  };
}

export function pluginViteConfig(opts: PluginBuildOptions): UserConfig {
  // Sourcemaps are a ~2× multiplier on `dist/` size (Excalidraw's
  // 8 MB bundle ships a 17 MB `.js.map`). They're only useful when
  // a developer is debugging the built artefact — for production
  // releases and CI we omit them. Override per plugin via
  // `PLUGIN_SOURCEMAP=true pnpm --filter … build`.
  const sourcemap =
    process.env.PLUGIN_SOURCEMAP === "true" ||
    process.env.NODE_ENV !== "production";

  return {
    plugins: [react(), copyManifestPlugin()],
    build: {
      lib: {
        entry: resolve(process.cwd(), opts.entry),
        name: opts.name,
        // ESM only; the host loads plugins via dynamic `import()`.
        formats: ["es"],
        fileName: () => "index.js",
      },
      sourcemap,
      // Don't wipe the entire dist between plugin tests / dev
      // builds; only the entry artefact changes.
      emptyOutDir: true,
      rollupOptions: {
        external: [...DEFAULT_EXTERNALS, ...(opts.extraExternals ?? [])],
        // Allow code-splitting so plugins can React.lazy heavy
        // surfaces (e.g. Excalidraw's ~2.5 MB editor). The entry
        // stays at `dist/index.js` to match the manifest's
        // `bundleUrl`; async chunks land under `dist/chunks/`.
        output: {
          chunkFileNames: "chunks/[name]-[hash].js",
          assetFileNames: "assets/[name]-[hash][extname]",
        },
      },
    },
  };
}
