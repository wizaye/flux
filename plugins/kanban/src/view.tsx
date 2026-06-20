/**
 * Kanban editor view — full-pane board with drag-and-drop columns
 * and cards, powered by `@dnd-kit`.
 *
 * Highlights:
 *   • Storage = `*.board.yaml` (see `codec.ts`). Legacy
 *     `*.kanban.json` / `*.kanban.md` migrate on first open.
 *   • Cards are first-class work items with stable global ids
 *     (`wi_XXXX`). Other Markdown notes link via
 *     `[[Board.board#wi_XXXX|Title]]`.
 *   • Parent/child relations render as collapsible groups with
 *     children indented under their parent.
 *   • Custom item types + custom fields per type, required-field
 *     validation in the editor modal.
 *   • Saved filters (JS-style boolean expressions) and optional
 *     swimlanes (group rows by any field).
 *
 * `@dnd-kit` not HTML5 drag: pointer-based DnD avoids the OS ghost
 * and the host's split-preview MIME listener.
 */
import * as React from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Filter,
  GitBranch,
  GripVertical,
  Plus,
  Settings2,
} from "lucide-react";

import type { EditorViewProps } from "@flux/plugin-sdk/types";
import { PluginPaneLayout } from "@flux/plugin-sdk/layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { useFileOperations } from "@/hooks/use-file-operations";

import { parseBoard, serialiseBoard } from "./codec";
import {
  isLegacyKanbanPath,
  migrateLegacyBoard,
  targetBoardPath,
} from "./migrate";
import { shortId } from "./schema";
import type {
  ColumnDef,
  FieldDef,
  ItemType,
  KanbanBoard,
  WorkItem,
} from "./schema";
import { CardEditor } from "./card-editor";
import { BoardSettings } from "./board-settings";

const CARD_PREFIX = "card:";
const COL_PREFIX = "col:";

const cardDndId = (cardId: string) => CARD_PREFIX + cardId;
const colDndId = (colId: string) => COL_PREFIX + colId;
const parseDndId = (
  id: string,
): { kind: "card" | "col"; id: string } | null => {
  if (id.startsWith(CARD_PREFIX)) {
    return { kind: "card", id: id.slice(CARD_PREFIX.length) };
  }
  if (id.startsWith(COL_PREFIX)) {
    return { kind: "col", id: id.slice(COL_PREFIX.length) };
  }
  return null;
};

const NO_FILTER = "__all";
const NO_SWIMLANE = "__none";

