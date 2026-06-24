/**
 * Unit tests for `tab-sync-store` — a tiny bridge store that
 * registers callback handlers from the shell layer for use by
 * file-operation hooks.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getTabSyncHandlers,
  useTabSyncStore,
} from "@/state/tab-sync-store";

beforeEach(() => {
  useTabSyncStore.setState({ handlers: null, activeFile: null });
});

describe("handlers registry", () => {
  it("starts empty", () => {
    expect(useTabSyncStore.getState().handlers).toBeNull();
    expect(getTabSyncHandlers()).toBeNull();
  });

  it("setHandlers stores both callbacks", () => {
    const closeTabsForFile = vi.fn();
    const renameTabFile = vi.fn();
    useTabSyncStore.getState().setHandlers({ closeTabsForFile, renameTabFile });
    const h = getTabSyncHandlers();
    expect(h).not.toBeNull();
    h!.closeTabsForFile("/foo.md");
    h!.renameTabFile("/old.md", "/new.md", "new");
    expect(closeTabsForFile).toHaveBeenCalledWith("/foo.md");
    expect(renameTabFile).toHaveBeenCalledWith("/old.md", "/new.md", "new");
  });

  it("setHandlers(null) clears the registry", () => {
    useTabSyncStore
      .getState()
      .setHandlers({ closeTabsForFile: vi.fn(), renameTabFile: vi.fn() });
    useTabSyncStore.getState().setHandlers(null);
    expect(useTabSyncStore.getState().handlers).toBeNull();
  });
});

describe("activeFile", () => {
  it("setActiveFile updates the focused tab metadata", () => {
    useTabSyncStore
      .getState()
      .setActiveFile({ fileId: "/foo.md", title: "Foo" });
    expect(useTabSyncStore.getState().activeFile).toEqual({
      fileId: "/foo.md",
      title: "Foo",
    });
  });

  it("setActiveFile(null) clears the focused tab", () => {
    useTabSyncStore
      .getState()
      .setActiveFile({ fileId: "/foo.md", title: "Foo" });
    useTabSyncStore.getState().setActiveFile(null);
    expect(useTabSyncStore.getState().activeFile).toBeNull();
  });
});
