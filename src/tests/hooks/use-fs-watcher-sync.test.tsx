/**
 * Unit tests for `useFsWatcherSync`.
 *
 * Focus: the cache-eviction policy + tree-refresh debounce. The
 * hook short-circuits when `isTauri` is false, so we mock the
 * bindings module to force it on and capture the listener
 * registered against `@tauri-apps/api/event`.
 */
import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/bindings", async () => {
  const actual =
    await vi.importActual<typeof import("@/bindings")>("@/bindings");
  return {
    ...actual,
    isTauri: true,
    getVaultInfo: vi.fn(async () => ({
      path: "/tmp/test-vault",
      name: "test-vault",
      fileCount: 0,
      openedAt: 0,
    })),
    getFileTree: vi.fn(async () => []),
  };
});

// Capture the listener registered by the hook so we can drive it
// from test cases.
let lastListener: ((event: { payload: unknown }) => void) | undefined;
const unlistenMock = vi.fn();

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_name: string, cb: (event: unknown) => void) => {
    lastListener = cb as (event: { payload: unknown }) => void;
    return unlistenMock;
  }),
}));

import { useFsWatcherSync } from "@/hooks/use-fs-watcher-sync";
import { useVaultStore } from "@/state/vault-store";

function resetStore() {
  useVaultStore.setState(
    {
      vaultHandle: null,
      isVaultOpen: false,
      fileTree: [],
      isLoadingTree: false,
      openFiles: new Map(),
      dirtyFiles: new Set(),
    },
    false,
  );
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  lastListener = undefined;
  unlistenMock.mockClear();
  resetStore();
});

afterEach(() => {
  vi.useRealTimers();
});

async function emit(payload: { changed: string[]; removed: string[] }) {
  await act(async () => {
    lastListener?.({ payload });
  });
  await flushMicrotasks();
}

describe("file-cache eviction", () => {
  it("drops the cached buffer for an externally-modified non-dirty file", async () => {
    renderHook(() => useFsWatcherSync());
    await flushMicrotasks();

    act(() => {
      const s = useVaultStore.getState();
      s.setFileContent("notes/a.md", "on-disk body");
      // not dirty — user hasn't typed since last load
    });

    await emit({ changed: ["notes/a.md"], removed: [] });

    expect(useVaultStore.getState().openFiles.has("notes/a.md")).toBe(false);
  });

  it("PROTECTS dirty buffers from external-change eviction", async () => {
    renderHook(() => useFsWatcherSync());
    await flushMicrotasks();

    act(() => {
      const s = useVaultStore.getState();
      s.setFileContent("notes/a.md", "my unsaved edits");
      s.markDirty("notes/a.md");
    });

    await emit({ changed: ["notes/a.md"], removed: [] });

    expect(useVaultStore.getState().openFiles.get("notes/a.md")).toBe(
      "my unsaved edits",
    );
  });

  it("ALWAYS evicts deleted-file buffers, even when dirty", async () => {
    // Rationale: the user has no way to recover the on-disk content;
    // continuing to show in-memory edits for a path that no longer
    // exists would be more confusing than dropping the buffer.
    renderHook(() => useFsWatcherSync());
    await flushMicrotasks();

    act(() => {
      const s = useVaultStore.getState();
      s.setFileContent("notes/a.md", "edits that will never persist");
      s.markDirty("notes/a.md");
    });

    await emit({ changed: [], removed: ["notes/a.md"] });

    expect(useVaultStore.getState().openFiles.has("notes/a.md")).toBe(false);
  });

  it("ignores changes for files not currently cached", async () => {
    renderHook(() => useFsWatcherSync());
    await flushMicrotasks();
    // No openFiles populated — emit should be a no-op for cache.
    await emit({ changed: ["notes/never-opened.md"], removed: [] });
    expect(useVaultStore.getState().openFiles.size).toBe(0);
  });
});

describe("tree-refresh debounce", () => {
  it("skips refresh when only content of existing files changed", async () => {
    const { getFileTree } = await import("@/bindings");
    const treeMock = getFileTree as unknown as ReturnType<typeof vi.fn>;
    treeMock.mockClear();

    // Seed fileTree with a single file so `currentPaths` knows it.
    useVaultStore.setState({
      fileTree: [{ id: "notes/a.md", name: "a.md", kind: "file" }],
    });

    renderHook(() => useFsWatcherSync());
    await flushMicrotasks();

    await emit({ changed: ["notes/a.md"], removed: [] });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    // No new path appeared, nothing removed → no refresh.
    expect(treeMock).not.toHaveBeenCalled();
  });

  it("refreshes the tree when a new file appears", async () => {
    const { getFileTree } = await import("@/bindings");
    const treeMock = getFileTree as unknown as ReturnType<typeof vi.fn>;
    treeMock.mockClear();

    useVaultStore.setState({
      fileTree: [{ id: "notes/a.md", name: "a.md", kind: "file" }],
    });
    renderHook(() => useFsWatcherSync());
    await flushMicrotasks();

    await emit({ changed: ["notes/brand-new.md"], removed: [] });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    await flushMicrotasks();

    expect(treeMock).toHaveBeenCalled();
  });

  it("refreshes the tree when a known file is removed", async () => {
    const { getFileTree } = await import("@/bindings");
    const treeMock = getFileTree as unknown as ReturnType<typeof vi.fn>;
    treeMock.mockClear();

    useVaultStore.setState({
      fileTree: [{ id: "notes/a.md", name: "a.md", kind: "file" }],
    });
    renderHook(() => useFsWatcherSync());
    await flushMicrotasks();

    await emit({ changed: [], removed: ["notes/a.md"] });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    await flushMicrotasks();

    expect(treeMock).toHaveBeenCalled();
  });
});

describe("lifecycle", () => {
  it("unlistens on unmount", async () => {
    const { unmount } = renderHook(() => useFsWatcherSync());
    await flushMicrotasks();
    expect(unlistenMock).not.toHaveBeenCalled();
    act(() => unmount());
    expect(unlistenMock).toHaveBeenCalled();
  });
});
