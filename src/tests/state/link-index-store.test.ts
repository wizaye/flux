/**
 * Unit tests for `link-index-store`.
 *
 * Exercises bulk replace, incremental patch, inverse-map rebuild,
 * and the public selectors used by the right-sidebar panels +
 * graph view. No Tauri / DOM dependencies — the store is pure
 * data so we drive it with a synthesised `LinkScanResult`.
 */
import { beforeEach, describe, expect, it } from "vitest";

import {
  selectBacklinks,
  selectOutgoing,
  useLinkIndexStore,
} from "@/state/link-index-store";
import type { LinkRef, TagRef } from "@/bindings";

function ref(
  from: string,
  line: number,
  target: string,
  opts: Partial<LinkRef> = {},
): LinkRef {
  return {
    from,
    line,
    target,
    targetNorm: target.toLowerCase().replace(/\\/g, "/").replace(/\.md$/, ""),
    kind: opts.kind ?? "wiki",
    snippet: opts.snippet ?? `line about ${target}`,
  };
}

function tag(from: string, line: number, name: string): TagRef {
  return { from, line, tag: name };
}

const RESET_STATE = useLinkIndexStore.getState();

beforeEach(() => {
  // Restore baseline so test order can't bleed state across cases.
  useLinkIndexStore.setState(
    {
      ...RESET_STATE,
      files: new Set(),
      links: [],
      tags: [],
      backlinksBy: new Map(),
      tagsBy: new Map(),
      hydrated: false,
      scanning: false,
    },
    true,
  );
});

describe("bulkReplace", () => {
  it("populates files, links, tags and marks hydrated", () => {
    useLinkIndexStore.getState().bulkReplace({
      files: ["notes/a.md", "notes/b.md"],
      links: [ref("notes/a.md", 3, "b")],
      tags: [tag("notes/a.md", 5, "draft")],
      scannedFiles: 2,
      skippedTooLarge: 0,
    });
    const s = useLinkIndexStore.getState();
    expect(s.files.has("notes/a.md")).toBe(true);
    expect(s.files.has("notes/b.md")).toBe(true);
    expect(s.links).toHaveLength(1);
    expect(s.tags).toHaveLength(1);
    expect(s.hydrated).toBe(true);
  });

  it("indexes backlinks by both full norm and basename", () => {
    useLinkIndexStore.getState().bulkReplace({
      files: ["notes/a.md", "notes/sub/b.md"],
      links: [ref("notes/a.md", 1, "sub/b")],
      tags: [],
      scannedFiles: 2,
      skippedTooLarge: 0,
    });
    const s = useLinkIndexStore.getState();
    // Full norm match
    expect(s.backlinksBy.get("sub/b")).toHaveLength(1);
    // Basename match (so `[[b]]` from another note would still hit
    // when scanned with the same target value).
    expect(s.backlinksBy.get("b")).toHaveLength(1);
  });

  it("normalises backslashes to forward slashes in the file set", () => {
    useLinkIndexStore.getState().bulkReplace({
      files: ["notes\\windows.md"],
      links: [],
      tags: [],
      scannedFiles: 1,
      skippedTooLarge: 0,
    });
    expect(useLinkIndexStore.getState().files.has("notes/windows.md")).toBe(
      true,
    );
  });
});

describe("patch", () => {
  it("removes prior rows for touched files before appending new ones", () => {
    useLinkIndexStore.getState().bulkReplace({
      files: ["a.md", "b.md"],
      links: [ref("a.md", 1, "b"), ref("a.md", 2, "c")],
      tags: [tag("a.md", 3, "x")],
      scannedFiles: 2,
      skippedTooLarge: 0,
    });
    useLinkIndexStore.getState().patch({
      files: ["a.md"],
      links: [ref("a.md", 7, "z")],
      tags: [tag("a.md", 8, "y")],
      scannedFiles: 1,
      skippedTooLarge: 0,
    });
    const s = useLinkIndexStore.getState();
    // Old links from a.md gone, new one present.
    const fromA = s.links.filter((l) => l.from === "a.md");
    expect(fromA).toHaveLength(1);
    expect(fromA[0].target).toBe("z");
    // Tags for a.md replaced too.
    expect(s.tags).toHaveLength(1);
    expect(s.tags[0].tag).toBe("y");
  });

  it("keeps untouched files intact on a partial patch", () => {
    useLinkIndexStore.getState().bulkReplace({
      files: ["a.md", "b.md"],
      links: [ref("a.md", 1, "b"), ref("b.md", 1, "a")],
      tags: [],
      scannedFiles: 2,
      skippedTooLarge: 0,
    });
    useLinkIndexStore.getState().patch({
      files: ["a.md"],
      links: [],
      tags: [],
      scannedFiles: 1,
      skippedTooLarge: 0,
    });
    // b.md → a.md should survive even though a.md was scanned away.
    const survivors = useLinkIndexStore.getState().links;
    expect(survivors).toHaveLength(1);
    expect(survivors[0].from).toBe("b.md");
  });
});

