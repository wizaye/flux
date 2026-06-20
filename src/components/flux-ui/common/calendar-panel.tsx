/**
 * Calendar panel for the left sidebar.
 *
 * Obsidian-style daily-notes flow: click a date → open
 * `YYYY-MM-DD.md`. If the note doesn't exist yet, create it on the
 * fly with a heading + ISO date frontmatter. Dates with existing
 * notes get an indicator dot under the day number so the user can
 * see at a glance which days they've already journaled.
 *
 * The detection is filename-based: any `*.md` whose basename
 * (without extension) parses as `YYYY-MM-DD` counts. Folder
 * doesn't matter — vault-root, `Daily/`, `Journal/2026/06/…` all
 * resolve. Conflict handling: if two notes exist for the same
 * date, clicking opens the first one alphabetically.
 *
 * No new IPC needed — uses the existing vault tree + file
 * operations the rest of the app already has.
 */
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { useFileOperations } from "@/hooks/use-file-operations";
import { useVaultStore } from "@/state/vault-store";
import type { FileNode } from "@/state/editor";

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Walk the vault tree once → map `YYYY-MM-DD` → first matching
 *  vault-relative path (alphabetical). Recomputed when the tree
 *  changes, not per render. */
function collectDailyNotes(tree: FileNode[]): Map<string, string> {
  const out: Map<string, string> = new Map();
  function walk(nodes: FileNode[]) {
    for (const n of nodes) {
      if (n.kind === "file" && n.name.toLowerCase().endsWith(".md")) {
        const stem = n.name.replace(/\.md$/i, "");
        if (DATE_RE.test(stem) && !out.has(stem)) {
          out.set(stem, n.id);
        }
      }
      if (n.children) walk(n.children);
    }
  }
  walk(tree);
  return out;
}

function fmtIso(d: Date): string {
  // Local-time YYYY-MM-DD (no timezone shift surprises around
  // midnight). Padding done manually to avoid pulling in date-fns
  // here when the format is this trivial.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function CalendarPanel() {
  const fileTree = useVaultStore((s) => s.fileTree);
  const { createFile } = useFileOperations();

  const dailyNotes = React.useMemo(
    () => collectDailyNotes(fileTree),
    [fileTree],
  );
  const today = React.useMemo(() => new Date(), []);
  const [selected, setSelected] = React.useState<Date>(today);

  // Modifier passed to react-day-picker via `modifiers` — every
  // date that matches a known daily-note path. The day-picker
  // adds the `[data-hasnote=true]` attribute on the day cell so we
  // can paint the indicator with CSS without re-rendering each
  // cell from React.
  const hasNoteMatcher = React.useCallback(
    (date: Date) => dailyNotes.has(fmtIso(date)),
    [dailyNotes],
  );

  const openOrCreate = React.useCallback(
    async (date: Date) => {
      const iso = fmtIso(date);
      const existing = dailyNotes.get(iso);
      if (existing) {
        window.dispatchEvent(
          new CustomEvent("flux-open-file", { detail: { fileId: existing } }),
        );
        return;
      }
      // New daily note — create at vault root for now (`<iso>.md`).
      // A "daily-notes folder" setting can override this once the
      // settings panel ships.
      const path = `${iso}.md`;
      const longDate = date.toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      });
      const initial = `---\ndate: ${iso}\n---\n\n# ${iso}\n\nNotes for ${longDate}.\n`;
      try {
        await createFile(path, initial);
        // The file-tree mutator already inserted the node — open it.
        window.dispatchEvent(
          new CustomEvent("flux-open-file", { detail: { fileId: path } }),
        );
      } catch {
        /* createFile already toasted */
      }
    },
    [dailyNotes, createFile],
  );

  return (
    <div className="flex flex-col gap-2 px-1.5 py-2 min-w-0">
      {/* The shadcn Calendar is a fixed-width grid (~196px @ default
          --cell-size). Wrapping in an overflow-auto container with a
          tightened cell-size keeps the panel usable when the sidebar
          is dragged below ~220px. */}
      <div className="overflow-x-auto -mx-1 px-1">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(d) => {
            if (!d) return;
            setSelected(d);
            void openOrCreate(d);
          }}
          modifiers={{ hasNote: hasNoteMatcher }}
          modifiersClassNames={{
            hasNote:
              "relative after:absolute after:bottom-1 after:left-1/2 after:-translate-x-1/2 after:size-1 after:rounded-full after:bg-primary",
          }}
          className="mx-auto [--cell-size:--spacing(6.5)] p-1"
        />
      </div>

      <div className="flex items-center justify-between gap-2 text-[12px] px-1 min-w-0">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-[12px] shrink min-w-0 truncate"
          onClick={() => {
            setSelected(today);
            void openOrCreate(today);
          }}
        >
          Today's note
        </Button>
        <span className="text-muted-foreground text-[11px] shrink-0">
          {sameDay(selected, today)
            ? "Today"
            : selected.toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}
        </span>
      </div>

      {dailyNotes.size > 0 && (
        <p className="text-[11px] text-muted-foreground/70 px-1">
          {dailyNotes.size} daily {dailyNotes.size === 1 ? "note" : "notes"} in
          this vault. Click a date to open or create one.
        </p>
      )}
    </div>
  );
}
