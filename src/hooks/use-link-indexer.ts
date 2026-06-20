/**
 * Link / tag indexer hook.
 *
 * Drives `useLinkIndexStore` from two signals:
 *   • Vault open / close (`useVaultStore.isVaultOpen`) — on open
 *     runs a full `scanVaultLinks()`; on close clears the index.
 *   • `flux://fs-changed` events — batches changed + removed paths
 *     into a single `scanVaultLinksSubset()` call per debounce
 *     window so a burst of saves still triggers exactly one Rust
 *     traversal.
 *
 * Browser-preview mode (no Tauri runtime) is a no-op — the index
 * stays empty and the right-sidebar panels render their empty
 * state.
 */
import { useEffect, useRef } from "react";

import {
  isTauri,
  scanVaultLinks,
  scanVaultLinksSubset,
} from "@/bindings";
import { useVaultStore } from "@/state/vault-store";
import { useLinkIndexStore } from "@/state/link-index-store";

interface FsChangedPayload {
  changed: string[];
  removed: string[];
}

const PATCH_DEBOUNCE_MS = 250;

export function useLinkIndexer() {
  const isVaultOpen = useVaultStore((s) => s.isVaultOpen);
  const bulkReplace = useLinkIndexStore((s) => s.bulkReplace);
  const patch = useLinkIndexStore((s) => s.patch);
  const reset = useLinkIndexStore((s) => s.reset);
  const setScanning = useLinkIndexStore((s) => s.setScanning);

  // ── Bulk scan on vault open / clear on close ─────────────────
  useEffect(() => {
    if (!isTauri) return;
    if (!isVaultOpen) {
      reset();
      return;
    }
    let cancelled = false;
    setScanning(true);
    void (async () => {
      try {
        const result = await scanVaultLinks();
        if (!cancelled) bulkReplace(result);
      } catch {
        /* swallow — backlinks panel falls back to empty state */
      } finally {
        if (!cancelled) setScanning(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isTauri, isVaultOpen, bulkReplace, reset, setScanning]);

  // ── Incremental patch on watcher events ──────────────────────
  const timer = useRef<number | null>(null);
  const pending = useRef<Set<string>>(new Set());
  const inFlight = useRef(false);

  useEffect(() => {
    if (!isTauri || !isVaultOpen) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const off = await listen<FsChangedPayload>(
        "flux://fs-changed",
        (event) => {
          for (const p of event.payload.changed) pending.current.add(p);
          for (const p of event.payload.removed) pending.current.add(p);
          if (timer.current !== null) {
            window.clearTimeout(timer.current);
          }
          timer.current = window.setTimeout(async () => {
            timer.current = null;
            if (inFlight.current) return;
            if (pending.current.size === 0) return;
            const batch = Array.from(pending.current).filter((p) =>
              /\.md$/i.test(p),
            );
            pending.current.clear();
            if (batch.length === 0) return;
            inFlight.current = true;
            try {
              const result = await scanVaultLinksSubset(batch);
              patch(result);
            } catch {
              /* leave the index unchanged */
            } finally {
              inFlight.current = false;
            }
          }, PATCH_DEBOUNCE_MS);
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
  }, [isVaultOpen, patch]);
}
