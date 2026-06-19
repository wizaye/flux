/**
 * Headless render of a markdown document to a static HTML string for
 * the PDF-export pipeline.
 *
 * Re-uses the same markdown-it + mermaid + shiki + mathjax stack as
 * the reading view, but produces a single self-contained HTML string
 * (no React, no event handlers) that the print iframe can load.
 *
 * The functions here are intentionally split from
 * `markdown-preview/index.tsx` so the doc-action menu doesn't drag
 * the React component (and the whole editor chrome) into its async
 * import chain.
 */
import MarkdownIt from "markdown-it";
import mathjax3 from "markdown-it-mathjax3";
import markdownItAnchor from "markdown-it-anchor";
// @ts-expect-error — no published @types/markdown-it-task-lists.
import markdownItTaskLists from "markdown-it-task-lists";

/** GitHub-style slug — mirrors the reading-view renderer. */
function githubSlug(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s\-_]/gu, "")
    .replace(/\s+/g, "-");
}

const md: MarkdownIt = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
  typographer: false,
});

md.use(mathjax3);
md.use(markdownItAnchor, { slugify: githubSlug, permalink: false });
md.use(markdownItTaskLists, { enabled: false, label: false });

// Intercept ```mermaid fenced blocks → render to SVG inline so the
// print frame doesn't need a runtime mermaid call.
const defaultFence = md.renderer.rules.fence ?? (() => "");
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const info = (token.info ?? "").trim().split(/\s+/)[0];
  if (info === "mermaid") {
    const escaped = token.content
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return `<div class="mermaid-diagram" data-mermaid="${encodeURIComponent(token.content)}">${escaped}</div>`;
  }
  return defaultFence(tokens, idx, options, env, self);
};

const WIKILINK_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Render `source` (raw markdown) to a self-contained HTML string
 * with mermaid SVGs and Shiki-highlighted code blocks already
 * expanded. The returned string is meant to be dropped into a
 * `.markdown-preview-host > .md-preview` container.
 */
export async function renderToStaticHtml(source: string): Promise<string> {
  // 1) Pass through markdown-it + mathjax3 + wikilink post-process.
  const baseHtml = md.render(source ?? "").replace(
    WIKILINK_RE,
    (_full, target: string, alias?: string) => {
      const label = (alias ?? target).trim();
      const t = target.trim().replace(/"/g, "&quot;");
      return `<a class="md-wikilink" data-target="${t}">${escapeText(label)}</a>`;
    },
  );

  // 2) Build a parser to walk the HTML, run mermaid + shiki on each
  // block, then serialise back to string.
  const tmp = document.createElement("div");
  tmp.innerHTML = baseHtml;

  // Mermaid: render every `.mermaid-diagram` using the LIGHT palette
  // (PDFs are always on a white page; dark-mode diagrams look out of
  // place against print).
  const diagrams = Array.from(tmp.querySelectorAll<HTMLElement>(".mermaid-diagram"));
  if (diagrams.length > 0) {
    const m = (await import("mermaid")).default;
    m.initialize({
      startOnLoad: false,
      securityLevel: "loose",
      theme: "base",
      themeVariables: {
        background: "#ffffff",
        primaryColor: "#eef0ff",
        primaryTextColor: "#1f1f2e",
        primaryBorderColor: "#6f5cf0",
        lineColor: "#6f5cf0",
        textColor: "#2e2e2e",
      },
    });
    for (let i = 0; i < diagrams.length; i++) {
      const div = diagrams[i];
      const enc = div.dataset.mermaid ?? "";
      const graphDef = enc ? decodeURIComponent(enc) : "";
      if (!graphDef) continue;
      try {
        const id = `mpdf-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`;
        const { svg } = await m.render(id, graphDef);
        div.innerHTML = svg;
      } catch (err) {
        div.innerHTML = `<pre class="mermaid-error">${String(err)}</pre>`;
      }
    }
  }

  // Shiki: highlight every `<pre><code class="language-X">` using
  // ONLY the light theme (PDFs are on white paper).
  const blocks = Array.from(tmp.querySelectorAll<HTMLPreElement>("pre"));
  if (blocks.length > 0) {
    const shiki = await (await import("shiki")).getSingletonHighlighter({
      themes: ["github-light-default"],
      langs: [],
    });
    for (const pre of blocks) {
      if (pre.classList.contains("mermaid-diagram")) continue;
      const code = pre.querySelector("code");
      if (!code) continue;
      const m = (code.className || "").match(/(?:^|\s)language-([\w-]+)/);
      const rawLang = m ? m[1].toLowerCase() : "";
      const sourceText = code.textContent ?? "";
      let lang = "text";
      if (rawLang && rawLang !== "plaintext" && rawLang !== "text") {
        const loaded = shiki.getLoadedLanguages();
        if (loaded.includes(rawLang)) {
          lang = rawLang;
        } else {
          try {
            await shiki.loadLanguage(rawLang as never);
            lang = rawLang;
          } catch {
            /* keep as text */
          }
        }
      }
      try {
        const html = shiki.codeToHtml(sourceText, {
          lang,
          theme: "github-light-default",
        });
        const wrap = document.createElement("div");
        wrap.innerHTML = html;
        const next = wrap.firstElementChild as HTMLElement | null;
        if (next && pre.parentElement) {
          if (lang && lang !== "text") next.setAttribute("data-lang", lang);
          pre.parentElement.replaceChild(next, pre);
        }
      } catch {
        /* leave the original */
      }
    }
  }

  return tmp.innerHTML;
}
