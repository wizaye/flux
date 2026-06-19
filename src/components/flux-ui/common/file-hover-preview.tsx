/**
 * File hover preview with two modes:
 *
 *   • Plain hover    → small metadata tooltip (name, modified,
 *                      created, size). Loads `get_file_metadata`
 *                      lazily on first hover, cached afterwards.
 *
 *   • Ctrl + hover   → rich popover that renders the actual file
 *                      content (markdown via the reading-mode
 *                      pipeline, raw text otherwise).
 *
 * Positioning is **cursor-anchored** (below + slightly right of the
 * pointer tail) rather than row-anchored. Two reasons:
 *   1. Long file rows under a thin sidebar already overflow; anchoring
 *      to the row pushes the popover far from where the eye is.
 *   2. The popover sits next to the cursor with no gap, so the user
 *      can move from row into the popover and interact with it (scroll,
 *      click links) without crossing a dead zone that would close it.
 *
 * If the user starts hovering without Ctrl held and then presses it
 * mid-hover, the popover swaps live from metadata → preview. Mirrors
 * the VS Code "Ctrl-hover for details" idiom.
 */
import * as React from "react";
import { createPortal } from "react-dom";
import { ScrollArea } from "@/components/ui/scroll-area";
import * as backend from "@/bindings";
import type { FileMetadata } from "@/bindings";
import type { FileNode } from "@/state/editor/types";
import { useVaultStore } from "@/state/vault-store";
import { useEditorStore } from "@/state/editor-store";
import { MarkdownPreviewBody } from "@/components/flux-ui/editor/views/markdown-preview";
import { IcLinkExternal } from "@/components/flux-ui/common/icons";
import { cn } from "@/lib/utils";

// ── Caches (module-level so unrelated remounts don't refetch) ────
type PreviewState = "idle" | "loading" | "ready" | "error" | "binary";
type Preview = { state: PreviewState; text?: string; error?: string };
type MetaState = "idle" | "loading" | "ready" | "error";
type Meta = { state: MetaState; data?: FileMetadata; error?: string };

const previewCache = new Map<string, Preview>();
const metaCache = new Map<string, Meta>();

const PREVIEW_BYTE_LIMIT = 16 * 1024;
const PREVIEW_LINE_LIMIT = 200;
const META_OPEN_DELAY = 500;
const PREVIEW_OPEN_DELAY = 250;
const CLOSE_DELAY = 120;
/** Pixel offset from the cursor's tail (bottom-right) to the
 *  popover's top-left. Small enough to act like a "below the cursor"
 *  attachment without leaving a gap the mouse can cross. */
const CURSOR_OFFSET_X = 14;
const CURSOR_OFFSET_Y = 18;

function isBinaryKind(node: FileNode): boolean {
  if (node.kind === "pdf" || node.kind === "graph") return true;
  const lower = node.name.toLowerCase();
  return (
    lower.endsWith(".png") ||
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".gif") ||
    lower.endsWith(".webp") ||
    lower.endsWith(".svg") ||
    lower.endsWith(".ico") ||
    lower.endsWith(".pdf")
  );
}

function isMarkdownKind(node: FileNode): boolean {
  const lower = node.name.toLowerCase();
  return lower.endsWith(".md") || lower.endsWith(".markdown");
}

