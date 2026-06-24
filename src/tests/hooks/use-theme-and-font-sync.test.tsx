/**
 * Tests for `useThemeAndFontSync`.
 *
 * The hook touches DOM globals (document.documentElement.classList
 * and CSS custom properties); we drive the settings store from the
 * test and assert the side effects.
 */
import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useThemeAndFontSync } from "@/hooks/use-theme-and-font-sync";
import { useSettingsStore } from "@/state/settings-store";

/** Snapshot we restore between tests so the hook re-runs cleanly. */
const initialTheme = useSettingsStore.getState().theme;
const initialFont = useSettingsStore.getState().fontSize;

/** jsdom doesn't ship `matchMedia` — install a stub that returns
 *  a non-matching media query so the `theme === "system"` branch
 *  doesn't throw. Individual tests can override `window.matchMedia`
 *  to drive specific behaviour. */
const defaultMatchMedia = () => ({
  matches: false,
  media: "(prefers-color-scheme: dark)",
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  dispatchEvent: () => true,
});

beforeEach(() => {
  document.documentElement.classList.remove("dark");
  document.documentElement.style.removeProperty("--editor-font-size");
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation(defaultMatchMedia),
  });
});

afterEach(() => {
  useSettingsStore.setState({ theme: initialTheme, fontSize: initialFont });
  document.documentElement.classList.remove("dark");
  document.documentElement.style.removeProperty("--editor-font-size");
  vi.restoreAllMocks();
});

describe("theme sync", () => {
  it("adds the `dark` class to <html> when theme=dark", () => {
    useSettingsStore.setState({ theme: "dark" });
    renderHook(() => useThemeAndFontSync());
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("removes the `dark` class when theme=light", () => {
    document.documentElement.classList.add("dark");
    useSettingsStore.setState({ theme: "light" });
    renderHook(() => useThemeAndFontSync());
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("follows the OS preference when theme=system and applies it on mount", () => {
    const matchMediaMock = vi.fn().mockReturnValue({
      matches: true,
      media: "(prefers-color-scheme: dark)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    });
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: matchMediaMock,
    });

    useSettingsStore.setState({ theme: "system" });
    renderHook(() => useThemeAndFontSync());

    expect(matchMediaMock).toHaveBeenCalledWith("(prefers-color-scheme: dark)");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("reacts to OS preference changes while theme=system", () => {
    let handler: ((e: { matches: boolean }) => void) | undefined;
    const mql = {
      matches: false,
      media: "(prefers-color-scheme: dark)",
      addEventListener: (_: string, cb: (e: { matches: boolean }) => void) => {
        handler = cb;
      },
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockReturnValue(mql),
    });

    useSettingsStore.setState({ theme: "system" });
    renderHook(() => useThemeAndFontSync());
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    act(() => handler!({ matches: true }));
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    act(() => handler!({ matches: false }));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("tears down the OS-preference listener when theme stops being `system`", () => {
    const removeListener = vi.fn();
    const mql = {
      matches: false,
      media: "(prefers-color-scheme: dark)",
      addEventListener: vi.fn(),
      removeEventListener: removeListener,
      dispatchEvent: vi.fn(),
    };
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockReturnValue(mql),
    });

    useSettingsStore.setState({ theme: "system" });
    const { rerender } = renderHook(() => useThemeAndFontSync());

    act(() => useSettingsStore.setState({ theme: "light" }));
    rerender();
    expect(removeListener).toHaveBeenCalled();
  });
});

describe("font-size sync", () => {
  it("writes --editor-font-size to :root", () => {
    useSettingsStore.setState({ fontSize: 20 });
    renderHook(() => useThemeAndFontSync());
    expect(
      document.documentElement.style.getPropertyValue("--editor-font-size"),
    ).toBe("20px");
  });

  it("updates the CSS variable when the setting changes", () => {
    useSettingsStore.setState({ fontSize: 14 });
    const { rerender } = renderHook(() => useThemeAndFontSync());
    expect(
      document.documentElement.style.getPropertyValue("--editor-font-size"),
    ).toBe("14px");
    act(() => useSettingsStore.setState({ fontSize: 18 }));
    rerender();
    expect(
      document.documentElement.style.getPropertyValue("--editor-font-size"),
    ).toBe("18px");
  });
});
