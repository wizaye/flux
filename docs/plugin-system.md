# Plugin System — Design & Implementation Guide

> Status: **Design spec — not yet implemented.**
> Review this before touching any code. All stubs are illustrative;
> file paths reflect the current `flux/src/` layout.

---

## 1. Goals

- Plugins ship as independent installable units — zero code from any plugin
  ever enters the core repository.
- The core app exposes **contribution points**: named slots in the UI that
  plugins declare they want to fill via a `manifest.json`.
- Enable / disable is instant (no restart). Install / uninstall requires a
  vault reload to re-scan manifests.
- Bundle size impact is **zero at launch** — plugin JS is loaded on first use
  only via dynamic `import()`.
- The same plugin template repo doubles as the open-source community scaffold.

---

## 2. Plugin Package Layout on Disk

Each plugin lives under `.zenvault/plugins/<id>/`:

```
.zenvault/plugins/excalidraw/
├── manifest.json       ← describes all contributions
├── dist/
│   ├── view.js         ← EditorView bundle (lazy loaded)
│   ├── sidebar.js      ← SidebarPanel bundle (lazy loaded)
│   ├── settings.js     ← SettingsPanel bundle (lazy loaded)
│   └── icon.svg        ← Activity bar icon
└── README.md
```

Only `manifest.json` is read at vault open. All `dist/*.js` files are loaded
on-demand when the user first activates that contribution point.

---

## 3. `manifest.json` Schema

```json
{
  "id": "excalidraw",
  "name": "Excalidraw Whiteboard",
  "version": "1.2.0",
  "author": "someuser",
  "description": "Freeform whiteboard with laser pointer and arch stencils.",
  "minAppVersion": "0.2.0",
  "apiVersion": "1.0",
  "capabilities": {
    "required": ["vault.read", "vault.write"],
    "optional": []
  },
  "contributes": {
    "activityBarItem": {
      "id": "excalidraw",
      "iconUrl": "dist/icon.svg",
      "tooltip": "Whiteboard",
      "placement": "left"
    },
    "sidebarPanel": {
      "id": "excalidraw-panel",
      "bundleUrl": "dist/sidebar.js",
      "placement": "left"
    },
    "editorViews": [
      {
        "extensions": [".excalidraw"],
        "bundleUrl": "dist/view.js"
      }
    ],
    "commands": [
      {
        "id": "excalidraw.new",
        "label": "New Whiteboard",
        "palette": true
      }
    ],
    "settingsPanel": {
      "label": "Excalidraw",
      "bundleUrl": "dist/settings.js"
    }
  }
}
```

All `bundleUrl` values are relative to the plugin directory.
The Rust side resolves them to `asset://` protocol URLs before emitting
the manifest over IPC.

---

## 4. Contribution Points — What Exists Today vs. What Changes

| Contribution | Existing surface | Change needed |
|---|---|---|
| `activityBarItem` | `activity-strip.tsx` — static `ENTRIES[]` | Add dynamic plugin slots below a hairline divider |
| `sidebarPanel` | `left-sidebar.tsx` — view switch on `LeftView` | Add a plugin panel branch that lazy-imports the bundle |
| `editorViews` | `pane.tsx` `PaneBody` — kind/viewMode switch | Check plugin registry before built-in dispatch |
| `commands` | `command-palette.tsx` — static `CommandGroup` list | Merge plugin commands from store into palette |
| `settingsPanel` | `settings-dialog.tsx` — static `COMMUNITY_PLUGIN_SECTIONS[]` | Replace static list with dynamic entries from store |

---

## 5. New File: `src/state/plugin-store.ts`

This is the single source of truth. The UI components never read manifests
directly — they subscribe to the **derived contribution maps** this store
exposes.

