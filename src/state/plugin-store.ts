/**
 * Plugin store — single source of truth for installed plugins +
 * their derived contribution maps.
 *
 * Two ways a plugin enters the store:
 *   1. **Bundled**: registered at boot from `src/plugins/registry.ts`.
 *      Its `loaderKind: "builtin"` flag tells the UI to use the
 *      provided component reference directly instead of dynamic
 *      `import(asset://…)`. Lives in this repo. Phase A path.
 *   2. **External**: scanned from `.zenvault/plugins/` by Rust at
 *      vault open. `loaderKind: "external"` carries a `bundleUrl`
 *      the UI lazy-loads. Phase C path (broker + asset:// resolution).
 *
 * The UI never reads `plugins` directly — it subscribes to the
 * derived contribution maps (`activityBarContributions`,
 * `editorViewRegistry`, `paletteCommands`, `settingsSections`) so a
 * re-derivation happens exactly once per mutation.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type * as React from "react";
import type {
  PluginActivityBarItem,
  PluginCommand,
  PluginManifest,
  PluginSettingsPanel,
  EditorViewProps,
} from "@flux/plugin-sdk/types";

// ── Component reference shapes (builtin vs external) ────────────────

/** For `loaderKind: "builtin"` we store React component refs
 *  directly so the UI can mount them with `<Comp />`. */
export interface BuiltinComponentRefs {
  sidebarPanel?: React.ComponentType;
  settingsPanel?: React.ComponentType;
  /** Map of `.ext` → component for `editorViews`. Keys lowercase. */
  editorViews?: Record<string, React.ComponentType<EditorViewProps>>;
  /** Activity-bar icon as a React component (lucide icon, custom svg). */
  activityBarIcon?: React.ComponentType<{ className?: string }>;
  /** Optional command handler keyed by command id. */
  commandHandlers?: Record<string, () => void>;
  /** Optional always-mounted React surface. Rendered once near the
   *  app root for every enabled plugin so commands can open
   *  dialogs / hold long-lived event listeners without depending on
   *  the sidebar being visible. */
  appRoot?: React.ComponentType;
}

// ── Installed record (persisted) ─────────────────────────────────────

export interface InstalledPlugin {
  id: string;
  enabled: boolean;
  version: string;
  /** Vault-relative folder for external plugins; empty for builtins. */
  pluginDir: string;
  manifest: PluginManifest;
  /** "builtin" plugins live in this repo and ship with the app.
   *  "external" plugins live in the user's vault and load via
   *  dynamic `import(asset://…)`. */
  loaderKind: "builtin" | "external";
}

interface PluginState {
  plugins: InstalledPlugin[];

  // Non-persisted runtime registry: component refs for builtin
  // plugins. Set once at boot by the registry; never serialised.
  builtinComponents: Record<string, BuiltinComponentRefs>;

  /** Lazy loaders registered alongside each builtin's manifest.
   *  Invoked on first enable so a plugin's React code lands in
   *  its own Vite chunk — not the host startup bundle. */
  builtinLoaders: Record<string, () => Promise<BuiltinComponentRefs>>;

  // Derived maps (recomputed on every mutation).
  activityBarContributions: Array<{
    pluginId: string;
    item: PluginActivityBarItem;
  }>;
  editorViewRegistry: Record<string, string>; // ".kanban.json" → pluginId
  paletteCommands: Array<{ pluginId: string; command: PluginCommand }>;
  settingsSections: Array<{
    pluginId: string;
    panel: PluginSettingsPanel;
    manifest: PluginManifest;
  }>;

  // Mutations
  /** Eager registration — components are already in memory.
   *  Used by tests + the SDK template's hot-reload path. */
  registerBuiltin: (
    manifest: PluginManifest,
    components: BuiltinComponentRefs,
    defaultEnabled?: boolean,
  ) => void;
  /** Lazy registration — components hydrate via `loader()` the
   *  first time the plugin becomes enabled. Production path for
   *  bundled plugins. */
  registerBuiltinLazy: (
    manifest: PluginManifest,
    loader: () => Promise<BuiltinComponentRefs>,
    defaultEnabled?: boolean,
  ) => void;
  /** Same hydration model as `registerBuiltinLazy`, but flagged
   *  `loaderKind: "external"` so the UI knows the plugin lives in
   *  the user's vault. The loader closure is responsible for
   *  resolving the on-disk bundle to an `asset://` URL the host
   *  webview can `import()`. */
  registerExternalLazy: (
    manifest: PluginManifest,
    pluginDir: string,
    loader: () => Promise<BuiltinComponentRefs>,
    defaultEnabled?: boolean,
  ) => void;
  /** Wipe all external plugins and re-seed from the supplied list.
   *  Called after every vault open and after every install /
   *  uninstall so the store stays in lockstep with the scanner.
   *  Builtin plugins are untouched. */
  replaceExternals: (
    entries: Array<{
      manifest: PluginManifest;
      pluginDir: string;
      loader: () => Promise<BuiltinComponentRefs>;
    }>,
  ) => void;
  setEnabled: (id: string, enabled: boolean) => void;
  uninstall: (id: string) => void;
}

