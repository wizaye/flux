/**
 * Tests for the detached-window detection helper.
 *
 * `isDetachedWindow()` reads `window.location.search` for
 * `?mode=detached`. We override jsdom's `location` per test via
 * `history.pushState` (the only thing jsdom permits without
 * monkey-patching).
 */
import { afterEach, describe, expect, it } from "vitest";

import { isDetachedWindow } from "@/lib/detached-window";

const initialUrl = window.location.href;

afterEach(() => {
  window.history.replaceState({}, "", initialUrl);
});

describe("isDetachedWindow", () => {
  it("returns false when no query string is present", () => {
    window.history.replaceState({}, "", "/");
    expect(isDetachedWindow()).toBe(false);
  });

  it("returns false when mode is something other than 'detached'", () => {
    window.history.replaceState({}, "", "/?mode=other");
    expect(isDetachedWindow()).toBe(false);
  });

  it("returns true when ?mode=detached is in the query string", () => {
    window.history.replaceState({}, "", "/?mode=detached");
    expect(isDetachedWindow()).toBe(true);
  });

  it("works alongside other query params", () => {
    window.history.replaceState({}, "", "/?file=foo.md&mode=detached&x=1");
    expect(isDetachedWindow()).toBe(true);
  });
});