export default function KanbanView(props: EditorViewProps) {
  // ── Lazy migration ──────────────────────────────────────────────
  const fileOps = useFileOperations();
  const [migrating, setMigrating] = React.useState(
    () => isLegacyKanbanPath(props.path),
  );
  const migrationStartedRef = React.useRef(false);

  React.useEffect(() => {
    if (!isLegacyKanbanPath(props.path)) return;
    if (migrationStartedRef.current) return;
    migrationStartedRef.current = true;
    void (async () => {
      try {
        const target = await migrateLegacyBoard(props.path, {
          readFile: fileOps.openFile,
          createFile: fileOps.createFile,
          deleteFile: fileOps.deleteFile,
        });
        window.dispatchEvent(
          new CustomEvent("flux-open-file", { detail: { fileId: target } }),
        );
      } catch {
        setMigrating(false);
        migrationStartedRef.current = false;
      }
    })();
  }, [props.path, fileOps]);

  // ── Parse / save plumbing ───────────────────────────────────────
  const lastSourceRef = React.useRef<string>("");
  const [board, setBoard] = React.useState<KanbanBoard>(() =>
    parseBoard(props.content),
  );

  React.useEffect(() => {
    if (props.content !== lastSourceRef.current) {
      lastSourceRef.current = props.content;
      setBoard(parseBoard(props.content));
    }
  }, [props.content]);

  const commit = React.useCallback(
    (next: KanbanBoard | ((prev: KanbanBoard) => KanbanBoard)) => {
      let computed: KanbanBoard | null = null;
      setBoard((prev) => {
        const value = typeof next === "function" ? next(prev) : next;
        computed = value;
        return value;
      });
      if (computed) {
        const serialised = serialiseBoard(computed);
        lastSourceRef.current = serialised;
        // Defer to a microtask — keeps React happy when commit() is
        // called from within a dnd-kit drag-over handler.
        queueMicrotask(() => props.onChange(serialised));
      }
    },
    [props],
  );

  // ── Toolbar / dialog state ──────────────────────────────────────
  const [activeFilterId, setActiveFilterId] = React.useState<string>(NO_FILTER);
  const [swimlaneField, setSwimlaneField] = React.useState<string>(
    board.swimlaneField ?? NO_SWIMLANE,
  );
  React.useEffect(() => {
    setSwimlaneField(board.swimlaneField ?? NO_SWIMLANE);
  }, [board.swimlaneField]);

  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());
  const toggleCollapsed = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const [editor, setEditor] = React.useState<{
    card?: WorkItem;
    columnId?: string;
    parentId?: string | null;
  } | null>(null);
  const [settingsOpen, setSettingsOpen] = React.useState(false);

  // Card to flash-highlight — set when another view dispatches
  // `flux-kanban-focus-item` (e.g. clicking a `flux-wi://` link in
  // a markdown note). Cleared after a brief animation window.
  // Matched on the board's stable `id`, NOT its path, so a board
  // rename doesn't break existing chip links.
  const [focusedId, setFocusedId] = React.useState<string | null>(null);
  React.useEffect(() => {
    const handler = (e: Event) => {
      const detail = (
        e as CustomEvent<{ boardId?: string; itemId?: string }>
      ).detail;
      if (!detail?.itemId) return;
      if (detail.boardId && detail.boardId !== board.id) return;
      setFocusedId(detail.itemId);
    };
    window.addEventListener("flux-kanban-focus-item", handler as EventListener);
    return () =>
      window.removeEventListener(
        "flux-kanban-focus-item",
        handler as EventListener,
      );
  }, [board.id]);
  React.useEffect(() => {
    if (!focusedId) return;
    const t = window.setTimeout(() => setFocusedId(null), 1800);
    return () => window.clearTimeout(t);
  }, [focusedId]);

  // Scroll the focused card into view + add a one-shot flash class.
  React.useEffect(() => {
    if (!focusedId) return;
    const node = document.querySelector(
      `[data-wi-id="${focusedId}"]`,
    ) as HTMLElement | null;
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusedId]);

  // ── Mutations ───────────────────────────────────────────────────
  const upsertItem = (next: WorkItem) =>
    commit((b) => {
      const exists = b.items.some((i) => i.id === next.id);
      return {
        ...b,
        items: exists
          ? b.items.map((i) => (i.id === next.id ? next : i))
          : [...b.items, next],
      };
    });

  const removeItem = (id: string) =>
    commit((b) => {
      // Also re-parent any children to the deleted card's parent so
      // we don't orphan them.
      const dropped = b.items.find((i) => i.id === id);
      const newParent = dropped?.parent ?? null;
      return {
        ...b,
        items: b.items
          .filter((i) => i.id !== id)
          .map((i) => (i.parent === id ? { ...i, parent: newParent } : i)),
      };
    });

  const toggleDone = (id: string) =>
    commit((b) => ({
      ...b,
      items: b.items.map((i) => (i.id === id ? { ...i, done: !i.done } : i)),
    }));

  const moveItemTo = (id: string, columnId: string, beforeId?: string) =>
    commit((b) => {
      const item = b.items.find((i) => i.id === id);
      if (!item) return b;
      const without = b.items.filter((i) => i.id !== id);
      const updated = { ...item, column: columnId };
      if (!beforeId) return { ...b, items: [...without, updated] };
      const idx = without.findIndex((i) => i.id === beforeId);
      if (idx < 0) return { ...b, items: [...without, updated] };
      const next = [...without];
      next.splice(idx, 0, updated);
      return { ...b, items: next };
    });

  const reorderColumns = (oldId: string, newId: string) =>
    commit((b) => {
      const oldIdx = b.columns.findIndex((c) => c.id === oldId);
      const newIdx = b.columns.findIndex((c) => c.id === newId);
      if (oldIdx < 0 || newIdx < 0 || oldIdx === newIdx) return b;
      return { ...b, columns: arrayMove(b.columns, oldIdx, newIdx) };
    });

  const addColumn = () =>
    commit((b) => ({
      ...b,
      columns: [...b.columns, { id: `col-${shortId()}`, name: "New column" }],
    }));

  // ── Filtering ───────────────────────────────────────────────────
  const activeFilter = React.useMemo(
    () => board.filters.find((f) => f.id === activeFilterId) ?? null,
    [activeFilterId, board.filters],
  );

  const visibleItems = React.useMemo(() => {
    if (!activeFilter) return board.items;
    const pred = compileFilter(activeFilter.expression);
    if (!pred) return board.items;
    return board.items.filter((card) => {
      try {
        return Boolean(pred(card));
      } catch {
        return true;
      }
    });
  }, [activeFilter, board.items]);

  // When a filter hides a parent but matches a child, surface the
  // ancestors so the user can still see the hierarchy context.
  const renderableItems = React.useMemo(() => {
    if (visibleItems === board.items) return visibleItems;
    const ids = new Set(visibleItems.map((i) => i.id));
    const byId = new Map(board.items.map((i) => [i.id, i]));
    for (const i of visibleItems) {
      let cur: WorkItem | undefined = i;
      while (cur?.parent) {
        const p = byId.get(cur.parent);
        if (!p || ids.has(p.id)) break;
        ids.add(p.id);
        cur = p;
      }
    }
    return board.items.filter((i) => ids.has(i.id));
  }, [visibleItems, board.items]);

  // ── DnD ─────────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const [activeId, setActiveId] = React.useState<string | null>(null);
  const activeCard = React.useMemo<WorkItem | null>(() => {
    if (!activeId) return null;
    const parsed = parseDndId(activeId);
    if (!parsed || parsed.kind !== "card") return null;
    return board.items.find((i) => i.id === parsed.id) ?? null;
  }, [activeId, board.items]);

  const handleDragStart = (e: DragStartEvent) =>
    setActiveId(String(e.active.id));

  const handleDragOver = (e: DragOverEvent) => {
    const { active, over } = e;
    if (!over) return;
    const activeParsed = parseDndId(String(active.id));
    if (!activeParsed || activeParsed.kind !== "card") return;
    const overParsed = parseDndId(String(over.id));
    if (!overParsed) return;

    const movingCard = board.items.find((i) => i.id === activeParsed.id);
    if (!movingCard) return;
    const targetCol =
      overParsed.kind === "col"
        ? overParsed.id
        : board.items.find((i) => i.id === overParsed.id)?.column;
    if (!targetCol || movingCard.column === targetCol) return;
    moveItemTo(movingCard.id, targetCol);
  };

  const handleDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const activeParsed = parseDndId(String(active.id));
    const overParsed = parseDndId(String(over.id));
    if (!activeParsed || !overParsed) return;

    if (activeParsed.kind === "col" && overParsed.kind === "col") {
      reorderColumns(activeParsed.id, overParsed.id);
      return;
    }
    if (activeParsed.kind === "card") {
      const card = board.items.find((i) => i.id === activeParsed.id);
      if (!card) return;
      const targetCol =
        overParsed.kind === "col"
          ? overParsed.id
          : board.items.find((i) => i.id === overParsed.id)?.column ??
            card.column;
      const beforeId =
        overParsed.kind === "card" && overParsed.id !== activeParsed.id
          ? overParsed.id
          : undefined;
      moveItemTo(card.id, targetCol, beforeId);
    }
  };

  const collisionDetection: CollisionDetection = closestCorners;

  // ── Swimlane partition ──────────────────────────────────────────
  const swimlaneDef = React.useMemo<FieldDef | null>(() => {
    if (swimlaneField === NO_SWIMLANE) return null;
    for (const t of board.itemTypes) {
      const f = t.fields.find((x) => x.id === swimlaneField);
      if (f) return f;
    }
    return null;
  }, [swimlaneField, board.itemTypes]);

  const lanes = React.useMemo(() => {
    if (!swimlaneDef) return [{ key: "__all", label: "" }];
    const keys = new Set<string>();
    for (const it of renderableItems) {
      const v = it.fields[swimlaneDef.id];
      if (Array.isArray(v)) v.forEach((x) => keys.add(String(x)));
      else if (v === undefined || v === null || v === "") keys.add("");
      else keys.add(String(v));
    }
    if (keys.size === 0) keys.add("");
    return Array.from(keys).map((k) => ({
      key: k,
      label: k === "" ? "(no value)" : k,
    }));
  }, [swimlaneDef, renderableItems]);

  const cardsInLane = React.useCallback(
    (laneKey: string, columnId: string): WorkItem[] => {
      const all = renderableItems.filter((i) => i.column === columnId);
      if (!swimlaneDef) return all;
      return all.filter((it) => {
        const v = it.fields[swimlaneDef.id];
        if (Array.isArray(v)) return v.map(String).includes(laneKey);
        if (v === undefined || v === null || v === "") return laneKey === "";
        return String(v) === laneKey;
      });
    },
    [renderableItems, swimlaneDef],
  );

  // ── Render ──────────────────────────────────────────────────────
  if (migrating) {
    return (
      <PluginPaneLayout
        title={<span className="text-[12.5px]">Migrating board…</span>}
      >
        <div className="flex items-center justify-center h-full text-[12.5px] text-muted-foreground">
          Converting&nbsp;<code>{props.path}</code>&nbsp;→&nbsp;
          <code>{targetBoardPath(props.path)}</code>
        </div>
      </PluginPaneLayout>
    );
  }

  const swimlaneFieldOptions = collectSchemaFields(board);
  const itemTypeIndex = new Map(board.itemTypes.map((t) => [t.id, t]));
  // Count children per item — drives the chevron badges + collapse.
  const childCount = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const it of board.items) {
      if (it.parent) m.set(it.parent, (m.get(it.parent) ?? 0) + 1);
    }
    return m;
  }, [board.items]);

  return (
    <PluginPaneLayout
      title={
        <Input
          value={board.title}
          onChange={(e) => commit((b) => ({ ...b, title: e.target.value }))}
          className="h-7 border-0 bg-transparent text-[13px] font-medium tracking-tight px-0 shadow-none focus-visible:ring-0"
          placeholder="Untitled board"
        />
      }
      actions={
        <div className="flex items-center gap-1.5">
          {board.filters.length > 0 && (
            <Select value={activeFilterId} onValueChange={setActiveFilterId}>
              <SelectTrigger
                className="h-7 gap-1.5 text-[11.5px] w-auto min-w-[140px]"
                aria-label="Filter"
              >
                <Filter className="w-3 h-3" />
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_FILTER} className="text-[12px]">
                  No filter
                </SelectItem>
                {board.filters.map((f) => (
                  <SelectItem key={f.id} value={f.id} className="text-[12px]">
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {swimlaneFieldOptions.length > 0 && (
            <Select
              value={swimlaneField}
              onValueChange={(v) => {
                setSwimlaneField(v);
                commit((b) => ({
                  ...b,
                  swimlaneField: v === NO_SWIMLANE ? undefined : v,
                }));
              }}
            >
              <SelectTrigger
                className="h-7 gap-1.5 text-[11.5px] w-auto min-w-[150px]"
                aria-label="Swimlane"
              >
                <SelectValue placeholder="No swimlane" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_SWIMLANE} className="text-[12px]">
                  No swimlane
                </SelectItem>
                {swimlaneFieldOptions.map((f) => (
                  <SelectItem key={f.id} value={f.id} className="text-[12px]">
                    Swimlane: {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSettingsOpen(true)}
            className="h-7 gap-1.5 text-[11.5px]"
            aria-label="Board settings"
          >
            <Settings2 className="w-3.5 h-3.5" />
            Settings
          </Button>
        </div>
      }
      bodyClassName="bg-background"
    >
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <div className="flex-1 min-h-0 min-w-0 overflow-auto">
          <div className="flex flex-col gap-4 p-4 min-w-min">
            {lanes.map((lane, laneIdx) => (
              <div key={lane.key} className="flex flex-col gap-2">
                {swimlaneDef && (
                  <div className="flex items-center gap-2 px-1">
                    <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      {swimlaneDef.label}
                    </span>
                    <span className="text-[12px] font-medium">{lane.label}</span>
                    <span className="h-px flex-1 bg-border/60" />
                  </div>
                )}

                <div className="flex items-start gap-3 min-w-min">
                  <SortableContext
                    items={board.columns.map((c) => colDndId(c.id))}
                    strategy={verticalListSortingStrategy}
                  >
                    {board.columns.map((col) => (
                      <Column
                        key={col.id + lane.key}
                        column={col}
                        cards={cardsInLane(lane.key, col.id)}
                        itemTypeIndex={itemTypeIndex}
                        childCount={childCount}
                        collapsed={collapsed}
                        toggleCollapsed={toggleCollapsed}
                        focusedId={focusedId}
                        showColumnDragHandle={laneIdx === 0}
                        onAddCard={() =>
                          setEditor({
                            columnId: col.id,
                            card: undefined,
                            parentId: null,
                          })
                        }
                        onOpenCard={(card) =>
                          setEditor({ card, columnId: card.column })
                        }
                        onAddChild={(parent) =>
                          setEditor({
                            columnId: parent.column,
                            parentId: parent.id,
                            card: undefined,
                          })
                        }
                        onToggleDone={(id) => toggleDone(id)}
                      />
                    ))}
                  </SortableContext>

                  {laneIdx === 0 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={addColumn}
                      className="h-7 self-start mt-1 gap-1.5 text-[11.5px]"
                    >
                      <Plus className="w-3 h-3" /> Column
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <DragOverlay
          dropAnimation={{
            duration: 180,
            easing: "cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        >
          {activeCard ? (
            <CardSurface
              card={activeCard}
              itemType={itemTypeIndex.get(activeCard.type)}
              childCount={childCount.get(activeCard.id) ?? 0}
              dragging
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      <CardEditor
        open={!!editor}
        onOpenChange={(open) => !open && setEditor(null)}
        board={board}
        card={editor?.card}
        initialColumnId={editor?.columnId}
        initialParentId={editor?.parentId ?? null}
        onSave={upsertItem}
        onDelete={removeItem}
      />

      <BoardSettings
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        board={board}
        onApply={(next) => commit(next)}
      />
    </PluginPaneLayout>
  );
}

// ── Column ──────────────────────────────────────────────────────────

interface ColumnProps {
  column: ColumnDef;
  cards: WorkItem[];
  itemTypeIndex: Map<string, ItemType>;
  childCount: Map<string, number>;
  collapsed: Set<string>;
  toggleCollapsed: (id: string) => void;
  focusedId: string | null;
  showColumnDragHandle: boolean;
  onAddCard: () => void;
  onOpenCard: (card: WorkItem) => void;
  onAddChild: (parent: WorkItem) => void;
  onToggleDone: (id: string) => void;
}

function Column({
  column,
  cards,
  itemTypeIndex,
  childCount,
  collapsed,
  toggleCollapsed,
  focusedId,
  showColumnDragHandle,
  onAddCard,
  onOpenCard,
  onAddChild,
  onToggleDone,
}: ColumnProps) {
  const sortable = useSortable({
    id: colDndId(column.id),
    data: { type: "column" },
    disabled: !showColumnDragHandle,
  });
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = sortable;

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.55 : undefined,
  };
  const overLimit = column.wip !== undefined && cards.length >= column.wip;

  // Build the parent-first ordering with children indented under
  // their parent. Cards whose parent is not in this column show at
  // the root (we don't pull the parent into this column for them).
  const ordered = orderWithChildren(cards);
  const isHidden = (card: WorkItem): boolean => {
    let cur: WorkItem | undefined = card;
    while (cur?.parent) {
      const parent = cards.find((c) => c.id === cur!.parent);
      if (!parent) break;
      if (collapsed.has(parent.id)) return true;
      cur = parent;
    }
    return false;
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex flex-col w-[320px] shrink-0 max-h-[calc(100vh-200px)] rounded-lg bg-muted/40 border border-border/60"
    >
      <div className="group flex items-center gap-1 h-[30px] px-2 shrink-0 border-b border-border/60">
        {showColumnDragHandle ? (
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label="Drag column"
            className="opacity-0 group-hover:opacity-60 hover:opacity-100 -ml-1 p-0.5 rounded cursor-grab active:cursor-grabbing text-muted-foreground"
          >
            <GripVertical className="w-3 h-3" />
          </button>
        ) : (
          <span className="w-3.5" />
        )}
        <span className="flex-1 px-1 text-[12px] font-medium tracking-tight truncate">
          {column.name}
        </span>
        <Badge
          variant={overLimit ? "destructive" : "secondary"}
          className="h-5 px-1.5 text-[10px] font-mono tabular-nums"
        >
          {cards.length}
          {column.wip ? `/${column.wip}` : ""}
        </Badge>
      </div>

      <SortableContext
        items={ordered.map((c) => cardDndId(c.id))}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex-1 min-h-[80px] overflow-y-auto p-2 flex flex-col gap-1.5">
          {ordered.map((card) => {
            if (isHidden(card)) return null;
            const depth = depthOf(card, cards);
            return (
              <SortableCard
                key={card.id}
                card={card}
                itemType={itemTypeIndex.get(card.type)}
                depth={depth}
                childCount={childCount.get(card.id) ?? 0}
                collapsed={collapsed.has(card.id)}
                focused={focusedId === card.id}
                onToggleCollapsed={() => toggleCollapsed(card.id)}
                onOpen={() => onOpenCard(card)}
                onAddChild={() => onAddChild(card)}
                onToggleDone={() => onToggleDone(card.id)}
              />
            );
          })}
          <Button
            variant="ghost"
            size="sm"
            onClick={onAddCard}
            className="h-7 justify-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <Plus className="w-3 h-3" /> Add item
          </Button>
        </div>
      </SortableContext>
    </div>
  );
}

// ── Card ────────────────────────────────────────────────────────────

interface CardSurfaceProps {
  card: WorkItem;
  itemType?: ItemType;
  depth?: number;
  childCount?: number;
  collapsed?: boolean;
  dragging?: boolean;
  /** Flash-highlight when another view focuses this card by id. */
  focused?: boolean;
  onOpen?: () => void;
  onAddChild?: () => void;
  onToggleCollapsed?: () => void;
  onToggleDone?: () => void;
}

function CardSurface({
  card,
  itemType,
  depth = 0,
  childCount = 0,
  collapsed,
  dragging,
  focused,
  onOpen,
  onAddChild,
  onToggleCollapsed,
  onToggleDone,
}: CardSurfaceProps) {
  const isOverdue = computeOverdue(card);
  const visibleFields = (itemType?.fields ?? [])
    .filter((f) => f.showOnCard)
    .slice(0, 4);

  return (
    <div
      data-wi-id={card.id}
      className={
        "group rounded-md border bg-card text-card-foreground " +
        (dragging
          ? "border-border/60 shadow-lg ring-2 ring-primary/40 cursor-grabbing"
          : focused
            ? "border-primary/60 ring-2 ring-primary/40 transition-colors cursor-pointer"
            : "border-border/60 hover:border-border transition-colors cursor-pointer")
      }
      style={{
        marginLeft: depth * 16,
        ...(itemType?.color
          ? { borderLeft: `3px solid ${itemType.color}` }
          : {}),
      }}
      role="button"
      tabIndex={0}
      onClick={() => onOpen?.()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onOpen?.();
        }
      }}
    >
      <div className="flex items-start gap-1.5 p-2 pl-2.5">
        {childCount > 0 ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapsed?.();
            }}
            className="mt-[2px] h-4 w-4 grid place-items-center rounded hover:bg-accent text-muted-foreground"
            aria-label={collapsed ? "Expand children" : "Collapse children"}
          >
            {collapsed ? (
              <ChevronRight className="w-3 h-3" />
            ) : (
              <ChevronDown className="w-3 h-3" />
            )}
          </button>
        ) : (
          <span className="mt-[2px] h-4 w-4" />
        )}

        <input
          type="checkbox"
          checked={card.done}
          onChange={(e) => {
            e.stopPropagation();
            onToggleDone?.();
          }}
          onClick={(e) => e.stopPropagation()}
          className="mt-[5px] h-3 w-3 accent-primary cursor-pointer"
          aria-label={card.done ? "Mark not done" : "Mark done"}
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {itemType && (
              <Badge
                variant="outline"
                className="h-[15px] px-1 text-[9.5px] uppercase tracking-wider font-mono shrink-0"
                style={
                  itemType.color
                    ? { borderColor: itemType.color, color: itemType.color }
                    : undefined
                }
              >
                {itemType.name}
              </Badge>
            )}
            {childCount > 0 && (
              <Badge
                variant="secondary"
                className="h-[15px] px-1 text-[9.5px] gap-0.5"
                title={`${childCount} child item(s)`}
              >
                <GitBranch className="w-2.5 h-2.5" /> {childCount}
              </Badge>
            )}
            {isOverdue && (
              <Badge
                variant="destructive"
                className="h-[15px] px-1 text-[9.5px] gap-0.5"
                title="Overdue"
              >
                <AlertTriangle className="w-2.5 h-2.5" /> Overdue
              </Badge>
            )}
          </div>
          <div
            className={
              "text-[12.5px] leading-snug mt-1 " +
              (card.done ? "line-through text-muted-foreground" : "")
            }
          >
            {card.title || "(untitled)"}
          </div>

          {visibleFields.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {visibleFields.map((f) => {
                const v = card.fields[f.id];
                if (v === undefined || v === null || v === "") return null;
                const display = Array.isArray(v) ? v.join(", ") : String(v);
                return (
                  <Badge
                    key={f.id}
                    variant="secondary"
                    className="h-[15px] px-1.5 text-[10px] font-normal"
                    title={f.label}
                  >
                    <span className="text-muted-foreground mr-1">
                      {f.label}:
                    </span>
                    {display}
                  </Badge>
                );
              })}
            </div>
          )}

          {card.sources && card.sources.length > 0 && (
            <div className="mt-1 text-[10px] text-muted-foreground truncate">
              ↳ Linked from {card.sources.length} note
              {card.sources.length === 1 ? "" : "s"}
            </div>
          )}
        </div>

        {!dragging && onAddChild && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAddChild();
            }}
            className="opacity-0 group-hover:opacity-60 hover:!opacity-100 h-5 w-5 grid place-items-center rounded text-muted-foreground hover:bg-accent"
            aria-label="Add child item"
            title="Add child item"
          >
            <Plus className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
}

function SortableCard(props: {
  card: WorkItem;
  itemType?: ItemType;
  depth: number;
  childCount: number;
  collapsed: boolean;
  focused: boolean;
  onToggleCollapsed: () => void;
  onOpen: () => void;
  onAddChild: () => void;
  onToggleDone: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: cardDndId(props.card.id),
    data: { type: "card" },
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0 : undefined,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <CardSurface
        card={props.card}
        itemType={props.itemType}
        depth={props.depth}
        childCount={props.childCount}
        collapsed={props.collapsed}
        focused={props.focused}
        onToggleCollapsed={props.onToggleCollapsed}
        onOpen={props.onOpen}
        onAddChild={props.onAddChild}
        onToggleDone={props.onToggleDone}
      />
    </div>
  );
}

// ── helpers ────────────────────────────────────────────────────────

/** Group siblings under their parent (DFS); roots first, children
 *  immediately after their parent. Roots include any card whose
 *  parent isn't in this column (we render it at depth 0 to keep
 *  cross-column families visible). */
function orderWithChildren(cards: WorkItem[]): WorkItem[] {
  const localIds = new Set(cards.map((c) => c.id));
  const childrenOf = new Map<string | null, WorkItem[]>();
  for (const c of cards) {
    const key =
      c.parent && localIds.has(c.parent) ? c.parent : null;
    if (!childrenOf.has(key)) childrenOf.set(key, []);
    childrenOf.get(key)!.push(c);
  }
  const out: WorkItem[] = [];
  function walk(parentId: string | null) {
    for (const c of childrenOf.get(parentId) ?? []) {
      out.push(c);
      walk(c.id);
    }
  }
  walk(null);
  return out;
}

function depthOf(card: WorkItem, cards: WorkItem[]): number {
  let depth = 0;
  let cur: WorkItem | undefined = card;
  while (cur?.parent) {
    const parent = cards.find((c) => c.id === cur!.parent);
    if (!parent) break;
    depth++;
    if (depth > 10) break; // hard cap; broken parent chain
    cur = parent;
  }
  return depth;
}

function collectSchemaFields(board: KanbanBoard): FieldDef[] {
  const seen = new Set<string>();
  const out: FieldDef[] = [];
  for (const t of board.itemTypes) {
    for (const f of t.fields) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      out.push(f);
    }
  }
  return out;
}

function computeOverdue(card: WorkItem): boolean {
  if (card.done) return false;
  const due = card.fields.due;
  if (typeof due !== "string" || !due) return false;
  const t = Date.parse(due);
  if (Number.isNaN(t)) return false;
  return t < Date.now() - 864e5;
}

const COMPILE_CACHE = new Map<string, ((card: WorkItem) => boolean) | null>();
function compileFilter(
  expression: string,
): ((card: WorkItem) => boolean) | null {
  if (COMPILE_CACHE.has(expression)) return COMPILE_CACHE.get(expression)!;
  let fn: ((card: WorkItem) => boolean) | null;
  try {
    // User-authored expression. Same trust boundary as the vault.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const compiled = new Function(
      "card",
      "const { fields = {}, done, column, type, title, parent } = card;" +
        " return (" + expression + ");",
    ) as (card: WorkItem) => boolean;
    fn = compiled;
  } catch {
    fn = null;
  }
  COMPILE_CACHE.set(expression, fn);
  return fn;
}