function derive(plugins: InstalledPlugin[]) {
  const active = plugins.filter((p) => p.enabled);

  const activityBarContributions = active
    .filter((p) => p.manifest.contributes.activityBarItem)
    .map((p) => ({
      pluginId: p.id,
      item: p.manifest.contributes.activityBarItem!,
    }));

  const editorViewRegistry: Record<string, string> = {};
  for (const p of active) {
    for (const ev of p.manifest.contributes.editorViews ?? []) {
      for (const ext of ev.extensions) {
        editorViewRegistry[ext.toLowerCase()] = p.id;
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

  return {
    activityBarContributions,
    editorViewRegistry,
    paletteCommands,
    settingsSections,
  };
}

/** Resolve a builtin plugin's lazy loader and stash the resulting
 *  component refs in the store so subsequent reads are sync. Idempotent
 *  per id — duplicate hydrations are coalesced via the in-flight map.
 *
 *  Errors are surfaced via `console.error` (matching the rest of the
 *  plugin layer) and re-thrown so callers can fall back to a "plugin
 *  failed to load" UI if they care. */
const inFlightHydration = new Map<string, Promise<void>>();

async function hydrateLazy(id: string): Promise<void> {
  if (inFlightHydration.has(id)) return inFlightHydration.get(id)!;
  const promise = (async () => {
    const loader = usePluginStore.getState().builtinLoaders[id];
    if (!loader) return;
    try {
      const components = await loader();
      usePluginStore.setState((s) => ({
        builtinComponents: { ...s.builtinComponents, [id]: components },
      }));
    } catch (err) {
      console.error(`[plugin-store] hydrate failed for "${id}":`, err);
      throw err;
    } finally {
      inFlightHydration.delete(id);
    }
  })();
  inFlightHydration.set(id, promise);
  return promise;
}

export const usePluginStore = create<PluginState>()(
  persist(
    (set, get) => ({
      plugins: [],
      builtinComponents: {},
      builtinLoaders: {},
      activityBarContributions: [],
      editorViewRegistry: {},
      paletteCommands: [],
      settingsSections: [],

      registerBuiltin: (manifest, components, defaultEnabled = false) =>
        set((s) => {
          // Preserve persisted enabled state if the user previously
          // toggled this plugin; new installs default to
          // `defaultEnabled` (almost always `false` — plugins should
          // be opt-in).
          const existing = s.plugins.find((p) => p.id === manifest.id);
          const enabled = existing ? existing.enabled : defaultEnabled;
          const next: InstalledPlugin = {
            id: manifest.id,
            enabled,
            version: manifest.version,
            pluginDir: "",
            manifest,
            loaderKind: "builtin",
          };
          const plugins = existing
            ? s.plugins.map((p) => (p.id === manifest.id ? next : p))
            : [...s.plugins, next];
          return {
            plugins,
            builtinComponents: {
              ...s.builtinComponents,
              [manifest.id]: components,
            },
            ...derive(plugins),
          };
        }),

      registerBuiltinLazy: (manifest, loader, defaultEnabled = false) => {
        set((s) => {
          const existing = s.plugins.find((p) => p.id === manifest.id);
          const enabled = existing ? existing.enabled : defaultEnabled;
          const next: InstalledPlugin = {
            id: manifest.id,
            enabled,
            version: manifest.version,
            pluginDir: "",
            manifest,
            loaderKind: "builtin",
          };
          const plugins = existing
            ? s.plugins.map((p) => (p.id === manifest.id ? next : p))
            : [...s.plugins, next];
          return {
            plugins,
            builtinLoaders: { ...s.builtinLoaders, [manifest.id]: loader },
            ...derive(plugins),
          };
        });
        // If the plugin starts enabled (persisted from a previous
        // session OR `defaultEnabled` was true), hydrate components
        // immediately so the first render finds them.
        const post = get();
        const installed = post.plugins.find((p) => p.id === manifest.id);
        if (installed?.enabled && !post.builtinComponents[manifest.id]) {
          void hydrateLazy(manifest.id);
        }
      },

      setEnabled: (id, enabled) => {
        set((s) => {
          const plugins = s.plugins.map((p) =>
            p.id === id ? { ...p, enabled } : p,
          );
          return { plugins, ...derive(plugins) };
        });
        // Hydrate the lazy bundle on the *first* enable. Subsequent
        // toggles re-use the cached components map.
        if (enabled) {
          const s = get();
          if (!s.builtinComponents[id] && s.builtinLoaders[id]) {
            void hydrateLazy(id);
          }
        }
      },
      registerExternalLazy: (manifest, pluginDir, loader, defaultEnabled = false) => {
        set((s) => {
          const existing = s.plugins.find((p) => p.id === manifest.id);
          const enabled = existing ? existing.enabled : defaultEnabled;
          const next: InstalledPlugin = {
            id: manifest.id,
            enabled,
            version: manifest.version,
            pluginDir,
            manifest,
            loaderKind: "external",
          };
          const plugins = existing
            ? s.plugins.map((p) => (p.id === manifest.id ? next : p))
            : [...s.plugins, next];
          return {
            plugins,
            builtinLoaders: { ...s.builtinLoaders, [manifest.id]: loader },
            ...derive(plugins),
          };
        });
        const post = get();
        const installed = post.plugins.find((p) => p.id === manifest.id);
        if (installed?.enabled && !post.builtinComponents[manifest.id]) {
          void hydrateLazy(manifest.id);
        }
      },
      replaceExternals: (entries) => {
        // Drop everything currently flagged external first so a
        // freshly-uninstalled plugin disappears from the store on
        // the next rescan.
        set((s) => {
          const keptPlugins = s.plugins.filter((p) => p.loaderKind !== "external");
          const components = { ...s.builtinComponents };
          const loaders = { ...s.builtinLoaders };
          for (const p of s.plugins) {
            if (p.loaderKind === "external") {
              delete components[p.id];
              delete loaders[p.id];
            }
          }
          return {
            plugins: keptPlugins,
            builtinComponents: components,
            builtinLoaders: loaders,
            ...derive(keptPlugins),
          };
        });
        // Now register each scanned plugin. We do this outside the
        // single `set` above so each `registerExternalLazy` call
        // can fire its own hydration trigger.
        for (const e of entries) {
          get().registerExternalLazy(e.manifest, e.pluginDir, e.loader, false);
        }
      },      uninstall: (id) =>
        set((s) => {
          const plugins = s.plugins.filter((p) => p.id !== id);
          const builtinComponents = { ...s.builtinComponents };
          delete builtinComponents[id];
          const builtinLoaders = { ...s.builtinLoaders };
          delete builtinLoaders[id];
          return {
            plugins,
            builtinComponents,
            builtinLoaders,
            ...derive(plugins),
          };
        }),
    }),
    {
      name: "flux-plugins",
      // Bump whenever a built-in plugin's manifest changes shape in
      // a way that would silently miss new contributions if loaded
      // from a stale snapshot. Bumping invalidates the derived
      // contribution maps; the `migrate` step keeps the user's
      // enable/disable choices intact across the bump.
      // Last bump: Kanban manifest gained `.board.yaml`.
      version: 2,
      migrate: (persisted: unknown, _from) => {
        // Old shape was identical apart from manifests embedding an
        // outdated `contributes` list. Keep enabled state, drop the
        // stale manifest copy — `registerBuiltin` re-attaches the
        // live one when the bootstrap call lands.
        if (
          typeof persisted === "object" &&
          persisted !== null &&
          Array.isArray((persisted as { plugins?: unknown }).plugins)
        ) {
          return persisted as Record<string, unknown>;
        }
        return { plugins: [] };
      },
      // Persist only the data the user owns: enabled state + which
      // manifests are installed. Component refs are non-serialisable
      // and re-registered on every boot.
      partialize: (s) => ({
        plugins: s.plugins.map(({ id, enabled, version, pluginDir, manifest, loaderKind }) => ({
          id,
          enabled,
          version,
          pluginDir,
          manifest,
          loaderKind,
        })),
      }),
      // After hydration, re-derive contribution maps from the
      // persisted plugin list so the UI doesn't render empty until
      // the first mutation. Builtin component refs are still empty
      // here — the bootstrap registry call fills them in next.
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const d = derive(state.plugins);
        state.activityBarContributions = d.activityBarContributions;
        state.editorViewRegistry = d.editorViewRegistry;
        state.paletteCommands = d.paletteCommands;
        state.settingsSections = d.settingsSections;
      },
    },
  ),
);

// ── Selectors used by the UI ────────────────────────────────────────

/** Look up a builtin plugin's components. Returns `undefined` when
 *  the plugin is external (Phase C) or not yet registered. */
export function selectBuiltinComponents(id: string) {
  return usePluginStore.getState().builtinComponents[id];
}