```ts
// src/state/plugin-store.ts

import { create } from "zustand";
import { persist } from "zustand/middleware";

// ── Manifest types ────────────────────────────────────────────────────────

export type PluginActivityBarItem = {
  id: string;
  iconUrl: string;         // asset:// URL resolved by Rust
  tooltip: string;
  placement?: "left" | "right";
};

export type PluginSidebarPanel = {
  id: string;
  bundleUrl: string;       // asset:// URL resolved by Rust
  placement: "left" | "right";
};

export type PluginEditorView = {
  extensions: string[];    // e.g. [".excalidraw"]
  bundleUrl: string;
};

export type PluginCommand = {
  id: string;
  label: string;
  palette: boolean;
};

export type PluginSettingsPanel = {
  label: string;
  bundleUrl: string;
};

export type PluginCapabilities = {
  required: string[];
  optional?: string[];
};

export type PluginManifest = {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  minAppVersion?: string;
  /** Host SDK version this plugin targets. Checked at load time. */
  apiVersion: string;
  /** Fine-grained capabilities the plugin needs from the host. */
  capabilities: PluginCapabilities;
  contributes: {
    activityBarItem?: PluginActivityBarItem;
    sidebarPanel?: PluginSidebarPanel;
    editorViews?: PluginEditorView[];
    commands?: PluginCommand[];
    settingsPanel?: PluginSettingsPanel;
  };
};

// ── Installed record (persisted) ──────────────────────────────────────────

export type InstalledPlugin = {
  id: string;
  enabled: boolean;
  version: string;
  pluginDir: string;   // absolute path — for resolving relative bundleUrls
  manifest: PluginManifest;
};

// ── Store ─────────────────────────────────────────────────────────────────

type PluginState = {
  plugins: InstalledPlugin[];

  // Derived maps — recomputed on every plugins mutation.
  // Components subscribe to these, never to `plugins` directly.
  activityBarContributions: Array<{ pluginId: string; item: PluginActivityBarItem }>;
  editorViewRegistry: Record<string, string>; // ".excalidraw" → bundleUrl
  paletteCommands: Array<{ pluginId: string; command: PluginCommand }>;
  settingsSections: Array<{ pluginId: string; panel: PluginSettingsPanel; manifest: PluginManifest }>;

  // Mutations
  /** Called once at vault open when Rust emits the manifest list over IPC. */
  loadManifests: (
    manifests: Array<{ manifest: PluginManifest; pluginDir: string }>
  ) => void;
  setEnabled: (id: string, enabled: boolean) => void;
  installPlugin: (manifest: PluginManifest, pluginDir: string) => void;
  uninstallPlugin: (id: string) => void;
};

function deriveContributions(plugins: InstalledPlugin[]) {
  const active = plugins.filter((p) => p.enabled);

  const activityBarContributions = active
    .filter((p) => p.manifest.contributes.activityBarItem)
    .map((p) => ({ pluginId: p.id, item: p.manifest.contributes.activityBarItem! }));

  const editorViewRegistry: Record<string, string> = {};
  for (const p of active) {
    for (const ev of p.manifest.contributes.editorViews ?? []) {
      for (const ext of ev.extensions) {
        editorViewRegistry[ext.toLowerCase()] = ev.bundleUrl;
      }
    }
  }

  const paletteCommands = active.flatMap((p) =>
    (p.manifest.contributes.commands ?? [])
      .filter((c) => c.palette)
      .map((command) => ({ pluginId: p.id, command })),
  );

  const settingsSections = active
    .filter((p) => p.manifest.contributes.settingsPanel)
    .map((p) => ({
      pluginId: p.id,
      panel: p.manifest.contributes.settingsPanel!,
      manifest: p.manifest,
    }));

  return { activityBarContributions, editorViewRegistry, paletteCommands, settingsSections };
}

export const usePluginStore = create<PluginState>()(
  persist(
    (set) => ({
      plugins: [],
      activityBarContributions: [],
      editorViewRegistry: {},
      paletteCommands: [],
      settingsSections: [],

      loadManifests: (manifests) =>
        set((s) => {
          // Merge incoming manifests with persisted enabled state.
          // Never overwrite a user's explicit enable/disable choice.
          const enabledMap = new Map(s.plugins.map((p) => [p.id, p.enabled]));
          const plugins: InstalledPlugin[] = manifests.map(({ manifest, pluginDir }) => ({
            id: manifest.id,
            // Preserve persisted state; default to true only for brand-new installs.
            enabled: enabledMap.has(manifest.id) ? enabledMap.get(manifest.id)! : true,
            version: manifest.version,
            pluginDir,
            manifest,
          }));
          return { plugins, ...deriveContributions(plugins) };
        }),

      setEnabled: (id, enabled) =>
        set((s) => {
          const plugins = s.plugins.map((p) => (p.id === id ? { ...p, enabled } : p));
          return { plugins, ...deriveContributions(plugins) };
        }),

      installPlugin: (manifest, pluginDir) =>
        set((s) => {
          const exists = s.plugins.find((p) => p.id === manifest.id);
          const next: InstalledPlugin = {
            id: manifest.id,
            enabled: true,
            version: manifest.version,
            pluginDir,
            manifest,
          };
          const plugins = exists
            ? s.plugins.map((p) => (p.id === manifest.id ? next : p))
            : [...s.plugins, next];
          return { plugins, ...deriveContributions(plugins) };
        }),

      uninstallPlugin: (id) =>
        set((s) => {
          const plugins = s.plugins.filter((p) => p.id !== id);
          return { plugins, ...deriveContributions(plugins) };
        }),
    }),
    {
      name: "flux-plugins",
      // Only persist enabled state + metadata. Manifests are re-emitted by
      // Rust on every vault open so we never stale-cache contribution shapes.
      partialize: (s) => ({
        plugins: s.plugins.map(({ id, enabled, version, pluginDir, manifest }) => ({
          id, enabled, version, pluginDir, manifest,
        })),
      }),
    },
  ),
);
```

