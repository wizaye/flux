import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import MarkdownIt from "markdown-it";
import mathjax3 from "markdown-it-mathjax3";
import markdownItAnchor from "markdown-it-anchor";
// @ts-expect-error — no published @types/markdown-it-task-lists
// package; the plugin is a single function (md, opts?) => void.
import markdownItTaskLists from "markdown-it-task-lists";
import "./styles.css";

/**
 * Reading-mode renderer for flux.
 *
 * Mirrors Obsidian's parser stack:
 *   • Lists (ordered + unordered, nested) — markdown-it core.
 *   • Tables, strikethrough, auto-linkified URLs — markdown-it core.
 *   • Task lists (`- [ ]` / `- [x]`) — markdown-it-task-lists.
 *   • Heading anchors — markdown-it-anchor with GitHub-style slugs
 *     so TOC `[text](#some-heading)` actually navigates.
 *   • MathJax 3 math — markdown-it-mathjax3 (`$…$` / `$$…$$`).
 *   • Code highlighting — Prism via markdown-it-prism.
 *   • Wikilinks `[[Note]]` / `[[Note|alias]]` — post-process regex.
 *   • Mermaid diagrams — lazy-loaded on first render.
 */

// Track the theme the singleton was initialised against so we can
// re-init when the user toggles light/dark. We don't actually do
// that anymore (see ensureMermaid below) — mermaid renders both
// light AND dark SVG variants at first paint and the toggle is pure
// CSS — but the singleton still has to be created exactly once.
type MermaidApi = Awaited<typeof import("mermaid")>["default"];
let mermaidInstance: MermaidApi | null = null;

/**
 * Pin Mermaid's palette to flux brand tokens so diagrams stay
 * legible in both themes. The defaults work poorly against our
 * preview background — dark theme renders pale text on a near-
 * transparent panel that almost vanishes, and light theme renders
 * faint borders that disappear into the page.
 */
function mermaidThemeFor(isDark: boolean) {
  if (isDark) {
    return {
      theme: "base" as const,
      themeVariables: {
        background: "#1a1a1a",
        primaryColor: "#2a2540",
        primaryTextColor: "#e7e3ff",
        primaryBorderColor: "#7f6df2",
        secondaryColor: "#222033",
        tertiaryColor: "#161421",
        lineColor: "#a397ff",
        textColor: "#dcddde",
        fontFamily: "var(--font-text, sans-serif)",
        // Sequence-diagram specifics — defaults are washed-out in dark.
        actorBkg: "#2a2540",
        actorBorder: "#7f6df2",
        actorTextColor: "#e7e3ff",
        actorLineColor: "#a397ff",
        signalColor: "#dcddde",
        signalTextColor: "#dcddde",
        labelBoxBkgColor: "#2a2540",
        labelBoxBorderColor: "#7f6df2",
        labelTextColor: "#e7e3ff",
        loopTextColor: "#dcddde",
        noteBkgColor: "#3a2a1a",
        noteTextColor: "#f0d8a6",
        noteBorderColor: "#a08050",
        activationBkgColor: "#a397ff",
        activationBorderColor: "#7f6df2",
        sequenceNumberColor: "#1a1a1a",
      },
    };
  }
  return {
    theme: "base" as const,
    themeVariables: {
      background: "#ffffff",
      primaryColor: "#eef0ff",
      primaryTextColor: "#1f1f2e",
      primaryBorderColor: "#6f5cf0",
      secondaryColor: "#f4f4f7",
      tertiaryColor: "#fafafa",
      lineColor: "#6f5cf0",
      textColor: "#2e2e2e",
      fontFamily: "var(--font-text, sans-serif)",
      actorBkg: "#eef0ff",
      actorBorder: "#6f5cf0",
      actorTextColor: "#1f1f2e",
      actorLineColor: "#6f5cf0",
      signalColor: "#2e2e2e",
      signalTextColor: "#2e2e2e",
      labelBoxBkgColor: "#eef0ff",
      labelBoxBorderColor: "#6f5cf0",
      labelTextColor: "#1f1f2e",
      loopTextColor: "#2e2e2e",
      noteBkgColor: "#fff8d6",
      noteTextColor: "#5a4500",
      noteBorderColor: "#c9a000",
      activationBkgColor: "#6f5cf0",
      activationBorderColor: "#4d3edc",
      sequenceNumberColor: "#ffffff",
    },
  };
}

