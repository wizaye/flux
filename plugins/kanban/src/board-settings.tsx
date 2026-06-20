/**
 * Board settings — full schema editor opened from the board
 * toolbar.
 *
 * Three tabs:
 *   • Columns — rename / reorder / WIP / add / remove + default
 *     item type + swimlane field.
 *   • Work item types — name / icon / color, field editor per type
 *     (label / id / type / required / show-on-card / options /
 *     default value).
 *   • Saved filters — name + JS-style boolean expression.
 *
 * Mutates a local draft; "Apply" emits the patched board, "Cancel"
 * discards. Cards orphaned by a removed column / type are reassigned
 * to a fallback so we never lose work-item data.
 */
import * as React from "react";
import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  Plus,
  Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { shortId } from "./schema";
import type {
  ColumnDef,
  FieldDef,
  FieldType,
  FieldValue,
  ItemType,
  KanbanBoard,
} from "./schema";

const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "textarea", label: "Long text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "select", label: "Single select" },
  { value: "multiselect", label: "Multi select" },
  { value: "checkbox", label: "Checkbox" },
  { value: "user", label: "User" },
];

const TAB_KEYS = ["columns", "types", "filters"] as const;
type TabKey = (typeof TAB_KEYS)[number];

interface BoardSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  board: KanbanBoard;
  onApply: (next: KanbanBoard) => void;
}

