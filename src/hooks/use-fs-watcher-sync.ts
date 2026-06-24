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
import { useVaultStore } from "@/state/vault-store";
import { flattenVault } from "@/state/editor";

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
        (event) => {
          const { fileTree, openFiles, dirtyFiles, removeFileContent } =
            useVaultStore.getState();
          const currentPaths = flattenVault(fileTree);

          const hasRemoved = event.payload.removed.some((p) => currentPaths.has(p));
          const hasNew = event.payload.changed.some((p) => !currentPaths.has(p));

          // Drop cached buffers for files that were modified
          // externally so the next open re-reads from disk. We skip
          // dirty files — their in-memory copy is the user's
          // unsaved work and stomping it would lose data. Same for
          // files that were just deleted (`removed` paths): the
          // open-tab handler will close their tabs separately.
          const stalePaths = [
            ...event.payload.changed.filter(
              (p) => openFiles.has(p) && !dirtyFiles.has(p),
            ),
            ...event.payload.removed.filter((p) => openFiles.has(p)),
          ];
          for (const path of stalePaths) {
            removeFileContent(path);
          }

          if (!hasRemoved && !hasNew) {
            // Content modification of existing files only - skip full vault tree rebuild
            return;
          }

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
