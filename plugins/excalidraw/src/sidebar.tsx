/**
 * Sidebar panel — lists every `*.excalidraw` file in the active
 * vault. Toolbar `+` creates a new drawing under `drawings/`.
 * Right-click a row for Reveal / Move to trash.
 */
import * as React from "react";
import { FileImage, Palette, Plus, Search } from "lucide-react";

import {
  useFileOperations,
  useVaultOperations,
  useVaultStore,
} from "@flux/plugin-sdk/bridge";
import type { FileNode } from "@flux/plugin-sdk/bridge";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@flux/plugin-sdk/ui";

import { emptyExcalidrawDoc, serializeExcalidrawDoc } from "./state";

const EXT = ".excalidraw";
const FOLDER = "drawings";

function isDrawing(id: string): boolean {
  return id.toLowerCase().endsWith(EXT);
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function displayName(path: string): string {
  return basename(path).replace(/\.excalidraw$/i, "");
}

function flatten(tree: FileNode[]): FileNode[] {
  const out: FileNode[] = [];
  function walk(nodes: FileNode[]) {
    for (const n of nodes) {
      if (n.kind === "file" && isDrawing(n.id)) out.push(n);
      if (n.children) walk(n.children);
    }
  }
  walk(tree);
  out.sort((a, b) => displayName(a.id).localeCompare(displayName(b.id)));
  return out;
}

function ensureExtension(name: string): string {
  const lower = name.toLowerCase();
  const withExt = lower.endsWith(EXT) ? name : name + EXT;
  if (!withExt.includes("/") && !withExt.includes("\\")) {
    return `${FOLDER}/${withExt}`;
  }
  return withExt;
}

function defaultName(existing: Set<string>): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, 19);
  const base = `Drawing ${stamp}.excalidraw`;
  const namespaced = `${FOLDER}/${base}`.toLowerCase();
  if (!existing.has(namespaced)) return base;
  let i = 2;
  while (
    existing.has(
      `${FOLDER}/Drawing ${stamp} (${i}).excalidraw`.toLowerCase(),
    )
  ) {
    i++;
  }
  return `Drawing ${stamp} (${i}).excalidraw`;
}

function bumpSuffix(name: string): string {
  const m = name.match(/^(.*) \((\d+)\)(\.[^.]+)$/);
  if (m) return `${m[1]} (${Number(m[2]) + 1})${m[3]}`;
  return name.replace(/(\.[^.]+)$/, " (2)$1");
}

export default function ExcalidrawSidebar() {
  const fileTree = useVaultStore((s) => s.fileTree);
  const drawings = React.useMemo(() => flatten(fileTree), [fileTree]);
  const { createFile, deleteFile } = useFileOperations();
  const { refreshVault } = useVaultOperations();

  const [query, setQuery] = React.useState("");
  const [newOpen, setNewOpen] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<FileNode | null>(
    null,
  );

  React.useEffect(() => {
    const onNew = () => setNewOpen(true);
    window.addEventListener("flux-excalidraw-new", onNew as EventListener);
    return () =>
      window.removeEventListener(
        "flux-excalidraw-new",
        onNew as EventListener,
      );
  }, []);

  const filtered = React.useMemo(() => {
    if (!query.trim()) return drawings;
    const q = query.toLowerCase();
    return drawings.filter((d) =>
      displayName(d.id).toLowerCase().includes(q),
    );
  }, [drawings, query]);

  const open = (path: string) => {
    window.dispatchEvent(
      new CustomEvent("flux-open-file", { detail: { fileId: path } }),
    );
  };

  const reveal = (path: string) => {
    window.dispatchEvent(
      new CustomEvent("flux-reveal-in-files", { detail: { fileId: path } }),
    );
  };

  const create = async (name: string) => {
    let attempt = ensureExtension(name);
    for (let i = 0; i < 8; i++) {
      try {
        await createFile(attempt, serializeExcalidrawDoc(emptyExcalidrawDoc()));
        void refreshVault(true);
        open(attempt);
        setNewOpen(false);
        return;
      } catch (err) {
        const msg = String(err ?? "");
        if (!/already.?exists/i.test(msg)) return;
        attempt = bumpSuffix(attempt);
      }
    }
  };

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-center gap-1 h-[30px] px-2 shrink-0">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setNewOpen(true)}
          title="New drawing"
          aria-label="New drawing"
          className="h-[22px] w-[22px] p-0 text-muted-foreground hover:text-foreground"
        >
          <Plus className="w-3.5 h-3.5" />
        </Button>
      </div>

      {drawings.length > 5 && (
        <div className="px-2 pb-1">
          <div className="relative">
            <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/70" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter drawings…"
              className="h-6 pl-6 text-[11.5px]"
            />
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center text-center gap-2 px-3 py-6 text-[12px] text-[var(--text-faint)]">
          <Palette className="w-6 h-6 opacity-50" />
          {drawings.length === 0 ? (
            <>
              <p>No drawings yet.</p>
              <p>Use the + button above to create one.</p>
            </>
          ) : (
            <p>No drawings match "{query}".</p>
          )}
        </div>
      ) : (
        <ul className="flex flex-col">
          {filtered.map((d) => (
            <li key={d.id}>
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <button
                    type="button"
                    onClick={() => open(d.id)}
                    title={d.id}
                    className="group flex w-full items-center gap-1.5 h-6 px-2 rounded-[4px] text-[12px] hover:bg-[var(--hover)]"
                  >
                    <span className="[width:var(--icon-xs)] [height:var(--icon-xs)] shrink-0" />
                    <FileImage className="[width:var(--icon-sm)] [height:var(--icon-sm)] shrink-0 opacity-80" />
                    <span className="truncate flex-1 text-left">
                      {displayName(d.id)}
                    </span>
                  </button>
                </ContextMenuTrigger>
                <ContextMenuContent className="min-w-[180px]">
                  <ContextMenuItem onClick={() => open(d.id)}>
                    Open
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => reveal(d.id)}>
                    Reveal in Files
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    variant="destructive"
                    onClick={() => setDeleteTarget(d)}
                  >
                    Move to trash
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            </li>
          ))}
        </ul>
      )}

      <NewDrawingDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        existing={new Set(drawings.map((d) => d.id.toLowerCase()))}
        onCreate={create}
      />

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Move drawing to trash?</AlertDialogTitle>
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

function NewDrawingDialog({
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
    setName(defaultName(existing));
  }, [open, existing]);

  const nameTaken = existing.has(ensureExtension(name).toLowerCase());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>New drawing</DialogTitle>
          <DialogDescription>
            Hand-drawn whiteboard powered by Excalidraw. Saved as{" "}
            <code>.excalidraw</code> JSON in your vault.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-[90px_minmax(0,1fr)] gap-x-3 gap-y-2 items-start text-[13px]">
          <label className="text-muted-foreground pt-2">File name</label>
          <div className="flex flex-col gap-1">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-8"
              placeholder="My drawing"
              autoFocus
            />
            <span className="text-[11px] text-muted-foreground font-mono">
              → {ensureExtension(name || "My drawing")}
            </span>
            {nameTaken && (
              <span className="text-[12px] text-destructive">
                A drawing with that name already exists.
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