async function loadMermaid(): Promise<MermaidApi> {
  if (mermaidInstance) return mermaidInstance;
  const m = await import("mermaid");
  mermaidInstance = m.default;
  return mermaidInstance;
}

/**
 * Render `graphDef` twice — once with the light theme variables and
 * once with the dark ones — so the consumer can drop both SVGs into
 * the DOM side-by-side and toggle visibility via CSS based on the
 * `.dark` class. Pure-CSS theme switching is instant; re-running
 * mermaid's `render()` on every toggle was the source of the
 * “diagrams trail the editor by ~200 ms” feel the user reported.
 */
async function renderMermaidBoth(
  graphDef: string,
  idPrefix: string,
): Promise<{ light: string; dark: string }> {
  const m = await loadMermaid();
  // Light render — re-initialize per call so the active themeVars
  // match. `initialize` is cheap and only mutates module state.
  m.initialize({
    startOnLoad: false,
    securityLevel: "loose",
    ...mermaidThemeFor(false),
  });
  const { svg: light } = await m.render(`${idPrefix}-l`, graphDef);
  m.initialize({
    startOnLoad: false,
    securityLevel: "loose",
    ...mermaidThemeFor(true),
  });
  const { svg: dark } = await m.render(`${idPrefix}-d`, graphDef);
  return { light, dark: fixDarkContrast(dark) };
}

/**
 * Repair contrast on dark-mode mermaid SVGs.
 *
 * Mermaid honours per-element `style X fill:#...` / `classDef ... fill:#...`
 * declarations in the diagram source verbatim. When a user authors a
 * note/warning callout with a light fill (`fill:#fff8d6`, `#e1f5ff`,
 * `#fce4ec`, etc.) but no explicit text-colour override, the text
 * inside inherits the dark theme's default text colour (`#e7e3ff` —
 * near-white) → near-white text on near-white background, unreadable.
 *
 * We walk the rendered SVG and, for any shape whose fill is too light
 * to read white text against (sRGB luminance ≥ 0.55), force the text
 * children inside that same group to near-black. Only applied to the
 * dark-render output — light-render text colours are already dark.
 *
 * Runs ONCE per diagram at mount (not on theme toggle) — toggle is
 * still pure CSS swap of `display:none/block` on the light/dark
 * wrappers. Zero JS work when the user presses D.
 */
