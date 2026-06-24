/**
 * Excalidraw mount — wraps the official `<Excalidraw>` SDK component
 * and adapts it to the SDK editor-view contract.
 *
 * Responsibilities:
 *   1. Parse the incoming `source` into elements/appState/files.
 *   2. Render `<Excalidraw>` with a stable `initialData`.
 *   3. On `onChange`, debounce and only call host `onChange` when the
 *      serialized scene actually changes (Excalidraw fires on every
 *      pointer move; bouncing through the host's save layer for each
 *      would saturate the file system).
 *   4. When the host swaps `source` (file switch / external edit),
 *      push the new scene into Excalidraw via `updateScene`.
 *   5. Track the host theme (`.dark` on `<html>`) and forward it.
 */
import * as React from "react";
import {
  Excalidraw,
  THEME,
  type ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw";
import type {
  AppState,
  BinaryFiles,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";
import type {
  ExcalidrawElement,
  NonDeleted,
} from "@excalidraw/excalidraw/element/types";

import "@excalidraw/excalidraw/index.css";

import { parseExcalidraw, serializeExcalidraw } from "./state";

interface Props {
  source: string;
  onChange: (next: string) => void;
}

/** Min interval between `onChange` round-trips to the host. The
 *  Excalidraw component fires `onChange` on every cursor move; the
 *  host's save layer already debounces, but skipping cheap dupes
 *  here avoids serializing the whole scene 60×/s. */
const SAVE_THROTTLE_MS = 250;

function useIsDarkHtml(): boolean {
  const subscribe = React.useCallback((cb: () => void) => {
    if (typeof document === "undefined") return () => {};
    const obs = new MutationObserver(cb);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => obs.disconnect();
  }, []);
  const getSnapshot = React.useCallback(
    () =>
      typeof document !== "undefined" &&
      document.documentElement.classList.contains("dark"),
    [],
  );
  return React.useSyncExternalStore(subscribe, getSnapshot, () => true);
}

export function ExcalidrawMount({ source, onChange }: Props) {
  const isDark = useIsDarkHtml();
  const apiRef = React.useRef<ExcalidrawImperativeAPI | null>(null);

  // Parse the SOURCE we mounted with — this becomes `initialData`.
  // Subsequent source swaps push through `updateScene` instead so
  // Excalidraw keeps its undo stack and viewport.
  const initialData = React.useMemo<ExcalidrawInitialDataState>(() => {
    const doc = parseExcalidraw(source);
    return {
      elements: doc.elements as ExcalidrawElement[],
      appState: doc.appState as Partial<AppState>,
      files: doc.files,
      scrollToContent: true,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentional: mount-once snapshot

  // Last-serialized scene — used to dedupe `onChange` and to detect
  // host-driven source swaps that need an `updateScene`.
  const lastSerializedRef = React.useRef<string>(source);

  // Host-driven source swap (file switch, external edit). When the
  // incoming `source` differs from the last value we serialized,
  // reload the scene without disturbing Excalidraw on echo-back.
  React.useEffect(() => {
    if (source === lastSerializedRef.current) return;
    lastSerializedRef.current = source;
    const api = apiRef.current;
    if (!api) return;
    const doc = parseExcalidraw(source);
    api.updateScene({
      elements: doc.elements as ExcalidrawElement[],
      appState: doc.appState as Partial<AppState>,
    });
    if (Object.keys(doc.files).length > 0) {
      api.addFiles(
        Object.values(doc.files).map((f) => ({
          id: f.id,
          dataURL: f.dataURL,
          mimeType: f.mimeType,
          created: f.created,
        })),
      );
    }
  }, [source]);

  // Throttled save — coalesce rapid-fire `onChange` calls.
  const pendingRef = React.useRef<{
    elements: readonly NonDeleted<ExcalidrawElement>[];
    appState: AppState;
    files: BinaryFiles;
  } | null>(null);
  const timerRef = React.useRef<number | null>(null);

  const flush = React.useCallback(() => {
    timerRef.current = null;
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (!pending) return;
    const next = serializeExcalidraw(
      pending.elements,
      pending.appState,
      pending.files,
    );
    if (next === lastSerializedRef.current) return;
    lastSerializedRef.current = next;
    onChange(next);
  }, [onChange]);

  React.useEffect(() => {
    return () => {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        flush();
      }
    };
  }, [flush]);

  const handleChange = React.useCallback(
    (
      elements: readonly NonDeleted<ExcalidrawElement>[],
      appState: AppState,
      files: BinaryFiles,
    ) => {
      pendingRef.current = { elements, appState, files };
      if (timerRef.current != null) return;
      timerRef.current = window.setTimeout(flush, SAVE_THROTTLE_MS);
    },
    [flush],
  );

  return (
    <div className="flex-1 min-h-0 w-full">
      <Excalidraw
        initialData={initialData}
        onChange={handleChange}
        theme={isDark ? THEME.DARK : THEME.LIGHT}
        excalidrawAPI={(api) => {
          apiRef.current = api;
        }}
        UIOptions={{
          canvasActions: {
            toggleTheme: false,
          },
        }}
      />
    </div>
  );
}

export default ExcalidrawMount;
