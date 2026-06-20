/**
 * Sidebar panel — lists every `*.board.yaml` (and legacy
 * `*.kanban.json` / `*.kanban.md` until migrated).
 *
 * Toolbar `+` opens the "New board" dialog with template picker.
 * Each row has a context menu: Open / Rename / Duplicate / Reveal
 * in Files / Move to trash.
 */
import * as React from "react";
import {
  FilePlus2,
  FileText,
  LayoutGrid,
  Plus,
  Search,
} from "lucide-react";

import { useVaultStore } from "@/state/vault-store";
import { useFileOperations } from "@/hooks/use-file-operations";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

import type { FileNode } from "@/state/editor";

import { serialiseBoard } from "./codec";
import { BOARD_TEMPLATES } from "./schema";

const BOARD_EXT = ".board.yaml";
const LEGACY_EXTS = [".kanban.json", ".kanban.md", ".kanban"];

function isBoardFile(id: string): boolean {
  const lower = id.toLowerCase();
  return (
    lower.endsWith(BOARD_EXT) ||
    LEGACY_EXTS.some((ext) => lower.endsWith(ext))
  );
}

function displayName(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path;
  return base
    .replace(/\.board\.yaml$/i, "")
    .replace(/\.kanban\.json$/i, "")
    .replace(/\.kanban\.md$/i, "")
    .replace(/\.kanban$/i, "");
}

function isLegacy(path: string): boolean {
  const lower = path.toLowerCase();
  return LEGACY_EXTS.some((ext) => lower.endsWith(ext));
}

function flattenBoards(tree: FileNode[]): FileNode[] {
  const out: FileNode[] = [];
  function walk(nodes: FileNode[]) {
    for (const n of nodes) {
      if (n.kind === "file" && isBoardFile(n.id)) out.push(n);
      if (n.children) walk(n.children);
    }
  }
  walk(tree);
  out.sort((a, b) => displayName(a.id).localeCompare(displayName(b.id)));
  return out;
}

