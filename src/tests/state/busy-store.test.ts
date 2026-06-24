/**
 * Unit tests for the global busy registry (`busy-store`).
 *
 * Covers begin/end/update/clear lifecycle, the concurrent-stack
 * semantics the global overlay relies on, and the `withBusy`
 * promise wrapper (both happy-path and rejection paths).
 */
import { beforeEach, describe, expect, it } from "vitest";

import { useBusyStore, withBusy } from "@/state/busy-store";

beforeEach(() => {
  useBusyStore.getState().clear();
});

describe("begin / end", () => {
  it("starts empty", () => {
    expect(useBusyStore.getState().entries).toHaveLength(0);
  });

  it("begin appends an entry and returns a unique id", () => {
    const id1 = useBusyStore.getState().begin("Loading vault…");
    const id2 = useBusyStore.getState().begin("Indexing", "12 files");
    expect(id1).not.toBe(id2);
    const entries = useBusyStore.getState().entries;
    expect(entries).toHaveLength(2);
    expect(entries[0].label).toBe("Loading vault…");
    expect(entries[1].detail).toBe("12 files");
    // Each entry has a startedAt timestamp.
    expect(typeof entries[0].startedAt).toBe("number");
  });

  it("end removes only the matching id", () => {
    const a = useBusyStore.getState().begin("A");
    const b = useBusyStore.getState().begin("B");
    useBusyStore.getState().end(a);
    const labels = useBusyStore.getState().entries.map((e) => e.label);
    expect(labels).toEqual(["B"]);
    useBusyStore.getState().end(b);
    expect(useBusyStore.getState().entries).toHaveLength(0);
  });

  it("end is a no-op for unknown ids", () => {
    useBusyStore.getState().begin("only one");
    useBusyStore.getState().end(99999);
    expect(useBusyStore.getState().entries).toHaveLength(1);
  });

  it("clear removes every entry regardless of id", () => {
    useBusyStore.getState().begin("a");
    useBusyStore.getState().begin("b");
    useBusyStore.getState().begin("c");
    useBusyStore.getState().clear();
    expect(useBusyStore.getState().entries).toHaveLength(0);
  });
});

describe("update", () => {
  it("patches label and/or detail without changing other fields", () => {
    const id = useBusyStore.getState().begin("Indexing", "0 / 100");
    const startedAt = useBusyStore.getState().entries[0].startedAt;
    useBusyStore.getState().update(id, { detail: "50 / 100" });
    const e = useBusyStore.getState().entries[0];
    expect(e.label).toBe("Indexing");
    expect(e.detail).toBe("50 / 100");
    expect(e.startedAt).toBe(startedAt);
  });

  it("can rewrite the label mid-flight", () => {
    const id = useBusyStore.getState().begin("Loading vault…");
    useBusyStore.getState().update(id, { label: "Building tree…" });
    expect(useBusyStore.getState().entries[0].label).toBe("Building tree…");
  });

  it("ignores unknown ids", () => {
    useBusyStore.getState().begin("real");
    useBusyStore.getState().update(99999, { label: "phantom" });
    expect(useBusyStore.getState().entries[0].label).toBe("real");
  });
});

describe("concurrent stack semantics", () => {
  it("preserves insertion order so the overlay shows the latest", () => {
    const a = useBusyStore.getState().begin("first");
    const b = useBusyStore.getState().begin("second");
    expect(useBusyStore.getState().entries.map((e) => e.label)).toEqual([
      "first",
      "second",
    ]);
    // End the first one — the second one (the "latest") remains.
    useBusyStore.getState().end(a);
    expect(useBusyStore.getState().entries.map((e) => e.label)).toEqual([
      "second",
    ]);
    useBusyStore.getState().end(b);
  });
});

describe("withBusy helper", () => {
  it("auto-begins and auto-ends on success", async () => {
    const result = await withBusy("Working", async () => {
      // While inside, an entry exists.
      expect(useBusyStore.getState().entries).toHaveLength(1);
      expect(useBusyStore.getState().entries[0].label).toBe("Working");
      return 42;
    });
    expect(result).toBe(42);
    expect(useBusyStore.getState().entries).toHaveLength(0);
  });

  it("auto-ends even when the task throws, then re-throws", async () => {
    const explode = withBusy("Working", async () => {
      throw new Error("boom");
    });
    await expect(explode).rejects.toThrow("boom");
    expect(useBusyStore.getState().entries).toHaveLength(0);
  });

  it("forwards the optional detail field", async () => {
    await withBusy(
      "Indexing",
      async () => {
        expect(useBusyStore.getState().entries[0].detail).toBe("starting…");
      },
      "starting…",
    );
  });
});
