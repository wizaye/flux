/**
 * Renders lucide icons as detached DOM <svg> nodes for use inside
 * the CodeMirror autocomplete tooltip.
 *
 * Why this exists:
 *   • CM6's `addToOptions.render(...)` expects a real DOM `Node` per
 *     visible completion (no React tree involved). Lucide ships as
 *     React components.
 *   • Rendering the React tree once at module load via
 *     `renderToStaticMarkup`, then cloning the resulting SVG per
 *     row, keeps the popover free of React reconciler overhead and
 *     avoids bundling `lucide-static`.
 *   • The cache key is the icon's `displayName` so we never re-render
 *     the same icon twice across the app's lifetime.
 */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ArrowDownToLine,
  Code,
  FileImage,
  Hash,
  Heading1,
  Heading2,
  Heading3,
  Image,
  Kanban,
  Link,
  List,
  ListOrdered,
  Minus,
  Quote,
  Sigma,
  SquareCheck,
  SquareDashed,
  Table,
  Type,
  Variable,
  type LucideIcon,
} from "lucide-react";

/** Stable set of completion categories. Each one maps to a lucide
 *  React icon below. */
export type CompletionIconKind =
  | "note"
  | "image"
  | "pdf"
  | "media"
  | "heading-1"
  | "heading-2"
  | "heading-3"
  | "bullet-list"
  | "numbered-list"
  | "task"
  | "quote"
  | "code"
  | "inline-code"
  | "divider"
  | "table"
  | "callout"
  | "math"
  | "wikilink"
  | "embed"
  | "work-item"
  | "kanban";

const ICON_BY_KIND: Record<CompletionIconKind, LucideIcon | "md" | "pdf"> = {
  // `note` + `pdf` use bespoke badge SVGs that print the format
  // letters inside a file-shape \u2014 lucide doesn't ship a branded
  // MD/PDF icon and a plain `FileText` glyph is ambiguous in a list
  // of mixed file types. See `customBadgeSvg` below.
  note: "md",
  image: FileImage,
  pdf: "pdf",
  media: SquareDashed,
  "heading-1": Heading1,
  "heading-2": Heading2,
  "heading-3": Heading3,
  "bullet-list": List,
  "numbered-list": ListOrdered,
  task: SquareCheck,
  quote: Quote,
  code: Code,
  "inline-code": Variable,
  divider: Minus,
  table: Table,
  callout: ArrowDownToLine,
  math: Sigma,
  wikilink: Link,
  embed: Image,
  "work-item": Hash,
  kanban: Kanban,
};

const svgCache = new Map<CompletionIconKind, string>();

/** Hand-rolled file-shape badge that prints a 2-character format
 *  label inside (e.g. "MD", "PDF"). Lucide's `FileText` doesn't
 *  communicate the file type, and using `lucide-static` here would
 *  bloat the bundle for two glyphs. */
function customBadgeSvg(label: string): string {
  // Visual reference points (14\u00d714 viewBox, stroke 1.75 to match
  // lucide). The label is centred horizontally and vertically.
  const fontSize = label.length <= 2 ? 5.5 : 4.5;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14"`,
    ` viewBox="0 0 24 24" fill="none" stroke="currentColor"`,
    ` stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">`,
    // File outline with corner fold (matches lucide File silhouette).
    `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>`,
    `<polyline points="14 2 14 8 20 8"/>`,
    // Format label \u2014 currentColor so it inherits the row's color.
    `<text x="12" y="${label.length <= 2 ? 17.5 : 17}"`,
    ` text-anchor="middle" font-family="var(--font-mono, ui-monospace, monospace)"`,
    ` font-size="${fontSize}" font-weight="700" fill="currentColor"`,
    ` stroke="none" letter-spacing="0.4">${label}</text>`,
    `</svg>`,
  ].join("");
}

/** Render the icon for `kind` as an SVG markup string. Cached on
 *  first call \u2014 every subsequent call is a Map lookup + parse. */
function svgFor(kind: CompletionIconKind): string {
  const cached = svgCache.get(kind);
  if (cached) return cached;
  const entry = ICON_BY_KIND[kind] ?? Type;
  let markup: string;
  if (entry === "md") {
    markup = customBadgeSvg("MD");
  } else if (entry === "pdf") {
    markup = customBadgeSvg("PDF");
  } else {
    markup = renderToStaticMarkup(
      React.createElement(entry, {
        size: 14,
        strokeWidth: 1.75,
        // Make the stroke pick up the row's `color` so the icon stays
        // legible in selected / hover states.
        color: "currentColor",
      }),
    );
  }
  svgCache.set(kind, markup);
  return markup;
}

/** Build a fresh DOM `<span>` containing the rendered icon for `kind`.
 *  Safe to call once per visible completion row. */
export function iconNodeFor(kind: CompletionIconKind | undefined): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = "cm-flux-icon";
  wrap.setAttribute("aria-hidden", "true");
  wrap.innerHTML = kind ? svgFor(kind) : "";
  return wrap;
}
