/**
 * Document-level command helpers used by the doc-header overflow
 * menu. Each function is intentionally side-effect-only and returns
 * nothing — callers chain them inside menu `onSelect` handlers.
 *
 * Why separate from the menu component: the menu shouldn't know
 * about Tauri APIs, the vault store, the print pipeline, etc. This
 * file is the seam between UI (the menu) and capability (Tauri,
 * vault, render).
 */
import { toast } from "sonner";
import { isTauri } from "@/bindings";
import type { FileNode } from "@/state/editor";
import { useVaultStore } from "@/state/vault-store";
import { formatError } from "./errors";

// ─────────────────────────────────────────────────────────────────
// Filesystem helpers — Tauri opener plugin
// ─────────────────────────────────────────────────────────────────

/**
 * Resolve a vault-relative file id to an absolute on-disk path.
 * Returns `null` when no vault is open (mock-vault) so callers can
 * fall back to a toast instead of throwing.
 */
function absolutePathFor(fileId: string): string | null {
  const vault = useVaultStore.getState().vaultHandle;
  if (!vault) return null;
  // The vault path always uses the OS separator; fileId uses `/` on
  // both. Normalise to backslash on Windows so the opener API + file
  // explorer recognise it.
  const sep = vault.path.includes("\\") ? "\\" : "/";
  const normalisedId = fileId.replace(/[\\/]+/g, sep);
  return vault.path.endsWith(sep)
    ? vault.path + normalisedId
    : vault.path + sep + normalisedId;
}

function parentDirOf(absPath: string): string {
  const i = Math.max(absPath.lastIndexOf("/"), absPath.lastIndexOf("\\"));
  return i >= 0 ? absPath.slice(0, i) : absPath;
}
// Re-exported as a tiny utility so other call sites can normalise
// without re-implementing the path-separator math.
export { parentDirOf as _parentDirOf };

/** Reveal a file in the system file explorer (Finder / Explorer / Nautilus). */
export async function showInSystemExplorer(fileId: string): Promise<void> {
  if (!isTauri) {
    toast.info("Show in system explorer is only available in the desktop app.");
    return;
  }
  const abs = absolutePathFor(fileId);
  if (!abs) {
    toast.info("Open a real vault first — mock files don't live on disk.");
    return;
  }
  try {
    const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
    await revealItemInDir(abs);
  } catch (err) {
    toast.error("Failed to reveal in explorer", { description: formatError(err) });
  }
}

/** Open the file in its registered default app (e.g. .pdf → Acrobat). */
export async function openInDefaultApp(fileId: string): Promise<void> {
  if (!isTauri) {
    toast.info("Open in default app is only available in the desktop app.");
    return;
  }
  const abs = absolutePathFor(fileId);
  if (!abs) {
    toast.info("Open a real vault first.");
    return;
  }
  try {
    const { openPath } = await import("@tauri-apps/plugin-opener");
    await openPath(abs);
  } catch (err) {
    toast.error("Failed to open in default app", { description: formatError(err) });
  }
}

// ─────────────────────────────────────────────────────────────────
// Reveal-in-navigation — custom event picked up by the left sidebar
// ─────────────────────────────────────────────────────────────────

/**
 * Ask the left sidebar to scroll the file into view, expanding any
 * parent folders along the way. Decoupled via window events so the
 * doc-header doesn't need a callback prop reaching across panes.
 */
export function revealInNavigation(fileId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("flux-reveal-in-nav", { detail: { fileId } }),
  );
}

// ─────────────────────────────────────────────────────────────────
// Right-sidebar focus
// ─────────────────────────────────────────────────────────────────

export type RightViewKey = "links" | "outgoing" | "tags" | "outline";

/**
 * Switch the right sidebar to a specific tab AND ensure it's
 * visible. Mirrors the "Open linked view" submenu from Obsidian.
 */
export function focusRightView(view: RightViewKey): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("flux-open-right-view", { detail: { view } }),
  );
}

// ─────────────────────────────────────────────────────────────────
// PDF export — high-fidelity print pipeline
// ─────────────────────────────────────────────────────────────────

/**
 * Per-export PDF customization. Surfaced via the export dialog so the
 * user can tune what ships into the PDF before generation runs.
 */