---

## 6. Change: `activity-strip.tsx`

Add two new props and a dynamic plugin slot section below the built-in entries.

```ts
// New props to add to ActivityStripProps:
activePluginPanel?: string | null;
onPluginPanel?: (pluginId: string) => void;

// New import at top of file:
import { usePluginStore } from "@/state/plugin-store";

// Inside ActivityStrip(), before the return:
const pluginContributions = usePluginStore((s) => s.activityBarContributions);

// Inside the returned JSX, after the existing ENTRIES.map(…) block:
{pluginContributions.length > 0 && (
  <>
    {/* Hairline separator between built-in and plugin icons */}
    <div className="w-[20px] h-px bg-border/50 my-0.5 shrink-0" aria-hidden />
    {pluginContributions.map(({ pluginId, item }) => (
      <IconButton
        key={`plugin-${pluginId}`}
        size="lstrip"
        active={!collapsed && activePluginPanel === pluginId}
        tooltip={item.tooltip}
        tooltipSide="right"
        onClick={() => onPluginPanel?.(pluginId)}
      >
        {/* Plugin icons are SVG asset:// URLs, not React components */}
        <img
          src={item.iconUrl}
          alt={item.tooltip}
          className="size-[18px] opacity-70"
          aria-hidden
        />
      </IconButton>
    ))}
  </>
)}
```

---

## 7. Change: `left-sidebar.tsx`

The sidebar already switches on `LeftView`. Add a plugin panel branch at the
top of the view-routing logic so a plugin panel renders when
`activePluginPanel` is set.

```ts
// New import:
import { usePluginStore } from "@/state/plugin-store";

// New state in LatticeShell (or wherever sidebar view state lives):
const [activePluginPanel, setActivePluginPanel] = React.useState<string | null>(null);

// New lazy loader map (built once, cached in module scope):
const pluginPanelCache = new Map<string, React.LazyExoticComponent<React.ComponentType>>();

function getPluginPanelComponent(bundleUrl: string) {
  if (!pluginPanelCache.has(bundleUrl)) {
    pluginPanelCache.set(
      bundleUrl,
      React.lazy(() => import(/* @vite-ignore */ bundleUrl)),
    );
  }
  return pluginPanelCache.get(bundleUrl)!;
}

// Inside the left sidebar render, before the existing view switch:
const pluginContributions = usePluginStore((s) => s.activityBarContributions);
const plugins = usePluginStore((s) => s.plugins);

if (activePluginPanel) {
  const contrib = pluginContributions.find((c) => c.pluginId === activePluginPanel);
  const plugin = plugins.find((p) => p.id === activePluginPanel);
  const sidebarPanel = plugin?.manifest.contributes.sidebarPanel;

  if (sidebarPanel) {
    const PanelComponent = getPluginPanelComponent(sidebarPanel.bundleUrl);
    return (
      <React.Suspense fallback={<PluginPanelSkeleton name={contrib?.item.tooltip ?? ""} />}>
        <PanelComponent />
      </React.Suspense>
    );
  }
}

// Fallback skeleton while the plugin bundle parses:
function PluginPanelSkeleton({ name }: { name: string }) {
  return (
    <div className="flex-1 flex items-center justify-center text-muted-foreground text-xs">
      Loading {name}…
    </div>
  );
}
```

---

## 8. Change: `pane.tsx` — `PaneBody` dispatch

The registry check happens **before** the existing `file.kind` switch so
plugins can override any extension, including ones the core handles.

```ts
// New import:
import { usePluginStore } from "@/state/plugin-store";

// Same lazy cache pattern as sidebar:
const pluginViewCache = new Map<string, React.LazyExoticComponent<React.ComponentType<EditorViewProps>>>();

function getPluginViewComponent(bundleUrl: string) {
  if (!pluginViewCache.has(bundleUrl)) {
    pluginViewCache.set(
      bundleUrl,
      React.lazy(() => import(/* @vite-ignore */ bundleUrl)),
    );
  }
  return pluginViewCache.get(bundleUrl)!;
}

// Inside PaneBody, add before the existing kind/viewMode dispatch:
const editorViewRegistry = usePluginStore((s) => s.editorViewRegistry);

// Derive the file extension from the file name:
const ext = file.name.includes(".")
  ? `.${file.name.split(".").pop()!.toLowerCase()}`
  : "";

const pluginBundleUrl = editorViewRegistry[ext];

if (pluginBundleUrl) {
  const PluginView = getPluginViewComponent(pluginBundleUrl);
  return (
    <React.Suspense fallback={<PluginViewSkeleton />}>
      <PluginView {...baseProps} />
    </React.Suspense>
  );
}

// … then continue with the existing kind/viewMode switch as-is.
```

