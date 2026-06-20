import { useEffect, useRef, useState } from "react";
import {
  EditorState,
  RangeSetBuilder,
  StateEffect,
  StateField,
  Transaction,
} from "@codemirror/state";
import { search, searchKeymap } from "@codemirror/search";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
  highlightActiveLine,
  rectangularSelection,
  crosshairCursor,
  Decoration,
  ViewPlugin,
  type DecorationSet,
  MatchDecorator,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import type { Command } from "@codemirror/view";
import { markdown, markdownLanguage, insertNewlineContinueMarkup, deleteMarkupBackward } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import {
  syntaxHighlighting,
  HighlightStyle,
  bracketMatching,
} from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import {
  closeBrackets,
  closeBracketsKeymap,
  autocompletion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { useEditorStore } from "@/state/editor-store";
import { useSettingsStore } from "@/state/settings-store";
import { usePluginStore } from "@/state/plugin-store";
import type { FileNode } from "@/state/editor";
import { vimMode as makeVimExtension } from "../../extensions/cm-vim";
import { livePreviewExtension, livePreviewStyles } from "../../extensions/live-preview";
import { taskActionExtension } from "../../extensions/task-action";
import { slashCompletions } from "../../extensions/slash-menu";
import { markdownShortcuts } from "../../extensions/markdown-shortcuts";
import { EMPTY_PANE_ACTIONS } from "../types";
import { PaneDocHeader } from "../../pane-doc-header";
import { EditorPaneLayout } from "../editor-pane-layout";

/**
 * Markdown CodeMirror surface for flux.
 *
 * Ported from `lattice/src/components/editor/CodeMirrorEditor.tsx`
 * with these intentional deltas:
 *   • No vault-store import — file lookup happens via the optional
 *     `vault` prop so panes can opt into wikilink autocomplete.
 *   • No jump-to-line / `flux-editor-find` event bridges — flux's
 *     backlink + doc-menu wiring lands in a later phase.
 *   • Theme tokens read from `:root` / `.dark` (`--text-normal`,
 *     `--selection`, `--syn-*` …) set in App.css — same CSS-var
 *     surface as lattice so theme switches are instant.
 */

const editorThemeBase = {
  "&": {
    color: "var(--text-normal)",
    backgroundColor: "transparent",
    height: "100%",
    fontFamily: "var(--font-text)",
    fontSize: "var(--editor-font-size, 16px)",
    lineHeight: "1.7",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--font-text)",
    overflow: "auto",
  },
  ".cm-content": {
    caretColor: "var(--text-normal)",
    fontFamily: "var(--font-text)",
    padding: "16px 24px 80px 24px",
    color: "var(--text-normal)",
  },
  ".cm-line": { color: "var(--text-normal)" },
  ".cm-lineNumbers .cm-gutterElement": {
    padding: "0 12px 0 8px",
    color: "var(--text-faint)",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--text-normal)",
    borderLeftWidth: "2px",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    {
      backgroundColor: "var(--selection) !important",
    },
  ".cm-panels": {
    backgroundColor: "var(--bg-header)",
    color: "var(--text-normal)",
    borderTop: "1px solid var(--border-strong)",
  },
  ".cm-activeLine": { backgroundColor: "transparent" },
  ".cm-selectionMatch": { backgroundColor: "var(--selection)" },
  "&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket": {
    backgroundColor: "var(--selection)",
    outline: "1px solid var(--border-strong)",
  },
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "var(--text-faint)",
    border: "none",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "transparent",
    color: "var(--text-muted)",
  },
  ".cm-foldPlaceholder": {
    backgroundColor: "transparent",
    border: "none",
    color: "var(--text-faint)",
  },
  ".cm-tooltip": {
    border: "1px solid var(--border-strong)",
    backgroundColor: "var(--bg-header)",
    color: "var(--text-normal)",
    borderRadius: "6px",
    boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
  },
  ".cm-tooltip-autocomplete": {
    "& > ul > li": {
      color: "var(--text-normal)",
      padding: "4px 8px",
    },
    "& > ul > li[aria-selected]": {
      backgroundColor: "var(--accent)",
      color: "var(--accent-foreground)",
    },
  },
};

