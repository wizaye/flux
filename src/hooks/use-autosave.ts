/**
 * Autosave loop.
 *
 * The mental model:
 *   • Typing marks a file dirty and updates the in-memory buffer.
 *   • This hook flushes dirty buffers to disk after a short idle
 *     window OR immediately when the user is about to lose focus
 *     (window blur, tab hidden, page unload).
 *   • `Ctrl/Cmd+S` keeps working — it goes through the same
 *     `saveFile` path and simply skips the debounce.
 *   • Successful saves are silent (the dirty dot vanishing is the
 *     feedback). Failures still toast so the user knows their data
 *     is not on disk yet.
 *
 * Why a single hook at the App root instead of per-pane debounce:
 *   • The dirty set is global (a single file can be edited in two
 *     split panes), so debouncing per pane could either double-save
 *     or miss the latest snapshot.
 *   • One subscriber + one timer keeps the flush logic boring and
 *     auditable.
 *
 * Idempotency: re-entrant flushes are guarded by an in-flight set
 * per path, so a lifecycle event firing mid-debounce can't kick off
 * a second write for the same file.
 */
import { useEffect, useRef } from "react";

import { isTauri } from "@/bindings";
import { useFileOperations } from "@/hooks/use-file-operations";
import { useVaultStore } from "@/state/vault-store";

/** Idle window after the last keystroke before we flush. */
export const AUTOSAVE_DEBOUNCE_MS = 1500;

export function useAutosave(): void {
  const { saveFile } = useFileOperations();
  // Keep the latest callback in a ref so the effect below only runs
  // once at mount and never re-subscribes.
  const saveFileRef = useRef(saveFile);
  saveFileRef.current = saveFile;

  useEffect(() => {
    if (!isTauri) return;

    let timer: number | null = null;
    const inFlight = new Set<string>();

    const flush = async () => {
      const { dirtyFiles, openFiles } = useVaultStore.getState();
      if (dirtyFiles.size === 0) return;

      const batch: Array<[string, string]> = [];
      for (const path of dirtyFiles) {
        if (inFlight.has(path)) continue;
        const content = openFiles.get(path);
        // No content cached → the buffer was already evicted (e.g.
        // by the external-edit handler in use-fs-watcher-sync). Skip
        // it; the file on disk is the source of truth.
        if (content === undefined) continue;
        batch.push([path, content]);
      }

      await Promise.all(
        batch.map(async ([path, content]) => {
          inFlight.add(path);
          try {
            await saveFileRef.current(path, content);
          } catch {
            // saveFile already surfaced the error toast; leave the
            // file dirty so the next keystroke / blur reschedules.
          } finally {
            inFlight.delete(path);
          }
        }),
      );
    };

    const scheduleFlush = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        void flush();
      }, AUTOSAVE_DEBOUNCE_MS);
    };

    const flushNow = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      void flush();
    };

    const unsubscribe = useVaultStore.subscribe((state, prev) => {
      // A vault close (or switch) clears `vaultHandle`. Drop the
      // in-flight set so a stuck write from the previous session
      // can't suppress autosave for a same-named path under the
      // new vault. We don't cancel the underlying promise — it'll
      // settle into the catch arm because the backend pool is gone.
      const vaultClosed =
        prev.vaultHandle !== null && state.vaultHandle === null;
      if (vaultClosed) inFlight.clear();

      // Two trigger conditions:
      //   1. A clean file became dirty (first keystroke).
      //   2. A dirty file got a new content snapshot (continued
      //      typing). `setFileContent` swaps the Map identity, so
      //      we can see "still dirty + new openFiles" as the typing
      //      signal without subscribing to a heavyweight selector.
      const becameDirty =
        state.dirtyFiles !== prev.dirtyFiles && state.dirtyFiles.size > 0;
      const typingWhileDirty =
        state.openFiles !== prev.openFiles && state.dirtyFiles.size > 0;
      if (becameDirty || typingWhileDirty) scheduleFlush();
    });

    const onBlur = () => flushNow();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushNow();
    };
    const onBeforeUnload = () => flushNow();

    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      unsubscribe();
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", onBeforeUnload);
      if (timer !== null) window.clearTimeout(timer);
      // One last attempt as the App unmounts (e.g. vault switch).
      // Best-effort: the underlying writes are atomic, so a
      // partial completion can't corrupt files.
      void flush();
    };
    // Run exactly once. saveFile is captured via a ref above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
