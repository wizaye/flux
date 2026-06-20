/**
 * Unit tests for the `cn()` className merger.
 *
 * Thin shim over `clsx` + `tailwind-merge`, but the behaviour we
 * depend on across the app is "later utility wins" — verifying that
 * here catches accidental swaps of the underlying libs.
 */
import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

describe("cn", () => {
  it("joins truthy class names", () => {
    expect(cn("a", "b", "c")).toBe("a b c");
  });

  it("drops falsy values", () => {
    expect(cn("a", false, null, undefined, "", "b")).toBe("a b");
  });

  it("flattens nested arrays", () => {
    expect(cn(["a", ["b", "c"]], "d")).toBe("a b c d");
  });

  it("dedupes conflicting tailwind utilities — later wins", () => {
    // `p-2` should be replaced by `p-4`; unrelated classes preserved.
    expect(cn("p-2 text-sm", "p-4")).toBe("text-sm p-4");
  });

  it("honours conditional object syntax from clsx", () => {
    expect(cn("base", { active: true, disabled: false })).toBe("base active");
  });

  it("returns empty string when given nothing", () => {
    expect(cn()).toBe("");
  });
});
