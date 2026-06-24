/**
 * "Link work item" dialog — pick a board, then pick an existing
 * work item OR fill in title/type/column to create a new one.
 *
 * The dialog returns the wikilink the host should paste into the
 * caller's editor (or the clipboard fallback). Creating a new item
 * mutates the chosen board file via `saveBoard`.
 */
import * as React from "react";
import { FileText, Search } from "lucide-react";

import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@flux/plugin-sdk/ui";

import {
  shortId,
  workItemLink,
  type KanbanBoard,
  type WorkItem,
} from "./schema";

type Mode = "existing" | "new";

interface LinkPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Vault-relative paths of every `*.board.yaml`. */
  boardPaths: string[];
  /** Load + parse a board on demand. */
  loadBoard: (path: string) => Promise<KanbanBoard>;
  /** Persist a board after a "create new" mutation. */
  saveBoard: (path: string, board: KanbanBoard) => Promise<void>;
  /** Final wikilink → caller. */
  onPicked: (link: string, boardPath: string, item: WorkItem) => void;
  /** Optional seed for the new-item form (e.g. the todo text from
   *  the user's `- [ ]` line). */
  initialTitle?: string;
}

export function LinkWorkItemDialog({
  open,
  onOpenChange,
  boardPaths,
  loadBoard,
  saveBoard,
  onPicked,
  initialTitle,
}: LinkPickerProps) {
  const [mode, setMode] = React.useState<Mode>("existing");
  const [boardPath, setBoardPath] = React.useState<string>("");
  const [board, setBoard] = React.useState<KanbanBoard | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");

  // ── "create new" form ──
  const [newTitle, setNewTitle] = React.useState(initialTitle ?? "");
  const [newTypeId, setNewTypeId] = React.useState<string>("");
  const [newColumnId, setNewColumnId] = React.useState<string>("");
  const [newParentId, setNewParentId] = React.useState<string>("__root");

  // Re-seed on open.
  React.useEffect(() => {
    if (!open) return;
    setMode("existing");
    setQuery("");
    setError(null);
    setNewTitle(initialTitle ?? "");
    if (!boardPath && boardPaths[0]) {
      setBoardPath(boardPaths[0]);
    }
  }, [open, initialTitle, boardPaths, boardPath]);

  // Load board on path change.
  React.useEffect(() => {
    if (!open || !boardPath) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadBoard(boardPath)
      .then((b) => {
        if (cancelled) return;
        setBoard(b);
        setNewTypeId(b.defaultItemType);
        setNewColumnId(b.columns[0]?.id ?? "");
        setNewParentId("__root");
      })
      .catch(() => {
        if (cancelled) return;
        setBoard(null);
        setError("Could not load this board.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, boardPath, loadBoard]);

  const filteredItems = React.useMemo(() => {
    if (!board) return [];
    const q = query.trim().toLowerCase();
    if (!q) return board.items;
    return board.items.filter((i) => {
      if (i.title.toLowerCase().includes(q)) return true;
      if (i.id.toLowerCase().includes(q)) return true;
      return Object.values(i.fields).some(
        (v) =>
          v !== undefined &&
          v !== null &&
          String(v).toLowerCase().includes(q),
      );
    });
  }, [board, query]);

  const pickExisting = (item: WorkItem) => {
    if (!board) return;
    const link = workItemLink(board.id, item);
    onPicked(link, boardPath, item);
    onOpenChange(false);
  };

  const createAndPick = async () => {
    if (!board) return;
    if (!newTitle.trim()) {
      setError("Title is required.");
      return;
    }
    const type = board.itemTypes.find((t) => t.id === newTypeId);
    if (!type) {
      setError("Pick a work item type.");
      return;
    }
    const fields: Record<string, unknown> = {};
    for (const f of type.fields) {
      if (f.defaultValue !== undefined) fields[f.id] = f.defaultValue;
    }
    const item: WorkItem = {
      id: `wi_${shortId()}`,
      type: newTypeId,
      column: newColumnId || board.columns[0].id,
      parent: newParentId === "__root" ? null : newParentId,
      title: newTitle.trim(),
      done: false,
      fields: fields as WorkItem["fields"],
      created: new Date().toISOString(),
    };
    const next: KanbanBoard = { ...board, items: [...board.items, item] };
    try {
      await saveBoard(boardPath, next);
      const link = workItemLink(board.id, item);
      onPicked(link, boardPath, item);
      onOpenChange(false);
    } catch (e) {
      setError("Could not save the board.");
    }
  };

  const boardName = (p: string) =>
    (p.split(/[\\/]/).pop() ?? p).replace(/\.board\.yaml$/i, "");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle>Link to work item</DialogTitle>
          <DialogDescription>
            Inserts a wikilink at your cursor:{" "}
            <code>[[Board.board#wi_…|title]]</code>.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-[80px_minmax(0,1fr)] gap-x-3 gap-y-2 items-center text-[13px]">
          <label className="text-muted-foreground">Board</label>
          {boardPaths.length === 0 ? (
            <span className="text-[12px] text-destructive">
              No boards in this vault. Create one first.
            </span>
          ) : (
            <Select value={boardPath} onValueChange={setBoardPath}>
              <SelectTrigger className="h-8">
                <SelectValue placeholder="Pick a board" />
              </SelectTrigger>
              <SelectContent>
                {boardPaths.map((p) => (
                  <SelectItem key={p} value={p}>
                    {boardName(p)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <label className="text-muted-foreground">Mode</label>
          <div className="flex items-center gap-1">
            {(["existing", "new"] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={
                  "h-7 px-3 text-[12px] rounded-md border transition-colors " +
                  (mode === m
                    ? "bg-accent border-foreground/30"
                    : "border-transparent hover:bg-accent/60 text-muted-foreground")
                }
              >
                {m === "existing" ? "Pick existing" : "Create new"}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3 max-h-[50vh] overflow-y-auto">
          {loading ? (
            <div className="text-[12px] text-muted-foreground py-6 text-center">
              Loading…
            </div>
          ) : !board ? (
            <div className="text-[12px] text-muted-foreground py-6 text-center">
              {error ?? "Pick a board to continue."}
            </div>
          ) : mode === "existing" ? (
            <ExistingPicker
              items={filteredItems}
              board={board}
              query={query}
              setQuery={setQuery}
              onPick={pickExisting}
            />
          ) : (
            <NewItemForm
              board={board}
              title={newTitle}
              setTitle={setNewTitle}
              typeId={newTypeId}
              setTypeId={setNewTypeId}
              columnId={newColumnId}
              setColumnId={setNewColumnId}
              parentId={newParentId}
              setParentId={setNewParentId}
            />
          )}
          {error && mode === "new" && (
            <div className="text-[12px] text-destructive">{error}</div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {mode === "new" && (
            <Button
              disabled={!board || !newTitle.trim()}
              onClick={() => void createAndPick()}
            >
              Create &amp; insert
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── existing picker ───────────────────────────────────────────────

function ExistingPicker({
  items,
  board,
  query,
  setQuery,
  onPick,
}: {
  items: WorkItem[];
  board: KanbanBoard;
  query: string;
  setQuery: (v: string) => void;
  onPick: (item: WorkItem) => void;
}) {
  const typeIndex = new Map(board.itemTypes.map((t) => [t.id, t]));
  const colIndex = new Map(board.columns.map((c) => [c.id, c]));

  return (
    <>
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/70" />
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search work items…"
          className="h-8 pl-8"
        />
      </div>

      <ul className="flex flex-col gap-1">
        {items.length === 0 && (
          <li className="text-[13px] text-muted-foreground py-6 text-center">
            No work items match.
          </li>
        )}
        {items.map((it) => {
          const type = typeIndex.get(it.type);
          const col = colIndex.get(it.column);
          return (
            <li key={it.id}>
              <button
                type="button"
                onClick={() => onPick(it)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent text-left text-[13px]"
              >
                <FileText
                  className="w-3.5 h-3.5 shrink-0 opacity-70"
                  style={type?.color ? { color: type.color } : undefined}
                />
                {type && (
                  <Badge
                    variant="outline"
                    className="shrink-0"
                    style={
                      type.color
                        ? { borderColor: type.color, color: type.color }
                        : undefined
                    }
                  >
                    {type.name}
                  </Badge>
                )}
                <span className="flex-1 truncate">{it.title}</span>
                {col && (
                  <span className="text-[11px] text-muted-foreground">
                    {col.name}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

// ── new-item form ─────────────────────────────────────────────────

function NewItemForm({
  board,
  title,
  setTitle,
  typeId,
  setTypeId,
  columnId,
  setColumnId,
  parentId,
  setParentId,
}: {
  board: KanbanBoard;
  title: string;
  setTitle: (v: string) => void;
  typeId: string;
  setTypeId: (v: string) => void;
  columnId: string;
  setColumnId: (v: string) => void;
  parentId: string;
  setParentId: (v: string) => void;
}) {
  return (
    <div className="grid grid-cols-[80px_minmax(0,1fr)] gap-x-3 gap-y-2 items-center text-[13px]">
      <label className="text-muted-foreground">Title</label>
      <Input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="h-8"
        placeholder="What needs doing?"
      />

      <label className="text-muted-foreground">Type</label>
      <Select value={typeId} onValueChange={setTypeId}>
        <SelectTrigger className="h-8">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {board.itemTypes.map((t) => (
            <SelectItem key={t.id} value={t.id}>
              {t.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <label className="text-muted-foreground">Column</label>
      <Select value={columnId} onValueChange={setColumnId}>
        <SelectTrigger className="h-8">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {board.columns.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <label className="text-muted-foreground">Parent</label>
      <Select value={parentId} onValueChange={setParentId}>
        <SelectTrigger className="h-8">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__root">— none —</SelectItem>
          {board.items.map((it) => (
            <SelectItem key={it.id} value={it.id}>
              {it.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <p className="col-span-2 text-[12px] text-muted-foreground">
        Saved to <code>{board.title}</code>. A wikilink will be
        inserted at your cursor — toggling the checkbox in your note
        will stay in sync with the work item (coming with the next
        plugin host milestone).
      </p>
    </div>
  );
}