export interface PdfExportOptions {
  /** Paper size — passed through to jsPDF's `format`. */
  pageSize: "a4" | "letter" | "legal";
  /** Orientation — portrait stacks longer files, landscape fits wide tables. */
  orientation: "portrait" | "landscape";
  /** Page margin in millimetres on each side. */
  marginMm: number;
  /** When true, dark-theme styling is forced regardless of UI theme. */
  darkBackground: boolean;
  /** When true, code blocks render with their Shiki tokens; otherwise
   *  plain monospace text (smaller PDF, cleaner if printed B&W). */
  includeCode: boolean;
  /** When true, Mermaid SVGs ship as-is; otherwise dropped entirely. */
  includeDiagrams: boolean;
  /** Rasterisation scale — higher = sharper text but larger file size.
   *  html2canvas multiplier; 2 is "retina" quality. */
  scale: number;
  /** Save filename (without extension). */
  filename: string;
}

export const DEFAULT_PDF_OPTIONS: PdfExportOptions = {
  pageSize: "a4",
  orientation: "portrait",
  marginMm: 14,
  darkBackground: false,
  includeCode: true,
  includeDiagrams: true,
  scale: 2,
  filename: "",
};

/**
 * Export the document to a PDF.
 *
 * In Tauri: dispatches to the NATIVE Rust command
 * `export_markdown_to_pdf` — `pulldown-cmark` parses the Markdown
 * and `printpdf` writes the file using the 14 PDF built-in fonts.
 * Zero npm deps, zero font files bundled, no main-thread freeze.
 *
 * In browser preview: falls back to the webview's `window.print()`
 * pipeline so the feature still works in `vite dev`.
 *
 * `savePath` is the absolute path the user picked via
 * `pickPdfSavePath` (Tauri) or `null` (browser).
 */
