import { useCallback, useEffect, useRef } from "react";

/**
 * Hook for drag-to-resize splitters. Returns a callback to attach to
 * the splitter handle's `onPointerDown`. While dragging, calls
 * `onDelta` with the cumulative pixel delta from the drag-start point.
 *
 * Ported verbatim from `lattice/src/hooks/useDragResize.ts`.
 */
export function useDragResize(
  axis: "x" | "y",
  onDelta: (delta: number) => void,
  onEnd?: () => void,
) {
  const startRef = useRef<number>(0);
  const draggingRef = useRef(false);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      draggingRef.current = true;
      startRef.current = axis === "x" ? e.clientX : e.clientY;
      (e.target as Element).setPointerCapture?.(e.pointerId);
      document.body.style.cursor = axis === "x" ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
    },
    [axis],
  );

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      const current = axis === "x" ? e.clientX : e.clientY;
      onDelta(current - startRef.current);
    };
    const up = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      onEnd?.();
    };
    // Safety nets — webviews occasionally swallow pointerup when the
    // cursor strays over the OS title bar / another window / the dev
    // overlay, leaving `body.cursor` stuck on `col-resize` and the
    // entire editor area showing the splitter cursor. Treat blur,
    // tab-hide and Escape as "drag is over, clean up".
    const onVisibility = () => { if (document.hidden) up(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") up(); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("blur", up);
    window.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("blur", up);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [axis, onDelta, onEnd]);

  return handlePointerDown;
}
