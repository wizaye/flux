import { useEffect, useRef, useState } from "react";
import {
  EditorState,
  RangeSetBuilder,
  StateEffect,
  StateField,
  Transaction,
} from "@codemirror/state";
import { openSearchPanel, search, searchKeymap } from "@codemirror/search";
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
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
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
import type { FileNode } from "@/state/editor";
import { vimMode as makeVimExtension } from "../../extensions/cm-vim";
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
  { tag: t.url, color: "var(--accent)" },
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
    color: "var(--accent)",
    cursor: "pointer",
    textDecoration: "underline",
    textDecorationColor: "transparent",
    transition: "text-decoration-color 0.15s, background-color 0.15s",
    borderRadius: "3px",
    padding: "0 2px",
  },
  ".cm-wikilink:hover": {
    backgroundColor: "var(--hover)",
    textDecorationColor: "var(--accent)",
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
    const options = all
      .filter((f) => query === "" || f.name.toLowerCase().includes(query))
      .map((f) => ({
        label: f.name,
        apply: (view: EditorView) => {
          view.dispatch({
            changes: {
              from: match.from,
              to: context.pos,
              insert: `[[${f.name}]]`,
            },
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
};

/**
 * Contract-compliant wrapper that builds the standard `<PaneDocHeader/>`
 * and delegates to the underlying CodeMirror body. Mirrors the pattern
 * in markdown-preview / slides-view / pdf-view — see
 * ../editor-pane-layout.tsx for the design rationale.
 */
export function CodeMirrorEditor(props: import("../types").EditorViewProps) {
  // Default guard — see markdown-preview/index.tsx for rationale.
  const { tab, file, content, vault, paneActions = EMPTY_PANE_ACTIONS, onChange, onSave, onOpenWikilink } = props;
  return (
    <EditorPaneLayout
      header={
        <PaneDocHeader
          tab={tab}
          onSplit={paneActions.onSplit}
          onToggleReading={paneActions.onToggleReading}
          onSetSlides={paneActions.onSetSlides}
          onRename={paneActions.onRename}
          onCopyPath={paneActions.onCopyPath}
          onShowInExplorer={paneActions.onShowInExplorer}
          onRevealInNav={paneActions.onRevealInNav}
          onDelete={paneActions.onDelete}
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
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
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
        search({ top: false }),
        ...makeVimExtension(vimEnabled),
        autocompletion({
          override: [wikilinkCompletions],
          activateOnTyping: true,
        }),
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
          click: (event) => {
            const target = event.target as HTMLElement;
            const wikilink = target.closest(".cm-wikilink") as HTMLElement | null;
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
            return false;
          },
        }),
      ],
    });

    const view = new EditorView({ state, parent: editorRef.current });
    viewRef.current = view;

    return () => {
      clearTimeout(debounceTimer);
      view.destroy();
      viewRef.current = null;
      loadedFileRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, isDark, showLineNumbers, wordWrap, vimEnabled]);

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

  // Doc-header "Find…" bridge — opens CodeMirror's search panel.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ filePath?: string }>).detail;
      if (detail?.filePath && detail.filePath !== filePath) return;
      const view = viewRef.current;
      if (!view) return;
      view.focus();
      openSearchPanel(view);
    };
    window.addEventListener("flux-editor-find", handler as EventListener);
    return () =>
      window.removeEventListener("flux-editor-find", handler as EventListener);
  }, [filePath]);

  return <div ref={editorRef} className="flex-1 min-h-0 min-w-0 overflow-hidden" />;
}
