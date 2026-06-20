/**
 * Global "busy" registry.
 *
 * Tracks long-running operations (vault open, PDF export, background
 * indexing, etc.) so a single overlay can render the dotmatrix
 * loader on top of the app and block accidental input while work is
 * in flight.
 *
 * Pattern:
 *   const id = useBusyStore.getState().begin("Loading vault…");
 *   try { await doWork(); } finally { useBusyStore.getState().end(id); }
 *
 * For promise wrappers, prefer the `withBusy` helper:
 *   await withBusy("Loading vault…", () => doWork());
 *
 * Multiple concurrent operations stack; the overlay shows the most
 * recently-begun label and stays mounted until ALL operations end.
 */
import { create } from "zustand";

export interface BusyEntry {
  id: number;
  label: string;
  /** Optional sublabel (e.g. file count, percentage). */
  detail?: string;
  startedAt: number;
}

interface BusyState {
  entries: BusyEntry[];
  begin: (label: string, detail?: string) => number;
  update: (id: number, patch: Partial<Pick<BusyEntry, "label" | "detail">>) => void;
  end: (id: number) => void;
  clear: () => void;
}

let _nextId = 1;

export const useBusyStore = create<BusyState>((set) => ({
  entries: [],
  begin: (label, detail) => {
    const id = _nextId++;
    const entry: BusyEntry = { id, label, detail, startedAt: Date.now() };
    set((s) => ({ entries: [...s.entries, entry] }));
    return id;
  },
  update: (id, patch) =>
    set((s) => ({
      entries: s.entries.map((e) =>
        e.id === id ? { ...e, ...patch } : e,
      ),
    })),
  end: (id) =>
    set((s) => ({ entries: s.entries.filter((e) => e.id !== id) })),
  clear: () => set({ entries: [] }),
}));

/** Promise wrapper that auto-begins / auto-ends a busy entry. */
export async function withBusy<T>(
  label: string,
  task: () => Promise<T>,
  detail?: string,
): Promise<T> {
  const id = useBusyStore.getState().begin(label, detail);
  try {
    return await task();
  } finally {
    useBusyStore.getState().end(id);
  }
}
