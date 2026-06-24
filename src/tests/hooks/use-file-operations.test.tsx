/**
 * Tests for `useFileOperations` — file CRUD facade.
 *
 * Each callback is verified end-to-end: backend call shape, tree
 * mutation, cache sync, tab-sync handler invocation, error toast +
 * rethrow on failure.
 */
import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/bindings", async () => {
  const actual =
    await vi.importActual<typeof import("@/bindings")>("@/bindings");
  return {
    ...actual,
    isTauri: true,
    readFile: vi.fn(async (_: string) => "file body"),
    writeFile: vi.fn(async () => undefined),
    createFile: vi.fn(async () => undefined),
    deleteFile: vi.fn(async () => undefined),
    archiveFile: vi.fn(async () => ".archive/notes/a.md"),
    moveFile: vi.fn(async (_src: string, dst: string) => ({
      newPath: dst,
      linksHealed: 0,
      filesUpdated: 0,
    })),
    renameFile: vi.fn(async (path: string, newName: string) => {
      const parent = path.split("/").slice(0, -1).join("/");
      const newPath = parent ? `${parent}/${newName}` : newName;
      return { newPath, linksHealed: 0, filesUpdated: 0 };
    }),
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
import { useFileOperations } from "@/hooks/use-file-operations";
import { useVaultStore } from "@/state/vault-store";
import { useEditorStore } from "@/state/editor-store";
import { useTabSyncStore } from "@/state/tab-sync-store";
import { useBookmarksStore } from "@/state/bookmarks-store";

const readFileMock = backend.readFile as unknown as ReturnType<typeof vi.fn>;
const writeFileMock = backend.writeFile as unknown as ReturnType<typeof vi.fn>;
const createFileMock = backend.createFile as unknown as ReturnType<typeof vi.fn>;
const deleteFileMock = backend.deleteFile as unknown as ReturnType<typeof vi.fn>;
const archiveFileMock = backend.archiveFile as unknown as ReturnType<typeof vi.fn>;
const moveFileMock = backend.moveFile as unknown as ReturnType<typeof vi.fn>;
const renameFileMock = backend.renameFile as unknown as ReturnType<typeof vi.fn>;
const toastErrorMock = toast.error as unknown as ReturnType<typeof vi.fn>;

function resetStores() {
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
  useEditorStore.setState(
    { dirtyFiles: new Set(), fileContents: new Map() },
    false,
  );
  useTabSyncStore.setState({ handlers: null, activeFile: null });
  try {
    useBookmarksStore.setState({ entries: [], groups: [] });
  } catch {
    /* bookmarks store may not be initialised */
  }
}

beforeEach(() => {
  readFileMock.mockClear().mockResolvedValue("file body");
  writeFileMock.mockClear().mockResolvedValue(undefined);
  createFileMock.mockClear().mockResolvedValue(undefined);
  deleteFileMock.mockClear().mockResolvedValue(undefined);
  archiveFileMock.mockClear().mockResolvedValue(".archive/notes/a.md");
  moveFileMock.mockClear().mockImplementation(async (_src, dst) => ({
    newPath: dst,
    linksHealed: 0,
    filesUpdated: 0,
  }));
  renameFileMock.mockClear().mockImplementation(async (path, newName) => {
    const parent = path.split("/").slice(0, -1).join("/");
    const newPath = parent ? `${parent}/${newName}` : newName;
    return { newPath, linksHealed: 0, filesUpdated: 0 };
  });
  toastErrorMock.mockClear();
  resetStores();
});

afterEach(() => vi.clearAllMocks());

// ── openFile ─────────────────────────────────────────────────────────

describe("openFile", () => {
  it("returns cached content without calling the backend", async () => {
    useVaultStore.getState().setFileContent("notes/a.md", "cached body");
    const { result } = renderHook(() => useFileOperations());

    const body = await act(async () => result.current.openFile("notes/a.md"));

    expect(body).toBe("cached body");
    expect(readFileMock).not.toHaveBeenCalled();
  });

  it("loads from backend, caches the result, and returns it on cache miss", async () => {
    readFileMock.mockResolvedValueOnce("fresh body");
    const { result } = renderHook(() => useFileOperations());

    const body = await act(async () => result.current.openFile("new.md"));

    expect(body).toBe("fresh body");
    expect(useVaultStore.getState().openFiles.get("new.md")).toBe("fresh body");
  });

  it("toasts and rethrows when the backend read fails", async () => {
    readFileMock.mockRejectedValueOnce({ kind: "NotFound", message: "x" });
    const { result } = renderHook(() => useFileOperations());

    await act(async () => {
      await expect(result.current.openFile("ghost.md")).rejects.toBeDefined();
    });
    expect(toastErrorMock).toHaveBeenCalledWith(
      "Failed to open file: ghost.md",
      expect.objectContaining({ description: expect.any(String) }),
    );
  });
});

// ── saveFile (silent on success after the autosave refactor) ─────────

describe("saveFile", () => {
  it("writes the file, caches it, and marks clean — without toasting", async () => {
    const { result } = renderHook(() => useFileOperations());
    useVaultStore.getState().markDirty("a.md");

    await act(async () => result.current.saveFile("a.md", "fresh"));

    expect(writeFileMock).toHaveBeenCalledWith("a.md", "fresh");
    expect(useVaultStore.getState().openFiles.get("a.md")).toBe("fresh");
    expect(useVaultStore.getState().dirtyFiles.has("a.md")).toBe(false);
  });

  it("leaves the file dirty and toasts when the write fails", async () => {
    writeFileMock.mockRejectedValueOnce(new Error("disk full"));
    const { result } = renderHook(() => useFileOperations());
    useVaultStore.getState().markDirty("a.md");

    await act(async () => {
      await expect(result.current.saveFile("a.md", "fresh")).rejects.toThrow(
        "disk full",
      );
    });
    expect(useVaultStore.getState().dirtyFiles.has("a.md")).toBe(true);
    expect(toastErrorMock).toHaveBeenCalledWith(
      "Failed to save file: a.md",
      expect.objectContaining({ description: "disk full" }),
    );
  });
});

// ── createFile / deleteFile / archiveFile ────────────────────────────

describe("createFile", () => {
  it("invokes the backend, adds to the tree, and caches initial content", async () => {
    const { result } = renderHook(() => useFileOperations());

    await act(async () => result.current.createFile("notes/new.md", "seed"));

    expect(createFileMock).toHaveBeenCalledWith("notes/new.md", "seed");
    expect(useVaultStore.getState().openFiles.get("notes/new.md")).toBe("seed");
    const tree = useVaultStore.getState().fileTree;
    const folder = tree.find((n) => n.id === "notes");
    expect(folder?.children?.[0].id).toBe("notes/new.md");
  });

  it("toasts on failure without mutating the tree", async () => {
    createFileMock.mockRejectedValueOnce({
      kind: "AlreadyExists",
      message: "x",
    });
    const { result } = renderHook(() => useFileOperations());

    await act(async () => {
      await expect(
        result.current.createFile("a.md", ""),
      ).rejects.toBeDefined();
    });
    expect(useVaultStore.getState().fileTree).toEqual([]);
  });
});

describe("deleteFile", () => {
  it("removes the file, drops cached content, marks clean, and closes tabs", async () => {
    const closeTabsForFile = vi.fn();
    useTabSyncStore.getState().setHandlers({
      closeTabsForFile,
      renameTabFile: vi.fn(),
    });
    useVaultStore.getState().addNodeToTree("notes/a.md", "file");
    useVaultStore.getState().setFileContent("notes/a.md", "body");
    useVaultStore.getState().markDirty("notes/a.md");
    useEditorStore.getState().markDirty("notes/a.md");

    const { result } = renderHook(() => useFileOperations());
    await act(async () => result.current.deleteFile("notes/a.md"));

    expect(deleteFileMock).toHaveBeenCalledWith("notes/a.md");
    expect(closeTabsForFile).toHaveBeenCalledWith("notes/a.md");
    expect(useVaultStore.getState().openFiles.has("notes/a.md")).toBe(false);
    expect(useVaultStore.getState().dirtyFiles.has("notes/a.md")).toBe(false);
    expect(useEditorStore.getState().dirtyFiles.has("notes/a.md")).toBe(false);
    // The parent `notes/` folder is intentionally retained so the
    // sidebar doesn't collapse when the user deletes the last child.
    const tree = useVaultStore.getState().fileTree;
    expect(tree).toEqual([
      expect.objectContaining({
        id: "notes",
        kind: "folder",
        children: [],
      }),
    ]);
  });

  it("toasts and rethrows when the backend delete fails", async () => {
    deleteFileMock.mockRejectedValueOnce(new Error("io"));
    const { result } = renderHook(() => useFileOperations());

    await act(async () => {
      await expect(result.current.deleteFile("a.md")).rejects.toThrow("io");
    });
    expect(toastErrorMock).toHaveBeenCalledWith(
      "Failed to delete file",
      expect.objectContaining({ description: "io" }),
    );
  });
});

describe("archiveFile", () => {
  it("archives, drops cache, removes tree node, returns archive path", async () => {
    archiveFileMock.mockResolvedValueOnce(".archive/notes/a.md");
    useVaultStore.getState().addNodeToTree("notes/a.md", "file");
    useVaultStore.getState().setFileContent("notes/a.md", "body");

    const { result } = renderHook(() => useFileOperations());

    const newPath = await act(async () =>
      result.current.archiveFile("notes/a.md"),
    );

    expect(newPath).toBe(".archive/notes/a.md");
    expect(archiveFileMock).toHaveBeenCalledWith("notes/a.md");
    expect(useVaultStore.getState().openFiles.has("notes/a.md")).toBe(false);
    const tree = useVaultStore.getState().fileTree;
    expect(tree).toEqual([
      expect.objectContaining({ id: "notes", children: [] }),
    ]);
  });

  it("toasts on failure", async () => {
    archiveFileMock.mockRejectedValueOnce({ kind: "InvalidPath" });
    const { result } = renderHook(() => useFileOperations());
    await act(async () => {
      await expect(result.current.archiveFile("x.md")).rejects.toBeDefined();
    });
    expect(toastErrorMock).toHaveBeenCalledWith(
      "Failed to archive",
      expect.objectContaining({ description: expect.any(String) }),
    );
  });
});

// ── moveFile / renameFile ────────────────────────────────────────────

describe("moveFile", () => {
  it("moves the file, transfers cached content under the new path, updates tabs", async () => {
    const renameTabFile = vi.fn();
    useTabSyncStore.getState().setHandlers({
      closeTabsForFile: vi.fn(),
      renameTabFile,
    });
    useVaultStore.getState().addNodeToTree("a.md", "file");
    useVaultStore.getState().setFileContent("a.md", "body-a");

    const { result } = renderHook(() => useFileOperations());

    const res = await act(async () => result.current.moveFile("a.md", "b.md"));

    expect(res.newPath).toBe("b.md");
    expect(useVaultStore.getState().openFiles.get("b.md")).toBe("body-a");
    expect(useVaultStore.getState().openFiles.has("a.md")).toBe(false);
    expect(renameTabFile).toHaveBeenCalledWith("a.md", "b.md", "b");
  });

  it("reports links healed in the success toast (best-effort UX)", async () => {
    moveFileMock.mockResolvedValueOnce({
      newPath: "b.md",
      linksHealed: 5,
      filesUpdated: 3,
    });
    const { result } = renderHook(() => useFileOperations());
    const res = await act(async () =>
      result.current.moveFile("a.md", "b.md"),
    );
    expect(res.linksHealed).toBe(5);
  });

  it("toasts and rethrows on failure", async () => {
    moveFileMock.mockRejectedValueOnce({ kind: "AlreadyExists" });
    const { result } = renderHook(() => useFileOperations());
    await act(async () => {
      await expect(
        result.current.moveFile("a.md", "b.md"),
      ).rejects.toBeDefined();
    });
    expect(toastErrorMock).toHaveBeenCalledWith(
      "Failed to move file",
      expect.objectContaining({ description: expect.any(String) }),
    );
  });
});

describe("renameFile", () => {
  it("renames within the same folder and rewrites tabs", async () => {
    const renameTabFile = vi.fn();
    useTabSyncStore.getState().setHandlers({
      closeTabsForFile: vi.fn(),
      renameTabFile,
    });
    useVaultStore.getState().addNodeToTree("notes/old.md", "file");
    useVaultStore.getState().setFileContent("notes/old.md", "body");

    const { result } = renderHook(() => useFileOperations());

    const res = await act(async () =>
      result.current.renameFile("notes/old.md", "new.md"),
    );

    expect(res.newPath).toBe("notes/new.md");
    expect(useVaultStore.getState().openFiles.get("notes/new.md")).toBe(
      "body",
    );
    expect(renameTabFile).toHaveBeenCalledWith(
      "notes/old.md",
      "notes/new.md",
      "new",
    );
  });

  it("updates bookmarks pointing at the old path", async () => {
    useBookmarksStore.getState().upsert({ id: "notes/old.md", title: "Old" });
    const { result } = renderHook(() => useFileOperations());

    await act(async () =>
      result.current.renameFile("notes/old.md", "new.md"),
    );

    expect(useBookmarksStore.getState().has("notes/old.md")).toBe(false);
    expect(useBookmarksStore.getState().has("notes/new.md")).toBe(true);
  });

  it("toasts and rethrows on backend failure", async () => {
    renameFileMock.mockRejectedValueOnce({ kind: "AlreadyExists" });
    const { result } = renderHook(() => useFileOperations());
    await act(async () => {
      await expect(
        result.current.renameFile("a.md", "b.md"),
      ).rejects.toBeDefined();
    });
    expect(toastErrorMock).toHaveBeenCalledWith(
      "Failed to rename file",
      expect.objectContaining({ description: expect.any(String) }),
    );
  });
});
