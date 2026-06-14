import { useEffect, useMemo, useRef } from "react";
import MarkdownIt from "markdown-it";
import texmath from "markdown-it-texmath";
import katex from "katex";
import hljs from "highlight.js";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github-dark.css";
import "./styles.css";

/**
 * Reading-mode renderer for flux.
 *
 * Ported from `lattice/src/components/editor/MarkdownPreview.tsx`,
 * trimmed for flux:
 *   • Drops `lattice-open-task-modal` (no task-metadata system yet).
 *   • Wikilink clicks dispatch `flux-open-wikilink` AND call the
 *     optional `onOpenWikilink` prop.
 *   • Mermaid is loaded lazily so the initial bundle stays slim.
 *   • KaTeX is wired via `markdown-it-texmath` with the `dollars`
 *     delimiter — `$inline$` and `$$display$$` both render.
 */

let mermaidReady = false;
async function ensureMermaid() {
  if (mermaidReady) return (await import("mermaid")).default;
  const m = await import("mermaid");
  const isDark = document.documentElement.classList.contains("dark");
  m.default.initialize({
    startOnLoad: false,
    theme: isDark ? "dark" : "default",
    securityLevel: "loose",
    fontFamily: "var(--font-text, sans-serif)",
  });
  mermaidReady = true;
  return m.default;
}

const md: MarkdownIt = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
  typographer: false,
  highlight: (str: string, lang: string) => {
    if (lang === "mermaid") {
      const escaped = str.replace(/</g, "&lt;").replace(/>/g, "&gt;");
      return `<div class="mermaid-diagram" data-mermaid="${encodeURIComponent(str)}">${escaped}</div>`;
    }
    // Language-aware syntax highlighting via highlight.js.
    // Falls through to markdown-it's escaped default <pre><code> when
    // the language is unknown or absent — the renderer wraps the
    // returned HTML in its own <pre>/<code> only when we return "".
    if (lang && hljs.getLanguage(lang)) {
      try {
        const out = hljs.highlight(str, { language: lang, ignoreIllegals: true }).value;
        return `<pre class="hljs"><code class="language-${lang}">${out}</code></pre>`;
      } catch {
        // fall through to default escape
      }
    }
    // Auto-detect when no language hint is provided so plain ```fences
    // still get some coloring.
    if (!lang) {
      try {
        const out = hljs.highlightAuto(str).value;
        return `<pre class="hljs"><code>${out}</code></pre>`;
      } catch {
        return "";
      }
    }
    return "";
  },
});

// Wire KaTeX via texmath. The `dollars` preset uses `$…$` / `$$…$$`.
md.use(texmath, {
  engine: katex,
  delimiters: "dollars",
  katexOptions: { throwOnError: false },
});

const WIKILINK_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

function escapeText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderHtml(source: string): string {
  const html = md.render(source);
  const withWikilinks = html.replace(
    WIKILINK_RE,
    (_full, target: string, alias?: string) => {
      const label = (alias ?? target).trim();
      const t = target.trim().replace(/"/g, "&quot;");
      return `<a href="#" class="md-wikilink" data-target="${t}">${escapeText(label)}</a>`;
    },
  );
  // Render task-list checkboxes (disabled, visual-only).
  return withWikilinks.replace(
    /<li>\[([ xX/\-])\]\s*(.*?)<\/li>/g,
    (_m, marker: string, text: string) => {
      const checked = marker === "x" || marker === "X";
      const inProgress = marker === "/" || marker === "-";
      const cls = inProgress
        ? "md-task-checkbox md-task-inprogress"
        : "md-task-checkbox";
      const input = `<input type="checkbox" class="${cls}" disabled${checked ? " checked" : ""}/>`;
      return `<li class="task-list-item">${input} <span class="task-list-item-text">${text}</span></li>`;
    },
  );
}

import { PaneDocHeader } from "../../pane-doc-header";
import { EditorPaneLayout } from "../editor-pane-layout";
import { EMPTY_PANE_ACTIONS, type EditorViewProps } from "../types";

/**
 * Contract-compliant top-level: receives the standard `EditorViewProps`
 * bundle from `Pane`, builds its own `<PaneDocHeader/>` (so each view
 * owns its chrome — see ./editor-pane-layout.tsx), and renders the
 * actual markdown body inside.
 *
 * Why each view builds its own header instead of letting `Pane` do
 * it: views that opt out (graph, future canvas/kanban) can simply
 * omit `header` from the layout — there's no dead strip or empty
 * geometry, and per-view chrome (graph's overlay, slides' nav, etc.)
 * lives next to the surface that uses it.
 */
export function MarkdownPreview(props: EditorViewProps) {
  // `paneActions` MUST come from `Pane` at runtime — the default is a
  // dev-time safety net so a stale HMR snapshot (view code reloaded
  // before parent) can't blow up with `undefined.onSplit`. See
  // ../types.ts EMPTY_PANE_ACTIONS.
  const { tab, content, paneActions = EMPTY_PANE_ACTIONS, onOpenWikilink } = props;
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
      <MarkdownPreviewBody source={content} onOpenWikilink={onOpenWikilink} />
    </EditorPaneLayout>
  );
}

type BodyProps = {
  source: string;
  onOpenWikilink?: (target: string) => void;
};

/**
 * The actual markdown renderer — kept as a separate component so it
 * can be reused outside of an editor pane (e.g. in side-panel
 * previews) without dragging the whole chrome along.
 */
export function MarkdownPreviewBody({ source, onOpenWikilink }: BodyProps) {
  const html = useMemo(() => renderHtml(source ?? ""), [source]);
  const containerRef = useRef<HTMLDivElement>(null);
  const onOpenWikilinkRef = useRef(onOpenWikilink);
  onOpenWikilinkRef.current = onOpenWikilink;

  // Render mermaid diagrams after HTML is injected.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const diagrams = Array.from(
      el.querySelectorAll<HTMLElement>(".mermaid-diagram"),
    );
    if (diagrams.length === 0) return;
    let cancelled = false;
    ensureMermaid().then((m) => {
      if (cancelled || !m) return;
      diagrams.forEach(async (div, idx) => {
        const graphDef = decodeURIComponent(div.dataset.mermaid ?? "");
        if (!graphDef) return;
        try {
          const id = `mermaid-${Date.now()}-${idx}`;
          const { svg } = await m.render(id, graphDef);
          if (!cancelled) {
            div.innerHTML = svg;
            div.removeAttribute("data-mermaid");
          }
        } catch (err) {
          div.innerHTML = `<pre class="mermaid-error">${String(err)}</pre>`;
        }
      });
    });
    return () => {
      cancelled = true;
    };
  }, [html]);

  // Delegated click handler for wikilinks.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const link = target.closest(".md-wikilink") as HTMLAnchorElement | null;
      if (!link) return;
      e.preventDefault();
      const dataTarget = link.dataset.target;
      if (!dataTarget) return;
      onOpenWikilinkRef.current?.(dataTarget);
      window.dispatchEvent(
        new CustomEvent("flux-open-wikilink", {
          detail: { target: dataTarget },
        }),
      );
    };
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, []);

  return (
    <div className="markdown-preview-host">
      <div
        ref={containerRef}
        className="md-preview"
        // markdown-it produces sanitized HTML (no inline scripts) and we
        // explicitly disabled raw-HTML pass-through via `html: false`.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
