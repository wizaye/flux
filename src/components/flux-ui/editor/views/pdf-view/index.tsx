import { useEffect, useMemo, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import { PaneDocHeader } from "../../pane-doc-header";
import { EditorPaneLayout } from "../editor-pane-layout";
import { EMPTY_PANE_ACTIONS } from "../types";
import "./styles.css";

// Register the worker URL ONCE per module load.
(
  pdfjs as unknown as { GlobalWorkerOptions: { workerSrc: string } }
).GlobalWorkerOptions.workerSrc = pdfWorkerUrl as string;

/**
 * PDF viewer for flux.
 *
 * Ported from `lattice/src/components/editor/PdfView.tsx`. The lattice
 * version reads bytes from disk via Tauri IPC; flux currently runs
 * with the mock vault so PDFs are passed in as base64 — when the
 * real-vault landing arrives we'll add the IPC fetch back.
 */

type Props = {
  /** Stable file id (used as key for re-fetch). */
  filePath: string;
  /** Base64-encoded PDF body. */
  base64?: string;
  /** Pre-decoded bytes (preferred over base64 to avoid double-copy). */
  bytes?: Uint8Array;
  fileName?: string;
};

const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;
const DEFAULT_ZOOM_IDX = 2;

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

type PdfDoc = {
  numPages: number;
  getPage(n: number): Promise<{
    getViewport(opts: { scale: number }): { width: number; height: number };
    render(opts: {
      canvasContext: CanvasRenderingContext2D;
      viewport: { width: number; height: number };
    }): { promise: Promise<void>; cancel?: () => void };
  }>;
};

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

function PdfViewBody({ filePath, base64, bytes, fileName }: Props) {
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoomIdx, setZoomIdx] = useState(DEFAULT_ZOOM_IDX);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Array<HTMLCanvasElement | null>>([]);
  const renderTasksRef = useRef<Array<{ cancel: () => void } | null>>([]);
  const docRef = useRef<PdfDoc | null>(null);

  const zoom = ZOOM_LEVELS[zoomIdx];

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPageCount(0);
    setCurrentPage(1);
    docRef.current = null;

    const load = async () => {
      try {
        const data = bytes ?? (base64 ? base64ToBytes(base64) : null);
        if (!data || data.length === 0) {
          setError("No PDF data provided.");
          setLoading(false);
          return;
        }
        const doc = await (
          pdfjs as unknown as {
            getDocument(opts: {
              data: Uint8Array;
              useWorkerFetch?: boolean;
            }): { promise: Promise<PdfDoc> };
          }
        ).getDocument({ data, useWorkerFetch: false }).promise;
        if (cancelled || !doc) return;
        docRef.current = doc;
        setPageCount(doc.numPages);
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
      for (const task of renderTasksRef.current) {
        try {
          task?.cancel?.();
        } catch {
          /* noop */
        }
      }
      renderTasksRef.current = [];
    };
  }, [filePath, base64, bytes]);

  useEffect(() => {
    if (!docRef.current || pageCount === 0) return;
    let cancelled = false;

    for (const task of renderTasksRef.current) {
      try {
        task?.cancel?.();
      } catch {
        /* noop */
      }
    }
    renderTasksRef.current = [];

    const renderAll = async () => {
      const doc = docRef.current;
      if (!doc) return;
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      for (let i = 1; i <= doc.numPages; i++) {
        if (cancelled) return;
        const canvas = pageRefs.current[i - 1];
        if (!canvas) continue;
        const ctx = canvas.getContext("2d");
        if (!ctx) continue;
        try {
          const page = await doc.getPage(i);
          const viewport = page.getViewport({ scale: zoom * dpr });
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
          canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
          const task = page.render({ canvasContext: ctx, viewport });
          renderTasksRef.current[i - 1] = task as { cancel: () => void };
          await task.promise;
        } catch (e) {
          const name = (e as { name?: string }).name ?? "";
          if (name === "RenderingCancelledException") continue;
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
  }, [pageCount, zoom]);

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
      <div ref={containerRef} className="pdf-scroll">
        {error && <div className="pdf-error">Failed to render PDF: {error}</div>}
        {loading && !error && <div className="pdf-loading">Loading PDF…</div>}
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
  );
}
