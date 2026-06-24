/**
 * Unit tests for `useLinkIndexer`.
 *
 * Focus on the bulk-scan → incremental-patch race: watcher events
 * fired BEFORE the initial scan completes must not patch a stale
 * snapshot that gets overwritten by `bulkReplace`. The hook gates
 * the listener on `useLinkIndexStore.hydrated`.
 */
import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LinkScanResult } from "@/bindings";

// `vi.mock` is hoisted ABOVE all imports — so the factory can't see
// module-scope `let`/`const`. Use `vi.hoisted` to share state.
const mocks = vi.hoisted(() => {
  let bulkResolve: ((value: unknown) => void) | undefined;
  return {
    scanVaultLinks: vi.fn(
      () =>
        new Promise<unknown>((resolve) => {
          bulkResolve = resolve;
        }),
    ),
    scanVaultLinksSubset: vi.fn(async (_: string[]) => ({
      files: [],
      links: [],
      tags: [],
      scannedFiles: 0,
      skippedTooLarge: 0,
    })),
    resolveBulk: (value: unknown) => {
      bulkResolve?.(value);
      bulkResolve = undefined;
    },
    resetBulk: () => {
      bulkResolve = undefined;
    },
  };
});

const scanVaultLinksMock = mocks.scanVaultLinks;
const scanVaultLinksSubsetMock = mocks.scanVaultLinksSubset;

vi.mock("@/bindings", async () => {
  const actual =
    await vi.importActual<typeof import("@/bindings")>("@/bindings");
  return {
    ...actual,
    isTauri: true,
    scanVaultLinks: mocks.scanVaultLinks,
    scanVaultLinksSubset: mocks.scanVaultLinksSubset,
  };
});

// Capture the watcher listener so tests can fire events.
const listenState = vi.hoisted(() => {
  return {
    listener: undefined as
      | ((event: { payload: { changed: string[]; removed: string[] } }) => void)
      | undefined,
    unlisten: vi.fn(),
  };
});

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_name: string, cb: (event: unknown) => void) => {
    listenState.listener = cb as typeof listenState.listener;
    return listenState.unlisten;
  }),
}));

import { useLinkIndexer } from "@/hooks/use-link-indexer";
import { useLinkIndexStore } from "@/state/link-index-store";
import { useVaultStore } from "@/state/vault-store";

function resetStores() {
  useLinkIndexStore.setState(
    {
      files: new Set(),
      links: [],
      tags: [],
      backlinksBy: new Map(),
      tagsBy: new Map(),
      hydrated: false,
      scanning: false,
    },
    false,
  );
  useVaultStore.setState({ isVaultOpen: false }, false);
}