function fixDarkContrast(svgString: string): string {
  if (typeof DOMParser === "undefined") return svgString;
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(svgString, "image/svg+xml");
  } catch {
    return svgString;
  }
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== "svg") return svgString;

  // Sub-shapes that may carry a `fill`. We check each group's
  // primary shape; if it's "light" (luminance ≥ 0.55), every text
  // node descendant of that group gets pinned to dark.
  const shapeSel = "rect, polygon, ellipse, circle, path";

  // Mermaid wraps each node + its label in one of these group
  // classes. We scope text-colour overrides to the containing group
  // so we don't accidentally re-colour text outside.
  const groupSel =
    "g.node, g.cluster, g.actor, g.statediagram-state, " +
    "g.classGroup, g.entity, g.task, g.section";

  let groups: SVGGElement[] = Array.from(
    root.querySelectorAll<SVGGElement>(groupSel),
  );

  // Fallback for unusual diagrams: if nothing matched the explicit
  // group selectors, pair every shape with its parent <g> and treat
  // that as the group.
  if (groups.length === 0) {
    const seen = new Set<SVGGElement>();
    root.querySelectorAll<SVGElement>(shapeSel).forEach((s) => {
      const g = s.parentElement;
      if (g && g.tagName.toLowerCase() === "g") {
        seen.add(g as unknown as SVGGElement);
      }
    });
    groups = Array.from(seen);
  }

  for (const g of groups) {
    // Use the first descendant shape's fill as the group's
    // background colour. Reading from the shape attribute first
    // because mermaid emits the fill that way for inline `style`
    // overrides; falling back to the inline `style="fill:..."`.
    const shape = g.querySelector(shapeSel) as SVGElement | null;
    if (!shape) continue;
    const attrFill = shape.getAttribute("fill") ?? "";
    const styleFill =
      (shape.getAttribute("style") ?? "").match(/fill:\s*([^;"]+)/i)?.[1] ?? "";
    const fill = (attrFill || styleFill).trim().toLowerCase();
    if (!fill || fill === "none" || fill === "transparent") continue;
    const lum = sRgbLuminance(fill);
    if (lum < 0.55) continue; // dark / mid bg — light text is fine

    // Override text colour on every text node inside this group.
    // Skip text that already has an explicit user-set fill (theirs
    // wins). We set both the attribute (mermaid sometimes reads
    // this) and an inline style (wins over external CSS).
    g.querySelectorAll<SVGElement>("text, tspan").forEach((t) => {
      if (t.getAttribute("fill")) {
        // Even an explicit fill might be the dark-theme default
        // (e.g. mermaid stamps fill="#e7e3ff" on every label). If
        // it's also too light, override it.
        const existing = t.getAttribute("fill")!.trim().toLowerCase();
        if (sRgbLuminance(existing) > 0.5) {
          t.setAttribute("fill", "#1f1f1f");
        }
        return;
      }
      const inline = t.getAttribute("style") ?? "";
      if (/(?:^|;)\s*fill\s*:/i.test(inline)) return;
      t.setAttribute("fill", "#1f1f1f");
    });

    // `<foreignObject>` text isn't an SVG `<text>` — it's HTML.
    // Mermaid renders flowchart node labels this way when
    // `htmlLabels` is enabled (the default). Pin colour on
    // foreignObject's HTML children too.
    g.querySelectorAll<HTMLElement>("foreignObject *").forEach((el) => {
      const inline = el.getAttribute("style") ?? "";
      if (/(?:^|;)\s*color\s*:/i.test(inline)) {
        // Replace any existing colour declaration with dark.
        el.setAttribute(
          "style",
          inline.replace(/(?:^|;)\s*color\s*:\s*[^;]+;?/gi, "") +
            ";color:#1f1f1f",
        );
      } else {
        el.setAttribute("style", inline ? `${inline};color:#1f1f1f` : "color:#1f1f1f");
      }
    });
  }

  return new XMLSerializer().serializeToString(root);
}

/**
 * Approximate sRGB luminance (0–1) for a CSS colour string.
 * Supports `#rgb`, `#rrggbb`, `rgb(...)`. Returns 1 (white) when the
 * colour can't be parsed — safer to over-protect text than to wash
 * it out.
 */
function sRgbLuminance(color: string): number {
  const c = color.trim().toLowerCase();
  let r = 0,
    g = 0,
    b = 0;
  if (c.startsWith("#")) {
    const hex = c.slice(1);
    if (hex.length === 3) {
      r = parseInt(hex[0] + hex[0], 16);
      g = parseInt(hex[1] + hex[1], 16);
      b = parseInt(hex[2] + hex[2], 16);
    } else if (hex.length === 6) {
      r = parseInt(hex.slice(0, 2), 16);
      g = parseInt(hex.slice(2, 4), 16);
      b = parseInt(hex.slice(4, 6), 16);
    } else return 1;
  } else if (c.startsWith("rgb")) {
    const m = c.match(/(\d+(?:\.\d+)?)/g);
    if (!m || m.length < 3) return 1;
    r = Number(m[0]);
    g = Number(m[1]);
    b = Number(m[2]);
  } else return 1;
  // Rec.709 luminance, gamma-uncorrected — good enough as a
  // light-vs-dark threshold (we're not doing colour science here).
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

// ── Shiki singleton ──────────────────────────────────────────────
// Lazy-loaded the first time we encounter a code block. Shiki's
// `getSingletonHighlighter` caches the instance across calls, and
// each `loadLanguage(...)` only fetches the grammar JSON the first
// time it's requested — so a markdown file that only uses `ts` and
// `bash` never pays for the other ~270 language grammars. Bundle-
// size win vs. the Prism approach where every language we wanted
// support for had to ship eagerly.
type ShikiHighlighter = Awaited<
  ReturnType<typeof import("shiki").getSingletonHighlighter>
>;
let shikiPromise: Promise<ShikiHighlighter> | null = null;
async function getShiki(): Promise<ShikiHighlighter> {
  if (!shikiPromise) {
    shikiPromise = import("shiki").then((m) =>
      m.getSingletonHighlighter({
        // Two themes preloaded so we can paint either flavour
        // synchronously after the highlighter is ready. Names match
        // VS Code's built-in themes.
        themes: ["github-dark-default", "github-light-default"],
        // Start with no languages — we load them on demand below.
        langs: [],
      }),
    );
  }
  return shikiPromise;
}

/**
 * GitHub-style heading slug. Mirrors what markdown-it-anchor's
 * default slugger produces, but written inline so TOC links written
 * by hand like `(#1-context-and-problem-statement)` match.
 */
function githubSlug(s: string): string {
  return s
    .toLowerCase()
    .trim()
    // Strip everything that isn't a letter/number/dash/space/_,
    // including punctuation, emoji, and inline-code chars.
    .replace(/[^\p{L}\p{N}\s\-_]/gu, "")
    .replace(/\s+/g, "-");
}

const md: MarkdownIt = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
  typographer: false,
});

// MathJax 3 for inline + display math. Same `$…$` / `$$…$$` syntax
// users know from Obsidian. Replaces the @vscode/markdown-it-katex
// adapter — Obsidian itself uses MathJax 3.
md.use(mathjax3);

// Heading IDs (so `[Foo](#foo)` in the TOC works). Slug function
// mirrors GitHub's so hand-written anchors line up with what people
// expect from VS Code / GitHub / Obsidian.
md.use(markdownItAnchor, {
  slugify: githubSlug,
  permalink: false,
});

// Task lists — proper handling for both tight and loose lists.
// Renders <input type=checkbox disabled> exactly like GitHub.
md.use(markdownItTaskLists, {
  enabled: false, // checkboxes are display-only (no toggling)
  label: false,
});

// Syntax highlighting is applied as a POST-render Shiki pass on the
// rendered HTML (see `MarkdownPreviewBody` below). Shiki uses VS
// Code's TextMate grammars + themes — robust dependency-free language
// loading, perfect parity with VS Code colours. The markdown-it
// `fence` rule below escapes raw code into a stable
// `<pre><code class="language-xxx">...</code></pre>` shape that the
// Shiki pass recognises and replaces in place.

// Intercept ```mermaid fenced blocks so they're passed through to
// the post-render mermaid pass instead of being treated as code.
const defaultFenceRule = md.renderer.rules.fence ?? (() => "");
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
  return defaultFenceRule(tokens, idx, options, env, self);
};

