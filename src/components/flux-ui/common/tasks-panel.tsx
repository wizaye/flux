/**
 * Tasks panel — vault-wide list of open Markdown checkboxes.
 *
 * Click a row checkbox → flip status (Rust rewrites the source
 * file). Click the row label → open the source file in a new tab
 * (uses the same `flux-open-file` event the rest of the app
 * listens for) and scroll to the task's line.
 *
 * The panel auto-refreshes on mount and whenever the vault's file
 * tree changes (which fires after every save/watcher reindex), so
 * the open-task list stays in sync without manual polling.
 */
import * as React from "react";
import { useShallow } from "zustand/react/shallow";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTasksStore } from "@/state/tasks-store";
import { useVaultStore } from "@/state/vault-store";

export function TasksPanel() {
  const { tasks, loading, refresh, toggle, pending } = useTasksStore(
    useShallow((s) => ({
      tasks: s.tasks,
      loading: s.loading,
      refresh: s.refresh,
      toggle: s.toggle,
      pending: s.pending,
    })),
  );
  const fileTree = useVaultStore((s) => s.fileTree);

  // Refresh on mount + whenever the file tree changes (a save /
  // watcher event rebuilds the tree). Cheap — Rust returns rows
  // from the same vault DB pool.
  React.useEffect(() => {
    void refresh();
  }, [refresh, fileTree]);

  const grouped = React.useMemo(() => groupByFile(tasks), [tasks]);

  return (
    <div className="flex h-full w-full flex-col text-[12.5px]">
      <div className="px-2 py-1.5 text-[11px] text-muted-foreground uppercase tracking-wide flex items-center justify-between">
        <span>Open tasks</span>
        <span>{tasks.length}</span>
      </div>
      <ScrollArea className="flex-1">
        {tasks.length === 0 && !loading && (
          <p className="px-3 py-4 text-[12px] italic text-muted-foreground">
            No open tasks. Add a line like <code>- [ ] my task</code> in
            any note.
          </p>
        )}
        {grouped.map((group) => (
          <section key={group.file} className="mb-1.5">
            <button
              type="button"
              onClick={() => openFile(group.file)}
              className="block w-full text-left px-2 py-1 text-[11.5px] text-muted-foreground hover:bg-accent/40 hover:text-foreground transition-colors"
            >
              {basename(group.file)}
            </button>
            <ul>
              {group.items.map((t) => (
                <li
                  key={t.id}
                  className="group flex items-start gap-2 px-2 py-1 hover:bg-accent/40"
                >
                  <Checkbox
                    checked={t.status === "done"}
                    disabled={pending.has(t.id)}
                    onCheckedChange={() => void toggle(t.id)}
                    className="mt-0.5 shrink-0"
                    aria-label={`Toggle "${t.rawText}"`}
                  />
                  <button
                    type="button"
                    onClick={() => openFileAtLine(t.fileId, t.lineHint)}
                    className="flex-1 text-left leading-tight"
                  >
                    <span
                      className={
                        t.status === "done"
                          ? "line-through text-muted-foreground"
                          : "text-foreground"
                      }
                    >
                      {t.rawText}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </ScrollArea>
    </div>
  );
}

function basename(fileId: string): string {
  const parts = fileId.split("/");
  return parts[parts.length - 1] || fileId;
}

function openFile(fileId: string): void {
  window.dispatchEvent(
    new CustomEvent("flux-open-file", { detail: { fileId } }),
  );
}

function openFileAtLine(fileId: string, line: number): void {
  // Tab-system listens for `flux-open-file`; line-jump is handled by
  // the editor via a separate event we already wire elsewhere.
  window.dispatchEvent(
    new CustomEvent("flux-open-file", { detail: { fileId, line } }),
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

interface TaskGroup {
  file: string;
  items: ReadonlyArray<{
    id: string;
    fileId: string;
    lineHint: number;
    rawText: string;
    status: "open" | "done";
  }>;
}

function groupByFile(
  tasks: ReadonlyArray<{
    id: string;
    fileId: string;
    lineHint: number;
    rawText: string;
    status: "open" | "done";
  }>,
): TaskGroup[] {
  const byFile = new Map<string, TaskGroup["items"][number][]>();
  for (const t of tasks) {
    const arr = byFile.get(t.fileId);
    if (arr) arr.push(t);
    else byFile.set(t.fileId, [t]);
  }
  return Array.from(byFile.entries()).map(([file, items]) => ({ file, items }));
}