function emptyResult(files: string[] = []): LinkScanResult {
  return {
    files,
    links: [],
    tags: [],
    scannedFiles: files.length,
    skippedTooLarge: 0,
  };
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.resetBulk();
  listenState.listener = undefined;
  listenState.unlisten.mockClear();
  scanVaultLinksMock.mockClear();
  scanVaultLinksSubsetMock.mockClear();
  resetStores();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("vault open → bulk scan", () => {
  it("calls scanVaultLinks once when the vault opens", async () => {
    renderHook(() => useLinkIndexer());

    act(() => {
      useVaultStore.setState({ isVaultOpen: true }, false);
    });
    await flushMicrotasks();

    expect(scanVaultLinksMock).toHaveBeenCalledTimes(1);
  });

  it("flips `hydrated` to true once the scan resolves", async () => {
    renderHook(() => useLinkIndexer());
    act(() => {
      useVaultStore.setState({ isVaultOpen: true }, false);
    });
    await flushMicrotasks();
    expect(useLinkIndexStore.getState().hydrated).toBe(false);

    await act(async () => {
      mocks.resolveBulk(emptyResult(["a.md"]));
      await Promise.resolve();
    });

    expect(useLinkIndexStore.getState().hydrated).toBe(true);
  });

  it("clears the index when the vault closes", async () => {
    renderHook(() => useLinkIndexer());
    act(() => {
      useVaultStore.setState({ isVaultOpen: true }, false);
    });
    await flushMicrotasks();
    await act(async () => {
      mocks.resolveBulk(emptyResult(["a.md"]));
      await Promise.resolve();
    });
    expect(useLinkIndexStore.getState().hydrated).toBe(true);

    act(() => {
      useVaultStore.setState({ isVaultOpen: false }, false);
    });
    await flushMicrotasks();

    expect(useLinkIndexStore.getState().hydrated).toBe(false);
    expect(useLinkIndexStore.getState().links).toHaveLength(0);
  });
});

describe("watcher race protection", () => {
  it("does NOT register the watcher listener until the bulk scan completes", async () => {
    const { listen } = await import("@tauri-apps/api/event");
    const listenMock = listen as unknown as ReturnType<typeof vi.fn>;
    listenMock.mockClear();

    renderHook(() => useLinkIndexer());
    act(() => {
      useVaultStore.setState({ isVaultOpen: true }, false);
    });
    await flushMicrotasks();

    // Bulk scan is still pending — `hydrated === false`, so the
    // incremental-patch effect short-circuits before calling
    // `listen()`.
    expect(listenMock).not.toHaveBeenCalled();

    // Now resolve the scan and observe the listener gets attached.
    await act(async () => {
      mocks.resolveBulk(emptyResult(["a.md"]));
      await Promise.resolve();
    });
    await flushMicrotasks();

    expect(listenMock).toHaveBeenCalledTimes(1);
  });

  it("processes watcher events only AFTER hydration so patches survive bulkReplace", async () => {
    renderHook(() => useLinkIndexer());
    act(() => {
      useVaultStore.setState({ isVaultOpen: true }, false);
    });
    await flushMicrotasks();

    // Resolve the bulk scan first.
    await act(async () => {
      mocks.resolveBulk(emptyResult([]));
      await Promise.resolve();
    });
    await flushMicrotasks();

    // Now the listener exists. Emit a watcher event for an .md file.
    await act(async () => {
      listenState.listener!({ payload: { changed: ["notes/b.md"], removed: [] } });
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    await flushMicrotasks();

    expect(scanVaultLinksSubsetMock).toHaveBeenCalledWith(["notes/b.md"]);
  });
});

describe("subset patch filtering", () => {
  it("filters non-markdown paths out of the subset call", async () => {
    renderHook(() => useLinkIndexer());
    act(() => {
      useVaultStore.setState({ isVaultOpen: true }, false);
    });
    await flushMicrotasks();
    await act(async () => {
      mocks.resolveBulk(emptyResult([]));
      await Promise.resolve();
    });
    await flushMicrotasks();

    await act(async () => {
      listenState.listener!({
        payload: {
          changed: ["notes/a.md", "notes/cover.png", "doc.pdf"],
          removed: ["old.txt"],
        },
      });
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    await flushMicrotasks();

    expect(scanVaultLinksSubsetMock).toHaveBeenCalledTimes(1);
    expect(scanVaultLinksSubsetMock).toHaveBeenCalledWith(["notes/a.md"]);
  });

  it("uppercase .MD extensions still trigger a patch (case-insensitive)", async () => {
    renderHook(() => useLinkIndexer());
    act(() => {
      useVaultStore.setState({ isVaultOpen: true }, false);
    });
    await flushMicrotasks();
    await act(async () => {
      mocks.resolveBulk(emptyResult([]));
      await Promise.resolve();
    });
    await flushMicrotasks();

    await act(async () => {
      listenState.listener!({ payload: { changed: ["notes/A.MD"], removed: [] } });
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    await flushMicrotasks();

    expect(scanVaultLinksSubsetMock).toHaveBeenCalledWith(["notes/A.MD"]);
  });
});
