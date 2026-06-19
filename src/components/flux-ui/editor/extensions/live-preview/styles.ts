import { EditorView } from "@codemirror/view";

/**
 * CodeMirror theme for the live-preview decorations. Kept in a
 * separate module so the plugin file stays focused on the data side.
 *
 * Strategy:
 *   • Hidden syntax (`**`, `_`, `#`) is replaced with empty widgets
 *     so there's nothing to style here.
 *   • Visible content is wrapped in `cm-lp-*` marks (Decoration.mark)
 *     and lines are tagged with `cm-lp-h{n}` for heading sizing.
 *   • All visual values come from the same `--text-*` / `--syn-*` /
 *     `--text-link` tokens the reading view uses — switches palette
 *     for free when `.dark` flips on <html>. Zero JS on theme toggle.
 *
 * Two extensions are exported because CodeMirror's `baseTheme` /
 * `theme` API can't express a `:root.dark` rule directly — we ship
 * the dark-mode overrides as a sibling base theme that uses the
 * `{ dark: true }` flag (CM auto-applies it when the editor's
 * `EditorView.darkTheme` facet says so), AND we expose a tiny plain
 * `<style>` injection for the rules that have to be document-wide
 * (Shiki token colour swap under `:root.dark`).
 */
const baseStyles = EditorView.baseTheme({
  // Headings — match the reading view's scale ratios.
  ".cm-lp-h": { fontWeight: "700", lineHeight: "1.25" },
  ".cm-lp-h1": {
    fontSize: "1.9em",
    borderBottom: "1px solid var(--border-strong)",
    paddingBottom: "0.2em",
  },
  ".cm-lp-h2": {
    fontSize: "1.5em",
    borderBottom: "1px solid var(--border-strong)",
    paddingBottom: "0.15em",
  },
  ".cm-lp-h3": { fontSize: "1.25em" },
  ".cm-lp-h4": { fontSize: "1.1em" },
  ".cm-lp-h5": { fontSize: "1em" },
  ".cm-lp-h6": { fontSize: "0.9em", color: "var(--text-muted)" },

  // Inline emphasis.
  ".cm-lp-bold": { fontWeight: "700", color: "var(--text-normal)" },
  ".cm-lp-italic": { fontStyle: "italic" },
  ".cm-lp-strike": {
    textDecoration: "line-through",
    color: "var(--text-muted)",
  },
  ".cm-lp-inline-code": {
    fontFamily: "var(--font-mono)",
    fontSize: "0.92em",
    padding: "0.1em 0.3em",
    background: "var(--hover)",
    borderRadius: "3px",
  },

  // Links & wikilinks.
  ".cm-lp-link": { color: "var(--text-link)", cursor: "pointer" },
  ".cm-lp-wikilink": {
    color: "var(--text-link)",
    cursor: "pointer",
    borderBottom: "1px dashed currentColor",
    textDecoration: "none",
  },

  // Inline image — keep it bounded so a 4k image doesn't blow up the
  // editor viewport.
  ".cm-lp-image": {
    display: "block",
    margin: "0.6em 0",
  },
  ".cm-lp-image img": {
    maxWidth: "100%",
    height: "auto",
    borderRadius: "6px",
  },

  // Horizontal rule.
  ".cm-lp-hr": {
    border: "none",
    borderTop: "1px solid var(--border-strong)",
    margin: "1.2em 0",
  },

  // Task checkbox.
  ".cm-lp-task": {
    margin: "0 0.45em 0.18em 0",
    verticalAlign: "middle",
    accentColor: "var(--text-link)",
    cursor: "pointer",
  },

  // Fenced-code line — subtle background to mark the block when the
  // cursor is inside and we're showing raw markdown.
  ".cm-lp-fenced": {
    fontFamily: "var(--font-mono)",
    fontSize: "0.95em",
  },

  // Code-block widget (shown when cursor is OUTSIDE the fence). The
  // widget body is a `<pre class="shiki ...">` from shiki dual-theme,
  // so token colours pick up `--shiki-light` / `--shiki-dark`. We
  // only need to style the chrome around it.
  ".cm-lp-codeblock": {
    margin: "0.8em 0",
    borderRadius: "6px",
    border: "1px solid var(--border-strong)",
    background: "color-mix(in srgb, var(--bg-header) 70%, #000 10%)",
    overflow: "auto",
    fontFamily: "var(--font-mono)",
    fontSize: "0.88em",
    lineHeight: "1.5",
  },
  ".cm-lp-codeblock pre": {
    margin: 0,
    padding: "12px 14px",
    background: "transparent !important",
    overflow: "visible",
  },
  ".cm-lp-codeblock pre.shiki": {
    background: "transparent !important",
  },
  ".cm-lp-codeblock pre.shiki, .cm-lp-codeblock pre.shiki span": {
    color: "var(--shiki-light)",
  },
  // (Dark-mode override for shiki tokens lives in the global
  // stylesheet appended below — `:root.dark` selectors can't be
  // expressed inside CM's baseTheme.)

  // Table widget (shown when cursor is OUTSIDE the table block).
  ".cm-lp-table-wrap": {
    margin: "0.9em 0",
    overflowX: "auto",
  },
  ".cm-lp-table": {
    borderCollapse: "collapse",
    width: "100%",
    fontSize: "0.95em",
    fontFamily: "var(--font-text)",
  },
  ".cm-lp-table th, .cm-lp-table td": {
    padding: "8px 14px",
    border: "1px solid var(--border-strong)",
    textAlign: "left",
    verticalAlign: "top",
    color: "var(--text-normal)",
  },
  ".cm-lp-table th": {
    background:
      "color-mix(in srgb, var(--text-link) 10%, var(--bg-header))",
    fontWeight: "600",
  },
  ".cm-lp-table tr:nth-child(even) td": {
    background:
      "color-mix(in srgb, var(--bg-header) 90%, var(--text-faint) 10%)",
  },
});

/**
 * Document-global rules the CM theme can't express because they
 * scope off `<html>` (`:root.dark`) rather than the editor root.
 * Injected once into `<head>` the first time this module loads so
 * theme switches stay pure-CSS — no JS runs when the user presses D.
 */
const GLOBAL_STYLE_ID = "flux-live-preview-global";
if (
  typeof document !== "undefined" &&
  !document.getElementById(GLOBAL_STYLE_ID)
) {
  const el = document.createElement("style");
  el.id = GLOBAL_STYLE_ID;
  el.textContent = `
:root.dark .cm-lp-codeblock pre.shiki,
:root.dark .cm-lp-codeblock pre.shiki span {
  color: var(--shiki-dark);
}
`;
  document.head.appendChild(el);
}

export const livePreviewStyles = baseStyles;
