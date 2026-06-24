/**
 * Tasks store unit tests. Mocks the bindings so we never need a
 * real Tauri runtime.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const listOpenTasks = vi.fn();
const toggleTask = vi.fn();

vi.mock("@/bindings", () => ({
  isTauri: true,
  listOpenTasks: (...args: unknown[]) => listOpenTasks(...args),
  toggleTask: (...args: unknown[]) => toggleTask(...args),
}));

import { useTasksStore } from "@/state/tasks-store";
import type { TaskDto } from "@/bindings";

function task(id: string, overrides: Partial<TaskDto> = {}): TaskDto {
  return {
    id,
    fileId: "todo.md",
    blockAnchor: null,
    lineHint: 0,
    status: "open",
    rawText: `task ${id}`,
    indexedAt: 0,
    ...overrides,
  };
}

beforeEach(() => {
  listOpenTasks.mockReset();
  toggleTask.mockReset();
  useTasksStore.setState({
    tasks: [],
    loading: false,
    pending: new Set(),
  });
});

describe("tasks-store — refresh", () => {
  it("fetches the open task list from Rust and stores it", async () => {
    listOpenTasks.mockResolvedValueOnce([task("a"), task("b")]);
    await useTasksStore.getState().refresh();
    expect(useTasksStore.getState().tasks.map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("clears loading even when the IPC fails", async () => {
    listOpenTasks.mockRejectedValueOnce(new Error("boom"));
    await useTasksStore.getState().refresh();
    expect(useTasksStore.getState().loading).toBe(false);
  });
});

describe("tasks-store — toggle", () => {
  it("optimistically removes the toggled task and re-fetches after success", async () => {
    listOpenTasks.mockResolvedValueOnce([task("a"), task("b")]);
    await useTasksStore.getState().refresh();
    toggleTask.mockResolvedValueOnce({
      taskId: "a",
      newStatus: "done",
      newAnchor: "^blk_xx",
      line: 0,
    });
    // After the toggle, listOpenTasks is called again to pull the
    // fresh state — task `a` is now done and disappears from the
    // open list.
    listOpenTasks.mockResolvedValueOnce([task("b")]);
    const result = await useTasksStore.getState().toggle("a");
    expect(result?.newStatus).toBe("done");
    expect(useTasksStore.getState().tasks.map((t) => t.id)).toEqual(["b"]);
  });

  it("rolls back the optimistic removal when the IPC rejects", async () => {
    listOpenTasks.mockResolvedValueOnce([task("a")]);
    await useTasksStore.getState().refresh();
    toggleTask.mockRejectedValueOnce(new Error("write failed"));
    const result = await useTasksStore.getState().toggle("a");
    expect(result).toBeNull();
    expect(useTasksStore.getState().tasks.map((t) => t.id)).toEqual(["a"]);
    expect(useTasksStore.getState().pending.has("a")).toBe(false);
  });
});