const editorThemeDark = EditorView.theme(editorThemeBase, { dark: true });
const editorThemeLight = EditorView.theme(editorThemeBase, { dark: false });

const markdownHighlight = HighlightStyle.define([
  {
    tag: t.heading1,
    color: "var(--text-normal)",
    fontWeight: "700",
    fontSize: "1.6em",
    lineHeight: "1.3",
  },
  {
    tag: t.heading2,
    color: "var(--text-normal)",
    fontWeight: "700",
    fontSize: "1.35em",
    lineHeight: "1.3",
  },
  {
    tag: t.heading3,
    color: "var(--text-normal)",
    fontWeight: "600",
    fontSize: "1.2em",
  },
  {
    tag: t.heading4,
    color: "var(--text-normal)",
    fontWeight: "600",
    fontSize: "1.08em",
  },
  {
    tag: [t.heading5, t.heading6],
    color: "var(--text-normal)",
    fontWeight: "600",
  },
  { tag: t.strong, color: "var(--text-normal)", fontWeight: "700" },
  { tag: t.emphasis, color: "var(--text-normal)", fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  {
    tag: t.monospace,
    fontFamily: "var(--font-mono)",
    color: "var(--syn-mono)",
  },
  { tag: t.url, color: "var(--text-link)" },
  { tag: t.quote, color: "var(--text-muted)", fontStyle: "italic" },
  { tag: t.processingInstruction, color: "var(--text-faint)" },
  { tag: t.contentSeparator, color: "var(--text-muted)" },
  { tag: t.meta, color: "var(--text-muted)" },
  { tag: t.keyword, color: "var(--syn-keyword)" },
  { tag: [t.string, t.special(t.string)], color: "var(--syn-string)" },
  { tag: t.comment, color: "var(--syn-comment)", fontStyle: "italic" },
  { tag: t.number, color: "var(--syn-number)" },
  { tag: [t.atom, t.bool, t.null], color: "var(--syn-atom)" },
  { tag: [t.typeName, t.className], color: "var(--syn-type)" },
  { tag: t.function(t.variableName), color: "var(--syn-function)" },
  { tag: t.variableName, color: "var(--syn-variable)" },
  { tag: t.propertyName, color: "var(--syn-variable)" },
  { tag: t.tagName, color: "var(--syn-tag)" },
  { tag: t.attributeName, color: "var(--syn-attr)" },
  { tag: [t.operator, t.derefOperator], color: "var(--text-muted)" },
  { tag: t.punctuation, color: "var(--text-muted)" },
  { tag: t.bracket, color: "var(--text-muted)" },
  { tag: t.invalid, color: "#f97583" },
]);

// ── Wikilinks ──
const wikilinkDecorator = new MatchDecorator({
  regexp: /\[\[([^\]]+)\]\]/g,
  decoration: (match) =>
    Decoration.mark({
      class: "cm-wikilink",
      attributes: { "data-target": match[1] },
    }),
});

const wikilinkPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = wikilinkDecorator.createDeco(view);
    }
    update(update: {
      docChanged: boolean;
      viewportChanged: boolean;
    }) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = wikilinkDecorator.updateDeco(
          update as Parameters<typeof wikilinkDecorator.updateDeco>[0],
          this.decorations,
        );
      }
    }
  },
  { decorations: (v) => v.decorations },
);

const wikilinkStyle = EditorView.baseTheme({
  ".cm-wikilink": {
    color: "var(--text-link)",
    cursor: "pointer",
    textDecoration: "underline",
    textDecorationColor: "transparent",
    transition: "text-decoration-color 0.15s, background-color 0.15s",
    borderRadius: "3px",
    padding: "0 2px",
  },
  ".cm-wikilink:hover": {
    backgroundColor: "var(--hover)",
    textDecorationColor: "var(--text-link)",
  },
});