export async function pickPdfSavePath(
  defaultStem: string,
): Promise<string | null | "cancelled"> {
  if (!isTauri) return null;
  const { save } = await import("@tauri-apps/plugin-dialog");
  const picked = await save({
    defaultPath: defaultStem + ".pdf",
    title: "Export PDF",
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  return picked ?? "cancelled";
}

export async function exportToPdf(
  file: FileNode,
  source: string,
  options: PdfExportOptions,
  savePath: string | null,
): Promise<void> {
  if (typeof window === "undefined") return;

  // Strip optional content based on user toggles BEFORE handing the
  // markdown to the renderer. Mermaid + raw HTML never appear in
  // the native PDF (the Rust renderer drops them).
  let md = source;
  if (!options.includeDiagrams) {
    md = md.replace(/```mermaid[\s\S]*?```/g, "");
  }
  if (!options.includeCode) {
    md = md.replace(/```[\w-]*[\s\S]*?```/g, "");
  }

  // ── Native Tauri path ─────────────────────────────────────────────
  if (isTauri && savePath) {
    const { exportMarkdownToPdf } = await import("@/bindings");
    const title = options.filename || file.name.replace(/\.md$/i, "");
    await exportMarkdownToPdf(title, md, savePath);
    return;
  }

  // ── Browser preview fallback (window.print) ───────────────────────
  // Notes on the print pipeline:
  //  • `@page { margin: 0 }` is required to suppress Chrome's auto
  //    page headers/footers (URL, page title, date/time). We then
  //    apply our own margin on the body. Without this you get
  //    "http://localhost:1420/  •  6/19/2026" baked into the PDF.
  //  • The `<title>` tag is embedded directly in the iframe HTML so
  //    the OS save dialog (Microsoft Print to PDF, Preview, etc.)
  //    pre-populates the filename. Setting `doc.title` after
  //    `doc.close()` is unreliable on Edge/Print-to-PDF.
  const fg = options.darkBackground ? "#e6e6e6" : "#1f1f1f";
  const muted = options.darkBackground ? "#9a9a9a" : "#6b6b6b";
  const border = options.darkBackground ? "#3a3a3a" : "#e5e5e5";
  const codeBg = options.darkBackground ? "#2a2a2a" : "#f5f5f4";
  const linkFg = options.darkBackground ? "#9eb5ff" : "#3b66d0";
  const bg = options.darkBackground ? "#1a1a1a" : "#ffffff";
  const pageWidth = options.orientation === "portrait" ? "210mm" : "297mm";
  const pageSizeName = options.pageSize === "letter" ? "Letter" : "A4";
  const docTitle = (options.filename || file.name.replace(/\.md$/i, ""))
    .replace(/[<>&"']/g, "");

  const { renderToStaticHtml } = await import("./pdf-render");
  const bodyHtml = await renderToStaticHtml(md);

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.left = "-99999px";
  iframe.style.top = "0";
  iframe.style.width = pageWidth;
  iframe.style.height = "100vh";
  iframe.style.border = "0";
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument!;
  doc.open();
  doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${docTitle}</title><style>
    @page { size: ${pageSizeName} ${options.orientation}; margin: 0; }
    html, body { margin: 0; padding: 0; background: ${bg}; color: ${fg};
      font-family: "Inter", system-ui, sans-serif; font-size: 14px; line-height: 1.6; }
    body { padding: ${options.marginMm}mm; box-sizing: border-box; }
    .md-preview h1 { font-size: 1.8em; border-bottom: 1px solid ${border}; padding-bottom: 0.3em; }
    .md-preview h2 { font-size: 1.45em; border-bottom: 1px solid ${border}; padding-bottom: 0.25em; }
    .md-preview h3 { font-size: 1.2em; }
    .md-preview a { color: ${linkFg}; }
    .md-preview code { font-family: monospace; background: ${codeBg}; padding: 0.15em 0.35em; border-radius: 3px; }
    .md-preview pre { background: ${codeBg}; padding: 0.9em; border-radius: 6px; }
    .md-preview blockquote { border-left: 3px solid ${border}; padding: 0.2em 1em; color: ${muted}; }
    .md-preview table { border-collapse: collapse; width: 100%; }
    .md-preview th, .md-preview td { border: 1px solid ${border}; padding: 0.4em 0.7em; }
  </style></head><body><div class="md-preview">${bodyHtml}</div></body></html>`);
  doc.close();
  await new Promise((r) => setTimeout(r, 100));
  try {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    // Give the print dialog ~1.5 s to take ownership of the iframe
    // before we tear it down. Removing too early cancels the dialog.
    await new Promise((r) => setTimeout(r, 1500));
  } finally {
    iframe.remove();
  }
}

function escapeHtml(s: string): string {
  // Currently unused (we no longer write a print iframe) but kept
  // exported for potential future callers that need to render the
  // file name into HTML safely.
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
// Suppress unused warning for `escapeHtml` while keeping it exported
// behind a stable name.
export { escapeHtml as _escapeHtml };

// ─────────────────────────────────────────────────────────────────
// Open in new window — detached Tauri webview
// ─────────────────────────────────────────────────────────────────

/**
 * Detach the file into its own borderless Tauri window. The new
 * window loads the same SPA with `?file=<id>&mode=detached` so the
 * App component can mount a stripped-down editor focused only on
 * that one file (no left sidebar, no right sidebar, just the doc).
 *
 * Falls back to a `window.open` browser tab when we're not in Tauri
 * (vite preview) so the action still has a visible effect.
 */
export async function openInNewWindow(file: FileNode): Promise<void> {
  // Pass through the vault path so the detached window can open
  // the same vault — wikilinks + metadata + frontmatter resolve as
  // if the file were still inside the parent window.
  const vault = useVaultStore.getState().vaultHandle;
  const params = new URLSearchParams();
  params.set("file", file.id);
  params.set("mode", "detached");
  if (vault?.path) params.set("vault", vault.path);
  const url = `?${params.toString()}`;
  if (!isTauri) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  try {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const label = `flux-doc-${Math.random().toString(36).slice(2, 10)}`;
    const win = new WebviewWindow(label, {
      url,
      title: file.name,
      width: 900,
      height: 720,
      minWidth: 480,
      minHeight: 320,
      decorations: true,
    });
    win.once("tauri://error", (ev) => {
      toast.error("Failed to open new window", {
        description: String(ev.payload),
      });
    });
  } catch (err) {
    toast.error("Failed to open new window", { description: formatError(err) });
  }
}

// ─────────────────────────────────────────────────────────────────
// "Coming soon" placeholder for version history
// ─────────────────────────────────────────────────────────────────

export function showVersionHistoryComingSoon(): void {
  toast.info("Version history ships with the VCS plugin", {
    description:
      "Install the GitHub / Google Drive / OneDrive sync plugin to back up and time-travel your vault.",
  });
}