export default function KanbanSidebar() {
  const fileTree = useVaultStore((s) => s.fileTree);
  const boards = React.useMemo(() => flattenBoards(fileTree), [fileTree]);
  const { createFile, deleteFile, renameFile, openFile } = useFileOperations();

  const [query, setQuery] = React.useState("");
  const [newOpen, setNewOpen] = React.useState(false);
  const [renameTarget, setRenameTarget] = React.useState<FileNode | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<FileNode | null>(null);

  React.useEffect(() => {
    const onNew = () => setNewOpen(true);
    window.addEventListener("flux-kanban-new-board", onNew as EventListener);
    return () =>
      window.removeEventListener(
        "flux-kanban-new-board",
        onNew as EventListener,
      );
  }, []);

  const filtered = React.useMemo(() => {
    if (!query.trim()) return boards;
    const q = query.toLowerCase();
    return boards.filter((b) =>
      displayName(b.id).toLowerCase().includes(q),
    );
  }, [boards, query]);

  const openBoard = (path: string) => {
    window.dispatchEvent(
      new CustomEvent("flux-open-file", { detail: { fileId: path } }),
    );
  };

  const createFromTemplate = async (templateId: string, name: string) => {
    const template = BOARD_TEMPLATES.find((t) => t.id === templateId);
    if (!template) return;
    const board = template.build();
    board.title = name.replace(/\.board\.yaml$/i, "") || board.title;
    const filename = ensureBoardExtension(name);
    try {
      await createFile(filename, serialiseBoard(board));
      openBoard(filename);
      setNewOpen(false);
    } catch {
      /* already toasted */
    }
  };

  const duplicate = async (node: FileNode) => {
    try {
      const content = await openFile(node.id);
      const dir = node.id.includes("/")
        ? node.id.slice(0, node.id.lastIndexOf("/") + 1)
        : "";
      const stem = displayName(node.id);
      let candidate = `${dir}${stem} (copy).board.yaml`;
      const existing = new Set(boards.map((b) => b.id.toLowerCase()));
      let i = 2;
      while (existing.has(candidate.toLowerCase())) {
        candidate = `${dir}${stem} (copy ${i}).board.yaml`;
        i++;
      }
      await createFile(candidate, content);
    } catch {
      /* already toasted */
    }
  };

  const reveal = (path: string) => {
    window.dispatchEvent(
      new CustomEvent("flux-reveal-in-files", { detail: { fileId: path } }),
    );
  };

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-center gap-1 h-[30px] px-2 shrink-0">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setNewOpen(true)}
          title="New board"
          aria-label="New board"
          className="h-[22px] w-[22px] p-0 text-muted-foreground hover:text-foreground"
        >
          <Plus className="w-3.5 h-3.5" />
        </Button>
      </div>

      {boards.length > 5 && (
        <div className="px-2 pb-1">
          <div className="relative">
            <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/70" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter boards…"
              className="h-6 pl-6 text-[11.5px]"
            />
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center text-center gap-2 px-3 py-6 text-[12px] text-[var(--text-faint)]">
          <LayoutGrid className="w-6 h-6 opacity-50" />
          {boards.length === 0 ? (
            <>
              <p>No boards yet.</p>
              <p>Use the + button above to create one.</p>
            </>
          ) : (
            <p>No boards match "{query}".</p>
          )}
        </div>
      ) : (
        <ul className="flex flex-col">
          {filtered.map((b) => {
            const legacy = isLegacy(b.id);
            return (
              <li key={b.id}>
                <ContextMenu>
                  <ContextMenuTrigger asChild>
                    <button
                      type="button"
                      onClick={() => openBoard(b.id)}
                      title={b.id}
                      className="group flex w-full items-center gap-1.5 h-6 px-2 rounded-[4px] text-[12px] hover:bg-[var(--hover)]"
                    >
                      <span className="[width:var(--icon-xs)] [height:var(--icon-xs)] shrink-0" />
                      <FileText className="[width:var(--icon-sm)] [height:var(--icon-sm)] shrink-0 opacity-80" />
                      <span className="truncate flex-1 text-left">
                        {displayName(b.id)}
                      </span>
                      {legacy && (
                        <Badge
                          variant="outline"
                          className="h-4 px-1 text-[9px] uppercase tracking-wider opacity-60 group-hover:opacity-100"
                          title="Will migrate to .board.yaml on open"
                        >
                          legacy
                        </Badge>
                      )}
                    </button>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="min-w-[180px]">
                    <ContextMenuItem onClick={() => openBoard(b.id)}>
                      Open
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => setRenameTarget(b)}>
                      Rename…
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => duplicate(b)}>
                      Duplicate
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => reveal(b.id)}>
                      Reveal in Files
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      variant="destructive"
                      onClick={() => setDeleteTarget(b)}
                    >
                      Move to trash
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              </li>
            );
          })}
        </ul>
      )}

      <NewBoardDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        existing={new Set(boards.map((b) => b.id.toLowerCase()))}
        onCreate={createFromTemplate}
      />

      <RenameDialog
        target={renameTarget}
        onClose={() => setRenameTarget(null)}
        onSubmit={async (next) => {
          if (!renameTarget) return;
          try {
            // `next` is the FULL filename the user typed (the
            // dialog prefills + edits the on-disk basename). We
            // pass it through verbatim — no silent suffix
            // injection — so what the user typed is what lands on
            // disk.
            await renameFile(renameTarget.id, next);
            setRenameTarget(null);
          } catch {
            /* already toasted */
          }
        }}
      />

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Move board to trash?</AlertDialogTitle>
            <AlertDialogDescription>
              <code>{deleteTarget?.id}</code> will be moved to{" "}
              <code>.trash/</code>. You can restore it from the trash
              view.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                const t = deleteTarget;
                setDeleteTarget(null);
                if (!t) return;
                try {
                  await deleteFile(t.id);
                } catch {
                  /* already toasted */
                }
              }}
            >
              Move to trash
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── New board dialog ───────────────────────────────────────────────

