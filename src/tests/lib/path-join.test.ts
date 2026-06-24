/**
 * Unit tests for `joinVaultPath` — the helper that the vault picker
 * uses to build the full "vault root + new vault name" path shown to
 * the user and sent to the backend.
 *
 * Regression coverage for the `'\\\\'` typo that previously collapsed
 * the Windows-separator branch and produced mixed-separator paths
 * like `C:\Users\vijay/MyVault`.
 */
import { describe, expect, it } from "vitest";

import { joinVaultPath } from "@/lib/path-join";

describe("joinVaultPath", () => {
  it("returns the name when parent is empty", () => {
    expect(joinVaultPath("", "MyVault")).toBe("MyVault");
  });

  it("returns the parent when name is empty", () => {
    expect(joinVaultPath("/home/v", "")).toBe("/home/v");
  });

  it("joins with forward slash when parent uses forward slashes", () => {
    expect(joinVaultPath("/home/vijay", "MyVault")).toBe(
      "/home/vijay/MyVault",
    );
    expect(joinVaultPath("/Users/v/Documents", "Notes")).toBe(
      "/Users/v/Documents/Notes",
    );
  });

  it("joins with backslash when parent uses backslashes only", () => {
    expect(joinVaultPath("C:\\Users\\vijay", "MyVault")).toBe(
      "C:\\Users\\vijay\\MyVault",
    );
    expect(joinVaultPath("D:\\Documents", "MyNotes")).toBe(
      "D:\\Documents\\MyNotes",
    );
  });

  it("prefers forward slash when parent has mixed separators", () => {
    // If a path already has both, the universal separator is safest.
    expect(joinVaultPath("C:/Users/vijay\\foo", "Bar")).toBe(
      "C:/Users/vijay\\foo/Bar",
    );
  });

  it("collapses a trailing forward slash before joining", () => {
    expect(joinVaultPath("/home/v/", "MyVault")).toBe("/home/v/MyVault");
    expect(joinVaultPath("/home/v///", "MyVault")).toBe("/home/v/MyVault");
  });

  it("collapses a trailing backslash before joining", () => {
    expect(joinVaultPath("C:\\Users\\vijay\\", "MyVault")).toBe(
      "C:\\Users\\vijay\\MyVault",
    );
    expect(joinVaultPath("C:\\Users\\vijay\\\\", "MyVault")).toBe(
      "C:\\Users\\vijay\\MyVault",
    );
  });

  it("does not introduce mixed separators on Windows-only parents (regression)", () => {
    // The previous bugged check `endsWith('\\\\')` (a 2-char `\\`
    // literal) never matched real Windows paths, so the picker
    // produced `C:\Users\vijay/MyVault`. This test pins the fix.
    const joined = joinVaultPath("C:\\Users\\vijay", "MyVault");
    expect(joined).not.toContain("/");
  });
});
