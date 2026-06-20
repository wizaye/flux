/**
 * Listen for Tauri `flux://fs-changed` watcher events and refresh
 * the vault tree silently. Hooked into a long-lived component (App
 * root) so the listener is attached for the lifetime of the
 * session.
 *
 * Debounces refresh calls to at most one per ~250 ms — the Rust
 * side already coalesces inotify bursts, but a hot save loop could
 * still fire several events in succession (write, fsync, modify).
 */
import { useEffect, useRef } from "react";
import { useVaultOperations } from "@/hooks/use-vault-operations";
import { isTauri } from "@/bindings";

interface FsChangedPayload {
  changed: string[];
  removed: string[];
}

export function useFsWatcherSync() {
  const { refreshVault } = useVaultOperations();
  const timer = useRef<number | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const off = await listen<FsChangedPayload>(
        "flux://fs-changed",
        () => {
          // Debounce: collapse rapid bursts into a single refresh.
          if (timer.current !== null) {
            window.clearTimeout(timer.current);
          }
          timer.current = window.setTimeout(async () => {
            timer.current = null;
            if (inFlight.current) return;
            inFlight.current = true;
            try {
              // Silent refresh — watcher events shouldn't toast.
              await refreshVault(true);
            } catch {
              /* refreshVault toasted */
            } finally {
              inFlight.current = false;
            }
          }, 250);
        },
      );
      if (cancelled) {
        off();
      } else {
        unlisten = off;
      }
    })();
    return () => {
      cancelled = true;
      if (timer.current !== null) window.clearTimeout(timer.current);
      unlisten?.();
    };
  }, [refreshVault]);
}