const WIKILINK_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

function escapeText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderHtml(source: string): string {
  const html = md.render(source);
  // Wikilink post-process — markdown-it doesn't know about `[[Note]]`,
  // so we rewrite after the fact. Runs on the rendered HTML so it
  // composes cleanly with everything else (links inside lists, table
  // cells, blockquotes — all work).
  return html.replace(
    WIKILINK_RE,
    (_full, target: string, alias?: string) => {
      const label = (alias ?? target).trim();
      const t = target.trim().replace(/"/g, "&quot;");
      return `<a href="#" class="md-wikilink" data-target="${t}">${escapeText(label)}</a>`;
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
          {...paneActions}
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
  // Theme toggling is 100% CSS-driven for both Mermaid and Shiki —
  // mermaid pre-renders both light and dark SVGs at first paint,
  // shiki uses its native dual-theme mode (`themes: { light, dark }`)
  // which emits CSS variables. Toggling the `.dark` class on <html>
  // flips both surfaces in the same frame as the editor / chrome.
  // Previous implementation re-ran mermaid.render + shiki.codeToHtml
  // on every toggle — perceptible 100–300 ms trailing lag.

  // Imperative HTML injection — runs ONLY when the rendered markdown
  // actually changes. Using `useLayoutEffect` so the assignment
  // lands before paint (no flash of empty content), and using a
  // dedicated effect (not `dangerouslySetInnerHTML`) so unrelated
  // parent re-renders (sidebar resize, tab focus, etc.) don't
  // re-touch our DOM and wipe the Mermaid SVGs / Shiki replacements
  // we mutated externally.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.innerHTML = html;
  }, [html]);

  // Render mermaid diagrams after HTML is injected. Each diagram is
  // rendered TWICE — once with light theme variables, once with dark
  // — and both SVGs are dropped into the DOM. CSS picks the right
  // variant based on the `.dark` class on <html>. Toggle latency is
  // a single `display:none/block` flip — indistinguishable from the
  // chrome's CSS-only swap.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let cancelled = false;

    void (async () => {
      const diagrams = Array.from(
        el.querySelectorAll<HTMLElement>(".mermaid-diagram"),
      );
      if (diagrams.length === 0) return;
      for (let idx = 0; idx < diagrams.length; idx++) {
        if (cancelled) return;
        const div = diagrams[idx];
        const stash = div.getAttribute("data-mermaid-src");
        const fromAttr = div.dataset.mermaid;
        const graphDef = stash
          ? decodeURIComponent(stash)
          : fromAttr
            ? decodeURIComponent(fromAttr)
            : "";
        if (!graphDef) continue;
        if (!stash && fromAttr) {
          div.setAttribute("data-mermaid-src", fromAttr);
        }
        // Skip if already rendered (handles re-mounts that preserve DOM).
        if (div.querySelector(":scope > .mermaid-light")) continue;
        try {
          const prefix = `mermaid-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`;
          const { light, dark } = await renderMermaidBoth(graphDef, prefix);
          if (cancelled) return;
          div.innerHTML =
            `<div class="mermaid-light">${light}</div>` +
            `<div class="mermaid-dark">${dark}</div>`;
          div.removeAttribute("data-mermaid");
        } catch (err) {
          if (cancelled) return;
          div.innerHTML = `<pre class="mermaid-error">${String(err)}</pre>`;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [html]);

  // Shiki syntax-highlighting pass. Walks every `<pre><code>` block
  // in the rendered HTML, lazy-loads the grammar for its declared
  // language, and replaces the raw `<pre>` with Shiki's highlighted
  // markup. Skips mermaid containers (they already replaced
  // themselves with SVG). Subscribes to theme flips directly so the
  // highlighter re-runs in the same frame the CSS palette swaps —
  // Shiki syntax-highlighting pass. Uses Shiki's native dual-theme
  // mode (`themes: { light, dark }` with `defaultColor: false`) so
  // every token span carries BOTH `--shiki-light` and `--shiki-dark`
  // CSS variables and the active palette is selected purely via
  // `.dark` class CSS in styles.css. No re-highlight on theme flip —
  // toggle is instant.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let cancelled = false;

    void (async () => {
      const shiki = await getShiki();
      if (cancelled) return;
      const blocks = Array.from(el.querySelectorAll<HTMLPreElement>("pre"));
      for (const pre of blocks) {
        if (cancelled) return;
        if (pre.classList.contains("mermaid-diagram")) continue;
        if (pre.classList.contains("shiki")) continue; // already done
        const code = pre.querySelector("code");
        if (!code) continue;
        const className = code.className || "";
        const langMatch = className.match(/(?:^|\s)language-([\w-]+)/);
        const rawLang = langMatch ? langMatch[1].toLowerCase() : "";
        const source = code.textContent ?? "";
        const loaded = shiki.getLoadedLanguages();
        let lang = "text";
        if (rawLang && rawLang !== "plaintext" && rawLang !== "text") {
          if (loaded.includes(rawLang)) {
            lang = rawLang;
          } else {
            try {
              await shiki.loadLanguage(rawLang as never);
              if (cancelled) return;
              lang = rawLang;
            } catch {
              /* unknown grammar — leave as text */
            }
          }
        }
        try {
          const html = shiki.codeToHtml(source, {
            lang,
            themes: {
              light: "github-light-default",
              dark: "github-dark-default",
            },
            // `defaultColor: false` emits per-token style as
            // `--shiki-light: #...; --shiki-dark: #...;` instead of
            // burning a single colour in. The CSS in styles.css picks
            // whichever variable matches the active theme.
            defaultColor: false,
          });
          if (cancelled) return;
          const tmp = document.createElement("div");
          tmp.innerHTML = html;
          const next = tmp.firstElementChild as HTMLElement | null;
          if (next && pre.parentElement) {
            if (lang && lang !== "text") {
              next.setAttribute("data-lang", lang);
            }
            pre.parentElement.replaceChild(next, pre);
          }
        } catch {
          /* highlighting failed — leave the original `<pre>` alone */
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [html]);

  // Add a Copy button to every code block (docs-site pattern). Uses
  // a MutationObserver so it picks up Shiki's replacement `<pre>`
  // blocks too — those land asynchronously after the highlighter
  // resolves, so a one-shot pass keyed on `[html]` would miss them.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const detachers = new WeakMap<HTMLElement, () => void>();

    const attach = (pre: HTMLElement) => {
      if (pre.classList.contains("mermaid-diagram")) return;
      const code = pre.querySelector("code");
      if (!code) return;
      // Wrap `<pre>` in a non-scrolling positioned shell so the Copy
      // button stays pinned to the top-right regardless of the
      // horizontal scroll position inside `<pre>`. Without the
      // wrapper the absolutely-positioned button lives inside the
      // scroll viewport and slides off-screen when the user scrolls
      // wide code horizontally.
      const parent = pre.parentElement;
      if (!parent) return;
      let shell = pre.previousElementSibling as HTMLElement | null;
      const isShellAlready =
        parent.classList?.contains("md-pre-shell") === true;
      if (isShellAlready) return;
      if (parent.tagName === "DIV" && parent.classList.contains("md-pre-shell")) {
        return;
      }
      shell = document.createElement("div");
      shell.className = "md-pre-shell";
      // Copy any data-lang from the pre onto the shell so the
      // language label (which lives on `::before`) can be anchored
      // to the non-scrolling layer too.
      const lang = pre.getAttribute("data-lang");
      if (lang) shell.setAttribute("data-lang", lang);
      parent.insertBefore(shell, pre);
      shell.appendChild(pre);
      pre.classList.add("md-pre-with-copy");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "md-copy-btn";
      btn.textContent = "Copy";
      btn.setAttribute("aria-label", "Copy code");
      const onClick = async (ev: MouseEvent) => {
        ev.preventDefault();
        ev.stopPropagation();
        const text = code.textContent ?? "";
        try {
          await navigator.clipboard.writeText(text);
          btn.textContent = "Copied";
          btn.classList.add("is-copied");
          window.setTimeout(() => {
            btn.textContent = "Copy";
            btn.classList.remove("is-copied");
          }, 1500);
        } catch {
          btn.textContent = "Failed";
          window.setTimeout(() => {
            btn.textContent = "Copy";
          }, 1500);
        }
      };
      btn.addEventListener("click", onClick);
      shell.appendChild(btn);
      detachers.set(pre, () => {
        btn.removeEventListener("click", onClick);
        if (btn.parentElement === shell) shell.removeChild(btn);
      });
    };

    // Initial pass.
    el.querySelectorAll<HTMLPreElement>("pre").forEach(attach);

    // Live pass — Shiki swaps `<pre>` elements in after its async
    // load. Watch the subtree for new `<pre>` insertions.
    const observer = new MutationObserver((records) => {
      for (const r of records) {
        for (const node of Array.from(r.addedNodes)) {
          if (!(node instanceof HTMLElement)) continue;
          if (node.tagName === "PRE") {
            attach(node);
          } else {
            node.querySelectorAll?.<HTMLPreElement>("pre").forEach(attach);
          }
        }
      }
    });
    observer.observe(el, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      el.querySelectorAll<HTMLElement>("pre").forEach((pre) => {
        detachers.get(pre)?.();
      });
    };
  }, [html]);

  // Delegated click handler for wikilinks AND in-document hash
  // links (TOC `(#some-heading)` style). Hash links need our own
  // handling because the preview lives inside a scrollable container,
  // not the document — the browser's default `#anchor` jump would
  // try to scroll `window` and silently do nothing.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const wikilink = target.closest(".md-wikilink") as HTMLAnchorElement | null;
      if (wikilink) {
        e.preventDefault();
        const dataTarget = wikilink.dataset.target;
        if (!dataTarget) return;
        onOpenWikilinkRef.current?.(dataTarget);
        window.dispatchEvent(
          new CustomEvent("flux-open-wikilink", {
            detail: { target: dataTarget },
          }),
        );
        return;
      }
      const anchor = target.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      // markdown-it serialises the href attribute, so we read it
      // raw rather than from the resolved `.href` property (which
      // would have the document base URL prepended).
      const href = anchor.getAttribute("href") ?? "";
      if (href.startsWith("#") && href.length > 1) {
        const id = decodeURIComponent(href.slice(1));
        const targetEl = el.querySelector<HTMLElement>(
          `#${CSS.escape(id)}`,
        );
        if (targetEl) {
          e.preventDefault();
          targetEl.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }
      // External http(s) links fall through to the browser default —
      // Tauri's webview opens them via the configured handler.
    };
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, []);

  return (
    <div className="markdown-preview-host">
      {/* Imperative innerHTML assignment via useLayoutEffect (below)
       *  rather than `dangerouslySetInnerHTML`. With dSIH, React's
       *  reconciler re-checks the html string on every parent
       *  re-render — and any parent state change (sidebar resize,
       *  pane focus, etc.) that causes a re-render will wipe the
       *  Mermaid SVGs and Shiki-replaced `<pre>` blocks we mutated
       *  externally. Owning the assignment ourselves keeps those
       *  mutations intact until the markdown source actually changes. */}
      <div ref={containerRef} className="md-preview" />
    </div>
  );
}
