import { WidgetType } from "@codemirror/view";

/**
 * Shared widget classes for the live-preview extension. Each widget
 * replaces a stretch of raw markdown markup with a rendered visual
 * (image, math, embed) when the cursor is not inside that range.
 *
 * All widgets implement `eq()` so CodeMirror reuses the existing DOM
 * across viewport / selection updates — recreating a widget tears
 * down its child DOM (re-loads images, re-renders math), which is
 * the single biggest perf trap with decoration widgets.
 */

/** `[[wikilink]]` or `[[wikilink|alias]]` rendered as a clickable pill. */
export class WikilinkWidget extends WidgetType {
  constructor(readonly target: string, readonly label: string) {
    super();
  }
  override eq(other: WidgetType): boolean {
    return (
      other instanceof WikilinkWidget &&
      other.target === this.target &&
      other.label === this.label
    );
  }
  toDOM(): HTMLElement {
    const a = document.createElement("a");
    a.className = "cm-lp-wikilink";
    a.setAttribute("data-target", this.target);
    a.textContent = this.label;
    a.setAttribute("draggable", "false");
    return a;
  }
  // The widget is just a styled span — events bubble normally and
  // the editor's click handler already routes wikilinks.
  override ignoreEvent(): boolean {
    return false;
  }
}

/** `![[image.png]]` or `![alt](url)` rendered inline. */
export class ImageWidget extends WidgetType {
  constructor(readonly src: string, readonly alt: string) {
    super();
  }
  override eq(other: WidgetType): boolean {
    return (
      other instanceof ImageWidget &&
      other.src === this.src &&
      other.alt === this.alt
    );
  }
  toDOM(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-lp-image";
    const img = document.createElement("img");
    img.src = this.src;
    img.alt = this.alt;
    img.loading = "lazy";
    img.draggable = false;
    wrap.appendChild(img);
    return wrap;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

/** Renders a horizontal rule (`---`) as an actual `<hr>` line. */
export class HrWidget extends WidgetType {
  override eq(other: WidgetType): boolean {
    return other instanceof HrWidget;
  }
  toDOM(): HTMLElement {
    const hr = document.createElement("hr");
    hr.className = "cm-lp-hr";
    return hr;
  }
}

/**
 * Renders a rendered checkbox in place of the literal `[ ]` or `[x]`
 * inside a task list item. The underlying text is unchanged — toggling
 * the checkbox is handled by a `domEventHandlers` click listener on
 * the editor view that swaps the character in the document.
 */
export class TaskCheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean, readonly pos: number) {
    super();
  }
  override eq(other: WidgetType): boolean {
    return (
      other instanceof TaskCheckboxWidget &&
      other.checked === this.checked &&
      other.pos === this.pos
    );
  }
  toDOM(): HTMLElement {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "cm-lp-task";
    input.checked = this.checked;
    input.setAttribute("data-pos", String(this.pos));
    return input;
  }
  override ignoreEvent(ev: Event): boolean {
    // Allow clicks through so the editor's click handler can toggle.
    return ev.type !== "mousedown" && ev.type !== "click";
  }
}

/**
 * Block-level widget that renders a markdown pipe-table as an actual
 * `<table>`. The widget owns its DOM tree and is reused across
 * updates whenever the source string is unchanged (Obsidian-style
 * stable widget — typing in a paragraph above doesn't blow away the
 * table render).
 *
 * Source is the raw markdown slice (`| a | b |\n|---|---|\n| 1 | 2 |`).
 * Parsing is hand-rolled instead of routing through markdown-it
 * because we already have the slice ranges from Lezer and don't want
 * to instantiate a markdown-it pipeline per widget construction.
 */
