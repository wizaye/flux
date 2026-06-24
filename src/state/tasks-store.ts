/**
 * Tasks store — vault-wide list of Markdown checkboxes.
 *
 * Mirrors the pattern used by `link-index-store`: the source of
 * truth lives in SQLite (`tasks` table), the store caches a
 * snapshot for the UI to render and exposes a `refresh()` action
 * + a `toggle()` action that pipes through the Rust command +
 * eagerly mutates the local cache so the UI updates without
 * waiting for the watcher reindex.
 */
import { create } from "zustand";
import {
  isTauri,
  listOpenTasks,
  toggleTask,
  type TaskDto,
  type ToggleTaskResult,
} from "@/bindings";

interface TasksState {
  tasks: TaskDto[];
  loading: boolean;
  /** Set of task ids currently mid-toggle so the UI can disable the
   *  checkbox to prevent double-firing while we wait for Rust. */
  pending: Set<string>;
  /** Fetch the latest open-task list from Rust. Idempotent. */
  refresh: () => Promise<void>;
  /** Flip a task; eagerly removes the row from the open list and
   *  rolls back if the IPC fails. */
  toggle: (id: string) => Promise<ToggleTaskResult | null>;
}

export const useTasksStore = create<TasksState>((set, get) => ({
  tasks: [],
  loading: false,
  pending: new Set(),

  refresh: async () => {
    if (!isTauri) return; // browser preview: no tasks command
    if (get().loading) return;
    set({ loading: true });
    try {
      const next = await listOpenTasks();
      set({ tasks: next, loading: false });
    } catch (e) {
      console.warn("[flux/tasks] refresh failed:", e);
      set({ loading: false });
    }
  },

  toggle: async (id: string) => {
    if (!isTauri) return null;
    // Optimistic removal — flipping an open task to done means it
    // disappears from the open-task list. The reindex Rust does on
    // toggle re-fetches the fresh state.
    const before = get().tasks;
    set((s) => ({
      tasks: s.tasks.filter((t) => t.id !== id),
      pending: new Set([...s.pending, id]),
    }));
    try {
      const result = await toggleTask(id);
      // Pull the new state from Rust so we never carry stale rows.
      await get().refresh();
      set((s) => {
        const pending = new Set(s.pending);
        pending.delete(id);
        return { pending };
      });
      return result;
    } catch (e) {
      console.error("[flux/tasks] toggle failed:", e);
      // Rollback.
      set((s) => {
        const pending = new Set(s.pending);
        pending.delete(id);
        return { tasks: before, pending };
      });
      return null;
    }
  },
}));
