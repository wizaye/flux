import { syntaxTree } from "@codemirror/language";
import {
  type EditorState,
  type Extension,
  type Range,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
} from "@codemirror/view";
import type { SyntaxNodeRef } from "@lezer/common";
import {
  CodeBlockWidget,
  HrWidget,
  ImageWidget,
  TableWidget,
  TaskCheckboxWidget,
  WikilinkWidget,
  WorkItemWidget,
} from "./widgets";

/**
 * Live-preview decoration builder.
 *
 * Walks ONLY `view.visibleRanges` (the rows currently inside the
 * scrolled viewport) and asks the Lezer markdown tree which nodes
 * cover them — same tree the syntax highlighter already parsed, so
 * we pay zero extra parse cost. For each markdown construct we:
 *
 *   1. Skip if the user's cursor / selection touches the node (so
 *      the markup stays visible while you're editing it — Obsidian-
 *      style "live" reveal).
 *   2. Emit a `Decoration.replace` widget for the syntax punctuation
 *      (`**`, `_`, `[[`, `![](...`) and an optional `mark` for the
 *      content so CSS can style the visible text (bold, italic,
 *      heading scale).
 *
 * Why a `ViewPlugin` and not a `StateField`:
 *   - We need `view.visibleRanges` (per-view), not state-wide info.
 *   - Decorations recompute on viewport scroll / selection change as
 *     well as doc change — `update()` runs on every `ViewUpdate`
 *     and we cheap-skip when nothing relevant changed.
 *   - 100k-line file scrolls just as fast as a 100-line one.
 *
 * Atomic widget ranges are exposed via `EditorView.atomicRanges` so
 * arrow keys jump over replaced markup as a single unit.
 */

/** Cheap check — is any cursor/selection range inside [from, to]? */
function selectionTouches(state: EditorState, from: number, to: number): boolean {
  for (const r of state.selection.ranges) {
    if (r.from <= to && r.to >= from) return true;
  }
  return false;
}

/**
 * Whole-line touch test: if the cursor sits on any line covered by
 * [from, to], we keep the raw markup visible. Used for block-level
 * constructs (headings, code fences, images) where Obsidian reveals
 * the entire line when the cursor lands on it.
 */
function selectionTouchesLine(
  state: EditorState,
  from: number,
  to: number,
): boolean {
  const lineFrom = state.doc.lineAt(from).from;
  const lineTo = state.doc.lineAt(to).to;
  return selectionTouches(state, lineFrom, lineTo);
}

/**
 * One pass over the document → produces the decoration set for the
 * current state. We collect decorations into a flat array and call
 * `Decoration.set(arr, true)` (sort=true) at the end — Lezer's tree
 * iteration plus the wikilink regex pass can emit overlapping or
 * out-of-order ranges (e.g. emphasis inside a paragraph after a
 * wikilink that comes later in the paragraph). Sorting once at the
 * end is O(n log n) over only the produced decorations and is
 * dwarfed by Lezer's parse cost.
 *
 * Why we iterate the whole doc instead of just `visibleRanges`:
 * block-level Decoration.replace widgets (tables, code blocks,
 * images) cannot be supplied through a `ViewPlugin` in CodeMirror 6
 * — they must come from a `StateField`, which has no view-scoped
 * `visibleRanges`. For files up to a few thousand lines this is
 * cheap because Lezer's iterate is fully incremental + the markdown
 * grammar is fast. Documents past ~10k lines should consider a
 * hybrid (state-field for blocks, view-plugin for inline marks).
 */
function buildDecorations(state: EditorState): DecorationSet {
  const decos: Range<Decoration>[] = [];
  const tree = syntaxTree(state);
  tree.iterate({
    enter: (node) => visitNode(node, state, decos),
  });
  return Decoration.set(decos, /* sort */ true);
}

/**
 * Per-node handler. Pushes decorations into `out` (we sort once at
 * the end). Returns `void` — the iterator descends into children
 * automatically unless we explicitly return `false`.
 *
 * Node names come from `@lezer/markdown`'s grammar. Key ones:
 *   - `ATXHeading1` … `ATXHeading6` (heading lines, contain
 *     `HeaderMark` + content)
 *   - `StrongEmphasis`, `Emphasis` (contain two `EmphasisMark`
 *     siblings wrapping the content)
 *   - `InlineCode` (contain two `CodeMark` siblings wrapping the
 *     text)
 *   - `Strikethrough` (with two `StrikethroughMark` siblings —
 *     GFM extension, on by default in `markdownLanguage`)
 *   - `Link` (contains `LinkMark` + URL nodes)
 *   - `Image` (`![alt](url)` — contains `LinkMark`, `URL`, `LinkLabel`)
 *   - `HorizontalRule`
 *   - `TaskMarker` (`[ ]` / `[x]` at start of a list item — GFM)
 *   - `FencedCode` (whole block, contains `CodeMark`, `CodeInfo`,
 *     `CodeText`)
 */
