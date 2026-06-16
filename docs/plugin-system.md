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

export type PluginManifest = {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  minAppVersion?: string;
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
        set(() => {
          const plugins: InstalledPlugin[] = manifests.map(({ manifest, pluginDir }) => ({
            id: manifest.id,
            enabled: true,
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

1. `src/state/plugin-store.ts` — no UI deps, test in isolation.
2. `activity-strip.tsx` — add props + plugin slot render, verify with a mock entry.
3. `pane.tsx` `PaneBody` — registry check before kind switch, test with a mock `.testview` file.
4. `settings-dialog.tsx` — `CommunityPluginsBody` + dynamic sections.
5. `left-sidebar.tsx` — plugin panel branch + lazy load.
6. `command-palette.tsx` — merged plugin commands group.
7. `lattice-shell.tsx` — wire `activePluginPanel` state + new props.
8. Rust `load_plugin_manifests` command + specta export.
9. Plugin template repo + GitHub Actions release workflow.
10. Community registry repo + `registry.json` schema validation CI.
