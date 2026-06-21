import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  IcCloud,
  IcSync,
  IcSyncIgnored,
} from "@/components/flux-ui/common/icons";
import {
  bgHeader,
  borderSoft,
  textMuted,
  textNormal,
  accentBg,
  hoverBg,
  hoverText,
  errorText,
} from "@/lib/lattice-tokens";
import { useTabSyncStore } from "@/state/tab-sync-store";
import { useVaultStore } from "@/state/vault-store";
import { useEditorStore } from "@/state/editor-store";
import { useSettingsStore } from "@/state/settings-store";
import {
  useLinkIndexStore,
  selectBacklinks,
} from "@/state/link-index-store";
import type { FileNode } from "@/state/editor";

/**
 * Floating bottom-right status pill. Two render states:
 *   - empty   → tiny corner pill with just the vim badge + sync icon
 *               (rendered when no document is active)
 *   - full    → wider pill with vim badge + backlinks/words/chars +
 *               sync icon
 *
 * Vim mode badge listens to the `lattice-vim-mode` CustomEvent that
 * the editor dispatches when the user changes mode. Colour mapping:
 *   insert  → #22c55e
 *   visual  → #f59e0b
 *   replace → #ef4444
 *   normal  → muted
 *
 * Sync indicator shows a small accent-coloured badge with the dirty
 * file count (capped 9+) when there are uncommitted local changes.
 */

type VimMode = "normal" | "insert" | "visual" | "replace";

const VIM_COLOR: Record<VimMode, string> = {
  insert: "text-[#22c55e]",
  visual: "text-[#f59e0b]",
  replace: "text-[#ef4444]",
  normal: "text-[#6b6b6b] dark:text-[#8b8b8b]",
};

const VIM_LABEL: Record<VimMode, string> = {
  // "VIM" is the resting label — communicates "vim is enabled" to a
  // reader who doesn't know modal-editor jargon. Once the user moves
  // into an actual non-normal mode, switch to the standard
  // INS / VIS / RPL chips.
  normal: "VIM",
  insert: "INS",
  visual: "VIS",
  replace: "RPL",
};

export interface StatusPillProps {
  /** True when no document is active — shows the compact pill.
   *  When omitted, derived from `useTabSyncStore.activeFile`. */
  empty?: boolean;
  backlinkCount?: number;
  wordCount?: number;
  charCount?: number;
  /** "ok" → connected / quiet, "off" → no sync configured. */
  syncState?: "ok" | "off";
  /** Number of locally-modified files; shown as a badge over the icon. */
  dirtyCount?: number;
  onSyncClick?: () => void;
}

/** Count whitespace-separated words. Strips fenced code blocks and
 *  HTML comments so the count tracks "prose the reader will see"
 *  rather than raw markdown bytes — same heuristic as lattice. */
function countWords(text: string): number {
  if (!text) return 0;
  // Strip ```fenced``` blocks and <!-- comments -->.
  const stripped = text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  const m = stripped.match(/\S+/g);
  return m ? m.length : 0;
}

/** Derive the source-of-truth body for the active file. Priority:
 *    1. live edits (`useEditorStore.fileContents`)
 *    2. content loaded from disk (`useVaultStore.openFiles`)
 *    3. mock-vault inline `FileNode.content` (browser-preview)
 *
 *  Falling back to (3) keeps the word/char counters honest when the
 *  app runs without a real vault — the mock files carry their body
 *  inline on the tree node, not in the per-path content maps. */
function useActiveFileBody(fileId: string | null): string {
  const editorContents = useEditorStore((s) => s.fileContents);
  const vaultContents = useVaultStore((s) => s.openFiles);
  const fileTree = useVaultStore((s) => s.fileTree);
  if (!fileId) return "";
  const fromEditor = editorContents.get(fileId);
  if (fromEditor !== undefined) return fromEditor;
  const fromVault = vaultContents.get(fileId);
  if (fromVault !== undefined) return fromVault;
  return findInlineContent(fileTree, fileId) ?? "";
}

function findInlineContent(tree: FileNode[], id: string): string | undefined {
  for (const n of tree) {
    if (n.id === id) return n.content;
    if (n.children) {
      const hit = findInlineContent(n.children, id);
      if (hit !== undefined) return hit;
    }
  }
  return undefined;
}

