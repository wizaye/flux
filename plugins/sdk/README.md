# @flux/plugin-sdk

The contract layer every Flux plugin programs against. Types,
capability constants, a typed host bridge, and the standard
layout/drag helpers. No host internals — everything in this
package is safe to bundle into a community plugin distributed via
`.zip` and installed into any vault.

## Install

```sh
pnpm add @flux/plugin-sdk
```

`react` and `react-dom` are `peerDependencies` — Flux provides
them at runtime. Bundling your own copy will break SDK type
identity across plugins.

## Stable surface (everything you can rely on)

| Subpath | Exports | Purpose |
|---|---|---|
| `@flux/plugin-sdk` | re-exports of `/types`, `/host`, `/contract`, `/layout`, `/drag`, plus an `ui` namespace | one-stop import |
| `@flux/plugin-sdk/types` | `PluginManifest`, `BuiltinComponentRefs`, `EditorViewProps`, `PluginHost`, etc. | the manifest schema + host contract types |
| `@flux/plugin-sdk/contract` | `HOST_API_VERSION`, `CAPABILITIES`, `Capability`, `ALL_CAPABILITIES` | version + capability constants |
| `@flux/plugin-sdk/host` | `createPluginHost`, `HostCallError` | call privileged host APIs from a plugin |
| `@flux/plugin-sdk/layout` | `PluginPaneLayout` | matches the host pane chrome (header + body + footer) |
| `@flux/plugin-sdk/drag` | drag-MIME constants for receiving DnD from the host | wire your editor view into the host's drag pipeline |

## Host-internal, NOT in the published package

| Subpath | Why it isn't public |
|---|---|
| `@flux/plugin-sdk/bridge` | re-exports first-party host stores/hooks behind `@/state/*` aliases — only resolves inside the Flux monorepo. Community plugins use `@flux/plugin-sdk/host` instead. |
| `@flux/plugin-sdk/ui` | re-exports the host's shadcn copies behind `@/components/ui/*` aliases. Per the shadcn philosophy (primitives are source code, not a library) community plugins copy their own shadcn primitives into the plugin's source tree. See **"UI primitives for community plugins"** below. |

Both still resolve in-repo for first-party plugins (Canvas,
Kanban) because the Vite + tsconfig alias maps short-circuit
package resolution. They are deliberately omitted from
`publishConfig.exports` so an npm-installed copy cannot import
them.

## UI primitives for community plugins

Community plugins should bundle their own shadcn primitives —
that matches the canonical shadcn workflow and avoids coupling
the plugin to a specific Flux SDK version's UI surface.

Quick setup inside your plugin repo:

```sh
# 1. Install Radix + the Tailwind helpers shadcn primitives need.
pnpm add @radix-ui/react-dialog @radix-ui/react-checkbox \
         @radix-ui/react-dropdown-menu @radix-ui/react-select \
         @radix-ui/react-switch @radix-ui/react-tooltip \
         class-variance-authority clsx tailwind-merge

# 2. shadcn init + add the primitives you actually use.
pnpm dlx shadcn@latest init
pnpm dlx shadcn@latest add button input dialog
```

The Flux host runtime ALREADY ships its own copies of these
deps; community plugins re-installing them locally only affects
the plugin's `dist/index.js` bundle size (≤ ~30 KB after
tree-shake) and does NOT cause version drift at runtime because
`react` + `react-dom` are externalised peer-deps.

## Minimum plugin entry

```ts
// src/index.ts
import { Sparkles } from "lucide-react";
import manifest from "../manifest.json";
import { createPluginHost, HOST_API_VERSION } from "@flux/plugin-sdk";
import type {
  PluginManifest,
  BuiltinComponentRefs,
} from "@flux/plugin-sdk/types";

export const Manifest: PluginManifest = manifest as PluginManifest;

export const Components: BuiltinComponentRefs = {
  activityBarIcon: Sparkles,
};

// Lazily build the host bridge — the constructor is cheap, but
// you only want to call it after the plugin is enabled (otherwise
// `apiVersion` is read with stale defaults during HMR).
export const host = createPluginHost({
  pluginId: Manifest.id,
  apiVersion: HOST_API_VERSION,
});
```

## Calling host contracts

```ts
import {
  createPluginHost,
  HOST_API_VERSION,
  CAPABILITIES,
  HostCallError,
} from "@flux/plugin-sdk";

const host = createPluginHost({
  pluginId: "my-plugin",
  apiVersion: HOST_API_VERSION,
});

// Your manifest must declare the capability before the broker
// will let the call through. Mismatch → HostCallError with code
// "capability_denied".
//
//   "capabilities": {
//     "required": ["vault.read", "plugin.storage.write"]
//   }

try {
  const text = await host.vault.readText("Welcome.md"); // CAPABILITIES.VAULT_READ
  await host.storage.set("lastSeen", Date.now());        // CAPABILITIES.PLUGIN_STORAGE_WRITE
  await host.workspace.showNotice({ title: "Done" });    // CAPABILITIES.WORKSPACE_NOTICE
} catch (e) {
  if (e instanceof HostCallError) {
    // `e.code` is one of:
    //   "capability_denied", "capability_mismatch",
    //   "api_version_mismatch", "unknown_action",
    //   "bad_payload", "no_vault", "unknown_plugin",
    //   "vault_read_failed", "vault_write_failed",
    //   "vault_list_failed", "storage_failed",
    //   "decode_failed", "encode_failed", "join_failed"
  }
}
```

## Capability cheat sheet

| Constant | String | Allows |
|---|---|---|
| `CAPABILITIES.VAULT_READ` | `vault.read` | `host.vault.readText` |
| `CAPABILITIES.VAULT_WRITE` | `vault.write` | `host.vault.writeText` |
| `CAPABILITIES.VAULT_LIST` | `vault.list` | `host.vault.listDir` |
| `CAPABILITIES.WORKSPACE_NOTICE` | `workspace.notice` | `host.workspace.showNotice` |
| `CAPABILITIES.WORKSPACE_OPEN` | `workspace.open` | `host.workspace.openPath` |
| `CAPABILITIES.SEARCH_QUERY` | `search.query` | `host.search.query` |
| `CAPABILITIES.PLUGIN_STORAGE_READ` | `plugin.storage.read` | `host.storage.get` |
| `CAPABILITIES.PLUGIN_STORAGE_WRITE` | `plugin.storage.write` | `host.storage.set`, `host.storage.delete` |

The host's `manifest::ALLOWED_CAPABILITIES` is the source of
truth. The SDK mirrors it; the host validates it on every install
and re-validates on every broker call.

## API version compatibility

Every plugin's `manifest.json` must declare `"apiVersion": "1.0"`.
The host refuses to load a plugin whose `apiVersion` does not
exactly match `HOST_API_VERSION`. When the SDK bumps the major
segment, your plugin keeps working on hosts that ship the matching
SDK version; it stops loading on older hosts.

## Building

```sh
pnpm --filter @flux/plugin-sdk build
# emits dist/{index,types,host,contract,layout,drag}.{js,d.ts}
```

The build is only required when publishing the SDK. In-repo
consumers (the host, Canvas, Kanban) resolve directly to `src/`
through the workspace's Vite + tsconfig alias maps.

## Publishing (when this package is extracted to its own repo)

```sh
pnpm --filter @flux/plugin-sdk build
cd plugins/sdk
npm publish
```

`publishConfig` in `package.json` automatically swaps `main`,
`types`, and `exports` to point at `dist/` so npm consumers receive
compiled JS + .d.ts (not raw `.ts` source). `bridge` and `ui` are
omitted from `publishConfig.exports` so they never reach published
consumers.