// ── Flash-line decoration (for future jump-to-line bridges) ──
const flashLineEffect = StateEffect.define<number>();
const clearFlashLineEffect = StateEffect.define<null>();

const flashLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(set, tr) {
    set = set.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(flashLineEffect)) {
        const ln = e.value;
        if (ln >= 1 && ln <= tr.state.doc.lines) {
          set = Decoration.set([
            Decoration.line({ class: "cm-flash-line" }).range(
              tr.state.doc.line(ln).from,
            ),
          ]);
        }
      } else if (e.is(clearFlashLineEffect)) {
        set = Decoration.none;
      }
    }
    return set;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const flashLineTheme = EditorView.baseTheme({
  ".cm-flash-line": {
    backgroundColor: "var(--selection)",
    transition: "background-color 1.2s ease-out",
  },
});

// ── List hanging indent ──
const LIST_LINE_RE = /^(\s*)([-*+]|\d+[.)])(\s+)/;

const listHangingIndent = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(update: {
      docChanged: boolean;
      viewportChanged: boolean;
      view: EditorView;
    }) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = this.build(update.view);
      }
    }
    build(view: EditorView): DecorationSet {
      const builder = new RangeSetBuilder<Decoration>();
      for (const { from, to } of view.visibleRanges) {
        let pos = from;
        while (pos <= to) {
          const line = view.state.doc.lineAt(pos);
          const m = LIST_LINE_RE.exec(line.text);
          if (m) {
            const prefix = m[0].length;
            builder.add(
              line.from,
              line.from,
              Decoration.line({
                attributes: {
                  style: `padding-left:${prefix}ch;text-indent:-${prefix}ch;`,
                },
              }),
            );
          }
          if (line.to + 1 <= pos) break;
          pos = line.to + 1;
        }
      }
      return builder.finish();
    }
  },
  { decorations: (v) => v.decorations },
);

// ── Wikilink autocomplete (uses optional `vault` prop) ──
function collectMarkdownFiles(
  vault: Map<string, FileNode>,
): { name: string; id: string }[] {
  const out: { name: string; id: string }[] = [];
  for (const node of vault.values()) {
    if (node.kind === "folder") continue;
    if (node.name.toLowerCase().endsWith(".md")) {
      out.push({ name: node.name.replace(/\.md$/i, ""), id: node.id });
    } else if (node.kind !== "canvas") {
      out.push({ name: node.name, id: node.id });
    }
  }
  return out;
}

function makeWikilinkCompletions(vault: Map<string, FileNode> | undefined) {
  return (context: CompletionContext): CompletionResult | null => {
    if (!vault) return null;
    const match = context.matchBefore(/\[\[[^\]]*/);
    if (!match) return null;
    const query = match.text.slice(2).toLowerCase();
    const all = collectMarkdownFiles(vault);
    // closeBrackets auto-pairs `[`, so the doc usually looks like
    // `[[query]]` with the cursor sitting between. Extend the
    // replaced range over any trailing `]` characters so the
    // completion doesn't leave a stray `]]` behind. Cap at two so
    // we don't munch into real content past the auto-pair.
    const after = context.state.doc.sliceString(
      context.pos,
      Math.min(context.state.doc.length, context.pos + 2),
    );
    let trailing = 0;
    while (trailing < 2 && after[trailing] === "]") trailing++;
    const replaceTo = context.pos + trailing;

    const options = all
      .filter((f) => query === "" || f.name.toLowerCase().includes(query))
      .map((f) => ({
        label: f.name,
        apply: (view: EditorView) => {
          const insert = `[[${f.name}]]`;
          view.dispatch({
            changes: { from: match.from, to: replaceTo, insert },
            selection: { anchor: match.from + insert.length },
            userEvent: "input.complete",
          });
        },
      }));
    return { from: match.from, options, filter: false };
  };
}

// ── List-aware Tab / Shift-Tab ──
const LIST_MARKER_RE = /^(\s*)([-*+]|\d+[.)])(\s+)/;

