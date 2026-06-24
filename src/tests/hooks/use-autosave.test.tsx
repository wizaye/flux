/**
 * Unit tests for `useAutosave`.
 *
 * Drives the vault-store directly to simulate "user is typing" and
 * verifies the hook:
 *   • Debounces writes to disk (single write per idle window even on
 *     rapid changes).
 *   • Skips files whose buffer has been evicted (external-edit case).
 *   • Leaves files dirty on save failure so the next keystroke
 *     re-schedules.
 *   • Flushes immediately on window blur, visibility hidden, and
 *     beforeunload.
 *   • Final-flushes on unmount.
 *
 * The `@/bindings` module is mocked so we can intercept `writeFile`
 * calls and force `isTauri = true` (jsdom doesn't expose the Tauri
 * internals).
 */
import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/bindings", async () => {
  const actual =
    await vi.importActual<typeof import("@/bindings")>("@/bindings");
  return {
    ...actual,
    isTauri: true,
    writeFile: vi.fn(async () => undefined),
  };
});

// Imported AFTER vi.mock so the hook + sonner see the mocked
// bindings module.
import * as backend from "@/bindings";
import {
  AUTOSAVE_DEBOUNCE_MS,
  useAutosave,
} from "@/hooks/use-autosave";
import { useVaultStore } from "@/state/vault-store";

const writeFileMock = backend.writeFile as unknown as ReturnType<typeof vi.fn>;

function resetVaultStore() {
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

beforeEach(() => {
  vi.useFakeTimers();
  writeFileMock.mockClear();
  writeFileMock.mockResolvedValue(undefined);
  resetVaultStore();
});

afterEach(() => {
  vi.useRealTimers();
});

async function flushPromises() {
  // Let queued microtasks (Promise.all in the hook's flush) run.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("debounced autosave", () => {
  it("does not write before the idle window elapses", () => {
    renderHook(() => useAutosave());

    act(() => {
      const s = useVaultStore.getState();
      s.setFileContent("notes/a.md", "draft");
      s.markDirty("notes/a.md");
    });

    act(() => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS - 1);
    });

    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it("writes once after the idle window for a single dirty file", async () => {
    renderHook(() => useAutosave());

    act(() => {
      const s = useVaultStore.getState();
      s.setFileContent("notes/a.md", "hello");
      s.markDirty("notes/a.md");
    });

    act(() => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
    });
    await flushPromises();

    expect(writeFileMock).toHaveBeenCalledTimes(1);
    expect(writeFileMock).toHaveBeenCalledWith("notes/a.md", "hello");
    expect(useVaultStore.getState().dirtyFiles.size).toBe(0);
  });

  it("coalesces rapid keystrokes into a single write of the latest content", async () => {
    renderHook(() => useAutosave());

    for (const c of ["h", "he", "hel", "hell", "hello"]) {
      act(() => {
        const s = useVaultStore.getState();
        s.setFileContent("notes/a.md", c);
        s.markDirty("notes/a.md");
        vi.advanceTimersByTime(100); // each keystroke 100ms apart
      });
    }

    act(() => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
    });
    await flushPromises();

    expect(writeFileMock).toHaveBeenCalledTimes(1);
    expect(writeFileMock).toHaveBeenCalledWith("notes/a.md", "hello");
  });

  it("writes every dirty file in one batch when the debounce fires", async () => {
    renderHook(() => useAutosave());

    act(() => {
      const s = useVaultStore.getState();
      s.setFileContent("a.md", "AAA");
      s.markDirty("a.md");
      s.setFileContent("b.md", "BBB");
      s.markDirty("b.md");
    });

    act(() => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
    });
    await flushPromises();

    expect(writeFileMock).toHaveBeenCalledTimes(2);
    const paths = writeFileMock.mock.calls.map((c) => c[0] as string).sort();
    expect(paths).toEqual(["a.md", "b.md"]);
    expect(useVaultStore.getState().dirtyFiles.size).toBe(0);
  });
});

