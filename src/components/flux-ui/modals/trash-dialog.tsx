/**
 * Trash dialog — lists files currently in `.trash/`, with Restore
 * and "Delete forever" actions per row.
 *
 * Backed by the Tauri commands `list_trash`, `restore_from_trash`,
 * and `purge_trash_entry`. Each row's path is the file's location
 * INSIDE `.trash/` (e.g. `.trash/2026-06/Notes/foo.md`) — restoring
 * derives the original vault path from the part after the month
 * bucket.
 */
import * as React from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  listTrash,
  restoreFromTrash,
  purgeTrashEntry,
  type TrashEntry,
} from "@/bindings";
import { formatError } from "@/lib/errors";
import { useVaultOperations } from "@/hooks/use-vault-operations";
import { IcTrash, IcRefresh } from "@/components/flux-ui/common/icons";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatWhen(ms: number): string {
  const d = new Date(ms);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

export type TrashDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function TrashDialog({ open, onOpenChange }: TrashDialogProps) {
  const [entries, setEntries] = React.useState<TrashEntry[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [busyPath, setBusyPath] = React.useState<string | null>(null);
  const { refreshVault } = useVaultOperations();

  const reload = React.useCallback(async () => {
    setLoading(true);
    try {
      const list = await listTrash();
      setEntries(list);
    } catch (e) {
      toast.error("Failed to load trash", { description: formatError(e) });
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (open) void reload();
  }, [open, reload]);

  const handleRestore = async (entry: TrashEntry) => {
    setBusyPath(entry.trashPath);
    try {
      const restored = await restoreFromTrash(entry.trashPath);
      toast.success(`Restored: ${restored}`);
      await reload();
      // Refresh the vault tree so the file shows up again in the sidebar.
      await refreshVault();
    } catch (e) {
      toast.error("Failed to restore", { description: formatError(e) });
    } finally {
      setBusyPath(null);
    }
  };

  const handlePurge = async (entry: TrashEntry) => {
    if (!confirm(`Permanently delete "${entry.name}"? This cannot be undone.`)) {
      // NB: this is the ONE place we keep the native confirm —
      // a permanent-delete from a list view is a rare enough action
      // that wrapping each row in a nested shadcn dialog adds more
      // friction than it removes.
      return;
    }
    setBusyPath(entry.trashPath);
    try {
      await purgeTrashEntry(entry.trashPath);
      toast.success(`Deleted forever: ${entry.name}`);
      await reload();
    } catch (e) {
      toast.error("Failed to purge", { description: formatError(e) });
    } finally {
      setBusyPath(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IcTrash /> Trash
          </DialogTitle>
          <DialogDescription>
            Files moved to <code>.trash/</code>. Restore puts them back at
            their original path; delete forever cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between text-xs text-muted-foreground py-1">
          <span>
            {loading
              ? "Loading…"
              : `${entries.length} item${entries.length === 1 ? "" : "s"}`}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void reload()}
            disabled={loading}
          >
            <IcRefresh /> Refresh
          </Button>
        </div>

        <ScrollArea className="h-[420px] rounded-md border">
          {entries.length === 0 && !loading && (
            <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
              Trash is empty.
            </div>
          )}
          <ul className="divide-y">
            {entries.map((e) => (
              <li
                key={e.trashPath}
                className="flex items-center gap-3 px-3 py-2 hover:bg-accent/40"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{e.name}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {e.originalPath}
                  </div>
                  <div className="text-[10px] text-muted-foreground tabular-nums">
                    {formatBytes(e.size)} · trashed {formatWhen(e.trashedAt)}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleRestore(e)}
                  disabled={busyPath === e.trashPath}
                >
                  Restore
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => void handlePurge(e)}
                  disabled={busyPath === e.trashPath}
                >
                  Delete forever
                </Button>
              </li>
            ))}
          </ul>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