The `EditorViewProps` type the plugin must implement is already defined in
`src/components/flux-ui/editor/views/types.ts`. Export it from the package
so template authors can import it without depending on the full app bundle.

---

## 9. Change: `command-palette.tsx`

Merge plugin-contributed commands into the palette under a "Plugins" group.

```ts
// New import:
import { usePluginStore } from "@/state/plugin-store";

// Inside CommandPalette component, before the return:
const paletteCommands = usePluginStore((s) => s.paletteCommands);

// Inside CommandList, after the last built-in CommandGroup:
{paletteCommands.length > 0 && (
  <>
    <CommandSeparator />
    <CommandGroup heading="Plugins">
      {paletteCommands.map(({ pluginId, command }) => (
        <CommandItem
          key={`${pluginId}-${command.id}`}
          onSelect={() => run(() => {
            // Phase 1: fire a custom DOM event that the plugin's
            // loaded bundle can listen for.
            window.dispatchEvent(
              new CustomEvent("zenvault:command", {
                detail: { pluginId, commandId: command.id },
              })
            );
          })}
        >
          {command.label}
        </CommandItem>
      ))}
    </CommandGroup>
  </>
)}
```

---

## 10. Change: `settings-dialog.tsx` — Community Plugins panel

Replace the static `COMMUNITY_PLUGIN_SECTIONS` array with a dynamic list
from the store. The "Community plugins" list item in the sidebar opens the
plugin browser (install/uninstall). Each installed plugin that contributes a
`settingsPanel` gets its own sidebar entry below it.

```ts
// New import:
import { usePluginStore } from "@/state/plugin-store";

// Inside SettingsDialog component:
const { plugins, settingsSections, setEnabled, uninstallPlugin } =
  usePluginStore();

// Replace the static COMMUNITY_PLUGIN_SECTIONS.map(…) block with:
const dynamicCommunitySections = settingsSections.map((s) => ({
  id: `plugin-settings-${s.pluginId}`,
  label: s.panel.label,
  Icon: IcExtensions, // fallback; ideally load the plugin's SVG icon
}));

// Inside SectionBody routing, add:
if (section.id === "community-plugins") return <CommunityPluginsBody />;
if (section.id.startsWith("plugin-settings-")) {
  const pluginId = section.id.replace("plugin-settings-", "");
  return <PluginSettingsBody pluginId={pluginId} />;
}

// ── New body components ───────────────────────────────────────────────────

function CommunityPluginsBody() {
  const { plugins, setEnabled, uninstallPlugin } = usePluginStore();
  return (
    <div>
      <Section title="Installed plugins">
        {plugins.length === 0 && (
          <div className="py-4 text-center text-[12px] text-muted-foreground">
            No plugins installed yet.
          </div>
        )}
        {plugins.map((p) => (
          <Row
            key={p.id}
            title={p.manifest.name}
            description={`${p.manifest.author} · v${p.version} — ${p.manifest.description}`}
          >
            <div className="flex items-center gap-2">
              <Switch checked={p.enabled} onChange={(v) => setEnabled(p.id, v)} />
              <button
                type="button"
                onClick={() => uninstallPlugin(p.id)}
                className="text-[11px] text-destructive hover:underline"
              >
                Remove
              </button>
            </div>
          </Row>
        ))}
      </Section>

      <Section title="Browse community plugins">
        <Row title="Plugin registry" description="Fetch the latest plugin list from GitHub.">
          {/* Wire to IPC command: fetch_plugin_registry() */}
          <button type="button" disabled className="...">
            Browse
          </button>
        </Row>
      </Section>
    </div>
  );
}

function PluginSettingsBody({ pluginId }: { pluginId: string }) {
  const section = usePluginStore((s) =>
    s.settingsSections.find((s) => s.pluginId === pluginId)
  );
  if (!section) return null;

  // Same lazy-load pattern as sidebar/editor views:
  const PluginSettings = React.lazy(
    () => import(/* @vite-ignore */ section.panel.bundleUrl)
  );
  return (
    <React.Suspense fallback={<div className="text-xs text-muted-foreground">Loading…</div>}>
      <PluginSettings />
    </React.Suspense>
  );
}
```

---

## 11. Change: `lattice-shell.tsx` — wire new props + plugin panel state

