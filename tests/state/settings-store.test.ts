/**
 * Unit tests for settings-store.ts
 *
 * Two surfaces:
 *  1. Pure helper functions: makeBinding, matchesBinding, bindingLabel,
 *     bindingChips. No side effects, fully deterministic.
 *  2. useSettingsStore: editor toggles + hotkey CRUD. Uses Zustand
 *     `persist` with localStorage — cleared in beforeEach so tests
 *     do not bleed into each other.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  makeBinding,
  matchesBinding,
  bindingLabel,
  bindingChips,
  DEFAULT_HOTKEYS,
  useSettingsStore,
  type HotkeyBinding,
} from "@/state/settings-store";

// ── makeBinding ────────────────────────────────────────────────────────────

describe("makeBinding", () => {
  it("produces a binding with all modifiers false by default", () => {
    const b = makeBinding("k");
    expect(b).toEqual<HotkeyBinding>({
      key: "k",
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
    });
  });

  it("lowercases the key", () => {
    expect(makeBinding("K").key).toBe("k");
    expect(makeBinding("S").key).toBe("s");
  });

  it("sets only the provided modifiers, leaving others false", () => {
    const b = makeBinding("s", { ctrlKey: true, shiftKey: true });
    expect(b.ctrlKey).toBe(true);
    expect(b.shiftKey).toBe(true);
    expect(b.metaKey).toBe(false);
    expect(b.altKey).toBe(false);
  });

  it("sets all four modifiers when all are provided", () => {
    const b = makeBinding("x", {
      metaKey: true,
      ctrlKey: true,
      shiftKey: true,
      altKey: true,
    });
    expect(b.metaKey).toBe(true);
    expect(b.ctrlKey).toBe(true);
    expect(b.shiftKey).toBe(true);
    expect(b.altKey).toBe(true);
  });
});

// ── matchesBinding ─────────────────────────────────────────────────────────

/** Build a minimal fake KeyboardEvent for testing. */
function fakeEvent(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key: "k",
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  } as KeyboardEvent;
}

describe("matchesBinding", () => {
  it("returns true for an exact key + modifier match", () => {
    const b = makeBinding("k", { metaKey: true });
    expect(matchesBinding(fakeEvent({ key: "k", metaKey: true }), b)).toBe(true);
  });

  it("returns false when the key differs", () => {
    expect(matchesBinding(fakeEvent({ key: "j" }), makeBinding("k"))).toBe(false);
  });

  it("returns false when a required modifier is missing on the event", () => {
    const b = makeBinding("k", { metaKey: true });
    expect(matchesBinding(fakeEvent({ key: "k", metaKey: false }), b)).toBe(false);
  });

  it("returns false when event carries an unexpected modifier", () => {
    const b = makeBinding("k"); // no modifiers
    expect(matchesBinding(fakeEvent({ key: "k", metaKey: true }), b)).toBe(false);
  });

  it("is case-insensitive (event key.toLowerCase() is compared)", () => {
    expect(matchesBinding(fakeEvent({ key: "K" }), makeBinding("k"))).toBe(true);
  });

  it("matches comma key correctly", () => {
    const b = makeBinding(",", { metaKey: true });
    expect(matchesBinding(fakeEvent({ key: ",", metaKey: true }), b)).toBe(true);
  });
});

// ── bindingLabel ───────────────────────────────────────────────────────────

describe("bindingLabel", () => {
  it("formats a plain key with no modifiers", () => {
    expect(bindingLabel(makeBinding("k"))).toBe("K");
  });

  it("prefixes ⌘ for metaKey", () => {
    expect(bindingLabel(makeBinding("k", { metaKey: true }))).toBe("⌘+K");
  });

  it("prefixes Ctrl for ctrlKey", () => {
    expect(bindingLabel(makeBinding("s", { ctrlKey: true }))).toBe("Ctrl+S");
  });

  it("prefixes ⇧ for shiftKey", () => {
    expect(bindingLabel(makeBinding("s", { shiftKey: true }))).toBe("⇧+S");
  });

  it("prefixes Alt for altKey", () => {
    expect(bindingLabel(makeBinding("s", { altKey: true }))).toBe("Alt+S");
  });

  it("stacks multiple modifiers in Ctrl+Alt+⇧+⌘ order", () => {
    const b = makeBinding("x", {
      ctrlKey: true,
      altKey: true,
      shiftKey: true,
      metaKey: true,
    });
    expect(bindingLabel(b)).toBe("Ctrl+Alt+⇧+⌘+X");
  });

  it("does not uppercase the comma key", () => {
    expect(bindingLabel(makeBinding(",", { metaKey: true }))).toBe("⌘+,");
  });
});

// ── bindingChips ───────────────────────────────────────────────────────────

describe("bindingChips", () => {
  it("returns a single chip for a plain key", () => {
    expect(bindingChips(makeBinding("k"))).toEqual(["K"]);
  });

  it("returns modifier chips before the key chip", () => {
    expect(bindingChips(makeBinding("k", { metaKey: true, shiftKey: true }))).toEqual([
      "⇧",
      "⌘",
      "K",
    ]);
  });

  it("preserves comma as its own chip without uppercasing", () => {
    expect(bindingChips(makeBinding(",", { metaKey: true }))).toEqual(["⌘", ","]);
  });

  it("returns all four modifier chips plus key", () => {
    const chips = bindingChips(
      makeBinding("z", { ctrlKey: true, altKey: true, shiftKey: true, metaKey: true }),
    );
    expect(chips).toEqual(["Ctrl", "Alt", "⇧", "⌘", "Z"]);
  });
});

