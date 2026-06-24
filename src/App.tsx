import "./App.css";
import * as React from "react";
import { LatticeShell } from "./components/flux-ui/layout/lattice-shell";
import { DetachedDocShell } from "./detached-doc-shell";
import { isDetachedWindow } from "./lib/detached-window";
import { IconScale } from "./components/flux-ui/common/icons";
import { TooltipProvider } from "./components/ui/tooltip";
import { Toaster } from "./components/ui/sonner";
import { ErrorToaster } from "./components/flux-ui/common/error-toaster";
import { VaultPicker } from "./components/flux-ui/modals/vault-picker";
import { useVaultStore } from "./state/vault-store";
import { useVaultOperations } from "./hooks/use-vault-operations";
import { useThemeAndFontSync } from "./hooks/use-theme-and-font-sync";
import { useFsWatcherSync } from "./hooks/use-fs-watcher-sync";
import { useLinkIndexer } from "./hooks/use-link-indexer";
import { useAutosave } from "./hooks/use-autosave";
import { bootPlugins } from "./plugins/boot";
import { refreshExternalPlugins } from "./plugins/install";
import { getLastVaultPath, isTauri } from "./bindings";
import { GlobalBusyOverlay } from "./components/flux-ui/common/global-busy-overlay";
import { withBusy } from "./state/busy-store";
import { usePluginStore } from "./state/plugin-store";

function App() {
  // Theme + font-size synchronisation — applies the user's saved
  // settings (system/light/dark, base font size) to the document
  // root before anything else paints.
  useThemeAndFontSync();

  // Detached-window mode: a popped-out single-file webview launched
  // by the doc-header "Open in new window" command. Detected ONCE
  // at first render (URL doesn't change in-flight) so it's safe to
  // gate everything below; full LatticeShell with sidebars + tabs
  // never instantiates in detached windows.
  const detached = React.useMemo(() => isDetachedWindow(), []);

  if (detached) {
    return <DetachedShellWrapper />;
  }
  return <FullShell />;
}

function DetachedShellWrapper() {
  return (
    <TooltipProvider delayDuration={200}>
      <IconScale>
        <DetachedDocShell />
        <GlobalBusyOverlay />
        <Toaster position="bottom-right" />
        <ErrorToaster />
      </IconScale>
    </TooltipProvider>
  );
}

function FullShell() {
  // Register every built-in plugin into the store on first mount,
  // then ask Rust to scan the vault for any external plugins
  // dropped into `.zenvault/plugins/`. Both steps are idempotent
  // and tolerate the no-vault case (boot just no-ops the scan).
  React.useEffect(() => {
    void bootPlugins();
  }, []);

  // Listen for backend `flux://fs-changed` events and quietly refresh
  // the vault tree when external edits land. Hook is a no-op in
  // browser preview (no Tauri runtime).
  useFsWatcherSync();
  // Bulk-scan + incrementally maintain the link/tag index that
  // powers the backlinks panel + graph view.
  useLinkIndexer();
  // Debounced autosave + flush-on-blur/hidden/unload. Ctrl+S still
  // works as an immediate flush via the editor's keymap.
  useAutosave();

  const isVaultOpen = useVaultStore((s) => s.isVaultOpen);
  const { openVault } = useVaultOperations();
  const [showVaultPicker, setShowVaultPicker] = React.useState(false);
  // Hide the picker until our auto-open attempt has resolved one way
  // or the other; otherwise the picker briefly flashes before the
  // last-opened vault loads.
  const [autoOpenChecked, setAutoOpenChecked] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    // Browser-only mode has no Tauri runtime → no vault to reopen.
    // Skip the IPC roundtrip entirely so we don't trigger an
    // unhandled rejection toast from the guarded `invoke` shim.
    if (!isTauri) {
      setAutoOpenChecked(true);
      return;
    }
    (async () => {
      try {
        const last = await getLastVaultPath();
        if (cancelled) return;
        if (last) {
          // Auto-reopen the most-recently-used vault under a global
          // busy overlay so the user can't click around while the
          // file tree + DB index are warming.
          try {
            await withBusy(
              "Opening vault\u2026",
              () => openVault(last),
              last,
            );
          } catch {
            /* useVaultOperations already toasts the error */
          }
        }
      } catch {
        /* getLastVaultPath failed (e.g. no Tauri) — just show picker. */
      } finally {
        if (!cancelled) setAutoOpenChecked(true);
      }
    })();
    return () => { cancelled = true; };
    // Run exactly once at mount. openVault is recreated on every
    // store-mutation; if we depend on it we'd loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Show the picker only after the auto-open check resolved AND no
  // vault is open. Skipped entirely in browser-only mode (no Tauri
  // runtime → no folder dialog → no real vault → fall through to the
  // mock vault that `lattice-shell` shows by default).
  React.useEffect(() => {
    if (!isTauri) return;
    if (autoOpenChecked && !isVaultOpen) {
      setShowVaultPicker(true);
    }
  }, [autoOpenChecked, isVaultOpen]);

  // Re-scan `.zenvault/plugins/` whenever the active vault changes.
  // Skips the IPC call in non-Tauri previews — `refreshExternalPlugins`
  // would log a warning otherwise.
  React.useEffect(() => {
    if (!isTauri || !isVaultOpen) return;
    void refreshExternalPlugins();
  }, [isVaultOpen]);

  return (
    <TooltipProvider delayDuration={200}>
      <IconScale>
        <LatticeShell />
        <PluginAppRoots />
        <VaultPicker
          open={showVaultPicker && !isVaultOpen}
          onClose={() => setShowVaultPicker(false)}
        />
        {/* Subtle/professional defaults — no closeButton X (user-hidden),
            no richColors (too vibrant). Errors still render with the
            destructive icon via the custom `icons` map in `ui/sonner.tsx`. */}
        <Toaster position="bottom-right" />
        <ErrorToaster />        <GlobalBusyOverlay />      </IconScale>
    </TooltipProvider>
  );
}

/**
 * Mounts every enabled built-in plugin's optional `appRoot`
 * component. Plugins use this slot for always-on UI (e.g. a
 * link-picker dialog that the command palette can open without
 * waiting for the sidebar to be visible).
 */
function PluginAppRoots() {
  const plugins = usePluginStore((s) => s.plugins);
  const builtinComponents = usePluginStore((s) => s.builtinComponents);
  return (
    <>
      {plugins
        .filter((p) => p.enabled && p.loaderKind === "builtin")
        .map((p) => {
          const Root = builtinComponents[p.id]?.appRoot;
          if (!Root) return null;
          return <Root key={p.id} />;
        })}
    </>
  );
}

export default App;
