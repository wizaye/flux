/**
 * Tests for `useDragResize` — the splitter drag callback factory.
 *
 * Verifies:
 *   • pointer-down captures pointer + sets body cursor/select.
 *   • pointer-move fires `onDelta` with the cumulative delta.
 *   • pointer-up tears down state and fires `onEnd`.
 *   • Escape / blur / tab-hidden also tear down (safety nets).
 *   • Unmount mid-drag restores the body cursor.
 */
import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDragResize } from "@/hooks/use-drag-resize";

function syntheticDown(x: number, y: number) {
  return {
    preventDefault: vi.fn(),
    clientX: x,
    clientY: y,
    pointerId: 1,
    target: { setPointerCapture: vi.fn() },
  } as unknown as React.PointerEvent;
}

beforeEach(() => {
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
});

describe("pointer drag — x axis", () => {
  it("sets body cursor to col-resize on pointer-down", () => {
    const { result } = renderHook(() => useDragResize("x", vi.fn()));
    act(() => result.current(syntheticDown(100, 0)));
    expect(document.body.style.cursor).toBe("col-resize");
    expect(document.body.style.userSelect).toBe("none");
  });

  it("fires onDelta with cumulative dx for each pointer-move", () => {
    const onDelta = vi.fn();
    const { result } = renderHook(() => useDragResize("x", onDelta));
    act(() => result.current(syntheticDown(100, 0)));

    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 120, clientY: 0 }),
      );
    });
    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 80, clientY: 0 }),
      );
    });

    expect(onDelta).toHaveBeenCalledWith(20);
    expect(onDelta).toHaveBeenCalledWith(-20);
  });

  it("clears body cursor on pointer-up and fires onEnd", () => {
    const onEnd = vi.fn();
    const { result } = renderHook(() => useDragResize("x", vi.fn(), onEnd));
    act(() => result.current(syntheticDown(0, 0)));
    act(() => {
      window.dispatchEvent(new PointerEvent("pointerup"));
    });
    expect(document.body.style.cursor).toBe("");
    expect(onEnd).toHaveBeenCalled();
  });

  it("ignores pointer-move events when not actively dragging", () => {
    const onDelta = vi.fn();
    renderHook(() => useDragResize("x", onDelta));
    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 99, clientY: 0 }),
      );
    });
    expect(onDelta).not.toHaveBeenCalled();
  });
});

describe("pointer drag — y axis", () => {
  it("sets body cursor to row-resize on pointer-down", () => {
    const { result } = renderHook(() => useDragResize("y", vi.fn()));
    act(() => result.current(syntheticDown(0, 200)));
    expect(document.body.style.cursor).toBe("row-resize");
  });

  it("fires onDelta with cumulative dy", () => {
    const onDelta = vi.fn();
    const { result } = renderHook(() => useDragResize("y", onDelta));
    act(() => result.current(syntheticDown(0, 200)));
    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 0, clientY: 250 }),
      );
    });
    expect(onDelta).toHaveBeenCalledWith(50);
  });
});

describe("safety nets", () => {
  it("Escape key cleans up an active drag", () => {
    const onEnd = vi.fn();
    const { result } = renderHook(() => useDragResize("x", vi.fn(), onEnd));
    act(() => result.current(syntheticDown(0, 0)));
    expect(document.body.style.cursor).toBe("col-resize");

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(document.body.style.cursor).toBe("");
    expect(onEnd).toHaveBeenCalled();
  });

  it("Window blur cleans up an active drag", () => {
    const onEnd = vi.fn();
    const { result } = renderHook(() => useDragResize("x", vi.fn(), onEnd));
    act(() => result.current(syntheticDown(0, 0)));

    act(() => {
      window.dispatchEvent(new Event("blur"));
    });

    expect(document.body.style.cursor).toBe("");
    expect(onEnd).toHaveBeenCalled();
  });

  it("`visibilitychange` to hidden cleans up an active drag", () => {
    const onEnd = vi.fn();
    const { result } = renderHook(() => useDragResize("x", vi.fn(), onEnd));
    act(() => result.current(syntheticDown(0, 0)));

    Object.defineProperty(document, "hidden", {
      value: true,
      configurable: true,
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(document.body.style.cursor).toBe("");
    expect(onEnd).toHaveBeenCalled();

    // Restore for other tests.
    Object.defineProperty(document, "hidden", {
      value: false,
      configurable: true,
    });
  });

  it("unmount mid-drag clears the body cursor", () => {
    const onEnd = vi.fn();
    const { result, unmount } = renderHook(() =>
      useDragResize("x", vi.fn(), onEnd),
    );
    act(() => result.current(syntheticDown(0, 0)));
    expect(document.body.style.cursor).toBe("col-resize");

    act(() => unmount());

    expect(document.body.style.cursor).toBe("");
    expect(onEnd).toHaveBeenCalled();
  });

  it("non-Escape keys do not cancel a drag", () => {
    const onEnd = vi.fn();
    const { result } = renderHook(() => useDragResize("x", vi.fn(), onEnd));
    act(() => result.current(syntheticDown(0, 0)));
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    });
    expect(onEnd).not.toHaveBeenCalled();
    expect(document.body.style.cursor).toBe("col-resize");
  });
});
