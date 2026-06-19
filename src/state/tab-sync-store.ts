/**
 * Tab-sync store — bridge between vault file operations and the
 * editor's open tabs.
 *
 * The split tree + open tabs live in `lattice-shell` (top-level state),
 * but the file operations that need to react to them (delete a file →
 * close its tabs, rename a file → relabel its tabs) sit deep inside
 * the hook layer. Rather than thread a callback through every layer,
 * `lattice-shell` registers two handlers in this store on mount, and
 * `useFileOperations` calls into the store whenever a backend
 * operation succeeds.
 *
 * The pattern is intentionally minimal: just a setter and two
 * getters. Adding a real event bus would be overkill — we only have
 * two events and one consumer.
 */
import { create } from "zustand";

export type TabSyncHandlers = {
  /** Close every tab pointing at `fileId` (or any descendant path
   *  when `fileId` happens to be a folder). */
  closeTabsForFile: (fileId: string) => void;
  /** Rewrite open tabs from `oldPath` to `newPath` (and update their
   *  display title). */
  renameTabFile: (oldPath: string, newPath: string, newName: string) => void;
};

type State = {
  handlers: TabSyncHandlers | null;
  setHandlers: (h: TabSyncHandlers | null) => void;
  /** Currently-focused markdown tab (fileId + display title).
   *  Pane.tsx publishes this on every active-tab change so other
   *  surfaces (e.g. the Bookmarks add button) know which file to
   *  target. `null` when no tab is selected or it's not a markdown
   *  file. */
  activeFile: { fileId: string; title: string } | null;
  setActiveFile: (next: { fileId: string; title: string } | null) => void;
};

export const useTabSyncStore = create<State>((set) => ({
  handlers: null,
  setHandlers: (handlers) => set({ handlers }),
  activeFile: null,
  setActiveFile: (activeFile) => set({ activeFile }),
}));

/** Convenience: read the current handlers (no React subscription). */
export function getTabSyncHandlers(): TabSyncHandlers | null {
  return useTabSyncStore.getState().handlers;
}