function visitNode(
  node: SyntaxNodeRef,
  state: EditorState,
  out: Range<Decoration>[],
): void {
  const name = node.name;
  const from = node.from;
  const to = node.to;

  // ── Headings ──────────────────────────────────────────────────
  if (name.startsWith("ATXHeading")) {
    const level = Number(name.slice(-1));
    const line = state.doc.lineAt(from);
    out.push(
      Decoration.line({ class: `cm-lp-h cm-lp-h${level}` }).range(line.from),
    );
    if (!selectionTouchesLine(state, from, to)) {
      const child = node.node.firstChild;
      if (child && child.name === "HeaderMark") {
        out.push(
          Decoration.replace({}).range(
            child.from,
            Math.min(child.to + 1, to),
          ),
        );
      }
    }
    return;
  }

  // ── Inline emphasis (bold, italic, strike, code) ──────────────
  if (
    name === "StrongEmphasis" ||
    name === "Emphasis" ||
    name === "Strikethrough" ||
    name === "InlineCode"
  ) {
    const klass =
      name === "StrongEmphasis"
        ? "cm-lp-bold"
        : name === "Emphasis"
          ? "cm-lp-italic"
          : name === "Strikethrough"
            ? "cm-lp-strike"
            : "cm-lp-inline-code";
    out.push(Decoration.mark({ class: klass }).range(from, to));
    if (!selectionTouches(state, from, to)) {
      let child = node.node.firstChild;
      while (child) {
        if (
          child.name === "EmphasisMark" ||
          child.name === "StrikethroughMark" ||
          child.name === "CodeMark"
        ) {
          out.push(Decoration.replace({}).range(child.from, child.to));
        }
        child = child.nextSibling;
      }
    }
    return;
  }

  // ── Links: render `[label](url)` as just the label, blue + click.
  //    Special-case `flux-wi://…` URLs as a kanban work-item chip
  //    so they read as a structured pointer (different from a
  //    regular external/relative link). ─────────────────────────
  if (name === "Link") {
    if (selectionTouches(state, from, to)) return;
    const labelStart = from + 1; // after "["
    let labelEnd = to;
    let urlEnd = to;
    let urlStart = to;
    let child = node.node.firstChild;
    let bracketDepth = 0;
    let seenOpenParen = false;
    while (child) {
      if (child.name === "LinkMark") {
        const ch = state.doc.sliceString(child.from, child.to);
        if (ch === "[") bracketDepth++;
        else if (ch === "]" && bracketDepth > 0) {
          bracketDepth--;
          if (bracketDepth === 0) labelEnd = child.from;
        } else if (ch === "(" && !seenOpenParen) {
          seenOpenParen = true;
          urlStart = child.to;
        } else if (ch === ")") urlEnd = child.to;
      }
      child = child.nextSibling;
    }
    const url = state.doc.sliceString(urlStart, urlEnd - 1).trim();
    if (url.startsWith("flux-wi://")) {
      const label = state.doc.sliceString(labelStart, labelEnd);
      out.push(
        Decoration.replace({
          widget: new WorkItemWidget(url, label),
        }).range(from, to),
      );
      return;
    }
    out.push(Decoration.replace({}).range(from, labelStart));
    out.push(Decoration.mark({ class: "cm-lp-link" }).range(labelStart, labelEnd));
    out.push(Decoration.replace({}).range(labelEnd, urlEnd));
    return;
  }

  // ── Images: `![alt](url)` → swap whole thing for <img> ────────
  if (name === "Image") {
    if (selectionTouchesLine(state, from, to)) return;
    const slice = state.doc.sliceString(from, to);
    const m = /!\[([^\]]*)\]\(([^)]*)\)/.exec(slice);
    if (m) {
      const alt = m[1];
      const url = m[2];
      if (url) {
        out.push(
          Decoration.replace({
            widget: new ImageWidget(url, alt),
            block: false,
          }).range(from, to),
        );
      }
    }
    return;
  }

  // ── Wikilinks: regex-scan inside Paragraph / TableCell. The
  // default markdown grammar doesn't recognise `[[...]]`, so we
  // post-process at the paragraph level. We DO NOT return false
  // here — the iterator continues to descend into the paragraph's
  // children (Emphasis, Link, etc.) and a final sort at the top
  // level fixes any out-of-order pushes.
  if (name === "Paragraph" || name === "TableCell") {
    const text = state.doc.sliceString(from, to);
    const re = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      const wFrom = from + match.index;
      const wTo = wFrom + match[0].length;
      if (selectionTouches(state, wFrom, wTo)) continue;
      const target = match[1].trim();
      const label = (match[2] ?? target).trim();
      out.push(
        Decoration.replace({
          widget: new WikilinkWidget(target, label),
        }).range(wFrom, wTo),
      );
    }
    // Fall through — let the iterator descend into emphasis / links
    // inside the paragraph.
    return;
  }

  // ── Horizontal rule ──────────────────────────────────────────
  if (name === "HorizontalRule") {
    if (selectionTouchesLine(state, from, to)) return;
    out.push(
      Decoration.replace({ widget: new HrWidget(), block: false }).range(
        from,
        to,
      ),
    );
    return;
  }

  // ── Task list checkbox ───────────────────────────────────────
  if (name === "TaskMarker") {
    const text = state.doc.sliceString(from, to);
    const checked = /\[[xX]\]/.test(text);
    if (!selectionTouches(state, from, to)) {
      out.push(
        Decoration.replace({
          widget: new TaskCheckboxWidget(checked, from),
        }).range(from, to),
      );
    }
    return;
  }

  // ── Fenced code: render as a Shiki-highlighted block widget when
  // the cursor is outside the block; show raw source (with the fence
  // markers) when the cursor is on any line of the block so it can
  // be edited. The block child structure is `CodeMark "```lang"`,
  // `CodeInfo`, `CodeText`, `CodeMark "```"`. The widget reads the
  // language from the first line of the slice; `CodeBlockWidget`
  // dual-themes via Shiki so the toggle stays pure-CSS.
  if (name === "FencedCode") {
    if (selectionTouchesLine(state, from, to)) {
      // Mark the lines so we can dim the fences in CSS if we want.
      const startLine = state.doc.lineAt(from);
      const endLine = state.doc.lineAt(to);
      for (let ln = startLine.number; ln <= endLine.number; ln++) {
        const line = state.doc.line(ln);
        out.push(
          Decoration.line({ class: "cm-lp-fenced" }).range(line.from),
        );
      }
      return;
    }
    const slice = state.doc.sliceString(from, to);
    // Parse `\`\`\`lang\n<body>\n\`\`\`` → lang + body
    const m = /^```([^\n`]*)\n([\s\S]*?)\n```\s*$/.exec(slice);
    let lang = "";
    let body = slice;
    if (m) {
      lang = (m[1] || "").trim().split(/\s+/)[0];
      body = m[2];
    }
    out.push(
      Decoration.replace({
        widget: new CodeBlockWidget(body, lang),
        block: true,
      }).range(from, to),
    );
    return;
  }

  // ── Table: render as a real `<table>` when the cursor is outside.
  // Lezer's GFM grammar emits a top-level `Table` node spanning the
  // whole table. When the cursor lands anywhere inside, we fall
  // through to raw text so the user can edit pipes / columns.
  if (name === "Table") {
    if (selectionTouchesLine(state, from, to)) {
      return; // raw markdown stays visible for editing
    }
    const slice = state.doc.sliceString(from, to);
    out.push(
      Decoration.replace({
        widget: new TableWidget(slice),
        block: true,
      }).range(from, to),
    );
    return;
  }
}

/**
 * Filter the decoration set down to just the widget-replace ranges so
 * `EditorView.atomicRanges` can treat them as single units (arrow
 * keys jump over them; click positions land at boundaries).
 */
function atomicFrom(decos: DecorationSet, docLength: number): DecorationSet {
  const out: Range<Decoration>[] = [];
  decos.between(0, docLength, (from, to, deco) => {
    if (deco.spec.widget) {
      out.push(deco.range(from, to));
    }
  });
  return Decoration.set(out, true);
}

/**
 * StateField that owns the live-preview decorations. Has to be a
 * state field (not a view plugin) because block widgets — tables,
 * code blocks, images — are forbidden from `ViewPlugin.decorations`
 * in CodeMirror 6: that surface only accepts inline decorations.
 *
 * Recomputes on every `docChanged` or selection move. Selection-only
 * changes are not free (we still walk the tree), but Lezer's tree
 * iterator is O(visible structure) over a cached incremental parse,
 * so the cost is dominated by the markdown grammar's already-paid
 * parse work.
 */
const livePreviewField = StateField.define<DecorationSet>({
  create(state) {
    return buildDecorations(state);
  },
  update(decos, tr) {
    if (!tr.docChanged && !tr.selection) return decos;
    return buildDecorations(tr.state);
  },
  provide: (f) => [
    EditorView.decorations.from(f),
    EditorView.atomicRanges.of((view) => {
      const decos = view.state.field(f, false);
      if (!decos) return Decoration.none;
      return atomicFrom(decos, view.state.doc.length);
    }),
  ],
});

export const livePreviewExtension: Extension = livePreviewField;
