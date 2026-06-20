/**
 * Unit tests for editor-store.ts
 *
 * Covers dirty-tracking and in-memory file content overrides.
 * These are pure Zustand state mutations with no Tauri or DOM
 * dependencies, so they run in the jsdom environment without
 * any mocking overhead.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore } from "@/state/editor-store";

/** Reset mutable state before each test so tests are independent. */
beforeEach(() => {
  useEditorStore.setState({
    dirtyFiles: new Set<string>(),
    fileContents: new Map<string, string>(),
  });
});

// ── Dirty tracking ─────────────────────────────────────────────────────────

describe("dirtyFiles — initial state", () => {
  it("starts with no dirty files", () => {
    expect(useEditorStore.getState().dirtyFiles.size).toBe(0);
  });
});

describe("markDirty", () => {
  it("adds a file id to the dirty set", () => {
    useEditorStore.getState().markDirty("file-1");
    expect(useEditorStore.getState().dirtyFiles.has("file-1")).toBe(true);
  });

  it("is idempotent — calling twice keeps set size at 1", () => {
    const { markDirty } = useEditorStore.getState();
    markDirty("file-1");
    markDirty("file-1");
    expect(useEditorStore.getState().dirtyFiles.size).toBe(1);
  });

  it("does not mutate the previous set reference (immutability)", () => {
    const before = useEditorStore.getState().dirtyFiles;
    useEditorStore.getState().markDirty("file-1");
    expect(useEditorStore.getState().dirtyFiles).not.toBe(before);
  });

  it("tracks multiple file ids independently", () => {
    const { markDirty } = useEditorStore.getState();
    markDirty("a");
    markDirty("b");
    const { dirtyFiles } = useEditorStore.getState();
    expect(dirtyFiles.has("a")).toBe(true);
    expect(dirtyFiles.has("b")).toBe(true);
    expect(dirtyFiles.size).toBe(2);
  });
});

describe("markClean", () => {
  it("removes a dirty file from the set", () => {
    useEditorStore.getState().markDirty("file-1");
    useEditorStore.getState().markClean("file-1");
    expect(useEditorStore.getState().dirtyFiles.has("file-1")).toBe(false);
  });

  it("is a no-op and returns the same set reference when file is already clean", () => {
    const before = useEditorStore.getState().dirtyFiles;
    useEditorStore.getState().markClean("nonexistent");
    expect(useEditorStore.getState().dirtyFiles).toBe(before);
  });

  it("only removes the targeted file, leaving others dirty", () => {
    const { markDirty, markClean } = useEditorStore.getState();
    markDirty("a");
    markDirty("b");
    markClean("a");
    const { dirtyFiles } = useEditorStore.getState();
    expect(dirtyFiles.has("a")).toBe(false);
    expect(dirtyFiles.has("b")).toBe(true);
  });
});

// ── In-memory file content ─────────────────────────────────────────────────

describe("fileContents — initial state", () => {
  it("starts with no overrides", () => {
    expect(useEditorStore.getState().fileContents.size).toBe(0);
  });
});

describe("setFileContent", () => {
  it("stores content for a given id", () => {
    useEditorStore.getState().setFileContent("file-1", "hello world");
    expect(useEditorStore.getState().fileContents.get("file-1")).toBe("hello world");
  });

  it("overwrites previous content for the same id", () => {
    const { setFileContent } = useEditorStore.getState();
    setFileContent("file-1", "v1");
    setFileContent("file-1", "v2");
    expect(useEditorStore.getState().fileContents.get("file-1")).toBe("v2");
  });

  it("does not mutate the previous map reference (immutability)", () => {
    const before = useEditorStore.getState().fileContents;
    useEditorStore.getState().setFileContent("file-1", "data");
    expect(useEditorStore.getState().fileContents).not.toBe(before);
  });

  it("stores multiple files independently", () => {
    const { setFileContent } = useEditorStore.getState();
    setFileContent("a", "alpha");
    setFileContent("b", "beta");
    const { fileContents } = useEditorStore.getState();
    expect(fileContents.get("a")).toBe("alpha");
    expect(fileContents.get("b")).toBe("beta");
  });
});

describe("getFileContent", () => {
  it("retrieves content set by setFileContent", () => {
    useEditorStore.getState().setFileContent("file-2", "# Heading");
    expect(useEditorStore.getState().getFileContent("file-2")).toBe("# Heading");
  });

  it("returns undefined for an id that was never set", () => {
    expect(useEditorStore.getState().getFileContent("never-set")).toBeUndefined();
  });

  it("returns undefined after store reset", () => {
    useEditorStore.getState().setFileContent("file-1", "data");
    useEditorStore.setState({ fileContents: new Map() });
    expect(useEditorStore.getState().getFileContent("file-1")).toBeUndefined();
  });
});

// ── Interaction between dirty tracking and content ─────────────────────────

describe("dirty + content interaction", () => {
  it("a file can be dirty and also have in-memory content", () => {
    const { markDirty, setFileContent } = useEditorStore.getState();
    markDirty("file-1");
    setFileContent("file-1", "unsaved edit");
    const state = useEditorStore.getState();
    expect(state.dirtyFiles.has("file-1")).toBe(true);
    expect(state.getFileContent("file-1")).toBe("unsaved edit");
  });

  it("markClean does not remove in-memory content", () => {
    const { markDirty, markClean, setFileContent } = useEditorStore.getState();
    markDirty("file-1");
    setFileContent("file-1", "content");
    markClean("file-1");
    expect(useEditorStore.getState().getFileContent("file-1")).toBe("content");
  });
});
