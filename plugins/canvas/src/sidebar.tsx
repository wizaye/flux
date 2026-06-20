/**
 * Sidebar panel — lists every `*.canvas` (JSON Canvas 1.0) in the
 * vault. Right-click row for Rename / Duplicate / Reveal / Delete;
 * toolbar `+` creates a new canvas with the default template.
 *
 * Mirrors the kanban sidebar's contract: discovery is filename-
 * based off the shared vault tree, all dialogs use shadcn
 * primitives directly (no SDK indirection for now).
 */
import * as React from "react";
import {
  FileImage,
  PencilRuler,
  Plus,
  Search,
} from "lucide-react";

import { useVaultStore } from "@/state/vault-store";
import { useFileOperations } from "@/hooks/use-file-operations";
import { useVaultOperations } from "@/hooks/use-vault-operations";

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

import { emptyCanvasDoc, serializeCanvas } from "./state";

const CANVAS_EXTS = [".canvas"];
/** All new canvases default to this folder so the vault root
 *  doesn't get cluttered. Hand-typed paths can override (see
 *  `ensureCanvasExtension`). */
const CANVAS_FOLDER = "canvases";

function isCanvasFile(id: string): boolean {
  const lower = id.toLowerCase();
  return CANVAS_EXTS.some((ext) => lower.endsWith(ext));
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function displayName(path: string): string {
  return basename(path).replace(/\.canvas$/i, "");
}

function flattenCanvases(tree: FileNode[]): FileNode[] {
  const out: FileNode[] = [];
  function walk(nodes: FileNode[]) {
    for (const n of nodes) {
      if (n.kind === "file" && isCanvasFile(n.id)) out.push(n);
      if (n.children) walk(n.children);
    }
  }
  walk(tree);
  out.sort((a, b) => displayName(a.id).localeCompare(displayName(b.id)));
  return out;
}

export default function CanvasSidebar() {
  const fileTree = useVaultStore((s) => s.fileTree);
  const canvases = React.useMemo(() => flattenCanvases(fileTree), [fileTree]);
  const { createFile, deleteFile, renameFile, openFile } = useFileOperations();
  const { refreshVault } = useVaultOperations();

  const [query, setQuery] = React.useState("");
  const [newOpen, setNewOpen] = React.useState(false);
  const [renameTarget, setRenameTarget] = React.useState<FileNode | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<FileNode | null>(null);

  // Palette command bridge — same shape kanban uses.
  React.useEffect(() => {
    const onNew = () => setNewOpen(true);
    window.addEventListener("flux-canvas-new", onNew as EventListener);
    return () =>
      window.removeEventListener("flux-canvas-new", onNew as EventListener);
  }, []);

  const filtered = React.useMemo(() => {
    if (!query.trim()) return canvases;
    const q = query.toLowerCase();
    return canvases.filter((c) =>
      displayName(c.id).toLowerCase().includes(q),
    );
  }, [canvases, query]);

  const open = (path: string) => {
    window.dispatchEvent(
      new CustomEvent("flux-open-file", { detail: { fileId: path } }),
    );
  };

  const create = async (name: string) => {
    // Resolve a unique on-disk filename even if our in-memory
    // `existing` set is stale (which happens when the previous
    // create's tree mutation hasn't propagated yet, or the file
    // was added out-of-band by a sync / external tool). We try up
    // to a small `(n)` bound; the inner loop is cheap because the
    // failure path is just a backend round-trip.
    let attempt = ensureCanvasExtension(name);
    for (let i = 0; i < 8; i++) {
      try {
        await createFile(attempt, serializeCanvas(emptyCanvasDoc()));
        // Force-refresh the vault tree so the new file shows in the
        // sidebar even if the in-memory `addNodeToTree` path didn't
        // match the on-disk canonical form (Windows separators,
        // case-sensitivity, etc.).
        void refreshVault(true);
        open(attempt);
        setNewOpen(false);
        return;
      } catch (err) {
        const msg = String(err ?? "");
        if (!/already.?exists/i.test(msg)) {
          // Different error — toast already raised inside
          // `createFile`. Bail.
          return;
        }
        // Bump suffix and try again.
        attempt = bumpSuffix(attempt);
      }
    }
  };

  const duplicate = async (node: FileNode) => {
    try {
      const content = await openFile(node.id);
      const dir = node.id.includes("/")
        ? node.id.slice(0, node.id.lastIndexOf("/") + 1)
        : "";
      const stem = displayName(node.id);
      let candidate = `${dir}${stem} (copy).canvas`;
      const existing = new Set(canvases.map((c) => c.id.toLowerCase()));
      let i = 2;
      while (existing.has(candidate.toLowerCase())) {
        candidate = `${dir}${stem} (copy ${i}).canvas`;
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
          title="New canvas"
          aria-label="New canvas"
          className="h-[22px] w-[22px] p-0 text-muted-foreground hover:text-foreground"
        >
          <Plus className="w-3.5 h-3.5" />
        </Button>
      </div>

      {canvases.length > 5 && (
        <div className="px-2 pb-1">
          <div className="relative">
            <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/70" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter canvases…"
              className="h-6 pl-6 text-[11.5px]"
            />
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center text-center gap-2 px-3 py-6 text-[12px] text-[var(--text-faint)]">
          <PencilRuler className="w-6 h-6 opacity-50" />
          {canvases.length === 0 ? (
            <>
              <p>No canvases yet.</p>
              <p>Use the + button above to create one.</p>
            </>
          ) : (
            <p>No canvases match "{query}".</p>
          )}
        </div>
      ) : (
        <ul className="flex flex-col">
          {filtered.map((c) => (
            <li key={c.id}>
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <button
                    type="button"
                    onClick={() => open(c.id)}
                    title={c.id}
                    className="group flex w-full items-center gap-1.5 h-6 px-2 rounded-[4px] text-[12px] hover:bg-[var(--hover)]"
                  >
                    <span className="[width:var(--icon-xs)] [height:var(--icon-xs)] shrink-0" />
                    <FileImage className="[width:var(--icon-sm)] [height:var(--icon-sm)] shrink-0 opacity-80" />
                    <span className="truncate flex-1 text-left">
                      {displayName(c.id)}
                    </span>
                  </button>
                </ContextMenuTrigger>
                <ContextMenuContent className="min-w-[180px]">
                  <ContextMenuItem onClick={() => open(c.id)}>
                    Open
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => setRenameTarget(c)}>
                    Rename…
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => duplicate(c)}>
                    Duplicate
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => reveal(c.id)}>
                    Reveal in Files
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    variant="destructive"
                    onClick={() => setDeleteTarget(c)}
                  >
                    Move to trash
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            </li>
          ))}
        </ul>
      )}

      <NewCanvasDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        existing={new Set(canvases.map((c) => c.id.toLowerCase()))}
        onCreate={create}
      />

      <RenameDialog
        target={renameTarget}
        onClose={() => setRenameTarget(null)}
        onSubmit={async (next) => {
          if (!renameTarget) return;
          try {
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
            <AlertDialogTitle>Move canvas to trash?</AlertDialogTitle>
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

// ── Dialogs ────────────────────────────────────────────────────────

function NewCanvasDialog({
  open,
  onOpenChange,
  existing,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existing: Set<string>;
  onCreate: (name: string) => Promise<void>;
}) {
  const [name, setName] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    setName(defaultCanvasName(existing));
  }, [open, existing]);

  const nameTaken = existing.has(ensureCanvasExtension(name).toLowerCase());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>New canvas</DialogTitle>
          <DialogDescription>
            Infinite-canvas whiteboard. Saved as JSON Canvas 1.0
            (<code>.canvas</code>) in your vault.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-[90px_minmax(0,1fr)] gap-x-3 gap-y-2 items-start text-[13px]">
          <label className="text-muted-foreground pt-2">File name</label>
          <div className="flex flex-col gap-1">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-8"
              placeholder="My canvas"
              autoFocus
            />
            <span className="text-[11px] text-muted-foreground font-mono">
              → {ensureCanvasExtension(name || "My canvas")}
            </span>
            {nameTaken && (
              <span className="text-[12px] text-destructive">
                A canvas with that name already exists.
              </span>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!name.trim() || nameTaken}
            onClick={() => onCreate(name.trim())}
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
  // Prefill with FULL basename incl. extension — same lesson the
  // kanban rename dialog learned: hiding the suffix is misleading.
  React.useEffect(() => {
    if (target) setValue(basename(target.id));
  }, [target]);

  const trimmed = value.trim();
  const losesSuffix =
    trimmed.length > 0 && !/\.canvas$/i.test(trimmed);

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Rename canvas</DialogTitle>
          <DialogDescription>
            Edit the full filename. Wikilinks pointing at this canvas
            are updated automatically.
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
              ⚠ Filename no longer ends in <code>.canvas</code>.
              The canvas view won't recognise this file after rename
              — it'll open as raw JSON instead.
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

// ── helpers ────────────────────────────────────────────────────────

function ensureCanvasExtension(name: string): string {
  const lower = name.toLowerCase();
  let withExt: string;
  if (lower.endsWith(".canvas")) {
    withExt = name;
  } else {
    withExt = name + ".canvas";
  }
  if (!withExt.includes("/") && !withExt.includes("\\")) {
    return `${CANVAS_FOLDER}/${withExt}`;
  }
  return withExt;
}

function defaultCanvasName(existing: Set<string>): string {
  // Second precision so two clicks within the same minute don't
  // collide on the timestamp alone. The `(n)` fallback below still
  // covers the edge case of two clicks within the same second.
  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, 19);
  const base = `Canvas ${stamp}.canvas`;
  const namespaced = `${CANVAS_FOLDER}/${base}`.toLowerCase();
  if (!existing.has(namespaced)) return base;
  let i = 2;
  while (
    existing.has(
      `${CANVAS_FOLDER}/Canvas ${stamp} (${i}).canvas`.toLowerCase(),
    )
  ) {
    i++;
  }
  return `Canvas ${stamp} (${i}).canvas`;
}

/** Append `(2)` (or bump an existing `(n)`) before the extension.
 *  Used by `create()` to escape a stale `existing` set when the
 *  backend rejects the create with AlreadyExists. */
function bumpSuffix(path: string): string {
  const m = /^(.*?)(?: \((\d+)\))?(\.canvas)$/i.exec(path);
  if (!m) return path + " (2)";
  const stem = m[1];
  const n = m[2] ? Number(m[2]) + 1 : 2;
  return `${stem} (${n})${m[3]}`;
}
