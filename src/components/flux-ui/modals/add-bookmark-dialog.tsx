/**
 * Add-bookmark dialog — Obsidian-parity form.
 *
 * Fields:
 *   • Path     (read-only, shows the file's vault-relative id)
 *   • Title    (defaults to the file stem; user can override)
 *   • Group    (Select; existing groups + "New group…" sentinel that
 *               swaps in a free-text Input for naming the new group)
 *
 * Opens both for "Add bookmark" (id with no existing entry) and
 * "Edit bookmark" (id already in the store — pre-fills title / group).
 */
import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useBookmarksStore } from "@/state/bookmarks-store";

interface Props {
  open: boolean;
  fileId: string | null;
  defaultTitle?: string;
  onClose: () => void;
}

const NEW_GROUP_SENTINEL = "__new_group__";
const NO_GROUP_SENTINEL = "__no_group__";

export function AddBookmarkDialog({
  open,
  fileId,
  defaultTitle,
  onClose,
}: Props) {
  const groups = useBookmarksStore((s) => s.groups);
  const entries = useBookmarksStore((s) => s.entries);
  const upsert = useBookmarksStore((s) => s.upsert);

  const existing = React.useMemo(
    () => entries.find((e) => e.id === fileId),
    [entries, fileId],
  );

  const [title, setTitle] = React.useState("");
  const [group, setGroup] = React.useState<string>("");
  const [newGroupName, setNewGroupName] = React.useState("");
  const creatingGroup = group === NEW_GROUP_SENTINEL;

  // Reset every time the dialog opens / target file changes.
  React.useEffect(() => {
    if (!open) return;
    setTitle(existing?.title ?? defaultTitle ?? "");
    setGroup(existing?.group ?? NO_GROUP_SENTINEL);
    setNewGroupName("");
  }, [open, fileId, existing, defaultTitle]);

  const handleSave = () => {
    if (!fileId) return;
    const finalGroup = creatingGroup
      ? newGroupName.trim()
      : group === NO_GROUP_SENTINEL
        ? ""
        : group.trim();
    upsert({
      id: fileId,
      title: title.trim() || undefined,
      group: finalGroup || undefined,
    });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Add bookmark</DialogTitle>
          <DialogDescription className="sr-only">
            Choose a title and bookmark group for this file.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-3 py-3 items-center text-[13px]">
          <label className="text-muted-foreground">Path</label>
          <div className="text-[12px] text-muted-foreground bg-muted/40 rounded-md px-2 py-1.5 truncate font-mono">
            {fileId ?? ""}
          </div>

          <label htmlFor="bookmark-title" className="text-muted-foreground">
            Title
          </label>
          <Input
            id="bookmark-title"
            value={title}
            placeholder={defaultTitle}
            onChange={(e) => setTitle(e.target.value)}
            className="h-8 text-[12.5px]"
          />

          <label className="text-muted-foreground">Bookmark group</label>
          <div className="flex flex-col gap-2">
            <Select
              value={group || NO_GROUP_SENTINEL}
              onValueChange={(v) => setGroup(v)}
            >
              <SelectTrigger className="h-8 text-[12.5px]">
                <SelectValue placeholder="(none)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_GROUP_SENTINEL}>(none)</SelectItem>
                {groups.map((g) => (
                  <SelectItem key={g} value={g}>
                    {g}
                  </SelectItem>
                ))}
                <SelectItem value={NEW_GROUP_SENTINEL}>
                  + New group…
                </SelectItem>
              </SelectContent>
            </Select>
            {creatingGroup && (
              <Input
                autoFocus
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="New group name"
                className="h-8 text-[12.5px]"
              />
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!fileId || (creatingGroup && !newGroupName.trim())}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
