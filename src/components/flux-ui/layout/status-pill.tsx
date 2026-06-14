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
  insert: "INS",
  visual: "VIS",
  replace: "RPL",
  normal: "NOR",
};

export interface StatusPillProps {
  /** True when no document is active — shows the compact pill. */
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

export function StatusPill({
  empty,
  backlinkCount,
  wordCount,
  charCount,
  syncState = "ok",
  dirtyCount = 0,
  onSyncClick,
}: StatusPillProps) {
  const [vim, setVim] = React.useState<VimMode>("normal");

  React.useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as string | undefined;
      if (detail === "insert" || detail === "visual" || detail === "replace" || detail === "normal") {
        setVim(detail);
      }
    };
    window.addEventListener("lattice-vim-mode", handler);
    return () => window.removeEventListener("lattice-vim-mode", handler);
  }, []);

  return (
    <div
      className={cn(
        "absolute bottom-0 right-0 z-[80] inline-flex items-center whitespace-nowrap",
        "rounded-tl-[8px] border-t border-l",
        bgHeader,
        borderSoft,
        textMuted,
        "text-[11px] gap-1.5 pl-[10px] pr-1.5 h-[26px] pointer-events-auto",
        empty && "pl-1 pr-1 gap-0 h-6",
      )}
    >
      <VimBadge mode={vim} />
      {!empty && (
        <>
          <Stat label="backlinks" value={backlinkCount ?? 0} />
          <Stat label="words" value={wordCount ?? 0} />
          <Stat label="chars" value={charCount ?? 0} />
        </>
      )}
      <SyncIndicator state={syncState} dirtyCount={dirtyCount} onClick={onSyncClick} />
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
