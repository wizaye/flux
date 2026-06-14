/**
 * Custom drag image — the floating chip rendered below + right of the
 * cursor while a tab is being dragged. Replaces the browser's default
 * washed-out copy of the source element.
 *
 * Ported from `lattice/src/components/common/dragGhost.ts`. The
 * positioning trick: setDragImage anchors the cursor at (0, 0) of the
 * passed element, so we wrap the visible chip in a transparent padding
 * box — the chip then renders 14px below + 14px right of the cursor
 * tail without any further math.
 *
 * The ghost element is appended to `document.body` and self-cleans
 * after one animation frame (the browser has already captured the
 * bitmap by that point).
 */
export function setDragImageBelowCursor(
  e: React.DragEvent | DragEvent,
  label: string,
): void {
  if (typeof document === "undefined") return;
  const dt = (e as DragEvent).dataTransfer;
  if (!dt) return;

  const wrap = document.createElement("div");
  wrap.style.cssText = [
    "position:absolute",
    "top:-1000px",
    "left:-1000px",
    "padding:14px 0 0 14px",
    "pointer-events:none",
    "z-index:-1",
  ].join(";");

  const chip = document.createElement("div");
  chip.textContent = label;
  chip.style.cssText = [
    "display:inline-flex",
    "align-items:center",
    "padding:5px 10px",
    "background:#2b2b2b",
    "border:1px solid rgba(255,255,255,0.12)",
    "border-radius:6px",
    "box-shadow:0 4px 14px rgba(0,0,0,0.35)",
    "font-size:12px",
    "color:#dcddde",
    "white-space:nowrap",
    "max-width:280px",
    "overflow:hidden",
    "text-overflow:ellipsis",
    "font-family:'Public Sans Variable',sans-serif",
  ].join(";");

  wrap.appendChild(chip);
  document.body.appendChild(wrap);

  try {
    dt.setDragImage(wrap, 0, 0);
  } catch {
    /* Some webview builds reject custom drag images — silently fall
       back to the browser default. */
  }

  // Pull the throwaway out of the DOM once the browser has snapshotted
  // the bitmap (next frame is always enough).
  requestAnimationFrame(() => {
    if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
  });
}

/** Read the editor's drag payload off a native DragEvent. */
export function readDragPayload(
  e: React.DragEvent | DragEvent,
): import("@/state/editor").DragPayload | null {
  const dt = (e as DragEvent).dataTransfer;
  if (!dt) return null;
  const tabJson = dt.getData("application/x-flux-tab");
  if (tabJson) {
    try {
      const o = JSON.parse(tabJson) as { leafId: string; tabId: string };
      return { kind: "tab", leafId: o.leafId, tabId: o.tabId };
    } catch {
      /* fall through to file check */
    }
  }
  const fileId = dt.getData("application/x-flux-file-id");
  if (fileId) return { kind: "file", fileId };
  return null;
}
