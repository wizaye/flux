/**
 * Markdown shortcut input handlers.
 *
 * Two small input rules that fire on each keystroke before the
 * default insert lands, returning `true` when we handled the
 * transaction so CodeMirror skips its own default.
 *
 *   1. Triple-backtick fence auto-close — typing the third `` ` ``
 *      at the start of a line (optionally with leading whitespace
 *      for list-nested fences) inserts a matching closing fence two
 *      lines below and parks the cursor on the language line.
 *      Mirrors the Obsidian / VS Code behaviour everyone expects.
 *
 *   2. Triple-dollar math block — same pattern for `$$`, expanding
 *      to a centred math block with the cursor on the empty middle
 *      line.
 *
 * These are deliberately conservative: only fire when the user
 * literally types the trigger char at the right column AND nothing
 * comes after on the line. That avoids interfering with people
 * editing existing fences or pasting blocks.
 */
import { EditorView } from "@codemirror/view";

/** Triple-backtick fence at start of a line. */
function expandFence(view: EditorView): boolean {
  const { state } = view;
  const { main } = state.selection;
  if (!main.empty) return false;

  const line = state.doc.lineAt(main.head);
  const col = main.head - line.from;
  // Need at least two backticks already typed BEFORE the cursor on
  // this line, and the user is about to insert the third.
  if (col < 2) return false;
  const before = line.text.slice(0, col);
  // Allow any leading whitespace (list-nested fences) then exactly
  // two backticks.
  if (!/^\s*``$/.test(before)) return false;
  // Don't expand if there's already text after the cursor on the
  // line — user is probably editing an inline `` `code` `` block.
  if (col < line.text.length) return false;

  const leading = before.match(/^\s*/)![0];
  const insert = "`\n" + leading + "\n" + leading + "```";
  // Cursor lands on the language-tag line (same line as the
  // opening fence, right after the third backtick).
  const cursorAt = main.head + 1;
  view.dispatch({
    changes: { from: main.head, to: main.head, insert },
    selection: { anchor: cursorAt },
    userEvent: "input.type",
  });
  return true;
}

/** Triple-dollar math block at start of a line. */
function expandMathBlock(view: EditorView): boolean {
  const { state } = view;
  const { main } = state.selection;
  if (!main.empty) return false;

  const line = state.doc.lineAt(main.head);
  const col = main.head - line.from;
  if (col < 1) return false;
  const before = line.text.slice(0, col);
  // Exactly one `$` already typed, about to type the second.
  if (!/^\s*\$$/.test(before)) return false;
  if (col < line.text.length) return false;

  const leading = before.match(/^\s*/)![0];
  // After this transaction the doc will read:
  //   `$$\n<leading>|\n<leading>$$`
  const insert = "$\n" + leading + "\n" + leading + "$$";
  const cursorAt = main.head + 2 + leading.length;
  view.dispatch({
    changes: { from: main.head, to: main.head, insert },
    selection: { anchor: cursorAt },
    userEvent: "input.type",
  });
  return true;
}

export const markdownShortcuts = EditorView.inputHandler.of(
  (view, _from, _to, text) => {
    if (text === "`") return expandFence(view);
    if (text === "$") return expandMathBlock(view);
    return false;
  },
);