describe("lifecycle flush", () => {
  it("flushes immediately on window blur", async () => {
    renderHook(() => useAutosave());

    act(() => {
      const s = useVaultStore.getState();
      s.setFileContent("notes/a.md", "draft");
      s.markDirty("notes/a.md");
    });

    expect(writeFileMock).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    await flushPromises();

    expect(writeFileMock).toHaveBeenCalledTimes(1);
  });

  it("flushes when the document becomes hidden", async () => {
    renderHook(() => useAutosave());

    act(() => {
      const s = useVaultStore.getState();
      s.setFileContent("notes/a.md", "draft");
      s.markDirty("notes/a.md");
    });

    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      configurable: true,
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flushPromises();

    expect(writeFileMock).toHaveBeenCalledTimes(1);

    // Reset for other tests.
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
  });

  it("does not flush on visibility change when document is still visible", async () => {
    renderHook(() => useAutosave());

    act(() => {
      const s = useVaultStore.getState();
      s.setFileContent("notes/a.md", "draft");
      s.markDirty("notes/a.md");
    });

    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flushPromises();

    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it("flushes on beforeunload", async () => {
    renderHook(() => useAutosave());

    act(() => {
      const s = useVaultStore.getState();
      s.setFileContent("a.md", "x");
      s.markDirty("a.md");
    });

    act(() => {
      window.dispatchEvent(new Event("beforeunload"));
    });
    await flushPromises();

    expect(writeFileMock).toHaveBeenCalledTimes(1);
  });

  it("attempts a final flush on unmount", async () => {
    const { unmount } = renderHook(() => useAutosave());

    act(() => {
      const s = useVaultStore.getState();
      s.setFileContent("a.md", "x");
      s.markDirty("a.md");
    });

    act(() => {
      unmount();
    });
    await flushPromises();

    expect(writeFileMock).toHaveBeenCalledTimes(1);
  });
});

describe("error handling", () => {
  it("leaves a file dirty when the underlying write fails", async () => {
    writeFileMock.mockRejectedValueOnce(new Error("disk full"));
    renderHook(() => useAutosave());

    act(() => {
      const s = useVaultStore.getState();
      s.setFileContent("a.md", "x");
      s.markDirty("a.md");
    });

    act(() => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
    });
    await flushPromises();

    expect(writeFileMock).toHaveBeenCalledTimes(1);
    expect(useVaultStore.getState().dirtyFiles.has("a.md")).toBe(true);
  });

  it("re-attempts on the next keystroke after a failed flush", async () => {
    writeFileMock.mockRejectedValueOnce(new Error("disk full"));
    renderHook(() => useAutosave());

    act(() => {
      const s = useVaultStore.getState();
      s.setFileContent("a.md", "x");
      s.markDirty("a.md");
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
    });
    await flushPromises();
    expect(writeFileMock).toHaveBeenCalledTimes(1);

    // Next keystroke → mock now succeeds.
    act(() => {
      const s = useVaultStore.getState();
      s.setFileContent("a.md", "xy");
      s.markDirty("a.md");
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
    });
    await flushPromises();

    expect(writeFileMock).toHaveBeenCalledTimes(2);
    expect(useVaultStore.getState().dirtyFiles.has("a.md")).toBe(false);
  });
});

describe("buffer eviction", () => {
  it("skips a dirty file whose content was evicted from the cache", async () => {
    renderHook(() => useAutosave());

    act(() => {
      const s = useVaultStore.getState();
      s.setFileContent("a.md", "x");
      s.markDirty("a.md");
      // Simulate the external-edit cache eviction.
      s.removeFileContent("a.md");
    });

    act(() => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
    });
    await flushPromises();

    expect(writeFileMock).not.toHaveBeenCalled();
    // Still dirty (we didn't touch the dirty set), but the hook
    // declined to write a buffer it no longer has.
    expect(useVaultStore.getState().dirtyFiles.has("a.md")).toBe(true);
  });
});

describe("vault switch", () => {
  it("clears the in-flight set when the vault closes so a same-named path under a new vault is not deduped against the previous session", async () => {
    // Make every write hang so the same path stays in `inFlight`
    // until the test explicitly resolves it.
    let hold: (() => void) | undefined;
    writeFileMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          hold = resolve;
        }),
    );
    renderHook(() => useAutosave());

    // Open vault A → dirty `a.md`.
    act(() => {
      useVaultStore.setState({
        vaultHandle: { path: "/v/A", name: "A", fileCount: 0, openedAt: 0 },
      });
      const s = useVaultStore.getState();
      s.setFileContent("a.md", "from vault A");
      s.markDirty("a.md");
    });
    act(() => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
    });
    await flushPromises();
    expect(writeFileMock).toHaveBeenCalledTimes(1);

    // Close vault (write is still in-flight — we never called hold()).
    act(() => {
      useVaultStore.setState({ vaultHandle: null });
    });

    // Open vault B with the same logical filename. Without the
    // close-clears-inFlight fix, the path "a.md" would still be in
    // the set and the next debounce flush would skip the write.
    act(() => {
      useVaultStore.setState({
        vaultHandle: { path: "/v/B", name: "B", fileCount: 0, openedAt: 0 },
      });
      const s = useVaultStore.getState();
      s.setFileContent("a.md", "from vault B");
      s.markDirty("a.md");
    });
    act(() => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
    });
    await flushPromises();

    // We expect a second `writeFile` call — the new vault's content.
    expect(writeFileMock).toHaveBeenCalledTimes(2);
    expect(writeFileMock.mock.calls[1]).toEqual(["a.md", "from vault B"]);

    // Tidy up the pending vault-A promise so vitest doesn't hang.
    hold?.();
  });
});