export function StatusPill({
  empty: emptyOverride,
  backlinkCount,
  wordCount,
  charCount,
  syncState = "ok",
  dirtyCount,
  onSyncClick,
}: StatusPillProps) {
  const [vim, setVim] = React.useState<VimMode>("normal");

  // Active file (may be null) drives every counter.
  const activeFile = useTabSyncStore((s) => s.activeFile);
  const fileId = activeFile?.fileId ?? null;

  // Word + character count come from whatever doc the editor /
  // vault store currently holds for the active file.
  const body = useActiveFileBody(fileId);
  const derivedWords = React.useMemo(() => countWords(body), [body]);
  const derivedChars = body.length;

  // Backlinks: pull the inverse map and run the same selector the
  // right sidebar uses. Selecting only `backlinksBy` keeps the
  // subscription stable — we don't re-render on every link/tag
  // mutation, just when an indexed file's backlinks change.
  const backlinksBy = useLinkIndexStore((s) => s.backlinksBy);
  const hydrated = useLinkIndexStore((s) => s.hydrated);
  const derivedBacklinks = React.useMemo(() => {
    if (!fileId) return 0;
    return selectBacklinks(
      // The selector only reads `backlinksBy` + `hydrated`; the
      // empty rest of the state shape is fine.
      {
        files: new Set(),
        links: [],
        tags: [],
        backlinksBy,
        tagsBy: new Map(),
        hydrated,
      } as never,
      fileId,
    ).length;
  }, [fileId, backlinksBy, hydrated]);

  // Dirty count = number of files with unsaved edits across the
  // whole session. Surfaced over the sync icon as the badge.
  const dirtyFiles = useEditorStore((s) => s.dirtyFiles);
  const derivedDirty = dirtyFiles.size;

  // Vim mode badge is opt-in. We hide it entirely when the user
  // hasn't enabled vim mode — saves screen real-estate on the pill
  // and avoids a confusing "NOR" label for users who don't know
  // what a modal editor is.
  const vimEnabled = useSettingsStore((s) => s.vimMode);

  // Caller-supplied overrides win — useful for tests / Storybook.
  const effectiveEmpty = emptyOverride ?? fileId === null;
  const effectiveBacklinks = backlinkCount ?? derivedBacklinks;
  const effectiveWords = wordCount ?? derivedWords;
  const effectiveChars = charCount ?? derivedChars;
  const effectiveDirty = dirtyCount ?? derivedDirty;

  React.useEffect(() => {
    if (!vimEnabled) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as string | undefined;
      if (detail === "insert" || detail === "visual" || detail === "replace" || detail === "normal") {
        setVim(detail);
      }
    };
    window.addEventListener("lattice-vim-mode", handler);
    return () => window.removeEventListener("lattice-vim-mode", handler);
  }, [vimEnabled]);

  return (
    <div
      className={cn(
        "absolute bottom-0 right-0 z-[80] inline-flex items-center whitespace-nowrap",
        // Rounded top-left corner is the "gooey" bevel that lets the
        // pill grow leftward from the corner without a hard 90° edge.
        "rounded-tl-[8px] border-t border-l",
        bgHeader,
        borderSoft,
        textMuted,
        "text-[11px] gap-1.5 pl-[10px] pr-1.5 h-[26px] pointer-events-auto",
        effectiveEmpty && "pl-1 pr-1 gap-0 h-6",
      )}
    >
      {!effectiveEmpty && (
        <>
          <Stat label="backlinks" value={effectiveBacklinks} />
          <Stat label="words" value={effectiveWords} />
          <Stat label="chars" value={effectiveChars} />
          {vimEnabled && <VimBadge mode={vim} />}
        </>
      )}
      <SyncIndicator state={syncState} dirtyCount={effectiveDirty} onClick={onSyncClick} />
    </div>
  );
}

function VimBadge({ mode }: { mode: VimMode }) {
  return (
    <span
      title={`Vim mode: ${mode}`}
      className={cn(
        "select-none cursor-default rounded-[4px] px-1.5 py-px",
        // Public Sans (inherited font-sans) with tabular numerals so
        // the badge width is stable as the mode label changes.
        "text-[10px] font-bold tracking-[0.08em] tabular-nums",
        "transition-colors duration-100",
        VIM_COLOR[mode],
        // currentColor → 12% alpha background
        "bg-current/[0.12]",
      )}
    >
      {VIM_LABEL[mode]}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <span className={cn("inline-flex items-center gap-[3px] px-1 h-5 rounded-[4px]", textMuted)}>
      <span className={cn("font-medium", textNormal)}>{value.toLocaleString()}</span>
      <span className={textMuted}>{label}</span>
    </span>
  );
}

function SyncIndicator({
  state,
  dirtyCount,
  onClick,
}: {
  state: "ok" | "off";
  dirtyCount: number;
  onClick?: () => void;
}) {
  const isOff = state === "off";
  const Icon = isOff ? IcSyncIgnored : dirtyCount > 0 ? IcSync : IcCloud;
  const title = isOff
    ? "Sync not configured"
    : dirtyCount > 0
      ? `${dirtyCount} uncommitted change${dirtyCount === 1 ? "" : "s"}`
      : "Up to date";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          onClick={onClick}
          aria-label={title}
          className={cn(
            "relative inline-flex h-5 w-5 items-center justify-center rounded-[4px]",
            "p-0 border-0 bg-transparent shrink-0",
            "transition-colors duration-100 active:translate-y-0",
            // Suppress shadcn's `focus-visible:ring-3` — would otherwise
            // halo this 20px corner-pill button after click.
            "focus-visible:ring-0 focus-visible:border-transparent",
            isOff
              ? cn(errorText, "hover:bg-[#e36464]/[0.12]")
              : cn(textMuted, hoverBg, hoverText),
          )}
        >
          <Icon className="[width:13px] [height:13px]" />
          {!isOff && dirtyCount > 0 && (
            <span
              aria-hidden
              className={cn(
                "absolute -top-[2px] -right-[2px] min-w-[12px] h-3 px-[3px]",
                "inline-flex items-center justify-center rounded-full",
                "text-[9px] font-bold leading-none text-white",
                accentBg,
              )}
            >
              {dirtyCount > 9 ? "9+" : dirtyCount}
            </span>
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>{title}</TooltipContent>
    </Tooltip>
  );
}
