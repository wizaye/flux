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
import { getLastVaultPath, isTauri } from "./bindings";

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
        <Toaster position="bottom-right" />
        <ErrorToaster />
      </IconScale>
    </TooltipProvider>
  );
}

function FullShell() {
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
          // Auto-reopen the most-recently-used vault. If it fails
          // (deleted folder, permissions, etc.) fall through to the
          // picker so the user can pick another one.
          try {
            await openVault(last);
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

  return (
    <TooltipProvider delayDuration={200}>
      <IconScale>
        <LatticeShell />
        <VaultPicker
          open={showVaultPicker && !isVaultOpen}
          onClose={() => setShowVaultPicker(false)}
        />
        {/* Subtle/professional defaults — no closeButton X (user-hidden),
            no richColors (too vibrant). Errors still render with the
            destructive icon via the custom `icons` map in `ui/sonner.tsx`. */}
        <Toaster position="bottom-right" />
        <ErrorToaster />
      </IconScale>
    </TooltipProvider>
  );
}

export default App;