// ── DEFAULT_HOTKEYS ────────────────────────────────────────────────────────

describe("DEFAULT_HOTKEYS", () => {
  it("commandPalette is ⌘K", () => {
    expect(DEFAULT_HOTKEYS.commandPalette).toEqual(makeBinding("k", { metaKey: true }));
  });

  it("openSettings is ⌘,", () => {
    expect(DEFAULT_HOTKEYS.openSettings).toEqual(makeBinding(",", { metaKey: true }));
  });

  it("toggleLeftSidebar is ⌘B", () => {
    expect(DEFAULT_HOTKEYS.toggleLeftSidebar).toEqual(makeBinding("b", { metaKey: true }));
  });

  it("toggleRightSidebar is ⌘⇧B", () => {
    expect(DEFAULT_HOTKEYS.toggleRightSidebar).toEqual(
      makeBinding("b", { metaKey: true, shiftKey: true }),
    );
  });
});

// ── useSettingsStore ───────────────────────────────────────────────────────

beforeEach(() => {
  // Clear persisted localStorage state so each test starts clean.
  localStorage.clear();
  useSettingsStore.setState({
    lineNumbers: false,
    wordWrap: true,
    vimMode: false,
    hotkeys: { ...DEFAULT_HOTKEYS },
  });
});

describe("useSettingsStore — initial state", () => {
  it("lineNumbers is false", () => {
    expect(useSettingsStore.getState().lineNumbers).toBe(false);
  });

  it("wordWrap is true", () => {
    expect(useSettingsStore.getState().wordWrap).toBe(true);
  });

  it("vimMode is false", () => {
    expect(useSettingsStore.getState().vimMode).toBe(false);
  });

  it("hotkeys match DEFAULT_HOTKEYS", () => {
    expect(useSettingsStore.getState().hotkeys).toEqual(DEFAULT_HOTKEYS);
  });
});

describe("useSettingsStore — editor toggles", () => {
  it("setLineNumbers true", () => {
    useSettingsStore.getState().setLineNumbers(true);
    expect(useSettingsStore.getState().lineNumbers).toBe(true);
  });

  it("setLineNumbers false", () => {
    useSettingsStore.getState().setLineNumbers(true);
    useSettingsStore.getState().setLineNumbers(false);
    expect(useSettingsStore.getState().lineNumbers).toBe(false);
  });

  it("setWordWrap false", () => {
    useSettingsStore.getState().setWordWrap(false);
    expect(useSettingsStore.getState().wordWrap).toBe(false);
  });

  it("setVimMode true", () => {
    useSettingsStore.getState().setVimMode(true);
    expect(useSettingsStore.getState().vimMode).toBe(true);
  });

  it("toggling one setting does not affect the others", () => {
    useSettingsStore.getState().setVimMode(true);
    expect(useSettingsStore.getState().lineNumbers).toBe(false);
    expect(useSettingsStore.getState().wordWrap).toBe(true);
  });
});

describe("useSettingsStore — hotkey management", () => {
  it("setHotkey updates the specified binding", () => {
    const newBinding = makeBinding("p", { metaKey: true });
    useSettingsStore.getState().setHotkey("commandPalette", newBinding);
    expect(useSettingsStore.getState().hotkeys.commandPalette).toEqual(newBinding);
  });

  it("setHotkey does not affect unrelated bindings", () => {
    useSettingsStore.getState().setHotkey("commandPalette", makeBinding("p", { metaKey: true }));
    expect(useSettingsStore.getState().hotkeys.openSettings).toEqual(
      DEFAULT_HOTKEYS.openSettings,
    );
  });

  it("resetHotkey restores the default for a single binding", () => {
    useSettingsStore.getState().setHotkey("commandPalette", makeBinding("z"));
    useSettingsStore.getState().resetHotkey("commandPalette");
    expect(useSettingsStore.getState().hotkeys.commandPalette).toEqual(
      DEFAULT_HOTKEYS.commandPalette,
    );
  });

  it("resetHotkey leaves other customized bindings intact", () => {
    const { setHotkey, resetHotkey } = useSettingsStore.getState();
    setHotkey("commandPalette", makeBinding("z"));
    setHotkey("openSettings", makeBinding("x"));
    resetHotkey("commandPalette");
    expect(useSettingsStore.getState().hotkeys.openSettings).toEqual(makeBinding("x"));
  });

  it("resetAllHotkeys restores every binding to defaults", () => {
    const { setHotkey, resetAllHotkeys } = useSettingsStore.getState();
    setHotkey("commandPalette", makeBinding("z"));
    setHotkey("openSettings", makeBinding("x"));
    setHotkey("toggleLeftSidebar", makeBinding("q"));
    resetAllHotkeys();
    expect(useSettingsStore.getState().hotkeys).toEqual(DEFAULT_HOTKEYS);
  });
});
