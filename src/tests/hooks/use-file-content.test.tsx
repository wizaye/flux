/**
 * Tests for `useFileContent` — dirty-tracking + batch save helpers.
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
    readFile: vi.fn(async () => "disk body"),
  };
});

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

import * as backend from "@/bindings";
import { toast } from "sonner";
import { useFileContent } from "@/hooks/use-file-content";
import { useVaultStore } from "@/state/vault-store";

const writeFileMock = backend.writeFile as unknown as ReturnType<typeof vi.fn>;
const readFileMock = backend.readFile as unknown as ReturnType<typeof vi.fn>;
const toastSuccessMock = toast.success as unknown as ReturnType<typeof vi.fn>;
const toastWarningMock = toast.warning as unknown as ReturnType<typeof vi.fn>;
const toastInfoMock = toast.info as unknown as ReturnType<typeof vi.fn>;
const toastErrorMock = toast.error as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  writeFileMock.mockClear().mockResolvedValue(undefined);
  readFileMock.mockClear().mockResolvedValue("disk body");
  toastSuccessMock.mockClear();
  toastWarningMock.mockClear();
  toastInfoMock.mockClear();
  toastErrorMock.mockClear();
  useVaultStore.setState(
    { openFiles: new Map(), dirtyFiles: new Set() },
    false,
  );
});

afterEach(() => vi.clearAllMocks());

describe("read helpers", () => {
  it("getContent returns undefined for an unknown path", () => {
    const { result } = renderHook(() => useFileContent());
    expect(result.current.getContent("missing.md")).toBeUndefined();
  });

  it("getContent returns cached content", () => {
    useVaultStore.getState().setFileContent("a.md", "hello");
    const { result } = renderHook(() => useFileContent());
    expect(result.current.getContent("a.md")).toBe("hello");
  });
});

describe("dirty bookkeeping", () => {
  it("updateContent caches body and marks dirty", () => {
    const { result } = renderHook(() => useFileContent());
    act(() => result.current.updateContent("a.md", "draft"));
    expect(useVaultStore.getState().openFiles.get("a.md")).toBe("draft");
    expect(result.current.isDirty("a.md")).toBe(true);
  });

  it("isDirty / getDirtyCount / getDirtyFiles agree with the store", () => {
    useVaultStore.getState().markDirty("a.md");
    useVaultStore.getState().markDirty("b.md");
    const { result } = renderHook(() => useFileContent());
    expect(result.current.isDirty("a.md")).toBe(true);
    expect(result.current.isDirty("missing")).toBe(false);
    expect(result.current.getDirtyCount()).toBe(2);
    expect(result.current.getDirtyFiles().sort()).toEqual(["a.md", "b.md"]);
  });
});

describe("saveAll", () => {
  it("shows an info toast and short-circuits when nothing is dirty", async () => {
    const { result } = renderHook(() => useFileContent());
    const res = await act(async () => result.current.saveAll());
    expect(res).toEqual({ saved: 0, failed: 0 });
    expect(toastInfoMock).toHaveBeenCalledWith("No files to save");
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it("writes every dirty file, clears the dirty set, success toast", async () => {
    useVaultStore.getState().setFileContent("a.md", "A");
    useVaultStore.getState().setFileContent("b.md", "B");
    useVaultStore.getState().markDirty("a.md");
    useVaultStore.getState().markDirty("b.md");
    const { result } = renderHook(() => useFileContent());

    const res = await act(async () => result.current.saveAll());

    expect(res).toEqual({ saved: 2, failed: 0 });
    expect(writeFileMock).toHaveBeenCalledTimes(2);
    expect(useVaultStore.getState().dirtyFiles.size).toBe(0);
    expect(toastSuccessMock).toHaveBeenCalledWith("Saved 2 file(s)");
  });

  it("counts failures separately and emits a warning toast on partial failure", async () => {
    useVaultStore.getState().setFileContent("a.md", "A");
    useVaultStore.getState().setFileContent("b.md", "B");
    useVaultStore.getState().markDirty("a.md");
    useVaultStore.getState().markDirty("b.md");
    writeFileMock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("io"));

    const { result } = renderHook(() => useFileContent());

    const res = await act(async () => result.current.saveAll());
    expect(res.saved + res.failed).toBe(2);
    expect(toastWarningMock).toHaveBeenCalled();
  });

  it("skips files whose content was evicted from the cache", async () => {
    useVaultStore.getState().markDirty("orphan.md");
    const { result } = renderHook(() => useFileContent());

    const res = await act(async () => result.current.saveAll());
    expect(res.failed).toBe(1);
    expect(writeFileMock).not.toHaveBeenCalled();
  });
});

describe("discardChanges", () => {
  it("reloads from disk, replaces cached body, clears dirty flag", async () => {
    useVaultStore.getState().setFileContent("a.md", "old draft");
    useVaultStore.getState().markDirty("a.md");
    readFileMock.mockResolvedValueOnce("on-disk");

    const { result } = renderHook(() => useFileContent());
    await act(async () => result.current.discardChanges("a.md"));

    expect(useVaultStore.getState().openFiles.get("a.md")).toBe("on-disk");
    expect(useVaultStore.getState().dirtyFiles.has("a.md")).toBe(false);
    expect(toastInfoMock).toHaveBeenCalledWith("Discarded changes: a.md");
  });

  it("toasts and rethrows when the disk read fails", async () => {
    readFileMock.mockRejectedValueOnce(new Error("io"));
    const { result } = renderHook(() => useFileContent());
    await act(async () => {
      await expect(result.current.discardChanges("a.md")).rejects.toThrow(
        "io",
      );
    });
    expect(toastErrorMock).toHaveBeenCalledWith(
      "Failed to reload file: a.md",
      expect.objectContaining({ description: "io" }),
    );
  });
});
