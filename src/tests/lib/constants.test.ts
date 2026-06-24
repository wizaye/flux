/**
 * Coverage tests for the static constant / token modules.
 *
 * These files have no runtime branches — importing them and
 * spot-checking a handful of values is enough to lock the contract
 * (numbers used by the layout-shell sizing logic, Tailwind class
 * strings used by the legacy lattice colour palette).
 */
import { describe, expect, it } from "vitest";

import {
  bgApp,
  bgEditor,
  bgHeader,
  bgMenu,
  bgSidebar,
  bgStrip,
  hoverBg,
  hoverText,
} from "@/lib/lattice-tokens";

import {
  FOOTER_H,
  HEADER_H,
  LEFT_COLLAPSE_AT,
  LEFT_DEFAULT,
  LEFT_MIN,
  PANE_TOOLBAR_H,
  PUSH_ANIM_MS,
  RESIZE_ZONE_W,
  RIGHT_COLLAPSE_AT,
  RIGHT_DEFAULT,
  RIGHT_MIN,
  SIDEBAR_ANIM_MS,
  STRIP_W,
  WIN_CONTROLS_W,
} from "@/lib/layout-constants";

describe("lattice-tokens", () => {
  it("exports light/dark Tailwind class strings for every surface", () => {
    for (const tok of [bgApp, bgEditor, bgSidebar, bgStrip, bgHeader, bgMenu]) {
      expect(tok).toMatch(/dark:/);
      expect(typeof tok).toBe("string");
      expect(tok.length).toBeGreaterThan(0);
    }
  });

  it("hover tokens are `hover:` prefixed", () => {
    expect(hoverBg).toMatch(/^hover:/);
    expect(hoverText).toMatch(/^hover:/);
  });
});

describe("layout-constants", () => {
  it("sidebar minimums are below defaults", () => {
    expect(LEFT_MIN).toBeLessThanOrEqual(LEFT_DEFAULT);
    expect(RIGHT_MIN).toBeLessThanOrEqual(RIGHT_DEFAULT);
  });

  it("auto-collapse threshold sits below the visible minimum", () => {
    expect(LEFT_COLLAPSE_AT).toBeLessThan(LEFT_MIN);
    expect(RIGHT_COLLAPSE_AT).toBeLessThan(RIGHT_MIN);
  });

  it("chrome dimensions are positive integers", () => {
    for (const v of [
      HEADER_H,
      FOOTER_H,
      PANE_TOOLBAR_H,
      WIN_CONTROLS_W,
      RESIZE_ZONE_W,
      STRIP_W,
    ]) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
    }
  });

  it("push animation is faster than the toggle slide", () => {
    expect(PUSH_ANIM_MS).toBeLessThan(SIDEBAR_ANIM_MS);
  });
});
