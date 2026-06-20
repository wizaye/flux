/**
 * Card editor — per-work-item modal. Dynamic inputs per
 * `FieldDef`, required validation, type / column / parent pickers.
 *
 * Reused for both "create" and "edit". In create mode, leaves `id`
 * generation to the caller (so the caller can persist before any
 * UI hop, e.g. the link-picker dialog).
 */
import * as React from "react";

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
import { Textarea } from "@/components/ui/textarea";

import { shortId } from "./schema";
import type {
  FieldDef,
  FieldValue,
  KanbanBoard,
  WorkItem,
} from "./schema";

interface CardEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  board: KanbanBoard;
  /** Absent → create mode. */
  card?: WorkItem;
  initialColumnId?: string;
  initialItemTypeId?: string;
  initialParentId?: string | null;
  onSave: (next: WorkItem) => void;
  onDelete?: (cardId: string) => void;
}

export function CardEditor({
  open,
  onOpenChange,
  board,
  card,
  initialColumnId,
  initialItemTypeId,
  initialParentId,
  onSave,
  onDelete,
}: CardEditorProps) {
  const isCreate = !card;

  const [typeId, setTypeId] = React.useState<string>(
    card?.type ??
      initialItemTypeId ??
      board.defaultItemType ??
      board.itemTypes[0]?.id ??
      "",
  );
  const [columnId, setColumnId] = React.useState<string>(
    card?.column ?? initialColumnId ?? board.columns[0]?.id ?? "",
  );
  const [parentId, setParentId] = React.useState<string>(
    card?.parent ?? initialParentId ?? "__root",
  );
  const [title, setTitle] = React.useState(card?.title ?? "");
  const [body, setBody] = React.useState(card?.body ?? "");
  const [done, setDone] = React.useState(card?.done ?? false);
  const [fields, setFields] = React.useState<Record<string, FieldValue>>(
    () => initFields(card, board, typeId),
  );
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    if (!open) return;
    setFields((prev) => {
      const t = board.itemTypes.find((x) => x.id === typeId);
      if (!t) return prev;
      const next: Record<string, FieldValue> = { ...prev };
      for (const f of t.fields) {
        if (next[f.id] === undefined) next[f.id] = f.defaultValue ?? defaultFor(f);
      }
      return next;
    });
  }, [typeId, board.itemTypes, open]);

  React.useEffect(() => {
    if (!open) return;
    setTypeId(
      card?.type ??
        initialItemTypeId ??
        board.defaultItemType ??
        board.itemTypes[0]?.id ??
        "",
    );
    setColumnId(card?.column ?? initialColumnId ?? board.columns[0]?.id ?? "");
    setParentId(card?.parent ?? initialParentId ?? "__root");
    setTitle(card?.title ?? "");
    setBody(card?.body ?? "");
    setDone(card?.done ?? false);
    setFields(
      initFields(card, board, card?.type ?? initialItemTypeId ?? board.defaultItemType),
    );
    setErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, card?.id]);

  const itemType = board.itemTypes.find((t) => t.id === typeId);

  // Eligible parent options: every item in this board EXCEPT
  // ourselves and our descendants (would create a cycle).
  const parentOptions = React.useMemo(() => {
    const forbid = new Set<string>();
    if (card) {
      const stack = [card.id];
      while (stack.length) {
        const id = stack.pop()!;
        forbid.add(id);
        for (const it of board.items) {
          if (it.parent === id) stack.push(it.id);
        }
      }
    }
    return board.items.filter((it) => !forbid.has(it.id));
  }, [board.items, card]);

  const setField = (id: string, value: FieldValue) => {
    setFields((prev) => ({ ...prev, [id]: value }));
    setErrors((prev) => {
      if (!prev[id]) return prev;
      const { [id]: _drop, ...rest } = prev;
      return rest;
    });
  };

  const handleSave = () => {
    const nextErrors: Record<string, string> = {};
    if (!title.trim()) nextErrors.__title = "Title is required";
    for (const f of itemType?.fields ?? []) {
      if (f.required && isEmpty(fields[f.id])) {
        nextErrors[f.id] = `${f.label} is required`;
      }
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    const base: WorkItem = card ?? {
      id: `wi_${shortId()}`,
      type: typeId,
      column: columnId,
      parent: parentId === "__root" ? null : parentId,
      title: title.trim(),
      done,
      fields,
      created: new Date().toISOString(),
    };
    onSave({
      ...base,
      type: typeId,
      column: columnId,
      parent: parentId === "__root" ? null : parentId,
      title: title.trim(),
      body: body.trim() || undefined,
      done,
      fields,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>
            {isCreate ? "New work item" : "Edit work item"}
          </DialogTitle>
          <DialogDescription>
            {itemType?.name ?? "Item"} in{" "}
            {board.columns.find((c) => c.id === columnId)?.name ?? "—"}.
            {card && (
              <span className="ml-1 font-mono opacity-60">{card.id}</span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 max-h-[60vh] overflow-y-auto pr-1">
          <FieldShell label="Title" required error={errors.__title}>
            <Input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (errors.__title) {
                  setErrors((prev) => {
                    const { __title: _drop, ...rest } = prev;
                    return rest;
                  });
                }
              }}
              autoFocus
              placeholder="What needs doing?"
              className="h-8"
            />
          </FieldShell>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <FieldShell label="Type">
              <Select value={typeId} onValueChange={setTypeId}>
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {board.itemTypes.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      <span className="flex items-center gap-2">
                        <span
                          aria-hidden
                          className="inline-block h-2 w-2 rounded-sm"
                          style={{ background: t.color ?? "currentColor" }}
                        />
                        {t.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldShell>

            <FieldShell label="Status">
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
            </FieldShell>

            <FieldShell label="Parent">
              <Select value={parentId} onValueChange={setParentId}>
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__root">— none —</SelectItem>
                  {parentOptions.map((it) => (
                    <SelectItem key={it.id} value={it.id}>
                      {it.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldShell>

            <FieldShell label="Checked">
              <label className="flex items-center gap-2 h-8 px-2 rounded-md border border-input text-[13px] cursor-pointer">
                <Checkbox
                  checked={done}
                  onCheckedChange={(v) => setDone(v === true)}
                />
                Done
              </label>
            </FieldShell>
          </div>

          {(itemType?.fields ?? []).length > 0 && (
            <div className="grid grid-cols-2 gap-3 pt-3 border-t border-border/60">
              {(itemType?.fields ?? []).map((field) => (
                <FieldShell
                  key={field.id}
                  label={field.label}
                  required={field.required}
                  hint={field.hint}
                  error={errors[field.id]}
                  className={field.type === "textarea" ? "col-span-2" : ""}
                >
                  <FieldInput
                    field={field}
                    value={fields[field.id]}
                    onChange={(v) => setField(field.id, v)}
                  />
                </FieldShell>
              ))}
            </div>
          )}

          <FieldShell
            label="Notes"
            hint="Free-form markdown. Stored in this item's `body` field."
          >
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              placeholder="Additional notes, links, acceptance criteria…"
            />
          </FieldShell>

          {card?.sources && card.sources.length > 0 && (
            <FieldShell
              label="Linked from"
              hint="Markdown files that reference this item."
            >
              <ul className="flex flex-col gap-1">
                {card.sources.map((s) => (
                  <li
                    key={s}
                    className="text-[12px] text-muted-foreground font-mono truncate"
                  >
                    {s}
                  </li>
                ))}
              </ul>
            </FieldShell>
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          {!isCreate && onDelete && card ? (
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => {
                onDelete(card.id);
                onOpenChange(false);
              }}
            >
              Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave}>
              {isCreate ? "Create" : "Save"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── field shell + inputs ──────────────────────────────────────────

function FieldShell({
  label,
  required,
  hint,
  error,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={"flex flex-col gap-1.5 " + (className ?? "")}>
      <span className="text-[12px] text-muted-foreground flex items-center gap-1.5">
        {label}
        {required && (
          <Badge
            variant="outline"
            className="h-4 px-1 text-[9px] uppercase tracking-wider"
          >
            req
          </Badge>
        )}
      </span>
      {children}
      {error ? (
        <span className="text-[12px] text-destructive">{error}</span>
      ) : hint ? (
        <span className="text-[12px] text-muted-foreground/70">{hint}</span>
      ) : null}
    </label>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: FieldDef;
  value: FieldValue;
  onChange: (v: FieldValue) => void;
}) {
  switch (field.type) {
    case "textarea":
      return (
        <Textarea
          value={asString(value)}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
        />
      );
    case "number":
      return (
        <Input
          type="number"
          inputMode="numeric"
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(e) => {
            const next = e.target.value;
            onChange(next === "" ? undefined : Number(next));
          }}
          className="h-8"
        />
      );
    case "date":
      return (
        <Input
          type="date"
          value={asString(value)}
          onChange={(e) => onChange(e.target.value || undefined)}
          className="h-8"
        />
      );
    case "select":
      return (
        <Select
          value={asString(value)}
          onValueChange={(v) => onChange(v || undefined)}
        >
          <SelectTrigger className="h-8">
            <SelectValue placeholder="Select…" />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((opt) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "multiselect": {
      const selected = Array.isArray(value)
        ? value
        : value
          ? [String(value)]
          : [];
      return (
        <div className="flex flex-wrap gap-1.5 p-1.5 rounded-md border border-input min-h-8">
          {(field.options ?? []).map((opt) => {
            const active = selected.includes(opt);
            return (
              <button
                key={opt}
                type="button"
                onClick={() =>
                  onChange(
                    active
                      ? selected.filter((s) => s !== opt)
                      : [...selected, opt],
                  )
                }
                className={
                  "h-6 px-2 rounded text-[12px] transition-colors " +
                  (active
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground")
                }
              >
                {opt}
              </button>
            );
          })}
        </div>
      );
    }
    case "checkbox":
      return (
        <label className="flex items-center gap-2 h-8 text-[13px]">
          <Checkbox
            checked={value === true}
            onCheckedChange={(v) => onChange(v === true)}
          />
          Yes
        </label>
      );
    case "user":
    case "text":
    default:
      return (
        <Input
          value={asString(value)}
          onChange={(e) => onChange(e.target.value || undefined)}
          className="h-8"
        />
      );
  }
}

// ── helpers ────────────────────────────────────────────────────────

function asString(v: FieldValue): string {
  if (v === undefined || v === null) return "";
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}

function isEmpty(v: FieldValue): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

function defaultFor(f: FieldDef): FieldValue {
  if (f.defaultValue !== undefined) return f.defaultValue;
  switch (f.type) {
    case "multiselect":
      return [];
    case "checkbox":
      return false;
    default:
      return undefined;
  }
}

function initFields(
  card: WorkItem | undefined,
  board: KanbanBoard,
  typeId: string,
): Record<string, FieldValue> {
  const t = board.itemTypes.find((x) => x.id === typeId);
  const base: Record<string, FieldValue> = {};
  for (const f of t?.fields ?? []) base[f.id] = defaultFor(f);
  return { ...base, ...(card?.fields ?? {}) };
}
