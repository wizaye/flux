/**
 * Slash-command completions.
 *
 * Trigger: a `/` typed at the very start of a line (optionally
 * after leading whitespace). The menu offers quick inserts for the
 * markdown constructs people reach for most often, plus a hook to
 * open the kanban work-item picker.
 *
 * Implementation notes:
 *   • This is a plain `CompletionSource` — same pipeline as
 *     wikilink autocomplete, so users see one unified popover with
 *     identical keyboard handling (↑/↓, Enter, Esc).
 *   • Each completion knows how to apply itself: most replace the
 *     `/query` token with the snippet body and place the cursor on
 *     a marker, a few dispatch a custom event that opens a plugin
 *     dialog.
 *   • We deliberately keep the trigger strict (must be at line
 *     start) so `https://` and `1/2` don't open the menu.
 */
import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  insertCompletionText,
} from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";

interface SlashItem {
  label: string;
  detail?: string;
  /** Body inserted at the cursor. Use `$|` to mark the post-insert
   *  cursor position. `$\n` puts the cursor at the end of the body
   *  (default). */
  body?: string;
  /** Custom apply — full control over the transaction. Mutually
   *  exclusive with `body`. */
  apply?: (view: EditorView, from: number, to: number) => void;
}

const ITEMS: SlashItem[] = [
  { label: "Heading 1", detail: "# ", body: "# $|" },
  { label: "Heading 2", detail: "## ", body: "## $|" },
  { label: "Heading 3", detail: "### ", body: "### $|" },
  { label: "Bullet list", detail: "- ", body: "- $|" },
  { label: "Numbered list", detail: "1. ", body: "1. $|" },
  { label: "Task", detail: "- [ ] ", body: "- [ ] $|" },
  { label: "Quote", detail: "> ", body: "> $|" },
  { label: "Code block", detail: "``` … ```", body: "```$|\n\n```" },
  { label: "Inline code", detail: "`code`", body: "`$|`" },
  { label: "Divider", detail: "---", body: "---\n$|" },
  {
    label: "Table",
    detail: "| col | col |",
    body: "| $| |  |\n| --- | --- |\n|  |  |",
  },
  { label: "Callout", detail: "> [!note]", body: "> [!note]\n> $|" },
  { label: "Math (block)", detail: "$$ … $$", body: "$$\n$|\n$$" },
  { label: "Wikilink", detail: "[[…]]", body: "[[$|]]" },
  {
    label: "Embed image",
    detail: "![[…]]",
    body: "![[$|]]",
  },
  {
    label: "Link to work item",
    detail: "kanban",
    apply: (view, from, to) => {
      // Remove the `/query` token first, then dispatch the kanban
      // picker. The picker's `onPicked` handler inserts the link at
      // the cursor we leave behind.
      view.dispatch({
        changes: { from, to, insert: "" },
        selection: { anchor: from },
      });
      window.dispatchEvent(new CustomEvent("flux-kanban-link-work-item"));
    },
  },
  {
    label: "New kanban board",
    detail: "kanban",
    apply: (view, from, to) => {
      view.dispatch({
        changes: { from, to, insert: "" },
        selection: { anchor: from },
      });
      window.dispatchEvent(new CustomEvent("flux-kanban-new-board"));
    },
  },
];

function applySnippet(
  view: EditorView,
  from: number,
  to: number,
  body: string,
): void {
  const cursorMarker = "$|";
  const idx = body.indexOf(cursorMarker);
  const clean = idx >= 0 ? body.replace(cursorMarker, "") : body;
  const tr = insertCompletionText(view.state, clean, from, to);
  view.dispatch(tr);
  // Place cursor on the marker if specified, else at the end of the
  // inserted text. `insertCompletionText` already moves the
  // selection to `from + clean.length`; only adjust if we have a
  // marker that isn't at the very end.
  if (idx >= 0 && idx !== clean.length) {
    const anchor = from + idx;
    view.dispatch({ selection: { anchor } });
  }
}

export function slashCompletions(
  context: CompletionContext,
): CompletionResult | null {
  // Match `/` (optionally followed by more chars) at start-of-line
  // — leading whitespace allowed so it works inside list items.
  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);
  const m = /(^|^\s+)\/([\w-]*)$/.exec(before);
  if (!m) return null;
  // Don't trigger when the user just typed a date / fraction / URL.
  // The strict line-start regex already excludes those.
  const tokenStart = line.from + (before.length - m[2].length - 1);
  const tokenEnd = context.pos;

  const options: Completion[] = ITEMS.map((item) => ({
    label: "/" + item.label.toLowerCase().replace(/\s+/g, "-"),
    displayLabel: item.label,
    detail: item.detail,
    type: "keyword",
    apply: (view, _completion, _from, _to) => {
      if (item.apply) {
        item.apply(view, tokenStart, tokenEnd);
        return;
      }
      applySnippet(view, tokenStart, tokenEnd, item.body ?? "");
    },
  }));

  return {
    from: tokenStart,
    to: tokenEnd,
    options,
    filter: true,
  };
}