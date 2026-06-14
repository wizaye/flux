import * as React from "react";
import { cn } from "@/lib/utils";
import { bgEditor, textMuted, accentText } from "@/lib/lattice-tokens";

/**
 * Placeholder pane-body shown when a tab has no file (the `+` button
 * creates one) or while we're waiting on Phase 2 of the editor port
 * for the real CodeMirror surface to come online.
 *
 * Visually mirrors `lattice/src/components/editor/EmptyTab.tsx` — a
 * centered column of accent-coloured links — without the eventual
 * `Ctrl+N / Ctrl+O` keybindings (those land alongside the command
 * palette in a later phase).
 */
type Props = {
  onCreate: () => void;
  onGoToFile: () => void;
  onClose: () => void;
};

export function EmptyTab({ onCreate, onGoToFile, onClose }: Props) {
  return (
    <div className={cn("flex flex-1 items-center justify-center", bgEditor)}>
      <ul className="list-none p-0 m-0 flex flex-col gap-[18px] items-center">
        <li>
          <EmptyAction onClick={onCreate}>Create new note (Ctrl + N)</EmptyAction>
        </li>
        <li>
          <EmptyAction onClick={onGoToFile}>Go to file (Ctrl + O)</EmptyAction>
        </li>
        <li>
          <EmptyAction onClick={onClose}>Close</EmptyAction>
        </li>
      </ul>
    </div>
  );
}

function EmptyAction({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "bg-transparent border-0 cursor-pointer text-[13px]",
        accentText,
        "hover:underline focus-visible:underline outline-none",
      )}
    >
      {children}
    </button>
  );
}

/**
 * Phase-1 placeholder editor surface — rendered for any markdown tab
 * until CodeMirror lands in Phase 2. Reads the file's content from
 * the passed vault map and shows it as un-styled monospace text inside
 * the standard pane padding, so the doc-header chrome is visible and
 * the layout chassis can be exercised end-to-end.
 */
export function PlaceholderEditor({
  content,
  title,
}: {
  content: string;
  title: string;
}) {
  return (
    <div className={cn("flex-1 min-h-0 min-w-0 overflow-auto", bgEditor)}>
      <div className="max-w-[760px] mx-auto px-[64px] py-[40px] pb-[80px]">
        <div className={cn("text-[11px] uppercase tracking-wider mb-4", textMuted)}>
          {title}
        </div>
        <pre className="whitespace-pre-wrap text-[14px] leading-[1.6] font-sans text-foreground/90">
          {content || "(empty)"}
        </pre>
      </div>
    </div>
  );
}