function NewBoardDialog({
  open,
  onOpenChange,
  existing,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existing: Set<string>;
  onCreate: (templateId: string, name: string) => Promise<void>;
}) {
  const [templateId, setTemplateId] = React.useState(BOARD_TEMPLATES[0].id);
  const [name, setName] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    setTemplateId(BOARD_TEMPLATES[0].id);
    setName(defaultBoardName(existing));
  }, [open, existing]);

  const nameTaken = existing.has(ensureBoardExtension(name).toLowerCase());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[540px]">
        <DialogHeader>
          <DialogTitle>New board</DialogTitle>
          <DialogDescription>
            Pick a template — you can edit columns and item types
            later from board settings.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-[90px_minmax(0,1fr)] gap-x-3 gap-y-2 items-start text-[13px]">
          <label className="text-muted-foreground pt-2">File name</label>
          <div className="flex flex-col gap-1">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-8"
              placeholder="My board"
              autoFocus
            />
            <span className="text-[11px] text-muted-foreground font-mono">
              → {ensureBoardExtension(name || "My board")}
            </span>
            {nameTaken && (
              <span className="text-[12px] text-destructive">
                A board with that name already exists.
              </span>
            )}
          </div>

          <label className="text-muted-foreground pt-2">Template</label>
          <ul className="flex flex-col gap-1.5">
            {BOARD_TEMPLATES.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setTemplateId(t.id)}
                  className={
                    "w-full text-left rounded-md border p-2.5 transition-colors " +
                    (t.id === templateId
                      ? "border-foreground/40 bg-accent"
                      : "border-border/60 hover:bg-accent/50")
                  }
                >
                  <div className="flex items-center gap-2 text-[13px] font-medium">
                    <FilePlus2 className="w-3.5 h-3.5 opacity-80" />
                    {t.name}
                  </div>
                  <div className="text-[12px] text-muted-foreground mt-0.5">
                    {t.description}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!name.trim() || nameTaken}
            onClick={() => onCreate(templateId, name.trim())}
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Rename dialog ──────────────────────────────────────────────────

function RenameDialog({
  target,
  onClose,
  onSubmit,
}: {
  target: FileNode | null;
  onClose: () => void;
  onSubmit: (next: string) => Promise<void>;
}) {
  const [value, setValue] = React.useState("");
  // Prefill with the FULL filename including the `.board.yaml`
  // suffix so what the user sees IS what's on disk. Stripping
  // extensions in a rename dialog has bitten users — they think
  // they typed a `.yaml` file name and end up with
  // `MyBoard.yaml.board.yaml` (when we re-append) or
  // `MyBoard.yaml` that the plugin no longer recognises.
  React.useEffect(() => {
    if (target) setValue(basename(target.id));
  }, [target]);

  const trimmed = value.trim();
  const losesSuffix =
    trimmed.length > 0 && !/\.board\.ya?ml$/i.test(trimmed);

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Rename board</DialogTitle>
          <DialogDescription>
            Edit the full filename. Wikilinks pointing at this board
            (and any work items in it) are updated automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="h-8 font-mono text-[12.5px]"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (trimmed) void onSubmit(trimmed);
              }
            }}
          />
          {losesSuffix && (
            <p className="text-[12px] text-amber-600 dark:text-amber-400">
              ⚠ Filename no longer ends in <code>.board.yaml</code>.
              The kanban view will still open this file if its
              contents start with <code>flux: board</code>, but it
              won't appear in this Boards list.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!trimmed}
            onClick={() => void onSubmit(trimmed)}
          >
            Rename
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Vault-relative basename — last segment after `/` or `\`. Unlike
 *  `displayName` (above), keeps every character of the on-disk
 *  filename including the `.board.yaml` suffix. */
function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

// ── helpers ────────────────────────────────────────────────────────

/** All new boards default to the `boards/` namespace so the vault
 *  root doesn't get cluttered. Users can still hand-type a leading
 *  folder (`Sprints/foo`) to override; we only inject the prefix
 *  when the name has no slashes of its own. */
const BOARDS_FOLDER = "boards";

function ensureBoardExtension(name: string): string {
  const lower = name.toLowerCase();
  let withExt: string;
  if (lower.endsWith(".board.yaml")) withExt = name;
  else if (lower.endsWith(".yaml"))
    withExt = name.slice(0, -5) + ".board.yaml";
  else withExt = name + ".board.yaml";
  // Auto-prefix `boards/` for names that don't already contain a
  // directory separator. `create_file` will mkdir-p the parent.
  if (!withExt.includes("/") && !withExt.includes("\\")) {
    return `${BOARDS_FOLDER}/${withExt}`;
  }
  return withExt;
}

function defaultBoardName(existing: Set<string>): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, 16);
  const base = `Board ${stamp}.board.yaml`;
  // The picker shows the unqualified name to the user — the boards/
  // prefix is added on save via `ensureBoardExtension`. We still
  // need to dedupe against the namespaced path.
  const namespaced = `${BOARDS_FOLDER}/${base}`.toLowerCase();
  if (!existing.has(namespaced)) return base;
  let i = 2;
  while (
    existing.has(`${BOARDS_FOLDER}/Board ${stamp} (${i}).board.yaml`.toLowerCase())
  ) {
    i++;
  }
  return `Board ${stamp} (${i}).board.yaml`;
}
