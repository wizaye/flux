/**
 * Editor display settings.
 *
 * Ported (trimmed) from `lattice/src/state/settingsStore.ts`. Holds
 * only the toggles the flux CodeMirror editor reads on mount — line
 * numbers, soft-wrap, vim mode. Persisted to `localStorage` so the
 * user's choices survive a reload.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

type SettingsState = {
  lineNumbers: boolean;
  wordWrap: boolean;
  vimMode: boolean;
  setLineNumbers: (v: boolean) => void;
  setWordWrap: (v: boolean) => void;
  setVimMode: (v: boolean) => void;
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      lineNumbers: false,
      wordWrap: true,
      vimMode: false,
      setLineNumbers: (v) => set({ lineNumbers: v }),
      setWordWrap: (v) => set({ wordWrap: v }),
      setVimMode: (v) => set({ vimMode: v }),
    }),
    { name: "flux-settings" },
  ),
);
