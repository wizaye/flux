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
  | "toggleRightSidebar"
  | "globalSearch";

/** Human-readable label shown in the Hotkeys settings panel. */
export const HOTKEY_LABELS: Record<HotkeyId, string> = {
  commandPalette: "Open command palette",
  openSettings: "Open settings",
  toggleLeftSidebar: "Toggle left sidebar",
  toggleRightSidebar: "Toggle right sidebar",
  globalSearch: "Search across all notes",
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

/** Returns true when a KeyboardEvent matches the stored binding.
 *  Defensive against undefined bindings — happens when a new hotkey
 *  is added and the user's persisted store predates it.
 *
 *  Cross-platform: when a binding has `metaKey: true` and the
 *  current platform is NOT macOS, we also accept `ctrlKey: true`.
 *  That way a single binding (`Cmd+F`) works as `Cmd+F` on macOS
 *  and `Ctrl+F` on Windows / Linux — mirroring CodeMirror's "Mod-"
 *  prefix convention. */
const IS_MAC =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");

export function matchesBinding(e: KeyboardEvent, b: HotkeyBinding | undefined): boolean {
  if (!b || typeof b.key !== "string") return false;
  if (e.key.toLowerCase() !== b.key) return false;
  if (e.shiftKey !== b.shiftKey) return false;
  if (e.altKey !== b.altKey) return false;
  if (IS_MAC) {
    return e.metaKey === b.metaKey && e.ctrlKey === b.ctrlKey;
  }
  // Non-Mac: collapse meta and ctrl into a single "Mod" key. Either
  // the binding's `metaKey` OR `ctrlKey` matches if the event has
  // EITHER pressed (but not both, and not neither).
  const wantsMod = b.metaKey || b.ctrlKey;
  const eventHasMod = e.metaKey || e.ctrlKey;
  return wantsMod === eventHasMod;
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
  // Cmd/Ctrl+F is the muscle-memory shortcut for "find" in every
  // editor. We route it to the global left-sidebar search (VS Code /
  // Obsidian style) instead of CM's inline-bottom search bar.
  globalSearch: makeBinding("f", { metaKey: true }),
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

  /** Base font size for the editor + reading view (px). */
  fontSize: number;
  setFontSize: (v: number) => void;

  /** Default view mode when opening a markdown file. */
  defaultViewMode: "source" | "live" | "preview";
  setDefaultViewMode: (v: "source" | "live" | "preview") => void;

  /** Theme override — "system" follows OS, "light" / "dark" pin. */
  theme: "system" | "light" | "dark";
  setTheme: (v: "system" | "light" | "dark") => void;

  /** When false, the doc-header eye / Reading toggle hides. */
  showRibbon: boolean;
  setShowRibbon: (v: boolean) => void;

  /** Show tab bar above editor panes. */
  showTabBar: boolean;
  setShowTabBar: (v: boolean) => void;

  /**
   * When `true`, the destructive "Merge entire file with…" command
   * bypasses the confirmation dialog. Driven by the "Don't ask
   * again" checkbox on that dialog; users can flip it back via
   * Settings → Reset confirmation prompts (future).
   */
  skipMergeConfirm: boolean;
  setSkipMergeConfirm: (v: boolean) => void;
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
      fontSize: 16,
      setFontSize: (v) => set({ fontSize: v }),
      defaultViewMode: "live",
      setDefaultViewMode: (v) => set({ defaultViewMode: v }),
      theme: "system",
      setTheme: (v) => set({ theme: v }),
      showRibbon: true,
      setShowRibbon: (v) => set({ showRibbon: v }),
      showTabBar: true,
      setShowTabBar: (v) => set({ showTabBar: v }),
      skipMergeConfirm: false,
      setSkipMergeConfirm: (v) => set({ skipMergeConfirm: v }),
      hotkeys: { ...DEFAULT_HOTKEYS },
      setHotkey: (id, binding) =>
        set((s) => ({ hotkeys: { ...s.hotkeys, [id]: binding } })),
      resetHotkey: (id) =>
        set((s) => ({ hotkeys: { ...s.hotkeys, [id]: DEFAULT_HOTKEYS[id] } })),
      resetAllHotkeys: () => set({ hotkeys: { ...DEFAULT_HOTKEYS } }),
    }),
    { name: "flux-settings",
      // Merge user-saved hotkeys with defaults so adding a new
      // command (e.g. `globalSearch` in 0.x) doesn't leave older
      // localStorage rows missing the new key — which would crash
      // `matchesBinding` with "Cannot read properties of undefined".
      merge: (persisted, current) => {
        const p = (persisted as Partial<SettingsState>) || {};
        return {
          ...current,
          ...p,
          hotkeys: { ...DEFAULT_HOTKEYS, ...(p.hotkeys ?? {}) },
        };
      },
    },
  ),
);