function selectedLineNumbers(state: EditorState): number[] {
  const set = new Set<number>();
  for (const r of state.selection.ranges) {
    const fromLine = state.doc.lineAt(r.from).number;
    const toLine = state.doc.lineAt(r.to).number;
    for (let n = fromLine; n <= toLine; n++) set.add(n);
  }
  return [...set];
}

const indentListLine: Command = (view) => {
  const { state } = view;
  type Hit = {
    line: ReturnType<typeof state.doc.line>;
    leadingWs: string;
    marker: string;
    trailingWs: string;
  };
  const hits: Hit[] = [];
  for (const n of selectedLineNumbers(state)) {
    const line = state.doc.line(n);
    const m = LIST_MARKER_RE.exec(line.text);
    if (!m) return false;
    hits.push({ line, leadingWs: m[1], marker: m[2], trailingWs: m[3] });
  }
  if (hits.length === 0) return false;
  const changes = hits.map(({ line, leadingWs, marker, trailingWs }) => {
    const indent = " ".repeat(marker.length + trailingWs.length);
    if (/^\d+/.test(marker)) {
      const suffix = marker.replace(/^\d+/, "");
      const newMarker = "1" + suffix;
      return {
        from: line.from,
        to: line.from + leadingWs.length + marker.length,
        insert: indent + leadingWs + newMarker,
      };
    }
    return { from: line.from, insert: indent };
  });
  view.dispatch({ changes, userEvent: "input.indent" });
  return true;
};

const dedentListLine: Command = (view) => {
  const { state } = view;
  type Hit = { line: ReturnType<typeof state.doc.line>; leadingWs: string };
  const hits: Hit[] = [];
  for (const n of selectedLineNumbers(state)) {
    const line = state.doc.line(n);
    const m = LIST_MARKER_RE.exec(line.text);
    if (!m) return false;
    if (m[1].length === 0) return false;
    hits.push({ line, leadingWs: m[1] });
  }
  if (hits.length === 0) return false;
  const changes = hits.map(({ line, leadingWs }) => ({
    from: line.from,
    to: line.from + Math.min(leadingWs.length, 2),
  }));
  view.dispatch({ changes, userEvent: "delete.dedent" });
  return true;
};

// ── Component ──
type Props = {
  /** Current file content (raw markdown). */
  content: string;
  /** Stable file id (used as React key + dirty-tracking handle). */
  filePath: string;
  /** Called on every content change (debounced internally). */
  onChange: (content: string) => void;
  /** Called on Cmd/Ctrl+S. */
  onSave: () => void;
  /** Optional vault map for `[[wikilink]]` autocomplete + click routing. */
  vault?: Map<string, FileNode>;
  /** Click handler for `[[wikilink]]` matches — passed the link target name. */
  onOpenWikilink?: (target: string) => void;
  /**
   * Enable the Obsidian-style live-preview extension stack: replaces
   * markdown markup on lines the cursor isn't on with rendered
   * widgets (bold/italic stripped, links rendered, images inlined,
   * task checkboxes interactive, headings scaled). Pure additive —
   * disabling it falls back to the raw source view.
   */
  livePreview?: boolean;
};

/**
 * Contract-compliant wrapper that builds the standard `<PaneDocHeader/>`
 * and delegates to the underlying CodeMirror body. Mirrors the pattern
 * in markdown-preview / slides-view / pdf-view — see
 * ../editor-pane-layout.tsx for the design rationale.
 */
export function CodeMirrorEditor(props: import("../types").EditorViewProps & { livePreview?: boolean }) {
  // Default guard — see markdown-preview/index.tsx for rationale.
  const { tab, file, content, vault, paneActions = EMPTY_PANE_ACTIONS, onChange, onSave, onOpenWikilink, livePreview } = props;
  return (
    <EditorPaneLayout
      header={
        <PaneDocHeader
          tab={tab}
          {...paneActions}
          topRightInsetPx={paneActions.topRightInsetPx ?? 0}
          dragging={paneActions.dragging ?? false}
        />
      }
    >
      <CodeMirrorEditorBody
        content={content}
        filePath={file.id}
        onChange={onChange ?? (() => undefined)}
        onSave={onSave ?? (() => undefined)}
        vault={vault}
        onOpenWikilink={onOpenWikilink}
        livePreview={livePreview}
      />
    </EditorPaneLayout>
  );
}

