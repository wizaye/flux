/**
 * Tests for `useVaultOperations` — open / create / close / refresh.
 */
import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/bindings", async () => {
  const actual =
    await vi.importActual<typeof import("@/bindings")>("@/bindings");
  return {
    ...actual,
    isTauri: true,
    openVault: vi.fn(async (path: string) => ({
      path,
      name: "test-vault",
      fileCount: 0,
      openedAt: 0,
    })),
    createVault: vi.fn(async (path: string) => ({
      path,
      name: "new-vault",
      fileCount: 0,
      openedAt: 0,
    })),
    closeVault: vi.fn(async () => undefined),
    getFileTree: vi.fn(async () => [
      {
        id: "README.md",
        name: "README.md",
        type: "file" as const,
        depth: 0,
        parentId: null,
        isOpen: null,
        state: null,
        childCount: null,
        size: 10,
        modifiedAt: 0,
      },
    ]),
    getVaultInfo: vi.fn(async () => ({
      path: "/v",
      name: "v",
      fileCount: 1,
      openedAt: 0,
    })),
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
import { useVaultOperations } from "@/hooks/use-vault-operations";
import { useVaultStore } from "@/state/vault-store";

const openVaultMock = backend.openVault as unknown as ReturnType<typeof vi.fn>;
const createVaultMock = backend.createVault as unknown as ReturnType<
  typeof vi.fn
>;
const closeVaultMock = backend.closeVault as unknown as ReturnType<
  typeof vi.fn
>;
const getFileTreeMock = backend.getFileTree as unknown as ReturnType<
  typeof vi.fn
>;
const getVaultInfoMock = backend.getVaultInfo as unknown as ReturnType<
  typeof vi.fn
>;
const toastSuccessMock = toast.success as unknown as ReturnType<typeof vi.fn>;
const toastErrorMock = toast.error as unknown as ReturnType<typeof vi.fn>;
const toastInfoMock = toast.info as unknown as ReturnType<typeof vi.fn>;

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
  openVaultMock.mockClear();
  createVaultMock.mockClear();
  closeVaultMock.mockClear();
  getFileTreeMock.mockClear();
  getVaultInfoMock.mockClear();
  toastSuccessMock.mockClear();
  toastErrorMock.mockClear();
  toastInfoMock.mockClear();
  resetVaultStore();
});

afterEach(() => vi.clearAllMocks());

describe("openVault", () => {
  it("opens the vault, loads the tree, marks vault open, toasts success", async () => {
    const { result } = renderHook(() => useVaultOperations());

    await act(async () => result.current.openVault("/v"));

    expect(openVaultMock).toHaveBeenCalledWith("/v");
    expect(useVaultStore.getState().isVaultOpen).toBe(true);
    expect(useVaultStore.getState().vaultHandle?.path).toBe("/v");
    expect(useVaultStore.getState().fileTree).toHaveLength(1);
    expect(toastSuccessMock).toHaveBeenCalled();
  });

  it("toasts and rethrows on backend failure", async () => {
    openVaultMock.mockRejectedValueOnce({
      kind: "InvalidVaultPath",
      message: "missing",
    });
    const { result } = renderHook(() => useVaultOperations());

    await act(async () => {
      await expect(result.current.openVault("/nope")).rejects.toBeDefined();
    });
    expect(toastErrorMock).toHaveBeenCalledWith(
      "Failed to open vault",
      expect.objectContaining({ description: expect.any(String) }),
    );
    expect(useVaultStore.getState().isVaultOpen).toBe(false);
  });
});

describe("createVault", () => {
  it("creates the vault, loads the tree, toasts success", async () => {
    const { result } = renderHook(() => useVaultOperations());

    await act(async () => result.current.createVault("/v"));

    expect(createVaultMock).toHaveBeenCalledWith("/v");
    expect(useVaultStore.getState().isVaultOpen).toBe(true);
    expect(toastSuccessMock).toHaveBeenCalled();
  });

  it("toasts and rethrows when create fails", async () => {
    createVaultMock.mockRejectedValueOnce(new Error("io"));
    const { result } = renderHook(() => useVaultOperations());
    await act(async () => {
      await expect(result.current.createVault("/v")).rejects.toThrow("io");
    });
    expect(toastErrorMock).toHaveBeenCalled();
  });
});

describe("closeVault", () => {
  it("closes the vault and clears state", async () => {
    useVaultStore.setState({
      vaultHandle: { path: "/v", name: "v", fileCount: 0, openedAt: 0 },
      isVaultOpen: true,
    });
    const { result } = renderHook(() => useVaultOperations());

    await act(async () => result.current.closeVault());

    expect(closeVaultMock).toHaveBeenCalled();
    expect(useVaultStore.getState().isVaultOpen).toBe(false);
    expect(useVaultStore.getState().vaultHandle).toBeNull();
    expect(toastInfoMock).toHaveBeenCalledWith("Vault closed");
  });

  it("warns the user about unsaved changes and respects 'cancel'", async () => {
    useVaultStore.setState({
      vaultHandle: { path: "/v", name: "v", fileCount: 0, openedAt: 0 },
      isVaultOpen: true,
      dirtyFiles: new Set(["a.md"]),
    });
    const confirmSpy = vi
      .spyOn(window, "confirm")
      .mockReturnValueOnce(false);
    const { result } = renderHook(() => useVaultOperations());

    await act(async () => result.current.closeVault());

    expect(confirmSpy).toHaveBeenCalled();
    expect(closeVaultMock).not.toHaveBeenCalled();
    expect(useVaultStore.getState().isVaultOpen).toBe(true);
  });

  it("proceeds with close when the user confirms despite dirty files", async () => {
    useVaultStore.setState({
      vaultHandle: { path: "/v", name: "v", fileCount: 0, openedAt: 0 },
      isVaultOpen: true,
      dirtyFiles: new Set(["a.md"]),
    });
    vi.spyOn(window, "confirm").mockReturnValueOnce(true);

    const { result } = renderHook(() => useVaultOperations());
    await act(async () => result.current.closeVault());

    expect(closeVaultMock).toHaveBeenCalled();
    expect(useVaultStore.getState().isVaultOpen).toBe(false);
  });

  it("toasts and rethrows when closing fails", async () => {
    useVaultStore.setState({
      vaultHandle: { path: "/v", name: "v", fileCount: 0, openedAt: 0 },
      isVaultOpen: true,
    });
    closeVaultMock.mockRejectedValueOnce(new Error("io"));
    const { result } = renderHook(() => useVaultOperations());
    await act(async () => {
      await expect(result.current.closeVault()).rejects.toThrow("io");
    });
    expect(toastErrorMock).toHaveBeenCalled();
  });
});

describe("refreshVault", () => {
  it("reloads info + tree and toasts success in non-silent mode", async () => {
    const { result } = renderHook(() => useVaultOperations());
    await act(async () => result.current.refreshVault(false));
    expect(getVaultInfoMock).toHaveBeenCalled();
    expect(getFileTreeMock).toHaveBeenCalled();
    expect(toastSuccessMock).toHaveBeenCalledWith("Vault refreshed");
  });

  it("suppresses the success toast in silent mode", async () => {
    const { result } = renderHook(() => useVaultOperations());
    await act(async () => result.current.refreshVault(true));
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });

  it("toasts and rethrows on failure", async () => {
    getVaultInfoMock.mockRejectedValueOnce(new Error("no vault"));
    const { result } = renderHook(() => useVaultOperations());
    await act(async () => {
      await expect(result.current.refreshVault(false)).rejects.toThrow(
        "no vault",
      );
    });
    expect(toastErrorMock).toHaveBeenCalled();
  });
});
