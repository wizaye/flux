/**
 * Custom drag image — the floating chip rendered below + right of the
 * cursor while a tab / file is being dragged. Replaces the browser's
 * default washed-out copy of the source element.
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

export type DragGhostOptions = {
  /** Optional Lucide-style inline SVG to prepend before the label. */
  iconSvg?: string;
  /** Override the chip's background. Defaults to a dark-mode-friendly
   *  surface — but the file-tree caller passes a theme-aware tone. */
  background?: string;
  /** Override text colour. */
  color?: string;
};

export function setDragImageBelowCursor(
  e: React.DragEvent | DragEvent,
  label: string,
  options: DragGhostOptions = {},
): void {
  if (typeof document === "undefined") return;
  const dt = (e as DragEvent).dataTransfer;
  if (!dt) return;

  const isDark =
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark");
  const background = options.background
    ?? (isDark ? "#2b2b2b" : "#ffffff");
  const color = options.color
    ?? (isDark ? "#dcddde" : "#1f1f1f");
  const border = isDark
    ? "1px solid rgba(255,255,255,0.12)"
    : "1px solid rgba(0,0,0,0.10)";

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
  chip.style.cssText = [
    "display:inline-flex",
    "align-items:center",
    "gap:6px",
    "padding:4px 10px",
    `background:${background}`,
    `border:${border}`,
    "border-radius:9999px",
    "box-shadow:0 6px 18px rgba(0,0,0,0.28)",
    "font-size:12px",
    "font-weight:500",
    `color:${color}`,
    "white-space:nowrap",
    "max-width:280px",
    "overflow:hidden",
    "text-overflow:ellipsis",
    "font-family:'Public Sans Variable',sans-serif",
    "line-height:1",
  ].join(";");

  if (options.iconSvg) {
    const iconWrap = document.createElement("span");
    iconWrap.style.cssText = [
      "display:inline-flex",
      "align-items:center",
      "width:14px",
      "height:14px",
      "flex-shrink:0",
      `color:${color}`,
      "opacity:0.8",
    ].join(";");
    iconWrap.innerHTML = options.iconSvg;
    chip.appendChild(iconWrap);
  }

  const text = document.createElement("span");
  text.textContent = label;
  text.style.cssText = [
    "overflow:hidden",
    "text-overflow:ellipsis",
    "white-space:nowrap",
    "max-width:240px",
  ].join(";");
  chip.appendChild(text);

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
