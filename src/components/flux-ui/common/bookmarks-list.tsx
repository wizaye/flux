/**
 * Bookmarks panel — Obsidian-parity layout (image 4 reference).
 *
 * Header (SidebarToolbar — same 30px geometry as Files panel):
 *   • Add bookmark   (opens AddBookmarkDialog for the active tab)
 *   • New group      (inline prompt for group name)
 *   • Close all      (collapses every group)
 *
 * Body uses `SidebarRow` so indentation and row heights match the
 * Files tree exactly. Groups render at depth 0 with a chevron;
 * entries render at depth 1 (no chevron — the column is reserved
 * by SidebarRow itself so the file icons line up).
 *
 * Clicking an entry dispatches `flux-open-file` so the shell can
 * route the click to whichever editor leaf is active.
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { IconButton } from "@/components/flux-ui/common/icon-button";
import {
  IcBookmarkPlus,
  IcFolderPlus,
  IcCollapseAll,
  IcBookmark,
  IcTrash,
} from "@/components/flux-ui/common/icons";
import { textFaint } from "@/lib/lattice-tokens";
import {
  SidebarToolbar,
  SidebarRow,
} from "@/components/flux-ui/common/sidebar-primitives";
import {
  useBookmarksStore,
  selectBookmarksByGroup,
  type BookmarkEntry,
} from "@/state/bookmarks-store";
import { AddBookmarkDialog } from "@/components/flux-ui/modals/add-bookmark-dialog";
import { useTabSyncStore } from "@/state/tab-sync-store";

/** Active markdown tab — published by pane.tsx via tab-sync-store. */
function useActiveFile(): { fileId: string | null; title: string | null } {
  const active = useTabSyncStore((s) => s.activeFile);
  return active ?? { fileId: null, title: null };
}

export function BookmarksList() {
  // Subscribe to raw slices to avoid the "getSnapshot should be
  // cached" infinite loop a derived selector would trigger.
  const entries = useBookmarksStore((s) => s.entries);
  const groups = useBookmarksStore((s) => s.groups);
  const addGroup = useBookmarksStore((s) => s.addGroup);
  const removeGroup = useBookmarksStore((s) => s.removeGroup);
  const remove = useBookmarksStore((s) => s.remove);
  const active = useActiveFile();

  const groupBuckets = React.useMemo(
    () => selectBookmarksByGroup({ entries, groups }),
    [entries, groups],
  );

  const [editTarget, setEditTarget] = React.useState<string | null>(null);
  const [editOpen, setEditOpen] = React.useState(false);
  const [groupPromptOpen, setGroupPromptOpen] = React.useState(false);
  const [groupName, setGroupName] = React.useState("");
  const [closedGroups, setClosedGroups] = React.useState<Set<string>>(
    () => new Set(),
  );

  const groupKey = (rawName: string) => rawName || "__untitled__";

  const closeAll = () => {
    const all = new Set<string>();
    for (const g of groupBuckets) all.add(groupKey(g.name));
    setClosedGroups(all);
  };

  const toggleGroup = (rawName: string) => {
    const key = groupKey(rawName);
    setClosedGroups((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleNewGroup = () => {
    const name = groupName.trim();
    if (!name) return;
    addGroup(name);
    setGroupName("");
    setGroupPromptOpen(false);
  };

  const hasAny = groupBuckets.some((g) => g.entries.length > 0);

  return (
    <div className="flex flex-col">
      <SidebarToolbar>
        <IconButton
          size="tiny"
          tooltip="Add bookmark"
          disabled={!active.fileId}
          onClick={() => {
            setEditTarget(active.fileId);
            setEditOpen(true);
          }}
        >
          <IcBookmarkPlus />
        </IconButton>
        <IconButton
          size="tiny"
          tooltip="New group"
          onClick={() => setGroupPromptOpen((v) => !v)}
        >
          <IcFolderPlus />
        </IconButton>
        <IconButton
          size="tiny"
          tooltip="Collapse all groups"
          onClick={closeAll}
        >
          <IcCollapseAll />
        </IconButton>
      </SidebarToolbar>

      {groupPromptOpen && (
        <div className="flex items-center px-2 pb-1.5">
          <input
            autoFocus
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleNewGroup();
              else if (e.key === "Escape") {
                setGroupName("");
                setGroupPromptOpen(false);
              }
            }}
            placeholder="Group name"
            className={cn(
              "flex-1 h-6 rounded-md bg-transparent border border-[var(--border-strong)] px-2 text-[12px] outline-none",
              "focus:ring-1 focus:ring-[var(--text-link)] focus:border-[var(--text-link)]",
            )}
          />
        </div>
      )}

      {!hasAny ? (
        <p className={cn("text-[12px] italic px-3 py-3", textFaint)}>
          No bookmarks yet — open a note, then use ⋯ → Bookmark.
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {groupBuckets.map((g) => {
            const closed = closedGroups.has(groupKey(g.name));
            const isUntitled = !g.name;
            return (
              <li key={groupKey(g.name)} className="flex flex-col gap-0.5">
                <SidebarRow
                  depth={0}
                  chevron={{ open: !closed }}
                  label={g.name || "Untitled group"}
                  onClick={() => toggleGroup(g.name)}
                  trailing={
                    !isUntitled ? (
                      <button
                        type="button"
                        aria-label="Remove group"
                        title="Remove group"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeGroup(g.name);
                        }}
                        className="opacity-0 group-hover:opacity-60 hover:opacity-100 p-0.5 rounded"
                      >
                        <IcTrash className="[width:var(--icon-xs)] [height:var(--icon-xs)]" />
                      </button>
                    ) : null
                  }
                />
                {!closed && g.entries.length > 0 && (
                  <ul className="flex flex-col gap-0.5">
                    {g.entries.map((e) => (
                      <BookmarkEntryRow
                        key={e.id}
                        entry={e}
                        onOpen={() =>
                          window.dispatchEvent(
                            new CustomEvent("flux-open-file", {
                              detail: { fileId: e.id },
                            }),
                          )
                        }
                        onEdit={() => {
                          setEditTarget(e.id);
                          setEditOpen(true);
                        }}
                        onRemove={() => remove(e.id)}
                      />
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <AddBookmarkDialog
        open={editOpen}
        fileId={editTarget}
        defaultTitle={
          editTarget && editTarget === active.fileId
            ? active.title ?? undefined
            : undefined
        }
        onClose={() => {
          setEditOpen(false);
          setEditTarget(null);
        }}
      />
    </div>
  );
}

function BookmarkEntryRow({
  entry,
  onOpen,
  onEdit,
  onRemove,
}: {
  entry: BookmarkEntry;
  onOpen: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const name =
    entry.title ||
    (entry.id.split(/[\\/]/).pop() ?? entry.id).replace(/\.md$/i, "");
  return (
    <li>
      <SidebarRow
        depth={1}
        leading={
          <IcBookmark className="[width:var(--icon-sm)] [height:var(--icon-sm)] shrink-0 opacity-80" />
        }
        label={name}
        title={entry.id}
        onClick={onOpen}
        onDoubleClick={onEdit}
        trailing={
          <button
            type="button"
            aria-label="Remove bookmark"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="opacity-0 group-hover:opacity-60 hover:opacity-100 p-0.5 rounded"
          >
            <IcTrash className="[width:var(--icon-xs)] [height:var(--icon-xs)]" />
          </button>
        }
      />
    </li>
  );
}
