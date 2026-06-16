/**
 * Editor display settings.
 *
 * Ported (trimmed) from `lattice/src/state/settingsStore.ts`. Holds
 * only the toggles the flux CodeMirror editor reads on mount — line
 * numbers, soft-wrap, vim mode. Persisted to `localStorage` so the
 * user's choices survive a reload.
 *
 * Also holds the user-customisable hotkey map so key bindings survive
 * reloads and can be edited in the Settings › Hotkeys panel.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

// ── Hotkey types ──────────────────────────────────────────────────────────────

/** A single parsed key combination. */
export type HotkeyBinding = {
  /** Physical key value (e.g. "k", ",", "b"). Always lowercase. */
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
};

/** Stable identifier for each command that has a configurable hotkey. */
export type HotkeyId =
  | "commandPalette"
  | "openSettings"
  | "toggleLeftSidebar"
  | "toggleRightSidebar";

/** Human-readable label shown in the Hotkeys settings panel. */
export const HOTKEY_LABELS: Record<HotkeyId, string> = {
  commandPalette: "Open command palette",
  openSettings: "Open settings",
  toggleLeftSidebar: "Toggle left sidebar",
  toggleRightSidebar: "Toggle right sidebar",
};

/** Factory — build a binding from its constituent parts. */
export function makeBinding(
  key: string,
  mods: Partial<Pick<HotkeyBinding, "metaKey" | "ctrlKey" | "shiftKey" | "altKey">> = {},
): HotkeyBinding {
  return {
    key: key.toLowerCase(),
    metaKey: mods.metaKey ?? false,
    ctrlKey: mods.ctrlKey ?? false,
    shiftKey: mods.shiftKey ?? false,
    altKey: mods.altKey ?? false,
  };
}

/** Returns true when a KeyboardEvent matches the stored binding. */
export function matchesBinding(e: KeyboardEvent, b: HotkeyBinding): boolean {
  return (
    e.key.toLowerCase() === b.key &&
    e.metaKey === b.metaKey &&
    e.ctrlKey === b.ctrlKey &&
    e.shiftKey === b.shiftKey &&
    e.altKey === b.altKey
  );
}

/** Convert a binding to a display string, e.g. "⌘⇧K". */
export function bindingLabel(b: HotkeyBinding): string {
  const parts: string[] = [];
  if (b.ctrlKey) parts.push("Ctrl");
  if (b.altKey) parts.push("Alt");
  if (b.shiftKey) parts.push("⇧");
  if (b.metaKey) parts.push("⌘");
  parts.push(b.key === "," ? "," : b.key.toUpperCase());
  return parts.join("+");
}

/** Split a binding label into individual Kbd chips. */
export function bindingChips(b: HotkeyBinding): string[] {
  const chips: string[] = [];
  if (b.ctrlKey) chips.push("Ctrl");
  if (b.altKey) chips.push("Alt");
  if (b.shiftKey) chips.push("⇧");
  if (b.metaKey) chips.push("⌘");
  chips.push(b.key === "," ? "," : b.key.toUpperCase());
  return chips;
}

export const DEFAULT_HOTKEYS: Record<HotkeyId, HotkeyBinding> = {
  commandPalette: makeBinding("k", { metaKey: true }),
  openSettings: makeBinding(",", { metaKey: true }),
  toggleLeftSidebar: makeBinding("b", { metaKey: true }),
  toggleRightSidebar: makeBinding("b", { metaKey: true, shiftKey: true }),
};

// ── Store ─────────────────────────────────────────────────────────────────────

type SettingsState = {
  // Editor
  lineNumbers: boolean;
  wordWrap: boolean;
  vimMode: boolean;
  setLineNumbers: (v: boolean) => void;
  setWordWrap: (v: boolean) => void;
  setVimMode: (v: boolean) => void;
  // Hotkeys
  hotkeys: Record<HotkeyId, HotkeyBinding>;
  setHotkey: (id: HotkeyId, binding: HotkeyBinding) => void;
  resetHotkey: (id: HotkeyId) => void;
  resetAllHotkeys: () => void;
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
      hotkeys: { ...DEFAULT_HOTKEYS },
      setHotkey: (id, binding) =>
        set((s) => ({ hotkeys: { ...s.hotkeys, [id]: binding } })),
      resetHotkey: (id) =>
        set((s) => ({ hotkeys: { ...s.hotkeys, [id]: DEFAULT_HOTKEYS[id] } })),
      resetAllHotkeys: () => set({ hotkeys: { ...DEFAULT_HOTKEYS } }),
    }),
    { name: "flux-settings" },
  ),
);
