/**
 * Tests for `useDirectoryOperations`.
 *
 * Drives the two callbacks (createDirectory / listDirectory) with a
 * mocked `@/bindings` so we can assert both the success path
 * (surgical tree insert + toast) and the error path (toast + rethrow).
 */
import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/bindings", async () => {
  const actual =
    await vi.importActual<typeof import("@/bindings")>("@/bindings");
  return {
    ...actual,
    isTauri: true,
    createDirectory: vi.fn(async () => undefined),
    listDirectory: vi.fn(async () => [] as unknown[]),
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
import { useDirectoryOperations } from "@/hooks/use-directory-operations";
import { useVaultStore } from "@/state/vault-store";

const createDirectoryMock = backend.createDirectory as unknown as ReturnType<
  typeof vi.fn
>;
const listDirectoryMock = backend.listDirectory as unknown as ReturnType<
  typeof vi.fn
>;
const toastErrorMock = toast.error as unknown as ReturnType<typeof vi.fn>;
const toastSuccessMock = toast.success as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  createDirectoryMock.mockClear().mockResolvedValue(undefined);
  listDirectoryMock.mockClear().mockResolvedValue([]);
  toastErrorMock.mockClear();
  toastSuccessMock.mockClear();
  useVaultStore.setState({ fileTree: [] }, false);
});

afterEach(() => vi.clearAllMocks());

describe("createDirectory", () => {
  it("calls the backend and inserts the new folder into the tree", async () => {
    const { result } = renderHook(() => useDirectoryOperations());

    await act(async () => {
      await result.current.createDirectory("notes/new-folder");
    });

    expect(createDirectoryMock).toHaveBeenCalledWith("notes/new-folder");
    const tree = useVaultStore.getState().fileTree;
    expect(tree).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "notes",
          kind: "folder",
          children: expect.arrayContaining([
            expect.objectContaining({ id: "notes/new-folder", kind: "folder" }),
          ]),
        }),
      ]),
    );
    expect(toastSuccessMock).toHaveBeenCalledWith(
      "Created directory: notes/new-folder",
    );
  });

  it("rethrows and surfaces a toast on backend failure", async () => {
    createDirectoryMock.mockRejectedValueOnce({
      kind: "PermissionDenied",
      message: "read-only fs",
    });
    const { result } = renderHook(() => useDirectoryOperations());

    await act(async () => {
      await expect(result.current.createDirectory("/etc")).rejects.toBeDefined();
    });

    expect(toastErrorMock).toHaveBeenCalledWith(
      "Failed to create directory: /etc",
      expect.objectContaining({
        description: expect.stringContaining("PermissionDenied"),
      }),
    );
    // The tree should NOT have a new folder on failure.
    expect(useVaultStore.getState().fileTree).toEqual([]);
  });
});

describe("listDirectory", () => {
  it("returns the backend payload on success", async () => {
    const payload = [
      {
        path: "notes/a.md",
        name: "a.md",
        type: "file" as const,
        state: null,
        size: 12,
        modifiedAt: 0,
      },
    ];
    listDirectoryMock.mockResolvedValueOnce(payload);
    const { result } = renderHook(() => useDirectoryOperations());

    const entries = await act(async () =>
      result.current.listDirectory("notes"),
    );

    expect(entries).toEqual(payload);
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("rethrows and toasts on backend failure", async () => {
    listDirectoryMock.mockRejectedValueOnce(new Error("io"));
    const { result } = renderHook(() => useDirectoryOperations());

    await act(async () => {
      await expect(result.current.listDirectory("ghost")).rejects.toThrow("io");
    });

    expect(toastErrorMock).toHaveBeenCalledWith(
      "Failed to list directory: ghost",
      expect.objectContaining({ description: "io" }),
    );
  });
});