export function BoardSettings({
  open,
  onOpenChange,
  board,
  onApply,
}: BoardSettingsProps) {
  const [draft, setDraft] = React.useState<KanbanBoard>(board);
  const [tab, setTab] = React.useState<TabKey>("columns");
  const [activeTypeIdx, setActiveTypeIdx] = React.useState(0);

  React.useEffect(() => {
    if (open) {
      setDraft(structuredClone(board));
      setTab("columns");
      setActiveTypeIdx(0);
    }
  }, [open, board]);

  const apply = () => {
    onApply(sanitiseBoard(draft));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[800px]">
        <DialogHeader>
          <DialogTitle>Board settings</DialogTitle>
          <DialogDescription>
            Customise columns, work item types, fields and saved filters.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-1 border-b border-border/60">
          {TAB_KEYS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={
                "h-8 px-3 text-[13px] -mb-px border-b-2 transition-colors " +
                (tab === k
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground")
              }
            >
              {labelFor(k)}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-3 max-h-[60vh] overflow-y-auto pr-1 text-[13px]">
          {tab === "columns" && (
            <ColumnsTab draft={draft} setDraft={setDraft} />
          )}
          {tab === "types" && (
            <TypesTab
              draft={draft}
              setDraft={setDraft}
              activeIdx={activeTypeIdx}
              setActiveIdx={setActiveTypeIdx}
            />
          )}
          {tab === "filters" && (
            <FiltersTab draft={draft} setDraft={setDraft} />
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={apply}>Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Columns ────────────────────────────────────────────────────────

function ColumnsTab({
  draft,
  setDraft,
}: {
  draft: KanbanBoard;
  setDraft: React.Dispatch<React.SetStateAction<KanbanBoard>>;
}) {
  const updateCol = (idx: number, patch: Partial<ColumnDef>) =>
    setDraft((d) => ({
      ...d,
      columns: d.columns.map((c, i) => (i === idx ? { ...c, ...patch } : c)),
    }));

  const move = (idx: number, dir: -1 | 1) =>
    setDraft((d) => {
      const next = [...d.columns];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return d;
      [next[idx], next[target]] = [next[target], next[idx]];
      return { ...d, columns: next };
    });

  const remove = (idx: number) =>
    setDraft((d) => {
      if (d.columns.length <= 1) return d;
      const dropped = d.columns[idx];
      const fallback = d.columns[idx === 0 ? 1 : 0].id;
      return {
        ...d,
        columns: d.columns.filter((_, i) => i !== idx),
        items: d.items.map((it) =>
          it.column === dropped.id ? { ...it, column: fallback } : it,
        ),
      };
    });

  const add = () =>
    setDraft((d) => ({
      ...d,
      columns: [
        ...d.columns,
        { id: `col-${shortId()}`, name: "New column" },
      ],
    }));

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] text-muted-foreground">
        Columns appear left → right on the board. Removing a column
        moves its cards to the first remaining column.
      </p>
      <ul className="flex flex-col gap-1.5">
        {draft.columns.map((col, idx) => (
          <li
            key={col.id}
            className="flex items-center gap-2 px-2 py-1.5 rounded-md border border-border/60 bg-card"
          >
            <button
              type="button"
              onClick={() => move(idx, -1)}
              disabled={idx === 0}
              className="h-6 w-6 grid place-items-center text-muted-foreground disabled:opacity-30 hover:text-foreground"
              aria-label="Move up"
            >
              <ChevronUp className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={() => move(idx, 1)}
              disabled={idx === draft.columns.length - 1}
              className="h-6 w-6 grid place-items-center text-muted-foreground disabled:opacity-30 hover:text-foreground"
              aria-label="Move down"
            >
              <ChevronDown className="w-3 h-3" />
            </button>
            <Input
              value={col.name}
              onChange={(e) => updateCol(idx, { name: e.target.value })}
              placeholder="Column name"
              className="h-7 text-[12.5px]"
            />
            <Input
              type="number"
              inputMode="numeric"
              placeholder="WIP"
              value={col.wip ?? ""}
              onChange={(e) =>
                updateCol(idx, {
                  wip: e.target.value ? Number(e.target.value) : undefined,
                })
              }
              className="h-7 w-[80px] text-[12.5px]"
              aria-label="WIP limit"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => remove(idx)}
              disabled={draft.columns.length <= 1}
              className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
              aria-label="Remove column"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </li>
        ))}
      </ul>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={add}
        className="h-7 self-start text-[12px] gap-1.5"
      >
        <Plus className="w-3 h-3" /> Add column
      </Button>

      <div className="grid grid-cols-2 gap-3 pt-3 border-t border-border/60 mt-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted-foreground">
            Default item type
          </span>
          <Select
            value={draft.defaultItemType}
            onValueChange={(v) =>
              setDraft((d) => ({ ...d, defaultItemType: v }))
            }
          >
            <SelectTrigger className="h-7 text-[12.5px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {draft.itemTypes.map((t) => (
                <SelectItem key={t.id} value={t.id} className="text-[12.5px]">
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted-foreground">
            Swimlane (group rows by)
          </span>
          <Select
            value={draft.swimlaneField ?? "__none"}
            onValueChange={(v) =>
              setDraft((d) => ({
                ...d,
                swimlaneField: v === "__none" ? undefined : v,
              }))
            }
          >
            <SelectTrigger className="h-7 text-[12.5px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none" className="text-[12.5px]">
                None
              </SelectItem>
              {allFields(draft).map((f) => (
                <SelectItem key={f.id} value={f.id} className="text-[12.5px]">
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>
    </div>
  );
}

// ── Types ──────────────────────────────────────────────────────────

function TypesTab({
  draft,
  setDraft,
  activeIdx,
  setActiveIdx,
}: {
  draft: KanbanBoard;
  setDraft: React.Dispatch<React.SetStateAction<KanbanBoard>>;
  activeIdx: number;
  setActiveIdx: (n: number) => void;
}) {
  const active = draft.itemTypes[activeIdx] ?? draft.itemTypes[0];

  const updateType = (idx: number, patch: Partial<ItemType>) =>
    setDraft((d) => ({
      ...d,
      itemTypes: d.itemTypes.map((t, i) =>
        i === idx ? { ...t, ...patch } : t,
      ),
    }));

  const addType = () =>
    setDraft((d) => ({
      ...d,
      itemTypes: [
        ...d.itemTypes,
        {
          id: `type-${shortId()}`,
          name: "New type",
          icon: "square-check-big",
          color: "#94a3b8",
          fields: [],
        },
      ],
    }));

  const removeType = (idx: number) =>
    setDraft((d) => {
      if (d.itemTypes.length <= 1) return d;
      const dropped = d.itemTypes[idx];
      const fallback =
        d.itemTypes.find((_, i) => i !== idx)?.id ?? d.defaultItemType;
      return {
        ...d,
        itemTypes: d.itemTypes.filter((_, i) => i !== idx),
        defaultItemType:
          d.defaultItemType === dropped.id ? fallback : d.defaultItemType,
        items: d.items.map((it) =>
          it.type === dropped.id ? { ...it, type: fallback } : it,
        ),
      };
    });

  const updateField = (fieldIdx: number, patch: Partial<FieldDef>) =>
    updateType(activeIdx, {
      fields: active.fields.map((f, i) =>
        i === fieldIdx ? { ...f, ...patch } : f,
      ),
    });

  const moveField = (fieldIdx: number, dir: -1 | 1) => {
    const next = [...active.fields];
    const target = fieldIdx + dir;
    if (target < 0 || target >= next.length) return;
    [next[fieldIdx], next[target]] = [next[target], next[fieldIdx]];
    updateType(activeIdx, { fields: next });
  };

  const removeField = (fieldIdx: number) =>
    updateType(activeIdx, {
      fields: active.fields.filter((_, i) => i !== fieldIdx),
    });

  const addField = () =>
    updateType(activeIdx, {
      fields: [
        ...active.fields,
        { id: `field-${shortId()}`, label: "New field", type: "text" },
      ],
    });

  return (
    <div className="grid grid-cols-[180px_1fr] gap-3">
      <div className="flex flex-col gap-1 border-r border-border/60 pr-2">
        {draft.itemTypes.map((t, i) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActiveIdx(i)}
            className={
              "flex items-center gap-2 h-7 px-2 rounded-md text-[12.5px] " +
              (i === activeIdx ? "bg-accent" : "hover:bg-accent/60")
            }
          >
            <span
              aria-hidden
              className="inline-block h-2 w-2 rounded-sm"
              style={{ background: t.color ?? "currentColor" }}
            />
            <span className="truncate flex-1 text-left">{t.name}</span>
          </button>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addType}
          className="h-7 text-[12px] gap-1.5 mt-1"
        >
          <Plus className="w-3 h-3" /> Add type
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-[1fr_120px_44px_36px] gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-muted-foreground">Name</span>
            <Input
              value={active.name}
              onChange={(e) => updateType(activeIdx, { name: e.target.value })}
              className="h-7 text-[12.5px]"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-muted-foreground">Icon</span>
            <Input
              value={active.icon ?? ""}
              onChange={(e) => updateType(activeIdx, { icon: e.target.value })}
              placeholder="lucide name"
              className="h-7 text-[12.5px]"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-muted-foreground">Color</span>
            <input
              type="color"
              value={active.color ?? "#94a3b8"}
              onChange={(e) => updateType(activeIdx, { color: e.target.value })}
              className="h-7 w-full rounded-md border border-input bg-background cursor-pointer p-0.5"
            />
          </label>
          <div className="flex items-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => removeType(activeIdx)}
              disabled={draft.itemTypes.length <= 1}
              className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
              aria-label="Remove type"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-1 pt-2 border-t border-border/60">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground uppercase tracking-wider">
              Fields
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addField}
              className="h-6 text-[11px] gap-1"
            >
              <Plus className="w-3 h-3" /> Field
            </Button>
          </div>
          <ul className="flex flex-col gap-1.5">
            {active.fields.map((field, fi) => (
              <li
                key={field.id}
                className="flex flex-col gap-1.5 p-2 rounded-md border border-border/60 bg-card"
              >
                <div className="flex items-center gap-2">
                  <GripVertical className="w-3 h-3 text-muted-foreground/60" />
                  <Input
                    value={field.label}
                    onChange={(e) => updateField(fi, { label: e.target.value })}
                    placeholder="Label"
                    className="h-7 text-[12.5px] flex-1"
                  />
                  <Input
                    value={field.id}
                    onChange={(e) =>
                      updateField(fi, { id: slugify(e.target.value) })
                    }
                    placeholder="id"
                    className="h-7 text-[11.5px] w-[120px] font-mono text-muted-foreground"
                  />
                  <Select
                    value={field.type}
                    onValueChange={(v) =>
                      updateField(fi, { type: v as FieldType })
                    }
                  >
                    <SelectTrigger className="h-7 w-[130px] text-[12px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FIELD_TYPES.map((ft) => (
                        <SelectItem key={ft.value} value={ft.value} className="text-[12px]">
                          {ft.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex flex-col">
                    <button
                      type="button"
                      onClick={() => moveField(fi, -1)}
                      disabled={fi === 0}
                      className="h-3.5 w-5 grid place-items-center text-muted-foreground disabled:opacity-30 hover:text-foreground"
                      aria-label="Move field up"
                    >
                      <ChevronUp className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveField(fi, 1)}
                      disabled={fi === active.fields.length - 1}
                      className="h-3.5 w-5 grid place-items-center text-muted-foreground disabled:opacity-30 hover:text-foreground"
                      aria-label="Move field down"
                    >
                      <ChevronDown className="w-3 h-3" />
                    </button>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeField(fi)}
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                    aria-label="Remove field"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>

                <div className="flex items-center gap-3 pl-5 text-[11.5px]">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <Checkbox
                      checked={!!field.required}
                      onCheckedChange={(v) =>
                        updateField(fi, { required: v === true })
                      }
                    />
                    Required
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <Checkbox
                      checked={!!field.showOnCard}
                      onCheckedChange={(v) =>
                        updateField(fi, { showOnCard: v === true })
                      }
                    />
                    Show on card
                  </label>
                  {(field.type === "select" || field.type === "multiselect") && (
                    <Input
                      placeholder="Options (comma separated)"
                      value={(field.options ?? []).join(", ")}
                      onChange={(e) =>
                        updateField(fi, {
                          options: e.target.value
                            .split(",")
                            .map((s) => s.trim())
                            .filter(Boolean),
                        })
                      }
                      className="h-7 flex-1 text-[12px]"
                    />
                  )}
                  <Input
                    placeholder="Default value"
                    value={defaultForInput(field)}
                    onChange={(e) =>
                      updateField(fi, {
                        defaultValue: parseDefaultForInput(field, e.target.value),
                      })
                    }
                    className="h-7 w-[160px] text-[12px]"
                  />
                </div>
                {field.hint && (
                  <Badge variant="outline" className="self-start text-[10px]">
                    hint: {field.hint}
                  </Badge>
                )}
              </li>
            ))}
            {active.fields.length === 0 && (
              <li className="text-[11.5px] text-muted-foreground px-2 py-3 text-center border border-dashed border-border/60 rounded-md">
                No fields yet. Add one above.
              </li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}

// ── Filters ────────────────────────────────────────────────────────

function FiltersTab({
  draft,
  setDraft,
}: {
  draft: KanbanBoard;
  setDraft: React.Dispatch<React.SetStateAction<KanbanBoard>>;
}) {
  const update = (idx: number, patch: Partial<KanbanBoard["filters"][number]>) =>
    setDraft((d) => ({
      ...d,
      filters: d.filters.map((f, i) => (i === idx ? { ...f, ...patch } : f)),
    }));

  const add = () =>
    setDraft((d) => ({
      ...d,
      filters: [
        ...d.filters,
        { id: `filter-${shortId()}`, name: "New filter", expression: "true" },
      ],
    }));

  const remove = (idx: number) =>
    setDraft((d) => ({
      ...d,
      filters: d.filters.filter((_, i) => i !== idx),
    }));

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] text-muted-foreground">
        Expressions are evaluated against <code>card</code>. Available
        identifiers: <code>fields</code>, <code>done</code>,{" "}
        <code>column</code>, <code>type</code>, <code>title</code>,{" "}
        <code>parent</code>.
      </p>
      <ul className="flex flex-col gap-1.5">
        {draft.filters.map((filter, idx) => (
          <li
            key={filter.id}
            className="flex items-center gap-2 p-2 rounded-md border border-border/60 bg-card"
          >
            <Input
              value={filter.name}
              onChange={(e) => update(idx, { name: e.target.value })}
              placeholder="Filter name"
              className="h-7 w-[180px] text-[12.5px]"
            />
            <Input
              value={filter.expression}
              onChange={(e) => update(idx, { expression: e.target.value })}
              placeholder="e.g. fields.priority === 'High'"
              className="h-7 flex-1 text-[12px] font-mono"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => remove(idx)}
              className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
              aria-label="Remove filter"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </li>
        ))}
      </ul>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={add}
        className="h-7 self-start text-[12px] gap-1.5"
      >
        <Plus className="w-3 h-3" /> Add filter
      </Button>
    </div>
  );
}

// ── helpers ────────────────────────────────────────────────────────

function labelFor(k: TabKey): string {
  switch (k) {
    case "columns":
      return "Columns";
    case "types":
      return "Work item types";
    case "filters":
      return "Saved filters";
  }
}

function allFields(board: KanbanBoard): FieldDef[] {
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

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-|-$/g, "") || "field";
}

function defaultForInput(f: FieldDef): string {
  const v = f.defaultValue;
  if (v === undefined || v === null) return "";
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}

function parseDefaultForInput(f: FieldDef, raw: string): FieldValue {
  if (raw === "") return undefined;
  switch (f.type) {
    case "number": {
      const n = Number(raw);
      return Number.isFinite(n) ? n : undefined;
    }
    case "checkbox":
      return raw === "true" || raw === "1";
    case "multiselect":
      return raw.split(",").map((s) => s.trim()).filter(Boolean);
    default:
      return raw;
  }
}

function sanitiseBoard(b: KanbanBoard): KanbanBoard {
  const validColIds = new Set(b.columns.map((c) => c.id));
  const validTypeIds = new Set(b.itemTypes.map((t) => t.id));
  const validItemIds = new Set(b.items.map((it) => it.id));
  const fallbackCol = b.columns[0]?.id;
  const fallbackType = validTypeIds.has(b.defaultItemType)
    ? b.defaultItemType
    : b.itemTypes[0]?.id ?? "task";

  return {
    ...b,
    defaultItemType: fallbackType,
    items: b.items.map((it) => ({
      ...it,
      column: validColIds.has(it.column)
        ? it.column
        : fallbackCol ?? it.column,
      type: validTypeIds.has(it.type) ? it.type : fallbackType,
      parent:
        it.parent && validItemIds.has(it.parent) ? it.parent : null,
    })),
  };
}
