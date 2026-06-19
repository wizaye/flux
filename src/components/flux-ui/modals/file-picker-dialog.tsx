/**
 * File / folder picker dialog used by the "Move file to…" and
 * "Merge entire file with…" commands.
 *
 * Renders the vault tree (flattened to a searchable list) so the
 * user can pick a target by name. Two filter modes:
 *   • `kind: "folder"`  → only directories selectable (Move target)
 *   • `kind: "file"`    → only markdown files selectable (Merge with)
 *
 * Keyboard: typing filters, ↑/↓ moves selection, ↵ confirms.
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { IcFolder, IcFile } from "@/components/flux-ui/common/icons";
import type { FileNode } from "@/state/editor";

interface FilePickerProps {
  open: boolean;
  title: string;
  description?: string;
  /** Whether selectable entries are files or folders. */
  kind: "file" | "folder";
  /** The vault tree to flatten + display. */
  tree: FileNode[];
  /** File ids to exclude (e.g. the file being moved itself). */
  excludeIds?: string[];
  onConfirm: (selectedId: string) => void;
  onCancel: () => void;
}

interface FlatEntry {
  id: string;
  name: string;
  isFolder: boolean;
}

function flattenTree(nodes: FileNode[]): FlatEntry[] {
  const out: FlatEntry[] = [];
  function walk(ns: FileNode[]) {
    for (const n of ns) {
      out.push({
        id: n.id,
        name: n.id, // show full path so duplicates are distinguishable
        isFolder: n.kind === "folder",
      });
      if (n.children) walk(n.children);
    }
  }
  walk(nodes);
  return out;
}

export function FilePickerDialog({
  open,
  title,
  description,
  kind,
  tree,
  excludeIds = [],
  onConfirm,
  onCancel,
}: FilePickerProps) {
  const [query, setQuery] = React.useState("");
  const [activeIdx, setActiveIdx] = React.useState(0);

  // Reset state when re-opened.
  React.useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIdx(0);
    }
  }, [open]);

  const allEntries = React.useMemo(() => {
    const flat = flattenTree(tree);
    const excludeSet = new Set(excludeIds);
    return flat.filter((e) => {
      if (excludeSet.has(e.id)) return false;
      if (kind === "folder" && !e.isFolder) return false;
      if (kind === "file" && e.isFolder) return false;
      // Markdown filter for files — merge only makes sense with text.
      if (kind === "file" && !/\.(md|markdown|txt)$/i.test(e.name)) return false;
      return true;
    });
  }, [tree, excludeIds, kind]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      // For folders, also offer "vault root" (empty id).
      if (kind === "folder") {
        return [
          { id: "", name: "/ (vault root)", isFolder: true } as FlatEntry,
          ...allEntries,
        ];
      }
      return allEntries;
    }
    const list = allEntries.filter((e) => e.name.toLowerCase().includes(q));
    return list;
  }, [allEntries, query, kind]);

  // Clamp activeIdx whenever the filtered list shrinks.
  React.useEffect(() => {
    if (activeIdx >= filtered.length) setActiveIdx(Math.max(0, filtered.length - 1));
  }, [filtered, activeIdx]);

  const handleConfirm = () => {
    const selected = filtered[activeIdx];
    if (selected) onConfirm(selected.id);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      handleConfirm();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        <div className="flex flex-col gap-2 py-2">
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Search ${kind === "folder" ? "folders" : "files"}…`}
          />
          <ScrollArea className="h-[320px] rounded-md border border-[var(--border-strong)]">
            {filtered.length === 0 ? (
              <p className="text-[12px] italic px-3 py-2 text-[var(--text-faint)]">
                No matching {kind === "folder" ? "folders" : "files"}.
              </p>
            ) : (
              <ul className="py-1">
                {filtered.map((entry, i) => (
                  <li
                    key={entry.id || "<root>"}
                    onClick={() => {
                      setActiveIdx(i);
                      onConfirm(entry.id);
                    }}
                    onMouseEnter={() => setActiveIdx(i)}
                    className={cn(
                      "flex items-center gap-2 px-3 py-1.5 text-[12px] cursor-pointer",
                      i === activeIdx
                        ? "bg-[var(--selection)] text-[var(--text-normal)]"
                        : "text-[var(--text-normal)]",
                    )}
                  >
                    {entry.isFolder ? (
                      <IcFolder className="[width:var(--icon-sm)] [height:var(--icon-sm)] shrink-0 opacity-80" />
                    ) : (
                      <IcFile className="[width:var(--icon-sm)] [height:var(--icon-sm)] shrink-0 opacity-80" />
                    )}
                    <span className="truncate">{entry.name}</span>
                  </li>
                ))}
              </ul>
            )}
          </ScrollArea>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={filtered.length === 0}>
            {kind === "folder" ? "Move here" : "Merge"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