describe("reset", () => {
  it("clears all state and hydration", () => {
    useLinkIndexStore.getState().bulkReplace({
      files: ["a.md"],
      links: [ref("a.md", 1, "b")],
      tags: [tag("a.md", 2, "x")],
      scannedFiles: 1,
      skippedTooLarge: 0,
    });
    useLinkIndexStore.getState().reset();
    const s = useLinkIndexStore.getState();
    expect(s.files.size).toBe(0);
    expect(s.links).toHaveLength(0);
    expect(s.tags).toHaveLength(0);
    expect(s.hydrated).toBe(false);
  });
});

describe("setScanning", () => {
  it("toggles the scanning flag", () => {
    useLinkIndexStore.getState().setScanning(true);
    expect(useLinkIndexStore.getState().scanning).toBe(true);
    useLinkIndexStore.getState().setScanning(false);
    expect(useLinkIndexStore.getState().scanning).toBe(false);
  });
});

describe("selectBacklinks", () => {
  beforeEach(() => {
    useLinkIndexStore.getState().bulkReplace({
      files: ["notes/a.md", "notes/b.md", "notes/sub/foo.md"],
      links: [
        ref("notes/a.md", 1, "b"),
        ref("notes/a.md", 2, "sub/foo"),
        ref("notes/b.md", 1, "foo"),
        ref("notes/b.md", 2, "b"), // self-ref — should be filtered
      ],
      tags: [],
      scannedFiles: 3,
      skippedTooLarge: 0,
    });
  });

  it("returns empty list for null fileId", () => {
    expect(
      selectBacklinks(useLinkIndexStore.getState(), null),
    ).toHaveLength(0);
  });

  it("matches by full normalised path", () => {
    const refs = selectBacklinks(
      useLinkIndexStore.getState(),
      "notes/sub/foo.md",
    );
    // a.md → sub/foo AND b.md → foo (basename match) both hit.
    expect(refs).toHaveLength(2);
    expect(refs.map((r) => r.from).sort()).toEqual([
      "notes/a.md",
      "notes/b.md",
    ]);
  });

  it("excludes self-references", () => {
    const refs = selectBacklinks(useLinkIndexStore.getState(), "notes/b.md");
    expect(refs.every((r) => r.from !== "notes/b.md")).toBe(true);
  });
});

describe("selectOutgoing", () => {
  it("returns only links originating from the given path", () => {
    useLinkIndexStore.getState().bulkReplace({
      files: ["a.md", "b.md"],
      links: [
        ref("a.md", 1, "b"),
        ref("a.md", 2, "c"),
        ref("b.md", 1, "a"),
      ],
      tags: [],
      scannedFiles: 2,
      skippedTooLarge: 0,
    });
    const out = selectOutgoing(useLinkIndexStore.getState(), "a.md");
    expect(out).toHaveLength(2);
    expect(out.every((l) => l.from === "a.md")).toBe(true);
  });

  it("normalises slashes before comparing", () => {
    useLinkIndexStore.getState().bulkReplace({
      files: ["notes/a.md"],
      links: [ref("notes/a.md", 1, "b")],
      tags: [],
      scannedFiles: 1,
      skippedTooLarge: 0,
    });
    const out = selectOutgoing(
      useLinkIndexStore.getState(),
      "notes\\a.md",
    );
    expect(out).toHaveLength(1);
  });
});