```ts
// New state:
const [activePluginPanel, setActivePluginPanel] = React.useState<string | null>(null);

const handlePluginPanel = (pluginId: string) => {
  if (activePluginPanel === pluginId && !leftCollapsed) {
    // Re-clicking the active plugin icon collapses the sidebar —
    // same behaviour as built-in view icons.
    setLeftCollapsed(true);
    setActivePluginPanel(null);
  } else {
    setActivePluginPanel(pluginId);
    setLeftCollapsed(false);
  }
};

// On built-in view change, clear the plugin panel:
const handleRouteView = (view: LeftView) => {
  setActivePluginPanel(null);
  // … existing onRouteView logic
};

// Pass to ActivityStrip:
<ActivityStrip
  // … existing props …
  activePluginPanel={activePluginPanel}
  onPluginPanel={handlePluginPanel}
/>

// Pass to LeftSidebar:
<LeftSidebar
  // … existing props …
  activePluginPanel={activePluginPanel}
/>
```

---

## 12. Rust side — IPC command (stub)

The Rust `zenvault-plugins` crate needs one new command that the React boot
sequence calls after `openVault`:

```rust
// src-tauri/src/commands/plugins.rs

#[tauri::command]
#[specta::specta]
pub async fn load_plugin_manifests(
    vault_path: String,
    app: tauri::AppHandle,
) -> Result<Vec<PluginManifestDto>, AppError> {
    let plugins_dir = PathBuf::from(&vault_path)
        .join(".zenvault")
        .join("plugins");

    if !plugins_dir.exists() {
        return Ok(vec![]);
    }

    let mut results = vec![];
    for entry in std::fs::read_dir(&plugins_dir)?.flatten() {
        let manifest_path = entry.path().join("manifest.json");
        if manifest_path.exists() {
            let raw = std::fs::read_to_string(&manifest_path)?;
            let manifest: PluginManifest = serde_json::from_str(&raw)?;

            // Resolve relative bundleUrls to asset:// protocol URLs so
            // the webview can import() them without path arithmetic.
            let plugin_dir = entry.path().to_string_lossy().to_string();
            let resolved = resolve_bundle_urls(manifest, &plugin_dir, &app);

            results.push(PluginManifestDto {
                manifest: resolved,
                plugin_dir,
            });
        }
    }
    Ok(results)
}
```

On the TypeScript side, call this once after vault open:

```ts
// In lattice-shell.tsx or a boot hook:
import { invoke } from "@tauri-apps/api/core";
import { usePluginStore } from "@/state/plugin-store";

const { loadManifests } = usePluginStore.getState();

invoke<Array<{ manifest: PluginManifest; pluginDir: string }>>(
  "load_plugin_manifests",
  { vaultPath: activeVaultPath }
).then(loadManifests).catch(console.error);
```

---

## 13. Community Registry (GitHub-based)

```
github.com/your-org/zenvault-plugins  (public, community-maintained)
  └── registry.json
```

```json
[
  {
    "id": "excalidraw",
    "name": "Excalidraw Whiteboard",
    "author": "someuser",
    "description": "Freeform whiteboard with laser pointer.",
    "repo": "someuser/zenvault-plugin-excalidraw",
    "latestVersion": "1.2.0",
    "downloadUrl": "https://github.com/someuser/zenvault-plugin-excalidraw/releases/download/v1.2.0/plugin.zip"
  }
]
```

- **Publishing:** plugin author opens a PR adding one entry to `registry.json`.
- **Install flow:** app fetches `registry.json` → shows browse list → user clicks
  install → Rust downloads `plugin.zip`, verifies a `sha256` field, unzips into
  `.zenvault/plugins/<id>/`, emits `load_plugin_manifests` → store updates.
- **Updates:** app compares `latestVersion` against installed `version` on
  each vault open; surfaces an update badge in Settings → Community plugins.

---

## 14. Plugin Template Repo Structure

```
zenvault-plugin-template/
├── manifest.json              ← fill in your contributes block
├── src/
│   ├── view.tsx               ← default export: React.ComponentType<EditorViewProps>
│   ├── sidebar.tsx            ← optional: sidebar panel component
│   └── settings.tsx           ← optional: settings panel component
├── types/
│   └── zenvault.d.ts          ← re-export of EditorViewProps, PluginManifest etc.
│                                 (copied from core, no dep on the full app)
├── vite.config.ts             ← library mode, one entry point per bundle
├── tsconfig.json
└── .github/workflows/
    └── release.yml            ← on git tag: build → zip manifest + dist/ → GH Release
```

