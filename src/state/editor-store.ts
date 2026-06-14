/**
 * Editor runtime state (per-session, NOT persisted).
 *
 * Two responsibilities right now:
 *   1. Dirty-tracking: which file ids have unsaved edits in any open
 *      CodeMirror pane. The editor consults this before clobbering
 *      its doc with a fresh `content` prop (see CodeMirrorEditor's
 *      sync effect) so concurrent edits in another pane don't blow
 *      away in-flight typing.
 *   2. In-memory content overrides: when the user types in CodeMirror
 *      we mirror the latest doc back into this map so the markdown-
 *      preview / slides / graph views see the current text without
 *      every change touching the vault. Closing the tab (or save in a
 *      future phase) flushes the override.
 *
 * Trimmed from `lattice/src/state/editorStore.ts`.
 */
import { create } from "zustand";

type EditorState = {
  dirtyFiles: Set<string>;
  fileContents: Map<string, string>;
  markDirty: (id: string) => void;
  markClean: (id: string) => void;
  setFileContent: (id: string, content: string) => void;
  getFileContent: (id: string) => string | undefined;
};

export const useEditorStore = create<EditorState>((set, get) => ({
  dirtyFiles: new Set(),
  fileContents: new Map(),
  markDirty: (id) =>
    set((s) => {
      if (s.dirtyFiles.has(id)) return s;
      const next = new Set(s.dirtyFiles);
      next.add(id);
      return { dirtyFiles: next };
    }),
  markClean: (id) =>
    set((s) => {
      if (!s.dirtyFiles.has(id)) return s;
      const next = new Set(s.dirtyFiles);
      next.delete(id);
      return { dirtyFiles: next };
    }),
  setFileContent: (id, content) =>
    set((s) => {
      const next = new Map(s.fileContents);
      next.set(id, content);
      return { fileContents: next };
    }),
  getFileContent: (id) => get().fileContents.get(id),
}));
