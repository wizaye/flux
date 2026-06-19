import { useEffect, useMemo, useRef } from "react";
import MarkdownIt from "markdown-it";
import Reveal from "reveal.js";
import "reveal.js/reveal.css";
import "reveal.js/theme/black.css";
import "./styles.css";

/**
 * Slide-deck view for a single markdown file.
 *
 * Ported from `lattice/src/components/editor/SlidesView.tsx` with
 * the wikilink event renamed to `flux-open-wikilink`. The slide-
 * splitting + Reveal embedded-mode trickery is unchanged because
 * Reveal's lifecycle quirks are the same regardless of host app.
 *
 * Break convention (matches Marp / Pandoc / Reveal-markdown):
 *   • `---` on its own line → new horizontal slide
 *   • `--`  on its own line → new vertical sub-slide
 *   • fence-aware: `---` inside a ``` block does NOT split.
 */

const slidesMd = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
  typographer: false,
});

const WIKILINK_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function escapeText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderSlideHtml(source: string): string {
  const html = slidesMd.render(source);
  return html.replace(WIKILINK_RE, (_full, target: string, alias?: string) => {
    const label = (alias ?? target).trim();
    return `<a href="#" class="md-wikilink" data-target="${escapeAttr(target.trim())}">${escapeText(label)}</a>`;
  });
}

function splitSlides(source: string): string[][] {
  const horizontals: string[][] = [];
  let curHoriz: string[] = [];
  let curSlide: string[] = [];
  let inFence = false;
  let fenceMark: "```" | "~~~" | null = null;

  const flushSlide = () => {
    curHoriz.push(curSlide.join("\n"));
    curSlide = [];
  };
  const flushHoriz = () => {
    flushSlide();
    horizontals.push(curHoriz);
    curHoriz = [];
  };

  for (const line of source.split(/\r?\n/)) {
    if (!inFence) {
      if (/^```/.test(line)) {
        inFence = true;
        fenceMark = "```";
      } else if (/^~~~/.test(line)) {
        inFence = true;
        fenceMark = "~~~";
      }
    } else if (
      (fenceMark === "```" && /^```\s*$/.test(line)) ||
      (fenceMark === "~~~" && /^~~~\s*$/.test(line))
    ) {
      inFence = false;
      fenceMark = null;
    }

    if (!inFence) {
      if (/^---\s*$/.test(line)) {
        flushHoriz();
        continue;
      }
      if (/^--\s*$/.test(line)) {
        flushSlide();
        continue;
      }
    }
    curSlide.push(line);
  }
  flushHoriz();

  while (
    horizontals.length > 1 &&
    horizontals[horizontals.length - 1].every((s) => s.trim().length === 0)
  ) {
    horizontals.pop();
  }

  return horizontals;
}

import { PaneDocHeader } from "../../pane-doc-header";
import { EditorPaneLayout } from "../editor-pane-layout";
import { EMPTY_PANE_ACTIONS, type EditorViewProps } from "../types";

/**
 * Contract-compliant wrapper: every view receives the same
 * `EditorViewProps` bundle and builds its own chrome. Slides keeps
 * the standard `<PaneDocHeader/>` so users can toggle back to
 * reading/source without leaving the tab.
 */
export function SlidesView(props: EditorViewProps) {
  // Default guard — see markdown-preview/index.tsx for rationale.
  const { tab, content, paneActions = EMPTY_PANE_ACTIONS } = props;
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
      <SlidesViewBody source={content} />
    </EditorPaneLayout>
  );
}

type BodyProps = {
  source: string;
};

function SlidesViewBody({ source }: BodyProps) {
  const deckRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<{
    destroy(): void;
    layout(): void;
    sync(): void;
  } | null>(null);

  const slidesHtml = useMemo(() => {
    const horizontals = splitSlides(source ?? "");
    const parts: string[] = [];
    for (const stack of horizontals) {
      if (stack.length === 1) {
        parts.push(`<section>${renderSlideHtml(stack[0])}</section>`);
      } else {
        parts.push("<section>");
        for (const slide of stack) {
          parts.push(`<section>${renderSlideHtml(slide)}</section>`);
        }
        parts.push("</section>");
      }
    }
    return parts.join("");
  }, [source]);

  useEffect(() => {
    const root = deckRef.current;
    if (!root) return;

    if (instanceRef.current) {
      try {
        instanceRef.current.destroy();
      } catch {
        /* noop */
      }
      instanceRef.current = null;
    }

    const slides = root.querySelector(".slides");
    if (slides) slides.innerHTML = slidesHtml;

    const inst = new Reveal(root, {
      embedded: true,
      hash: false,
      controls: true,
      progress: true,
      slideNumber: "c/t",
      keyboard: true,
      transition: "slide",
      autoSlide: 0,
      width: 960,
      height: 600,
      margin: 0.05,
      minScale: 0.2,
      maxScale: 2.0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      scrollActivationWidth: null as any,
    });
    void inst.initialize().then(() => {
      instanceRef.current = inst as unknown as typeof instanceRef.current;
    });

    return () => {
      try {
        inst.destroy();
      } catch {
        /* noop */
      }
      instanceRef.current = null;
    };
  }, [slidesHtml]);

  useEffect(() => {
    const root = deckRef.current;
    if (!root) return;
    const ro = new ResizeObserver(() => {
      const inst = instanceRef.current;
      if (inst) {
        try {
          inst.layout();
        } catch {
          /* noop */
        }
      }
    });
    ro.observe(root);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const root = deckRef.current;
    if (!root) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const link = target.closest(".md-wikilink") as HTMLAnchorElement | null;
      if (!link) return;
      e.preventDefault();
      const dataTarget = link.dataset.target;
      if (!dataTarget) return;
      window.dispatchEvent(
        new CustomEvent("flux-open-wikilink", {
          detail: { target: dataTarget },
        }),
      );
    };
    root.addEventListener("click", onClick);
    return () => root.removeEventListener("click", onClick);
  }, []);

  return (
    <div className="slides-view">
      <div ref={deckRef} className="reveal slides-host">
        <div className="slides" />
      </div>
    </div>
  );
}