function truncate(text: string): string {
  const lines = text.split("\n");
  let out = lines.slice(0, PREVIEW_LINE_LIMIT).join("\n");
  if (out.length > PREVIEW_BYTE_LIMIT) {
    out = out.slice(0, PREVIEW_BYTE_LIMIT) + "\n…";
  }
  return out;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatRelative(ms: number): string {
  if (!ms) return "unknown";
  const diff = (Date.now() - ms) / 1000;
  if (diff < 5) return "just now";
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(ms).toLocaleDateString();
}

function formatExact(ms: number): string {
  if (!ms) return "unknown";
  const d = new Date(ms);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

export type FileHoverPreviewProps = {
  node: FileNode;
  /** The trigger element — the actual tree row. */
  children: React.ReactNode;
  /** Click handler for the "open in editor" button shown in the top-
   *  right of the preview popover. Same shape as the sidebar's
   *  `onOpenFile` so we can wire it through directly. */
  onOpenFile?: (fileId: string) => void;
};

type Mode = "meta" | "preview";
type Anchor = { x: number; y: number } | null;

const POPOVER_W = { meta: 260, preview: 420 };
const POPOVER_H = { meta: 140, preview: 360 };

export function FileHoverPreview({ node, children, onOpenFile }: FileHoverPreviewProps) {
  const isFolder = node.kind === "folder";
  const isVaultOpen = useVaultStore((s) => s.isVaultOpen);
  const liveBody = useEditorStore((s) => s.fileContents.get(node.id));
  const cachedBody = useVaultStore((s) => s.openFiles.get(node.id));

  const [open, setOpen] = React.useState(false);
  const [mode, setMode] = React.useState<Mode>("meta");
  const [anchor, setAnchor] = React.useState<Anchor>(null);
  const [, setTick] = React.useState(0);
  const bump = () => setTick((t) => t + 1);

  const openTimerRef = React.useRef<number | null>(null);
  const closeTimerRef = React.useRef<number | null>(null);
  const hoveringTriggerRef = React.useRef(false);
  const hoveringPopoverRef = React.useRef(false);
  const popoverRef = React.useRef<HTMLDivElement | null>(null);
  // Once preview mode opens, treat the popover as "pinned" — we keep
  // it in preview mode even if the user releases Ctrl, and we keep
  // it open even after the mouse leaves (until they click outside).
  // That matches the VS Code peek-window idiom: Ctrl-hover opens it,
  // then it behaves like a normal popover you can scroll through and
  // interact with hands-off.
  const stickyPreviewRef = React.useRef(false);

  const cancelTimers = React.useCallback(() => {
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  React.useEffect(() => () => cancelTimers(), [cancelTimers]);

  // When the popover closes for any reason, drop the sticky pin so
  // the next plain hover starts in meta mode again.
  React.useEffect(() => {
    if (!open) stickyPreviewRef.current = false;
  }, [open]);

  // ── Metadata fetch (lazy, cached) ───────────────────────────────
  React.useEffect(() => {
    if (!open || isFolder) return;
    const existing = metaCache.get(node.id);
    if (existing && (existing.state === "ready" || existing.state === "loading")) {
      return;
    }
    metaCache.set(node.id, { state: "loading" });
    bump();
    if (!isVaultOpen) {
      metaCache.set(node.id, {
        state: "ready",
        data: {
          size: typeof node.content === "string" ? node.content.length : 0,
          createdAt: 0,
          modifiedAt: 0,
          isDir: false,
        },
      });
      bump();
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await backend.getFileMetadata(node.id);
        if (cancelled) return;
        metaCache.set(node.id, { state: "ready", data });
        bump();
      } catch (e) {
        if (cancelled) return;
        metaCache.set(node.id, {
          state: "error",
          error: e instanceof Error ? e.message : String(e),
        });
        bump();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, isFolder, node.id, isVaultOpen, node.content]);

  // ── Preview fetch (only when Ctrl+hover) ────────────────────────
  React.useEffect(() => {
    if (!open || mode !== "preview" || isFolder) return;
    if (isBinaryKind(node)) {
      previewCache.set(node.id, { state: "binary" });
      bump();
      return;
    }
    const fresh = liveBody ?? cachedBody;
    if (fresh !== undefined) {
      previewCache.set(node.id, { state: "ready", text: truncate(fresh) });
      bump();
      return;
    }
    const existing = previewCache.get(node.id);
    if (existing && existing.state === "loading") return;
    if (!isVaultOpen) {
      const inline = node.content;
      previewCache.set(node.id, {
        state: "ready",
        text: typeof inline === "string" ? truncate(inline) : "",
      });
      bump();
      return;
    }
    previewCache.set(node.id, { state: "loading" });
    bump();
    let cancelled = false;
    (async () => {
      try {
        const body = await backend.readFile(node.id);
        if (cancelled) return;
        previewCache.set(node.id, { state: "ready", text: truncate(body) });
        bump();
      } catch (e) {
        if (cancelled) return;
        previewCache.set(node.id, {
          state: "error",
          error: e instanceof Error ? e.message : String(e),
        });
        bump();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, mode, isFolder, node, isVaultOpen, liveBody, cachedBody]);

  // ── Hover/key wiring ────────────────────────────────────────────
  const scheduleOpen = React.useCallback(
    (nextMode: Mode) => {
      cancelTimers();
      setMode(nextMode);
      const delay = nextMode === "preview" ? PREVIEW_OPEN_DELAY : META_OPEN_DELAY;
      openTimerRef.current = window.setTimeout(() => {
        setOpen(true);
        openTimerRef.current = null;
      }, delay);
    },
    [cancelTimers],
  );

  const scheduleClose = React.useCallback(() => {
    cancelTimers();
    closeTimerRef.current = window.setTimeout(() => {
      // If the popover is sticky-pinned (preview mode), only an
      // outside click can close it — ignore mouse-leave entirely.
      if (stickyPreviewRef.current) return;
      // If the mouse jumped into the popover during the close grace
      // period, abort — `hoveringPopoverRef` is set by the popover's
      // own onMouseEnter.
      if (hoveringTriggerRef.current || hoveringPopoverRef.current) return;
      setOpen(false);
      closeTimerRef.current = null;
    }, CLOSE_DELAY);
  }, [cancelTimers]);

  const handleMouseEnter = React.useCallback(
    (e: React.MouseEvent) => {
      hoveringTriggerRef.current = true;
      setAnchor({ x: e.clientX, y: e.clientY });
      const ctrl = e.ctrlKey || e.metaKey;
      const nextMode: Mode = ctrl ? "preview" : "meta";
      if (nextMode === "preview") stickyPreviewRef.current = true;
      scheduleOpen(nextMode);
    },
    [scheduleOpen],
  );

  const handleMouseMove = React.useCallback(
    (e: React.MouseEvent) => {
      // Track the cursor while it's over the trigger but BEFORE the
      // popover opens. Once open, freeze the anchor so the popover
      // doesn't chase the cursor and lose its dock point.
      if (open) return;
      setAnchor({ x: e.clientX, y: e.clientY });
    },
    [open],
  );

  const handleMouseLeave = React.useCallback(() => {
    hoveringTriggerRef.current = false;
    scheduleClose();
  }, [scheduleClose]);

  // Live mode switching when the user toggles Ctrl mid-hover.
  // Asymmetric on purpose: Ctrl-down can ALWAYS upgrade meta -> preview
  // (and pins the popover), but Ctrl-up never downgrades — once you've
  // committed to peeking the file body, releasing Ctrl shouldn't yank
  // the popover back to a meta tooltip.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!hoveringTriggerRef.current && !hoveringPopoverRef.current) return;
      if (e.type !== "keydown") return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;
      setMode("preview");
      stickyPreviewRef.current = true;
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // Outside-click dismiss. The popover only "sticks" in preview
  // mode; meta tooltips close on mouse-leave like a normal tooltip
  // so we don't trap clicks for them.
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (popoverRef.current?.contains(t)) return;
      // Reset stickiness so the next hover starts fresh.
      stickyPreviewRef.current = false;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Folder rows skip both behaviours entirely.
  if (isFolder) return <>{children}</>;

  // Inject hover handlers into the trigger child (the file row
  // button).
  const triggerWithHover = React.isValidElement(children)
    ? React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
        onMouseEnter: handleMouseEnter,
        onMouseMove: handleMouseMove,
        onMouseLeave: handleMouseLeave,
      })
    : children;

  const meta = metaCache.get(node.id);
  const preview = previewCache.get(node.id);

  // Clamp the popover position to the viewport so it stays fully
  // visible even when the user hovers a row at the bottom-right.
  let positionStyle: React.CSSProperties | null = null;
  if (open && anchor && typeof window !== "undefined") {
    const w = POPOVER_W[mode];
    const h = POPOVER_H[mode];
    const margin = 8;
    let left = anchor.x + CURSOR_OFFSET_X;
    let top = anchor.y + CURSOR_OFFSET_Y;
    if (left + w > window.innerWidth - margin) {
      left = Math.max(margin, anchor.x - w - CURSOR_OFFSET_X);
    }
    if (top + h > window.innerHeight - margin) {
      top = Math.max(margin, anchor.y - h - CURSOR_OFFSET_Y);
    }
    positionStyle = { position: "fixed", left, top, zIndex: 50 };
  }

  return (
    <>
      {triggerWithHover}
      {open && positionStyle && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={popoverRef}
              role="dialog"
              aria-label="File preview"
              style={{
                ...positionStyle,
                width: POPOVER_W[mode],
              }}
              onMouseEnter={() => {
                hoveringPopoverRef.current = true;
                cancelTimers();
              }}
              onMouseLeave={() => {
                hoveringPopoverRef.current = false;
                scheduleClose();
              }}
              className={cn(
                "relative rounded-md border bg-popover text-popover-foreground shadow-md overflow-hidden",
                "animate-in fade-in-0 zoom-in-95",
              )}
            >
              {mode === "preview" ? (
                <>
                  <button
                    type="button"
                    aria-label="Open in editor"
                    title="Open in editor"
                    onClick={() => {
                      stickyPreviewRef.current = false;
                      setOpen(false);
                      onOpenFile?.(node.id);
                    }}
                    className={cn(
                      "absolute top-1.5 right-1.5 z-10",
                      "inline-flex items-center justify-center",
                      "h-6 w-6 rounded-md",
                      "text-muted-foreground hover:text-foreground",
                      "bg-popover/80 hover:bg-accent",
                      "border border-transparent hover:border-border",
                      "transition-colors",
                      "[&_svg]:size-3.5",
                    )}
                  >
                    <IcLinkExternal />
                  </button>
                  <ScrollArea
                    className="h-[360px] [&>[data-slot=scroll-area-viewport]>div]:!block [&>[data-slot=scroll-area-viewport]>div]:!w-full [&>[data-slot=scroll-area-viewport]>div]:!min-w-0"
                  >
                    <PreviewBody preview={preview} markdown={isMarkdownKind(node)} />
                  </ScrollArea>
                </>
              ) : (
                <MetaBody node={node} meta={meta} />
              )}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

// ── Meta tooltip ─────────────────────────────────────────────────

function MetaBody({ node, meta }: { node: FileNode; meta: Meta | undefined }) {
  const ready = meta?.state === "ready" && meta.data;
  return (
    <div className="flex flex-col text-[11px]">
      <div className="px-3 py-2 border-b">
        <div className="text-[12px] font-semibold truncate" title={node.name}>
          {node.name}
        </div>
        <div className="text-[10px] text-muted-foreground truncate" title={node.id}>
          {node.id}
        </div>
      </div>
      <dl className="px-3 py-2 space-y-1 m-0">
        <Row
          label="Modified"
          value={ready ? formatRelative(meta!.data!.modifiedAt) : "—"}
          hint={ready ? formatExact(meta!.data!.modifiedAt) : undefined}
        />
        <Row
          label="Created"
          value={ready ? formatRelative(meta!.data!.createdAt) : "—"}
          hint={ready ? formatExact(meta!.data!.createdAt) : undefined}
        />
        <Row label="Size" value={ready ? formatBytes(meta!.data!.size) : "—"} />
      </dl>
      <div className="px-3 py-1.5 border-t text-[10px] text-muted-foreground italic">
        Hold <kbd className="font-mono not-italic">Ctrl</kbd> to peek contents
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums" title={hint}>{value}</dd>
    </div>
  );
}

// ── Rich preview (Ctrl+hover) ────────────────────────────────────

function PreviewBody({
  preview,
  markdown,
}: {
  preview: Preview | undefined;
  markdown: boolean;
}) {
  if (!preview || preview.state === "idle" || preview.state === "loading") {
    return (
      <div className="px-3 py-3 text-[11px] text-muted-foreground">Loading…</div>
    );
  }
  if (preview.state === "binary") {
    return (
      <div className="px-3 py-3 text-[11px] text-muted-foreground">
        Binary file — no text preview available.
      </div>
    );
  }
  if (preview.state === "error") {
    return (
      <div className="px-3 py-3 text-[11px] text-destructive">
        Failed to read file
        {preview.error ? (
          <span className="block opacity-70">{preview.error}</span>
        ) : null}
      </div>
    );
  }
  if (!preview.text || preview.text.trim().length === 0) {
    return (
      <div className="px-3 py-3 text-[11px] text-muted-foreground italic">
        Empty file.
      </div>
    );
  }
  if (markdown) {
    return (
      <div className="px-3 py-2 text-[12px] file-hover-md">
        <MarkdownPreviewBody source={preview.text} />
      </div>
    );
  }
  return (
    <pre className="m-0 px-3 py-3 text-[11px] leading-[1.5] whitespace-pre-wrap break-words font-mono text-foreground/90">
      {preview.text}
    </pre>
  );
}