### `vite.config.ts` stub

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      // Build each contribution point as a separate entry so the app
      // only loads what it needs.
      entry: {
        view: resolve(__dirname, "src/view.tsx"),
        sidebar: resolve(__dirname, "src/sidebar.tsx"),
        settings: resolve(__dirname, "src/settings.tsx"),
      },
      formats: ["es"],
    },
    rollupOptions: {
      // React is provided by the host app — don't bundle it.
      external: ["react", "react-dom"],
      output: { globals: { react: "React", "react-dom": "ReactDOM" } },
    },
  },
});
```

### `.github/workflows/release.yml` stub

```yaml
name: Release plugin
on:
  push:
    tags: ["v*"]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
      - run: pnpm install
      - run: pnpm build
      - name: Package plugin
        run: |
          zip -r plugin.zip manifest.json dist/ README.md
          sha256sum plugin.zip > plugin.zip.sha256
      - uses: softprops/action-gh-release@v2
        with:
          files: |
            plugin.zip
            plugin.zip.sha256
```

---

## 15. Trust Model (V1 vs V2)

| | V1 (ship this) | V2 (future) |
|---|---|---|
| **How bundles are loaded** | `import(asset://...)` directly in the webview | Sandboxed `<iframe>` with `postMessage` bridge |
| **DOM access** | Full — plugin renders inside the pane's React tree | Isolated — plugin sees only its iframe |
| **Security assumption** | User installed the plugin from the community registry | Needed when accepting untrusted third-party plugins |
| **Implementation cost** | Low — just dynamic import + React.Suspense | High — need a bridge protocol and iframe lifecycle |

V1 is acceptable for a community ecosystem where every plugin goes through
a registry PR review. Document this explicitly in the plugin template README.

---

## 16. Implementation Order

**Phase 1 — Core store and manifest loading**
1. `src/state/plugin-store.ts` — add `PluginCapabilities` + `apiVersion` to types; fix `loadManifests` merge semantics. No UI deps, test in isolation.
2. Rust `load_plugin_manifests` command + specta export. Verify `asset://` URL resolution.

**Phase 2 — UI contribution points**
3. `activity-strip.tsx` — add props + plugin slot render, verify with a mock entry.
4. `pane.tsx` `PaneBody` — registry check before kind switch, test with a mock `.testview` file.
5. `left-sidebar.tsx` — plugin panel branch + lazy load.
6. `command-palette.tsx` — merged plugin commands group.
7. `settings-dialog.tsx` — `CommunityPluginsBody` + dynamic sections.
8. `lattice-shell.tsx` — wire `activePluginPanel` state + new props.

**Phase 3 — Host contract platform (broker)**
9. Define shared `PluginBackendRequest` / `PluginBackendResponse` types in a shared types file.
10. Rust `plugin_backend_call` broker command — validation pipeline (plugin exists → `apiVersion` compat → capability granted → payload valid → route).
11. `src-tauri/src/plugins/contracts/vault.rs` — implement `VaultApi` handlers first.
12. `src-tauri/src/plugins/contracts/vcs.rs` — `GitApi` handlers; proves non-core features work.
13. Frontend `plugin-sdk` package — `createPluginHost()` wrapper for plugin authors.
14. Install/permission-prompt UX in settings — show `capabilities.required` to user before enabling.

**Phase 4 — Marketplace and ecosystem**
15. Plugin template repo + GitHub Actions release workflow.
16. Community registry repo + `registry.json` schema validation CI.
17. Signed artifact verification in install flow.

---

## 17. Host Contracts and Capability Model

The plugin system should be implemented as an **app-wide host API platform**.
Plugins do not get arbitrary access to the frontend, Tauri internals, or raw
Rust commands. Instead, the app exposes a set of **stable contracts** and each
contract is protected by **fine-grained capabilities** declared in the plugin
manifest and enforced by the host.

This is the right model for an open-source app with reviewed marketplace
plugins:

- The codebase is open and contributors can inspect how the host works.
- Marketplace plugins are reviewed before publication.
- Runtime access is still constrained so a plugin only gets the exact powers it
  asked for and the host approved.

### 17.1 Core rule

Plugins may only do privileged work by calling **host contracts**. A plugin
never calls an arbitrary Tauri command directly.

Correct mental model:

- plugin asks for `GitApi.pull()`
- host checks `vcs.pull`
- host executes the internal git implementation
- host returns a typed result

Incorrect mental model:

- plugin gets general-purpose backend execution access
- plugin calls arbitrary shell, filesystem, or Rust internals

### 17.2 Contract layers

The system is split into three layers:

1. **Contract layer**
   Defines the stable interfaces plugin authors program against.
2. **Permission layer**
   Maps contract methods to capabilities declared in `manifest.json`.
3. **Execution layer**
   Implements the actual behavior in host TypeScript and/or Rust.

This keeps plugin authoring stable even if Flux changes its internal
implementation details later.

### 17.3 Recommended first-party contracts

These contracts should exist as part of the V1 host SDK.

```ts
export interface VaultApi {
  readText(path: string): Promise<string>;
  writeText(path: string, content: string): Promise<void>;
  listDir(path: string): Promise<Array<{ name: string; path: string; kind: "file" | "dir" }>>;
}

export interface WorkspaceApi {
  openPath(path: string): Promise<void>;
  revealInSidebar(path: string): Promise<void>;
  showNotice(input: { title: string; message?: string; tone?: "info" | "success" | "warning" | "error" }): Promise<void>;
}

export interface GitApi {
  status(): Promise<GitStatus>;
  fetch(input?: { remote?: string }): Promise<void>;
  pull(input?: { remote?: string; branch?: string }): Promise<void>;
  push(input?: { remote?: string; branch?: string }): Promise<void>;
  commit(input: { message: string }): Promise<{ oid: string }>;
}

export interface SearchApi {
  query(input: { text: string; limit?: number }): Promise<SearchResult[]>;
}

export interface PluginStorageApi {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}
```

Notes:

- `VaultApi` is for vault-scoped file operations only.
- `GitApi` is how a community VCS plugin becomes possible without giving raw
  backend execution.
- `PluginStorageApi` is isolated per plugin so plugins do not share a mutable
  global key-value store.
- UI contribution points (`editorViews`, `sidebarPanel`, `settingsPanel`,
  `commands`) remain separate from privileged host contracts.

### 17.4 Capability naming

Capabilities should be explicit, additive, and user-readable.

Recommended V1 capability set:

- `vault.read`
- `vault.write`
- `vault.list`
- `workspace.open`
- `workspace.notice`
- `search.query`
- `plugin.storage.read`
- `plugin.storage.write`
- `vcs.status`
- `vcs.fetch`
- `vcs.pull`
- `vcs.push`
- `vcs.commit`
- `network.fetch`

Capabilities should be checked per action, not just once at install time.

### 17.5 Manifest additions

Add a `capabilities` block to the plugin manifest. This should be reviewed as
part of marketplace approval and shown to the user in the install flow.

```json
{
  "id": "zenvault-git",
  "name": "ZenVault Git",
  "version": "0.1.0",
  "apiVersion": "1.0",
  "capabilities": {
    "required": [
      "vault.read",
      "vault.write",
      "vcs.status",
      "vcs.pull",
      "vcs.push",
      "vcs.commit"
    ],
    "optional": [
      "network.fetch"
    ]
  },
  "contributes": {
    "activityBarItem": {
      "id": "git",
      "iconUrl": "dist/icon.svg",
      "tooltip": "Git",
      "placement": "left"
    },
    "sidebarPanel": {
      "id": "git-panel",
      "bundleUrl": "dist/sidebar.js",
      "placement": "left"
    }
  }
}
```

Add these manifest fields in V1:

- `apiVersion`: host SDK compatibility gate.
- `capabilities.required`: install-time minimum.
- `capabilities.optional`: may be requested later behind a prompt.

### 17.6 Broker design

The broker is an app-level control plane, not just a frontend helper.

- TypeScript defines the plugin-facing SDK and typed request/response shapes.
- Rust and host services enforce capability checks and run privileged actions.
- Plugins import the SDK and never talk to internal commands directly.

Suggested request contract:

```ts
export type PluginBackendRequest = {
  pluginId: string;
  apiVersion: string;
  capability: string;
  contract: string;
  action: string;
  payload: unknown;
};

export type PluginBackendResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };
```

Suggested Rust entrypoint:

```rust
#[tauri::command]
#[specta::specta]
pub async fn plugin_backend_call(
    req: PluginBackendRequest,
    app: tauri::AppHandle,
) -> Result<PluginBackendResponse, AppError> {
    // 1. Validate plugin exists and is enabled.
    // 2. Validate apiVersion compatibility.
    // 3. Validate capability is granted.
    // 4. Validate payload schema for the requested action.
    // 5. Route to the correct host service.
    // 6. Return typed success/error response.
}
```

### 17.7 Handler routing

Internally, the broker should route to focused handler modules rather than one
large switch statement.

Suggested layout:

```text
src-tauri/src/plugins/
├── mod.rs
├── broker.rs
├── permissions.rs
├── manifest.rs
├── contracts/
│   ├── vault.rs
│   ├── workspace.rs
│   ├── search.rs
│   └── vcs.rs
```

Each handler module should:

- decode only its own payload shapes
- enforce capability checks again if needed
- delegate to existing app services
- return stable contract responses

### 17.8 Why this matters for real plugins

This contract model is what enables plugins such as:

- **Git/VCS plugin**
  adds commit, fetch, pull, push, and history UI without making git a core
  built-in feature for all users.
- **Whiteboard plugin**
  adds a rich editor view and optional sidebar/settings panels with little or
  no privileged access.
- **Kanban/tasks plugin**
  adds work-item workflows for users who want them, without forcing tasks into
  the core note-taking model.

This is the product boundary: **plugins can make the app behave differently,
but only through approved host contracts**.

---

## 18. Developer Template and SDK Starting Point

The plugin template repo should ship with a minimal but real host SDK so plugin
authors do not need to reverse-engineer the app internals.

### 18.1 Template repo goals

The template should let a developer:

1. declare contributions in `manifest.json`
2. declare required capabilities
3. build one or more UI bundles
4. call host contracts through a small TypeScript SDK
5. package the plugin into a release zip

### 18.2 Recommended template layout

```text
zenvault-plugin-template/
├── manifest.json
├── package.json
├── tsconfig.json
├── vite.config.ts
├── README.md
├── src/
│   ├── index.ts
│   ├── view.tsx
│   ├── sidebar.tsx
│   ├── settings.tsx
│   ├── commands.ts
│   └── plugin.ts
├── sdk/
│   ├── index.ts
│   ├── types.ts
│   ├── host.ts
│   └── contracts/
│       ├── vault.ts
│       ├── workspace.ts
│       ├── search.ts
│       └── git.ts
├── types/
│   └── zenvault.d.ts
└── .github/workflows/
    └── release.yml
```

### 18.3 Developer-facing SDK shape

The template SDK should expose a single host object that is easy to learn.

```ts
export interface PluginHost {
  vault: VaultApi;
  workspace: WorkspaceApi;
  search: SearchApi;
  git?: GitApi;
  storage: PluginStorageApi;
  commands: PluginCommandApi;
}
```

The template should export a helper like:

```ts
import { createPluginHost } from "./sdk";

export const host = createPluginHost({
  pluginId: "zenvault-git",
  apiVersion: "1.0",
});
```

Then plugin code uses that object instead of calling transport APIs directly.

```ts
import { host } from "./plugin";

export async function syncNow() {
  await host.git?.pull({ remote: "origin", branch: "main" });
  await host.workspace.showNotice({
    title: "Repository updated",
    tone: "success",
  });
}
```

### 18.4 Minimal SDK transport

The SDK should hide the broker transport completely.

```ts
import { invoke } from "@tauri-apps/api/core";

export async function callHost<T>(request: PluginBackendRequest): Promise<T> {
  const response = await invoke<PluginBackendResponse<T>>("plugin_backend_call", {
    req: request,
  });

  if (!response.ok) {
    throw new Error(response.error.message);
  }

  return response.data;
}
```

The host app may later swap this transport for a safer bridge without forcing
plugin authors to rewrite their code, as long as the SDK contract remains
stable.

### 18.5 Template manifest example

```json
{
  "id": "zenvault-kanban",
  "name": "Kanban Board",
  "version": "0.1.0",
  "author": "community-dev",
  "description": "Track work items in a board view without changing the core note model.",
  "minAppVersion": "0.2.0",
  "apiVersion": "1.0",
  "capabilities": {
    "required": ["vault.read", "vault.write", "workspace.open"],
    "optional": ["search.query"]
  },
  "contributes": {
    "activityBarItem": {
      "id": "kanban",
      "iconUrl": "dist/icon.svg",
      "tooltip": "Kanban",
      "placement": "left"
    },
    "sidebarPanel": {
      "id": "kanban-panel",
      "bundleUrl": "dist/sidebar.js",
      "placement": "left"
    },
    "editorViews": [
      {
        "extensions": [".kanban.json"],
        "bundleUrl": "dist/view.js"
      }
    ],
    "settingsPanel": {
      "label": "Kanban",
      "bundleUrl": "dist/settings.js"
    }
  }
}
```

### 18.6 Recommended implementation sequence after this spec

To make plugin development real, build the platform in this order:

1. define manifest `apiVersion` and `capabilities`
2. define shared request/response types for the broker
3. implement `plugin_backend_call` with one contract first: `VaultApi`
4. add `PluginStorageApi` so plugin authors have isolated state immediately
5. add `GitApi` next to prove the architecture supports non-core features
6. publish the template repo with one example plugin, ideally a small kanban or git sidebar plugin

If `GitApi` works cleanly through this platform, the architecture is doing the
right thing: plugins are extending the product without requiring Flux core to
own every feature itself.
