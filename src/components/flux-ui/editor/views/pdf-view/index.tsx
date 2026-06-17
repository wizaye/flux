import { useEffect, useMemo, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import { cn } from "@/lib/utils";
import { useVaultStore } from "@/state/vault-store";
import { readFileBinary } from "@/bindings";
import { PaneDocHeader } from "../../pane-doc-header";
import { EditorPaneLayout } from "../editor-pane-layout";
import { EMPTY_PANE_ACTIONS } from "../types";
import "./styles.css";

// Register the worker URL ONCE per module load.
(
  pdfjs as unknown as { GlobalWorkerOptions: { workerSrc: string } }
).GlobalWorkerOptions.workerSrc = pdfWorkerUrl as string;

const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;
const DEFAULT_ZOOM_IDX = 2;
const THUMB_WIDTH = 140;

// Minimal structural typing for the pdf.js surface we touch. Avoids
// pulling in the full `PDFDocumentProxy` typings (which churn between
// pdfjs-dist majors) while still keeping our usage type-safe.
type PdfViewport = { width: number; height: number };
type PdfRenderTask = { promise: Promise<void>; cancel?: () => void };
type PdfPage = {
  getViewport(opts: { scale: number }): PdfViewport;
  render(opts: {
    canvasContext: CanvasRenderingContext2D;
    viewport: PdfViewport;
  }): PdfRenderTask;
};
type PdfDoc = {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
};

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

// ── Per-page render serializer ─────────────────────────────────────
//
// pdf.js throws "Cannot use the same canvas during multiple render()
// operations" if `PdfPage.render()` is called twice on the same page
// before the prior render has settled — even when the canvases are
// different. This happens in two places:
//   1. The thumbnail rail mounts/unmounts as the user toggles it; the
//      prior render's `cancel()` returns immediately but pdf.js keeps
//      the page busy until the render promise actually rejects.
//   2. The main scroller and the thumbnail rail both rendering the
//      same page at the same time after a fresh load.
//
// Track in-flight renders per (doc, pageIndex) in a module-level
// WeakMap so the lock survives component unmount/remount cycles. Each
// new render awaits the prior one (after cancelling it) before
// invoking `page.render()`.

const pageLocks = new WeakMap<PdfDoc, Map<number, Promise<unknown>>>();

function getLocks(doc: PdfDoc): Map<number, Promise<unknown>> {
  let m = pageLocks.get(doc);
  if (!m) {
    m = new Map();
    pageLocks.set(doc, m);
  }
  return m;
}

/**
 * Serialize a render-producing function against any other in-flight
 * render for the same (doc, pageNum). Chains promise-style so we
 * preserve FIFO order across mounts and across the main/thumbnail
 * views.
 */
async function withPageLock<T>(
  doc: PdfDoc,
  pageNum: number,
  fn: () => Promise<T>,
): Promise<T> {
  const locks = getLocks(doc);
  const prior = locks.get(pageNum);
  // Swallow prior failures (cancellations) so the chain keeps moving.
  const next = (prior ?? Promise.resolve()).catch(() => undefined).then(fn);
  locks.set(pageNum, next);
  try {
    return await next;
  } finally {
    if (locks.get(pageNum) === next) locks.delete(pageNum);
  }
}

/**
 * Render one PdfPage into a canvas under the per-page lock. The
 * caller passes a `cancelled` getter so we can bail out if the React
 * effect that scheduled this render has been torn down by the time
 * the lock is released.
 */
async function renderPageInto(
  doc: PdfDoc,
  pageNum: number,
  canvas: HTMLCanvasElement,
  scale: number,
  isCancelled: () => boolean,
): Promise<void> {
  await withPageLock(doc, pageNum, async () => {
    if (isCancelled()) return;
    const page = await doc.getPage(pageNum);
    if (isCancelled()) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const viewport = page.getViewport({ scale: scale * dpr });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
    canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
    const task = page.render({ canvasContext: ctx, viewport });
    try {
      await task.promise;
    } catch (e) {
      const name = (e as { name?: string }).name ?? "";
      if (name !== "RenderingCancelledException") throw e;
    }
  });
}

/**
 * PDF viewer for flux.
 *
 * Layout: thumbnail rail on the left, scrollable page tray on the
 * right. Mirrors Chrome / Edge's built-in viewer so the muscle memory
 * carries over. PDF bytes come from the Tauri backend via
 * `read_file_binary` for real-vault files, or as base64 inline content
 * for the mock vault.
 */
export function PdfView(props: import("../types").EditorViewProps) {
  // Default guard — see markdown-preview/index.tsx for rationale.
  const { tab, file, content, paneActions = EMPTY_PANE_ACTIONS } = props;
  return (
    <EditorPaneLayout
      header={
        <PaneDocHeader
          tab={tab}
          onSplit={paneActions.onSplit}
          // PDF has no source/preview toggle — pass the noop through
          // anyway so the header signature stays uniform. The DocMoreMenu
          // hides the toggle item when `viewMode` is undefined.
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
      <PdfViewBody
        filePath={file.id}
        base64={content}
        fileName={file.name}
      />
    </EditorPaneLayout>
  );
}

type BodyProps = {
  /** Stable file id (used as key for re-fetch). */
  filePath: string;
  /** Base64-encoded PDF body (mock-vault path). */
  base64?: string;
  fileName?: string;
};

function PdfViewBody({ filePath, base64, fileName }: BodyProps) {
  const isVaultOpen = useVaultStore((s) => s.isVaultOpen);

  // ── Document state ───────────────────────────────────────────────
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoomIdx, setZoomIdx] = useState(DEFAULT_ZOOM_IDX);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showThumbs, setShowThumbs] = useState(true);

  const zoom = ZOOM_LEVELS[zoomIdx];

  // Refs for the scrollable tray + per-page canvases.
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Array<HTMLCanvasElement | null>>([]);

  // ── Load the PDF bytes + open the document ───────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPageCount(0);
    setCurrentPage(1);
    setDoc(null);

    const load = async () => {
      try {
        let data: Uint8Array | null = null;
        if (isVaultOpen) {
          // Real vault: pull bytes through Tauri so we never round-trip
          // the file as a UTF-8 string (which would corrupt the PDF).
          data = await readFileBinary(filePath);
        } else if (base64 && base64.length > 0) {
          // Mock vault fallback — FileNode.content is base64.
          data = base64ToBytes(base64);
        }
        if (!data || data.length === 0) {
          setError("No PDF data available for this file.");
          setLoading(false);
          return;
        }
        const opened = await (
          pdfjs as unknown as {
            getDocument(opts: {
              data: Uint8Array;
              useWorkerFetch?: boolean;
            }): { promise: Promise<PdfDoc> };
          }
        ).getDocument({ data, useWorkerFetch: false }).promise;
        if (cancelled) return;
        setDoc(opened);
        setPageCount(opened.numPages);
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [filePath, base64, isVaultOpen]);

  // ── Render every page into its canvas when zoom changes ──────────
  useEffect(() => {
    if (!doc || pageCount === 0) return;
    let cancelled = false;
    const isCancelled = () => cancelled;

    const renderAll = async () => {
      for (let i = 1; i <= doc.numPages; i++) {
        if (cancelled) return;
        const canvas = pageRefs.current[i - 1];
        if (!canvas) continue;
        try {
          await renderPageInto(doc, i, canvas, zoom, isCancelled);
        } catch (e) {
          if (!cancelled) {
            // eslint-disable-next-line no-console
            console.error(`PDF page ${i} render failed:`, e);
          }
        }
      }
    };

    void renderAll();
    return () => {
      cancelled = true;
    };
  }, [doc, pageCount, zoom]);

  // ── Track which page is in view (drives thumbnail highlight) ─────
  useEffect(() => {
    const root = containerRef.current;
    if (!root || pageCount === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible.length === 0) return;
        const pageAttr = (visible[0].target as HTMLElement).dataset.page;
        if (!pageAttr) return;
        const p = Number.parseInt(pageAttr, 10);
        if (!Number.isFinite(p)) return;
        setCurrentPage(p);
      },
      { root, threshold: [0.25, 0.5, 0.75] },
    );
    for (const canvas of pageRefs.current) {
      if (canvas) observer.observe(canvas);
    }
    return () => observer.disconnect();
  }, [pageCount]);

  const goToPage = (n: number) => {
    const clamped = Math.min(Math.max(1, n), pageCount);
    const canvas = pageRefs.current[clamped - 1];
    if (!canvas) return;
    canvas.scrollIntoView({ behavior: "smooth", block: "start" });
    setCurrentPage(clamped);
  };

  const pageSlots = useMemo(
    () => Array.from({ length: pageCount }, (_v, i) => i + 1),
    [pageCount],
  );

  return (
    <div className="pdf-view">
      <div className="pdf-toolbar">
        <button
          type="button"
          className="pdf-btn"
          onClick={() => setShowThumbs((v) => !v)}
          title={showThumbs ? "Hide thumbnails" : "Show thumbnails"}
          aria-pressed={showThumbs}
        >
          {/* sidebar glyph */}
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
            <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" />
            <line x1="6" y1="3" x2="6" y2="13" stroke="currentColor" />
          </svg>
        </button>
        <span className="pdf-title" title={fileName}>
          {fileName ?? "Document"}
        </span>
        <div className="pdf-spacer" />
        <button
          className="pdf-btn"
          onClick={() => goToPage(currentPage - 1)}
          disabled={loading || currentPage <= 1}
          title="Previous page"
          type="button"
        >
          ‹
        </button>
        <span className="pdf-page-indicator">
          {loading ? "…" : `${currentPage} / ${pageCount || "?"}`}
        </span>
        <button
          className="pdf-btn"
          onClick={() => goToPage(currentPage + 1)}
          disabled={loading || currentPage >= pageCount}
          title="Next page"
          type="button"
        >
          ›
        </button>
        <div className="pdf-spacer" />
        <button
          className="pdf-btn"
          onClick={() => setZoomIdx((z) => Math.max(0, z - 1))}
          disabled={loading || zoomIdx === 0}
          title="Zoom out"
          type="button"
        >
          −
        </button>
        <span className="pdf-zoom-label">{Math.round(zoom * 100)}%</span>
        <button
          className="pdf-btn"
          onClick={() =>
            setZoomIdx((z) => Math.min(ZOOM_LEVELS.length - 1, z + 1))
          }
          disabled={loading || zoomIdx === ZOOM_LEVELS.length - 1}
          title="Zoom in"
          type="button"
        >
          +
        </button>
      </div>
      <div className="pdf-body">
        {showThumbs && (
          <PdfThumbnails
            doc={doc}
            pageCount={pageCount}
            currentPage={currentPage}
            onJump={goToPage}
          />
        )}
        <div ref={containerRef} className="pdf-scroll">
          {error && (
            <div className="pdf-error">Failed to render PDF: {error}</div>
          )}
          {loading && !error && (
            <div className="pdf-loading">Loading PDF…</div>
          )}
          {pageSlots.map((p) => (
            <canvas
              key={p}
              data-page={p}
              ref={(el) => {
                pageRefs.current[p - 1] = el;
              }}
              className="pdf-page"
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Thumbnail rail ──────────────────────────────────────────────────

type ThumbProps = {
  doc: PdfDoc | null;
  pageCount: number;
  currentPage: number;
  onJump: (page: number) => void;
};

function PdfThumbnails({ doc, pageCount, currentPage, onJump }: ThumbProps) {
  const thumbRefs = useRef<Array<HTMLCanvasElement | null>>([]);

  // Render each thumbnail once per document load. Thumbnails are
  // fixed-width so we don't need to re-render on zoom. All renders go
  // through `renderPageInto` which holds a per-page lock — so toggling
  // the rail doesn't crash pdf.js with overlapping render() calls on
  // the same `PdfPage`.
  useEffect(() => {
    if (!doc || pageCount === 0) return;
    let cancelled = false;
    const isCancelled = () => cancelled;

    const renderAll = async () => {
      for (let i = 1; i <= doc.numPages; i++) {
        if (cancelled) return;
        const canvas = thumbRefs.current[i - 1];
        if (!canvas) continue;
        const baseScale = await (async () => {
          const page = await doc.getPage(i);
          const v = page.getViewport({ scale: 1 });
          return THUMB_WIDTH / v.width;
        })();
        if (cancelled) return;
        try {
          await renderPageInto(doc, i, canvas, baseScale, isCancelled);
        } catch (e) {
          if (!cancelled) {
            // eslint-disable-next-line no-console
            console.error(`Thumbnail ${i} render failed:`, e);
          }
        }
      }
    };

    void renderAll();
    return () => {
      cancelled = true;
    };
  }, [doc, pageCount]);

  // Auto-scroll the rail to keep the active thumbnail visible as the
  // main scroller moves. `block: "nearest"` avoids tugging the rail
  // around when the active page is already on-screen.
  useEffect(() => {
    const el = thumbRefs.current[currentPage - 1]?.parentElement;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [currentPage]);

  const items = useMemo(
    () => Array.from({ length: pageCount }, (_v, i) => i + 1),
    [pageCount],
  );

  return (
    <div className="pdf-thumb-rail" aria-label="Page thumbnails">
      {items.map((p) => (
        <button
          key={p}
          type="button"
          className={cn("pdf-thumb-item", p === currentPage && "is-active")}
          onClick={() => onJump(p)}
          aria-current={p === currentPage ? "page" : undefined}
        >
          <canvas
            ref={(el) => {
              thumbRefs.current[p - 1] = el;
            }}
            className="pdf-thumb-canvas"
          />
          <span className="pdf-thumb-label">{p}</span>
        </button>
      ))}
    </div>
  );
}
