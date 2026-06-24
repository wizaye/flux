# Flux Plugin Template

This is the canonical scaffold a new Flux plugin starts from. Every
first-party plugin (Canvas, Kanban) and every community plugin should
match this layout. Tooling, lint rules, and the host loader all
assume this shape.

## File layout

```
my-plugin/
├── package.json          # npm metadata + build scripts
├── manifest.json         # runtime metadata (id, version, contributes, capabilities)
├── tsconfig.json         # extends ../../tsconfig.plugin-base.json
├── vite.config.ts        # 3-line factory call (see plugins/plugin-build-config.ts)
├── README.md             # user-facing docs
├── src/
│   ├── index.ts          # plugin entry — default export { manifest, components }
│   ├── view.tsx          # editor view (if `contributes.editorViews`)
│   ├── sidebar.tsx       # sidebar panel (if `contributes.sidebarPanel`)
│   ├── settings.tsx      # settings panel (if `contributes.settingsPanel`)
│   └── app-root.tsx      # optional always-mounted React surface
└── tests/                # plugin-local Vitest tests
```

## Required `package.json` fields

```json
{
  "name": "@<scope>/plugin-<id>",
  "version": "0.1.0",
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./manifest": "./manifest.json"
  },
  "scripts": {
    "build": "vite build",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@flux/plugin-sdk": "workspace:*"
  },
  "peerDependencies": {
    "react": "*",
    "react-dom": "*"
  }
}
```

## Required `manifest.json` schema

Validated against `@flux/plugin-sdk/types::PluginManifest`. See
`plugins/canvas/manifest.json` and `plugins/kanban/manifest.json`
for working examples.

Key fields:

- `id` — unique slug, lowercase + hyphens. Used as the storage
  namespace, the registry key, and the `.zenvault/plugins/<id>/`
  folder name.
- `version` — semver. Surfaced in Settings → Community plugins.
- `apiVersion` — Flux plugin API the plugin targets. Host rejects
  manifests whose `apiVersion` is outside its compatibility range.
- `capabilities.required` / `capabilities.optional` — host
  permissions the plugin asks for at install time. Granted via the
  Settings dialog before the bundle is loaded.
- `contributes` — what UI surfaces the plugin fills (activity-bar
  icon, sidebar panel, editor view for given file extensions,
  palette commands, settings panel).

## Entry point contract (`src/index.ts`)

The host loader calls `await import("@<scope>/plugin-<id>")` and
expects:

```ts
import manifest from "../manifest.json";
import type { PluginManifest, BuiltinComponentRefs } from "@flux/plugin-sdk/types";

export const Manifest: PluginManifest = manifest as PluginManifest;

export const Components: BuiltinComponentRefs = {
  activityBarIcon: SomeLucideIcon,
  sidebarPanel: SidebarComponent,
  editorViews: { ".myext": ViewComponent },
  settingsPanel: SettingsComponent,
  commandHandlers: {
    "my.command": () => { /* … */ },
  },
};
```

Both exports must be present. The host registers the plugin via
`usePluginStore.registerBuiltinLazy(Manifest, () => import("<pkg>"), false)`
so the components module is only fetched on first enable.

## Build output

```sh
pnpm --filter @<scope>/plugin-<id> build
# → dist/index.js     (single ESM bundle)
# → dist/manifest.json (copied)
```

Externalised at build time:

- `react`, `react-dom`, `react/*`, `react-dom/*`
- `@flux/plugin-sdk` and every sub-path

These are provided by the host runtime. Bundling them would
break SDK type identity across plugins.

## Bundled at build time

Anything else the plugin imports lands in `dist/index.js`. For
plugins with heavy assets (mermaid, pdfjs) override
`rollupOptions.output.codeSplitting` in the plugin's local
`vite.config.ts` to opt back into chunking.

## Testing

Plugins ship their own `tests/` directory. They can reuse the
host's Vitest config by importing from `../../vitest.config.ts`
or define their own.

## Host loading model

Two paths exist; both end at the same `registerBuiltinLazy` /
`registerExternalLazy` actions on the plugin store.

