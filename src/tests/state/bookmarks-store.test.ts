/**
 * Unit tests for `bookmarks-store`.
 *
 * Backed by localStorage (jsdom provides one) and keyed on the
 * active vault — we drive the vault store directly to simulate
 * a vault being open.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { selectBookmarksByGroup, useBookmarksStore } from "@/state/bookmarks-store";
import { useVaultStore } from "@/state/vault-store";

const VAULT = "/tmp/test-vault";

beforeEach(() => {
  localStorage.clear();
  useVaultStore.setState({
    vaultHandle: {
      path: VAULT,
      name: "test",
      fileCount: 0,
      openedAt: 0,
    },
    fileTree: [],
    isVaultOpen: true,
  });
  useBookmarksStore.getState().reload();
});

describe("upsert / has / remove", () => {
  it("starts with no bookmarks", () => {
    expect(useBookmarksStore.getState().entries).toHaveLength(0);
    expect(useBookmarksStore.getState().has("/foo.md")).toBe(false);
  });

  it("adds a bookmark via upsert", () => {
    useBookmarksStore.getState().upsert({ id: "/foo.md", title: "Foo" });
    expect(useBookmarksStore.getState().has("/foo.md")).toBe(true);
    const entry = useBookmarksStore
      .getState()
      .entries.find((e) => e.id === "/foo.md");
    expect(entry?.title).toBe("Foo");
  });

  it("updates an existing bookmark on second upsert", () => {
    useBookmarksStore.getState().upsert({ id: "/foo.md", title: "Foo" });
    useBookmarksStore
      .getState()
      .upsert({ id: "/foo.md", title: "Foo (renamed)", group: "Inbox" });
    const entries = useBookmarksStore.getState().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe("Foo (renamed)");
    expect(entries[0].group).toBe("Inbox");
  });

  it("removes a bookmark by id", () => {
    useBookmarksStore.getState().upsert({ id: "/foo.md" });
    useBookmarksStore.getState().remove("/foo.md");
    expect(useBookmarksStore.getState().has("/foo.md")).toBe(false);
  });
});

describe("toggle", () => {
  it("adds when missing, removes when present, returns new state", () => {
    const before = useBookmarksStore.getState().toggle("/foo.md");
    expect(before).toBe(true);
    expect(useBookmarksStore.getState().has("/foo.md")).toBe(true);

    const after = useBookmarksStore.getState().toggle("/foo.md");
    expect(after).toBe(false);
    expect(useBookmarksStore.getState().has("/foo.md")).toBe(false);
  });
});

describe("rename", () => {
  it("rewrites the id and preserves metadata", () => {
    useBookmarksStore
      .getState()
      .upsert({ id: "/old.md", title: "Old", group: "Inbox" });
    useBookmarksStore.getState().rename("/old.md", "/new.md");
    expect(useBookmarksStore.getState().has("/old.md")).toBe(false);
    expect(useBookmarksStore.getState().has("/new.md")).toBe(true);
    const entry = useBookmarksStore
      .getState()
      .entries.find((e) => e.id === "/new.md");
    expect(entry?.title).toBe("Old");
    expect(entry?.group).toBe("Inbox");
  });

  it("no-ops when the old id doesn't exist", () => {
    useBookmarksStore.getState().rename("/missing.md", "/new.md");
    expect(useBookmarksStore.getState().entries).toHaveLength(0);
  });
});

describe("groups", () => {
  it("addGroup appends, dedupes, and skips empty input", () => {
    useBookmarksStore.getState().addGroup("Inbox");
    useBookmarksStore.getState().addGroup("Inbox"); // duplicate
    useBookmarksStore.getState().addGroup("   "); // whitespace
    expect(useBookmarksStore.getState().groups).toEqual(["Inbox"]);
  });

  it("upsert with a new group auto-creates the group", () => {
    useBookmarksStore
      .getState()
      .upsert({ id: "/foo.md", group: "Auto" });
    expect(useBookmarksStore.getState().groups).toContain("Auto");
  });

  it("removeGroup clears the group string from members", () => {
    useBookmarksStore.getState().upsert({ id: "/foo.md", group: "Inbox" });
    useBookmarksStore.getState().removeGroup("Inbox");
    expect(useBookmarksStore.getState().groups).not.toContain("Inbox");
  });
});

describe("persistence", () => {
  it("survives a reload from localStorage", () => {
    useBookmarksStore.getState().upsert({ id: "/foo.md", title: "Foo" });
    useBookmarksStore.getState().reload();
    expect(useBookmarksStore.getState().has("/foo.md")).toBe(true);
  });

  it("migrates legacy flat-string-array shape", () => {
    const key =
      "flux.bookmarks." + encodeURIComponent(VAULT);
    localStorage.setItem(key, JSON.stringify(["/legacy.md", "/old.md"]));
    useBookmarksStore.getState().reload();
    expect(useBookmarksStore.getState().entries.map((e) => e.id)).toEqual([
      "/legacy.md",
      "/old.md",
    ]);
  });

  it("isolates bookmarks per vault path", () => {
    useBookmarksStore.getState().upsert({ id: "/foo.md" });
    // Swap vault — reload should give a fresh empty list.
    useVaultStore.setState({
      vaultHandle: {
        path: "/tmp/other-vault",
        name: "other",
        fileCount: 0,
        openedAt: 0,
      },
      isVaultOpen: true,
    });
    useBookmarksStore.getState().reload();
    expect(useBookmarksStore.getState().entries).toHaveLength(0);

    // Back to original — bookmark survives.
    useVaultStore.setState({
      vaultHandle: {
        path: VAULT,
        name: "test",
        fileCount: 0,
        openedAt: 0,
      },
      isVaultOpen: true,
    });
    useBookmarksStore.getState().reload();
    expect(useBookmarksStore.getState().has("/foo.md")).toBe(true);
  });
});

describe("selectBookmarksByGroup", () => {
  it("empty store returns a single empty Untitled bucket", () => {
    const groups = selectBookmarksByGroup({ entries: [], groups: [] });
    expect(groups).toEqual([{ name: "", entries: [] }]);
  });

  it("groups entries by their `group` field, ordering by store.groups", () => {
    useBookmarksStore.getState().addGroup("Inbox");
    useBookmarksStore.getState().addGroup("Reading");
    useBookmarksStore.getState().upsert({ id: "/a.md", group: "Reading" });
    useBookmarksStore.getState().upsert({ id: "/b.md", group: "Inbox" });
    useBookmarksStore.getState().upsert({ id: "/c.md" }); // untitled

    const groups = selectBookmarksByGroup(useBookmarksStore.getState());
    expect(groups.map((g) => g.name)).toEqual(["Inbox", "Reading", ""]);
    expect(groups[0].entries.map((e) => e.id)).toEqual(["/b.md"]);
    expect(groups[1].entries.map((e) => e.id)).toEqual(["/a.md"]);
    expect(groups[2].entries.map((e) => e.id)).toEqual(["/c.md"]);
  });

  it("includes entries pointing at a group that was never registered (orphans)", () => {
    useBookmarksStore.getState().upsert({ id: "/x.md", group: "Ghost" });
    const groups = selectBookmarksByGroup(useBookmarksStore.getState());
    const ghost = groups.find((g) => g.name === "Ghost");
    expect(ghost?.entries).toHaveLength(1);
  });
});

describe("legacy migration corner cases", () => {
  it("ignores garbage / non-array / non-object stored values", () => {
    const key = "flux.bookmarks." + encodeURIComponent(VAULT);
    localStorage.setItem(key, "not-json");
    useBookmarksStore.getState().reload();
    expect(useBookmarksStore.getState().entries).toEqual([]);
    expect(useBookmarksStore.getState().groups).toEqual([]);

    localStorage.setItem(key, JSON.stringify({ unexpected: "shape" }));
    useBookmarksStore.getState().reload();
    expect(useBookmarksStore.getState().entries).toEqual([]);
  });
});