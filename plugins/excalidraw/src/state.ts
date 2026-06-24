/**
 * Excalidraw scene — (de)serialization helpers.
 *
 * On-disk format mirrors the Excalidraw web app's exported `.excalidraw`
 * JSON so files round-trip with the web editor + the Obsidian
 * Excalidraw plugin's "Compressed" off mode.
 *
 *   {
 *     "type": "excalidraw",
 *     "version": 2,
 *     "source": "flux:excalidraw",
 *     "elements": [...],
 *     "appState": { "viewBackgroundColor": "...", "gridSize": null },
 *     "files":    { ... binary files keyed by id ... }
 *   }
 *
 * `appState` is intentionally narrow — Excalidraw rejects a number of
 * runtime-only keys (collaborators, cursorButton, ...) on restore, so
 * we only persist the visual-config subset and let Excalidraw fill in
 * defaults for everything else.
 */
import type {
  ExcalidrawElement,
  NonDeleted,
} from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";

export interface ExcalidrawDoc {
  type: "excalidraw";
  version: number;
  source: string;
  elements: readonly ExcalidrawElement[];
  appState: Partial<AppState>;
  files: BinaryFiles;
}

const FILE_TYPE = "excalidraw";
const FILE_VERSION = 2;
const FILE_SOURCE = "flux:excalidraw";

/** AppState keys we round-trip to disk. Keep this list small — adding
 *  a runtime-only key (e.g. `collaborators`) causes Excalidraw to
 *  reject the whole scene on restore. */
const PERSISTED_APP_STATE_KEYS = [
  "viewBackgroundColor",
  "gridSize",
  "gridStep",
  "gridModeEnabled",
  "zenModeEnabled",
  "viewModeEnabled",
  "objectsSnapModeEnabled",
  "currentItemStrokeColor",
  "currentItemBackgroundColor",
  "currentItemFillStyle",
  "currentItemStrokeWidth",
  "currentItemStrokeStyle",
  "currentItemRoughness",
  "currentItemOpacity",
  "currentItemFontFamily",
  "currentItemFontSize",
  "currentItemTextAlign",
  "currentItemStartArrowhead",
  "currentItemEndArrowhead",
  "currentItemRoundness",
  "scrollX",
  "scrollY",
  "zoom",
  "theme",
  "name",
] as const satisfies readonly (keyof AppState)[];

export function emptyExcalidrawDoc(): ExcalidrawDoc {
  return {
    type: FILE_TYPE,
    version: FILE_VERSION,
    source: FILE_SOURCE,
    elements: [],
    appState: {
      viewBackgroundColor: "#ffffff",
      gridSize: null as unknown as number,
    },
    files: {},
  };
}

export function parseExcalidraw(raw: string): ExcalidrawDoc {
  if (!raw || raw.trim() === "") return emptyExcalidrawDoc();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyExcalidrawDoc();
  }
  if (!parsed || typeof parsed !== "object") return emptyExcalidrawDoc();
  const p = parsed as Partial<ExcalidrawDoc>;
  return {
    type: FILE_TYPE,
    version: typeof p.version === "number" ? p.version : FILE_VERSION,
    source: typeof p.source === "string" ? p.source : FILE_SOURCE,
    elements: Array.isArray(p.elements)
      ? (p.elements as ExcalidrawElement[])
      : [],
    appState:
      p.appState && typeof p.appState === "object"
        ? (p.appState as Partial<AppState>)
        : {},
    files:
      p.files && typeof p.files === "object" ? (p.files as BinaryFiles) : {},
  };
}

/** Trim AppState to the persisted subset so a save doesn't write any
 *  ephemeral keys Excalidraw would later refuse to restore. */
function pickPersistedAppState(state: AppState): Partial<AppState> {
  const out: Partial<AppState> = {};
  for (const key of PERSISTED_APP_STATE_KEYS) {
    const v = (state as Record<string, unknown>)[key];
    if (v !== undefined) (out as Record<string, unknown>)[key] = v;
  }
  return out;
}

export function serializeExcalidraw(
  elements: readonly NonDeleted<ExcalidrawElement>[],
  appState: AppState,
  files: BinaryFiles,
): string {
  const doc: ExcalidrawDoc = {
    type: FILE_TYPE,
    version: FILE_VERSION,
    source: FILE_SOURCE,
    elements,
    appState: pickPersistedAppState(appState),
    files,
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

export function serializeExcalidrawDoc(doc: ExcalidrawDoc): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}