**1. Built-in (in-repo)** — for first-party plugins that ship in
the host binary. The registry at
[`src/plugins/registry.ts`](../../src/plugins/registry.ts) names
the plugin's package and Vite code-splits each `import()`
boundary so the plugin JS stays out of the startup bundle:

```ts
const BUILTIN_PLUGINS = {
  canvas: { manifest: canvasManifest, load: () => import("@flux/plugin-canvas") },
  kanban: { manifest: kanbanManifest, load: () => import("@flux/plugin-kanban") },
};
```

**2. External (vault-installed)** — the production path for
community plugins. On every vault open the host calls Rust's
`scan_plugins` command, which walks
`<vault>/.zenvault/plugins/<id>/` and validates every manifest.
For each scanned plugin the frontend builds a loader that does
`import(asset://<entryPath>)`, then registers it via
`replaceExternals` so the plugin's components land in the same
store the built-in path uses.

In both cases the plugin's bundle is fetched only on first enable.

## Shipping a plugin to end users

A plugin author ships a single `.zip` containing:

```
my-plugin.zip
  ├── manifest.json
  └── dist/
      ├── index.js
      └── (any plugin-bundled assets)
```

Build it:

```sh
pnpm --filter @<scope>/plugin-<id> build
cd plugins/my-plugin/dist
zip -r ../my-plugin.zip manifest.json index.js
```

Hand the zip to the user (Discord, GitHub release, download URL).

## How an end user installs a plugin

1. Open **Settings → Community plugins**.
2. Under **Install a plugin**, click **Choose .zip** and pick the
   archive (or **Choose folder** and pick a `dist/` directory for
   local development).
3. The Flux host validates the manifest, stages the bundle into a
   temp folder, and only on full validation success moves it into
   `<vault>/.zenvault/plugins/<id>/`. A failed install never
   leaves a half-written folder behind.
4. The new plugin appears in the **Installed plugins** list with
   its declared capabilities visible. Toggle the switch to enable.
5. On enable, the host dynamically imports the plugin's
   `dist/index.js` and mounts its activity-bar icon / sidebar /
   editor view contributions.

To uninstall, click **Uninstall** next to the plugin. The host
removes the folder AND wipes the plugin's scoped storage rows
from the vault SQLite database.

## Dev iteration loop

```sh
# Terminal 1 — host
pnpm tauri dev

# Terminal 2 — plugin (watch + rebuild)
cd plugins/my-plugin
pnpm build --watch
```

Then in the running Flux app: Settings → Community plugins →
Choose folder → pick `plugins/my-plugin/`. Each subsequent edit +
`vite build` produces a new `dist/index.js`; toggle the plugin
off and back on to remount with the latest bundle.

## Host contracts your plugin can call

The SDK's `createPluginHost({ pluginId, apiVersion })` returns a
typed surface bound to the calling plugin. Every method routes
through the Rust broker, which re-checks the manifest's capability
grant on every request — capabilities you declare are the ONLY
ones available at runtime.

```ts
import { createPluginHost } from "@flux/plugin-sdk/host";

const host = createPluginHost({ pluginId: Manifest.id, apiVersion: Manifest.apiVersion });

const text = await host.vault.readText("Welcome.md");        // capability: vault.read
await host.vault.writeText("Out.md", "# Hello");             // capability: vault.write
await host.workspace.showNotice({ title: "Saved" });         // capability: workspace.notice
await host.storage.set("lastRun", Date.now());               // capability: plugin.storage.write
const last = await host.storage.get<number>("lastRun");      // capability: plugin.storage.read
```

When the broker rejects a call (missing capability, vault closed,
underlying I/O failure) the SDK throws a `HostCallError` whose
`code` field carries the broker's error code — branch on it for
recoverable cases.

## How to start a new plugin from this template

```sh
cp -r templates/plugin plugins/my-plugin
cd plugins/my-plugin
# edit package.json — set the package name + description
# edit manifest.json — set id / name / version / contributes / capabilities
# edit src/index.ts — wire your components
pnpm install
pnpm --filter @<scope>/plugin-<id> build
```

After the first build, register the plugin in
`src/plugins/registry.ts` (for in-repo built-in mode) OR zip the
`dist/` + `manifest.json` and install it via Settings → Community
plugins (for production-style external mode). The template is
designed so both paths use identical source code.
