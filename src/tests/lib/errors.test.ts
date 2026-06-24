/**
 * Unit tests for `formatError`.
 *
 * The helper exists to coerce Tauri's serialized `AppError` enum
 * (`{ kind, message }`) and assorted JS error shapes into
 * human-readable strings without printing "[object Object]".
 */
import { describe, expect, it } from "vitest";

import { formatError } from "@/lib/errors";

describe("formatError", () => {
  it("returns the string itself for string inputs", () => {
    expect(formatError("plain")).toBe("plain");
    expect(formatError("")).toBe("");
  });

  it("returns 'Unknown error' for null / undefined", () => {
    expect(formatError(null)).toBe("Unknown error");
    expect(formatError(undefined)).toBe("Unknown error");
  });

  it("extracts message from Error instances", () => {
    expect(formatError(new Error("boom"))).toBe("boom");
    expect(formatError(new TypeError("oops"))).toBe("oops");
  });

  it("formats Tauri AppError shape with both kind and message", () => {
    expect(
      formatError({ kind: "NotFound", message: "missing.md" }),
    ).toBe("NotFound: missing.md");
  });

  it("uses message alone when kind is missing", () => {
    expect(formatError({ message: "lonely" })).toBe("lonely");
  });

  it("uses kind alone when message is missing", () => {
    expect(formatError({ kind: "Internal" })).toBe("Internal");
  });

  it("JSON-stringifies plain objects with neither kind nor message", () => {
    const out = formatError({ foo: "bar" });
    expect(out).toContain("foo");
    expect(out).toContain("bar");
  });

  it("falls back to String() for numbers and booleans", () => {
    expect(formatError(42)).toBe("42");
    expect(formatError(true)).toBe("true");
  });

  it("handles a circular object without throwing", () => {
    type Cyc = { self?: Cyc; toString?: () => string };
    const o: Cyc = {};
    o.self = o;
    o.toString = () => "fallback";
    // Should not throw and should fall back to the object's toString
    // when JSON.stringify fails.
    const result = formatError(o);
    expect(typeof result).toBe("string");
  });

  it("rejects non-string `kind` / `message` fields gracefully", () => {
    // Numeric kind/message — should not show up as `123: 456`.
    const out = formatError({ kind: 123, message: 456 });
    // Falls through to JSON.stringify since neither field is a string.
    expect(out).toContain("123");
  });
});