export class TableWidget extends WidgetType {
  constructor(readonly source: string) {
    super();
  }
  override eq(other: WidgetType): boolean {
    return other instanceof TableWidget && other.source === this.source;
  }
  toDOM(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-lp-table-wrap";
    const table = document.createElement("table");
    table.className = "cm-lp-table";
    const lines = this.source
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    // A valid GFM table is: header, separator (---), then 0+ rows.
    // We tolerate malformed input — if there's no separator, every
    // line becomes a body row.
    let sepIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(lines[i])) {
        sepIdx = i;
        break;
      }
    }
    const headerLines = sepIdx > 0 ? lines.slice(0, sepIdx) : [];
    const bodyLines = sepIdx >= 0 ? lines.slice(sepIdx + 1) : lines;

    const splitCells = (line: string) => {
      // Strip leading/trailing pipes, then split. Empty cells (`||`)
      // are kept so column counts stay aligned.
      let s = line;
      if (s.startsWith("|")) s = s.slice(1);
      if (s.endsWith("|")) s = s.slice(0, -1);
      return s.split("|").map((c) => c.trim());
    };

    if (headerLines.length > 0) {
      const thead = document.createElement("thead");
      const tr = document.createElement("tr");
      for (const cell of splitCells(headerLines[0])) {
        const th = document.createElement("th");
        renderInlineInto(th, cell);
        tr.appendChild(th);
      }
      thead.appendChild(tr);
      table.appendChild(thead);
    }
    if (bodyLines.length > 0) {
      const tbody = document.createElement("tbody");
      for (const line of bodyLines) {
        const tr = document.createElement("tr");
        for (const cell of splitCells(line)) {
          const td = document.createElement("td");
          renderInlineInto(td, cell);
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
    }

    wrap.appendChild(table);
    return wrap;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

/**
 * Block-level widget that renders a fenced code block with Shiki
 * syntax highlighting. The widget body is filled synchronously with
 * a plain `<pre><code>` (so layout doesn't jump), and Shiki's
 * dual-theme HTML is swapped in once the async highlight resolves.
 *
 * Caches Shiki's HTML by `${lang}::${source}` so repeated
 * decoration rebuilds (every keystroke!) reuse the previous render.
 * Without this cache, typing a single character anywhere in the
 * document would re-highlight every code block on the next viewport
 * pass — the dominant cost for a doc with many fences.
 */
const shikiCache = new Map<string, string>();
let shikiPromise: Promise<unknown> | null = null;

export class CodeBlockWidget extends WidgetType {
  constructor(readonly source: string, readonly lang: string) {
    super();
  }
  override eq(other: WidgetType): boolean {
    return (
      other instanceof CodeBlockWidget &&
      other.source === this.source &&
      other.lang === this.lang
    );
  }
  toDOM(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-lp-codeblock";
    if (this.lang) wrap.setAttribute("data-lang", this.lang);

    const cacheKey = `${this.lang}::${this.source}`;
    const cached = shikiCache.get(cacheKey);
    if (cached) {
      wrap.innerHTML = cached;
      return wrap;
    }

    // Synchronous placeholder so the widget never measures as
    // empty — matters for cursor positioning around the block.
    const fallback = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = this.source;
    fallback.appendChild(code);
    wrap.appendChild(fallback);

    // Async highlight + swap.
    void highlightAndSwap(wrap, this.source, this.lang, cacheKey);
    return wrap;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

async function highlightAndSwap(
  wrap: HTMLElement,
  source: string,
  lang: string,
  cacheKey: string,
): Promise<void> {
  try {
    if (!shikiPromise) {
      shikiPromise = import("shiki").then((m) =>
        m.getSingletonHighlighter({
          themes: ["github-light-default", "github-dark-default"],
          langs: [],
        }),
      );
    }
    const shiki = (await shikiPromise) as Awaited<
      ReturnType<typeof import("shiki").getSingletonHighlighter>
    >;
    let useLang = "text";
    if (lang && lang !== "plaintext" && lang !== "text") {
      const loaded = shiki.getLoadedLanguages();
      if (loaded.includes(lang)) {
        useLang = lang;
      } else {
        try {
          await shiki.loadLanguage(lang as never);
          useLang = lang;
        } catch {
          /* unknown grammar — render as plain text */
        }
      }
    }
    const html = shiki.codeToHtml(source, {
      lang: useLang,
      themes: {
        light: "github-light-default",
        dark: "github-dark-default",
      },
      defaultColor: false,
    });
    shikiCache.set(cacheKey, html);
    // If the widget DOM is still attached, swap in the highlighted
    // markup. If the user has typed past it the widget may have
    // been replaced — that's fine, the cache still warms.
    if (wrap.isConnected) {
      wrap.innerHTML = html;
    }
  } catch {
    /* highlight failed — keep the plain-text fallback */
  }
}

/**
 * Tiny inline-markdown renderer used by `TableWidget` cells. Handles
 * the most common inline marks (`**bold**`, `*italic*`, `` `code` ``,
 * `[label](url)`, `[[wikilink]]`). For anything more exotic the cell
 * falls back to literal text. The whole point is keeping table cells
 * lightweight so this stays cheap even at 100+ rows.
 */
function renderInlineInto(host: HTMLElement, source: string): void {
  // Escape first — we build up DOM via innerHTML so the source text
  // must not contain raw markup.
  const escaped = source
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const html = escaped
    // Wikilinks first (so they don't get gobbled by other patterns).
    .replace(
      /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
      (_m, t: string, l?: string) =>
        `<a class="cm-lp-wikilink" data-target="${t.trim().replace(/"/g, "&quot;")}">${(l ?? t).trim()}</a>`,
    )
    // Inline code (`` `code` ``) — must run before bold/italic so
    // backticks inside emphasis don't get split.
    .replace(/`([^`]+)`/g, '<code class="cm-lp-inline-code">$1</code>')
    // Standard links `[label](url)` — label rendered visibly.
    .replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      (_m, label: string, url: string) =>
        `<a class="cm-lp-link" href="${url.replace(/"/g, "&quot;")}">${label}</a>`,
    )
    // Bold then italic (order matters — `**foo**` would match `*foo*`).
    .replace(/\*\*([^*]+)\*\*/g, '<strong class="cm-lp-bold">$1</strong>')
    .replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, '<em class="cm-lp-italic">$1</em>')
    .replace(/~~([^~]+)~~/g, '<span class="cm-lp-strike">$1</span>');
  host.innerHTML = html;
}