function CodeMirrorEditorBody({
  content,
  filePath,
  onChange,
  onSave,
  vault,
  onOpenWikilink,
  livePreview,
}: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const loadedFileRef = useRef<string | null>(null);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const onOpenWikilinkRef = useRef(onOpenWikilink);
  onOpenWikilinkRef.current = onOpenWikilink;
  const vaultRef = useRef(vault);
  vaultRef.current = vault;

  // Track active theme so the right CodeMirror theme variant is used.
  const [isDark, setIsDark] = useState(() => {
    if (typeof document === "undefined") return true;
    return document.documentElement.classList.contains("dark");
  });
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const sync = () => setIsDark(root.classList.contains("dark"));
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  const showLineNumbers = useSettingsStore((s) => s.lineNumbers);
  const wordWrap = useSettingsStore((s) => s.wordWrap);
  const vimEnabled = useSettingsStore((s) => s.vimMode);
  // Only mount the task-line "link work item" affordance when a
  // plugin that can handle the request is enabled. Today that means
  // kanban; widen the predicate when a generic provider hook lands.
  const taskActionEnabled = usePluginStore((s) =>
    s.plugins.some((p) => p.id === "kanban" && p.enabled),
  );

  useEffect(() => {
    if (!editorRef.current || !filePath) return;
    if (loadedFileRef.current === filePath && viewRef.current) return;

    if (viewRef.current) {
      viewRef.current.destroy();
      viewRef.current = null;
    }
    loadedFileRef.current = filePath;
    const currentPath = filePath;
    let debounceTimer: ReturnType<typeof setTimeout>;

    const wikilinkCompletions = makeWikilinkCompletions(vaultRef.current);

    const state = EditorState.create({
      doc: content ?? "",
      extensions: [
        ...(showLineNumbers ? [lineNumbers()] : []),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        highlightActiveLine(),
        rectangularSelection(),
        crosshairCursor(),
        bracketMatching(),
        closeBrackets(),
        ...(wordWrap ? [EditorView.lineWrapping] : []),
        keymap.of([
          ...closeBracketsKeymap,
          { key: "Tab", run: indentListLine },
          { key: "Shift-Tab", run: dedentListLine },
          // Enter inside a list continues the markup (next bullet,
          // next numbered item, or exits the list on a blank item).
          // Backspace at the start of a list line deletes one level
          // of markup instead of the bare character. Same behaviour
          // VS Code / Obsidian / GitHub use; without it, pressing
          // Enter just inserts a blank line and markdown-it then
          // can't see the resulting `2. foo` line as a list because
          // CommonMark requires either a `1.` start or no preceding
          // paragraph for an ordered list to interrupt text.
          { key: "Enter", run: insertNewlineContinueMarkup },
          { key: "Backspace", run: deleteMarkupBackward },
          ...defaultKeymap,
          ...historyKeymap,
          // Filter out CM's Mod-f / Mod-h bindings so they bubble to
          // the window-level handler that routes Find/Replace to the
          // global left-sidebar search panel (VS Code style). All
          // OTHER search bindings (F3, Mod-g, etc.) are preserved.
          ...searchKeymap.filter((b) => b.key !== "Mod-f" && b.key !== "Mod-h"),
          indentWithTab,
          {
            key: "Mod-s",
            run: () => {
              onSaveRef.current();
              return true;
            },
          },
        ]),
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        isDark ? editorThemeDark : editorThemeLight,
        syntaxHighlighting(markdownHighlight),
        wikilinkPlugin,
        wikilinkStyle,
        listHangingIndent,
        flashLineField,
        flashLineTheme,
        // Live-preview decorations are appended LAST so they win
        // visual-precedence over the raw wikilink / syntax styling
        // for the same ranges. The extension is a no-op when not
        // mounted, so opting out is just "don't include it".
        ...(livePreview ? [livePreviewExtension, livePreviewStyles] : []),
        // Hover affordance on `- [ ]` task lines → "Link work item"
        // button. Only mounted when a plugin (kanban today) is
        // listening for `flux-kanban-link-work-item`.
        ...(taskActionEnabled ? [taskActionExtension] : []),
        search({ top: false }),
        ...makeVimExtension(vimEnabled),
        autocompletion({
          override: [wikilinkCompletions, slashCompletions],
          activateOnTyping: true,
        }),
        // Markdown shortcut input rules — triple-backtick fence
        // auto-close, triple-dollar math block. Registered AFTER
        // autocompletion so completions still win when a popup is
        // open.
        markdownShortcuts,
        EditorView.updateListener.of((update) => {
          if (
            update.docChanged &&
            update.transactions.some((tr) => tr.annotation(Transaction.userEvent))
          ) {
            const es = useEditorStore.getState();
            if (!es.dirtyFiles.has(currentPath)) {
              es.markDirty(currentPath);
            }
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
              const newContent = update.state.doc.toString();
              onChangeRef.current(newContent);
            }, 50);
          }
        }),
        EditorView.domEventHandlers({
          click: (event, view) => {
            const target = event.target as HTMLElement;

            // Work-item chip — markdown link with a `flux-wi://`
            // URL. Distinct from a regular wikilink because the
            // graph indexer must not see it as a note-to-note edge.
            // The URL embeds only stable board/work-item ids; the
            // kanban plugin's app-root resolves the board file path
            // (renames don't break the link) and emits the
            // open-file + focus events.
            const workitemEl = target.closest(
              ".cm-lp-workitem",
            ) as HTMLElement | null;
            if (workitemEl) {
              const url = workitemEl.getAttribute("data-target") ?? "";
              const m = /^flux-wi:\/\/(brd_[A-Za-z0-9]+)#(wi_[A-Za-z0-9]+)$/.exec(url);
              if (m) {
                window.dispatchEvent(
                  new CustomEvent("flux-kanban-open-work-item", {
                    detail: { boardId: m[1], itemId: m[2] },
                  }),
                );
              }
              return true;
            }

            // Live-preview wikilink widget — `.cm-wikilink` is the
            // raw-markdown decoration, `.cm-lp-wikilink` is the
            // live-preview replacement widget. Both carry a
            // `data-target` with the wikilink target string.
            const wikilink = target.closest(
              ".cm-wikilink, .cm-lp-wikilink",
            ) as HTMLElement | null;
            if (wikilink) {
              const linkTarget = wikilink.getAttribute("data-target");
              if (linkTarget) {
                onOpenWikilinkRef.current?.(linkTarget);
                window.dispatchEvent(
                  new CustomEvent("flux-open-wikilink", {
                    detail: { target: linkTarget },
                  }),
                );
              }
              return true;
            }

            // Live-preview task checkbox — flip `[ ]` <-> `[x]` in
            // the underlying document at the stored position so the
            // toggle persists on save. The widget itself is replaced
            // by the next decoration rebuild.
            if (target.matches?.(".cm-lp-task")) {
              const input = target as HTMLInputElement;
              const posAttr = input.getAttribute("data-pos");
              if (posAttr) {
                const pos = Number(posAttr);
                const text = view.state.doc.sliceString(pos, pos + 3);
                const replacement = /\[[xX]\]/.test(text) ? "[ ]" : "[x]";
                view.dispatch({
                  changes: { from: pos, to: pos + 3, insert: replacement },
                });
                event.preventDefault();
                return true;
              }
            }
            return false;
          },
        }),
      ],
    });

    const view = new EditorView({ state, parent: editorRef.current });
    // Tag the editor DOM with the bound file path so DOM-level
    // event handlers (e.g. the task-action extension's "link work
    // item" button) can identify the source file without importing
    // editor-store from inside a CodeMirror plugin.
    view.dom.dataset.fluxFileId = currentPath;
    viewRef.current = view;

    return () => {
      clearTimeout(debounceTimer);
      view.destroy();
      viewRef.current = null;
      loadedFileRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, isDark, showLineNumbers, wordWrap, vimEnabled, livePreview, taskActionEnabled]);

  // Sync external content into the editor doc.
  useEffect(() => {
    if (!viewRef.current) return;
    const next = content ?? "";
    const currentDoc = viewRef.current.state.doc.toString();
    if (next === currentDoc) return;
    const isDirty = useEditorStore.getState().dirtyFiles.has(filePath);
    if (viewRef.current.hasFocus && isDirty) return;
    viewRef.current.dispatch({
      changes: { from: 0, to: currentDoc.length, insert: next },
    });
  }, [content, filePath]);

  // Global Cmd+S handler — catches save even when editor isn't focused.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        onSaveRef.current();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // The doc-header ⋯ → Find command no longer opens CodeMirror's
  // inline search panel — it routes to the left-sidebar global
  // search (VS-Code style). CM's own Ctrl+F keymap (registered via
  // `searchKeymap` in the extensions array) still works inside the
  // editor for the user-already-typing flow.

  // Cross-pane "jump to line" — fired by the search panel after a
  // result click. We scroll the line into view + flash-highlight it
  // briefly so the user spots where the match landed.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ fileId?: string; line?: number }>).detail;
      if (!detail?.fileId || detail.fileId !== filePath) return;
      const view = viewRef.current;
      const ln = detail.line;
      if (!view || !ln || ln < 1) return;
      const lineCount = view.state.doc.lines;
      if (ln > lineCount) return;
      const line = view.state.doc.line(ln);
      view.dispatch({
        effects: [
          EditorView.scrollIntoView(line.from, { y: "center" }),
          flashLineEffect.of(line.from),
        ],
        selection: { anchor: line.from },
      });
      window.setTimeout(() => {
        try {
          view.dispatch({ effects: clearFlashLineEffect.of(null) });
        } catch {
          /* view may have been destroyed */
        }
      }, 1600);
    };
    window.addEventListener("flux-jump-to-line", handler as EventListener);
    return () =>
      window.removeEventListener(
        "flux-jump-to-line",
        handler as EventListener,
      );
  }, [filePath]);

  // Insert text at the current cursor (or replace an explicit
  // range / the selection). Used by plugins/commands that need to
  // drop a wikilink / chip into the active editor without
  // re-routing through a custom IPC.
  // Detail shape:
  //   { fileId: string;
  //     text: string;
  //     from?: number; to?: number;        // explicit doc range to replace
  //     replaceSelection?: boolean;        // fallback: replace selection
  //   }
  // Precedence: explicit `from/to` > `replaceSelection` > cursor head.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (
        e as CustomEvent<{
          fileId?: string;
          text?: string;
          from?: number;
          to?: number;
          replaceSelection?: boolean;
        }>
      ).detail;
      if (!detail?.fileId || detail.fileId !== filePath) return;
      const view = viewRef.current;
      if (!view) return;
      const text = detail.text ?? "";
      const docLen = view.state.doc.length;
      let from: number;
      let to: number;
      if (
        typeof detail.from === "number" &&
        typeof detail.to === "number" &&
        detail.from >= 0 &&
        detail.to >= detail.from &&
        detail.to <= docLen
      ) {
        from = detail.from;
        to = detail.to;
      } else {
        const range = view.state.selection.main;
        from = detail.replaceSelection ? range.from : range.head;
        to = detail.replaceSelection ? range.to : range.head;
      }
      view.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + text.length },
        userEvent: "input.paste",
      });
      view.focus();
    };
    window.addEventListener("flux-insert-at-cursor", handler as EventListener);
    return () =>
      window.removeEventListener(
        "flux-insert-at-cursor",
        handler as EventListener,
      );
  }, [filePath]);

  return <div ref={editorRef} className="flex-1 min-h-0 min-w-0 overflow-hidden" />;
}
