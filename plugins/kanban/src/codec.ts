/**
 * `.board.yaml` codec — read on load, emit on save.
 *
 * The on-disk format IS a YAML document, not a markdown file with
 * YAML frontmatter. That keeps the parse straightforward (`js-yaml`
 * round-trips the whole thing) and the diffs sensible. We emit a
 * leading `---` and trailing newline so editors that auto-detect
 * YAML by frontmatter delimiters still highlight the file.
 *
 * Tolerance rules:
 *   1. Valid `.board.yaml` round-trips unchanged.
 *   2. Unknown top-level keys are dropped on save (we own the shape).
 *   3. Unknown keys *inside* a work item's `fields` map are
 *      preserved, so a user adding a field via Settings does not
 *      lose data on cards parsed before the field existed.
 *   4. Garbage → fresh `emptyBoard()` so the user always sees a
 *      usable surface. The original file is not touched unless the
 *      user saves.
 */
import { dump as yamlDump, load as yamlLoad } from "js-yaml";

import {
  emptyBoard,
  FALLBACK_ITEM_TYPE_ID,
  shortId,
  type ColumnDef,
  type FieldDef,
  type FieldType,
  type FieldValue,
  type ItemType,
  type KanbanBoard,
  type SavedFilter,
  type WorkItem,
} from "./schema";

export function parseBoard(raw: string): KanbanBoard {
  if (!raw || !raw.trim()) return emptyBoard();

  let data: unknown;
  try {
    // js-yaml accepts a leading `---` document marker; we don't
    // need to strip it ourselves.
    data = yamlLoad(raw);
  } catch {
    return emptyBoard();
  }
  if (!isObject(data) || data.flux !== "board") return emptyBoard();

  const columns: ColumnDef[] = Array.isArray(data.columns)
    ? data.columns.map(coerceColumn).filter((c): c is ColumnDef => c !== null)
    : [];
  if (columns.length === 0) return emptyBoard();

  const itemTypes: ItemType[] = Array.isArray(data.itemTypes)
    ? data.itemTypes
        .map(coerceItemType)
        .filter((t): t is ItemType => t !== null)
    : [];
  if (itemTypes.length === 0) {
    itemTypes.push({
      id: FALLBACK_ITEM_TYPE_ID,
      name: "Task",
      icon: "square-check-big",
      fields: [],
    });
  }

  const itemTypeIds = new Set(itemTypes.map((t) => t.id));
  const colIds = new Set(columns.map((c) => c.id));

  const defaultItemType =
    typeof data.defaultItemType === "string" &&
    itemTypeIds.has(data.defaultItemType)
      ? data.defaultItemType
      : itemTypes[0].id;

  const rawItems = Array.isArray(data.items) ? data.items : [];
  const items: WorkItem[] = rawItems
    .map((raw) => coerceItem(raw, itemTypes, colIds, defaultItemType))
    .filter((i): i is WorkItem => i !== null);

  // Drop parent references that don't exist (deleted parent → root).
  const knownIds = new Set(items.map((i) => i.id));
  for (const it of items) {
    if (it.parent && !knownIds.has(it.parent)) it.parent = null;
  }

  return {
    version: 1,
    id: typeof data.id === "string" && data.id ? data.id : `brd_${shortId()}`,
    title: typeof data.title === "string" ? data.title : "Untitled board",
    columns,
    itemTypes,
    defaultItemType,
    swimlaneField:
      typeof data.swimlaneField === "string" ? data.swimlaneField : undefined,
    filters: Array.isArray(data.filters)
      ? data.filters.map(coerceFilter).filter((f): f is SavedFilter => f !== null)
      : [],
    items,
  };
}

export function serialiseBoard(board: KanbanBoard): string {
  const out: Record<string, unknown> = {
    flux: "board",
    version: 1,
    id: board.id,
    title: board.title,
    columns: board.columns.map((c) =>
      stripUndef({ id: c.id, name: c.name, wip: c.wip }),
    ),
    itemTypes: board.itemTypes.map((t) =>
      stripUndef({
        id: t.id,
        name: t.name,
        icon: t.icon,
        color: t.color,
        fields: t.fields.map((f) =>
          stripUndef({
            id: f.id,
            label: f.label,
            type: f.type,
            showOnCard: f.showOnCard,
            required: f.required,
            options: f.options,
            defaultValue: f.defaultValue,
            hint: f.hint,
          }),
        ),
      }),
    ),
    defaultItemType: board.defaultItemType,
  };
  if (board.swimlaneField) out.swimlaneField = board.swimlaneField;
  if (board.filters.length > 0) out.filters = board.filters;
  out.items = board.items.map((it) =>
    stripUndef({
      id: it.id,
      type: it.type,
      column: it.column,
      parent: it.parent,
      title: it.title,
      body: it.body,
      done: it.done,
      fields: it.fields,
      created: it.created,
      sources: it.sources,
    }),
  );

  const yaml = yamlDump(out, {
    noRefs: true,
    lineWidth: 100,
    quotingType: '"',
    forceQuotes: false,
    sortKeys: false,
  });
  // Leading `---` lets editors that auto-detect YAML frontmatter
  // still pick the file up; it's cosmetic — js-yaml ignores it on
  // parse.
  return `---\n${yaml}`;
}

// ── coerce helpers (defensive: tolerate hand-edits) ────────────────

function coerceColumn(raw: unknown): ColumnDef | null {
  if (!isObject(raw)) return null;
  const id = typeof raw.id === "string" && raw.id ? raw.id : null;
  const name = typeof raw.name === "string" ? raw.name : id;
  if (!id || !name) return null;
  return {
    id,
    name,
    ...(typeof raw.wip === "number" && raw.wip > 0 ? { wip: raw.wip } : {}),
  };
}

function coerceItemType(raw: unknown): ItemType | null {
  if (!isObject(raw)) return null;
  const id = typeof raw.id === "string" && raw.id ? raw.id : null;
  const name = typeof raw.name === "string" ? raw.name : id;
  if (!id || !name) return null;
  const fields = Array.isArray(raw.fields)
    ? raw.fields.map(coerceField).filter((f): f is FieldDef => f !== null)
    : [];
  return {
    id,
    name,
    icon: typeof raw.icon === "string" ? raw.icon : undefined,
    color: typeof raw.color === "string" ? raw.color : undefined,
    fields,
  };
}

const FIELD_TYPES: FieldType[] = [
  "text", "textarea", "number", "date",
  "select", "multiselect", "checkbox", "user",
];

function coerceField(raw: unknown): FieldDef | null {
  if (!isObject(raw)) return null;
  const id = typeof raw.id === "string" && raw.id ? raw.id : null;
  const label = typeof raw.label === "string" ? raw.label : id;
  const type = typeof raw.type === "string" && (FIELD_TYPES as string[]).includes(raw.type)
    ? (raw.type as FieldType)
    : "text";
  if (!id || !label) return null;
  return {
    id,
    label,
    type,
    showOnCard: raw.showOnCard === true,
    required: raw.required === true,
    options: Array.isArray(raw.options)
      ? raw.options.filter((x): x is string => typeof x === "string")
      : undefined,
    defaultValue: isFieldValue(raw.defaultValue)
      ? (raw.defaultValue as FieldValue)
      : undefined,
    hint: typeof raw.hint === "string" ? raw.hint : undefined,
  };
}

function coerceFilter(raw: unknown): SavedFilter | null {
  if (!isObject(raw)) return null;
  const id = typeof raw.id === "string" && raw.id ? raw.id : null;
  const name = typeof raw.name === "string" ? raw.name : id;
  const expression = typeof raw.expression === "string" ? raw.expression : "";
  if (!id || !name || !expression) return null;
  return { id, name, expression };
}

function coerceItem(
  raw: unknown,
  itemTypes: ItemType[],
  colIds: Set<string>,
  defaultItemType: string,
): WorkItem | null {
  if (!isObject(raw)) return null;
  const id = typeof raw.id === "string" && raw.id ? raw.id : `wi_${shortId()}`;
  const typeId =
    typeof raw.type === "string" && itemTypes.some((t) => t.id === raw.type)
      ? raw.type
      : defaultItemType;
  const type = itemTypes.find((t) => t.id === typeId)!;
  const column =
    typeof raw.column === "string" && colIds.has(raw.column)
      ? raw.column
      : Array.from(colIds)[0];

  const fieldsRaw = isObject(raw.fields) ? raw.fields : {};
  const fields: Record<string, FieldValue> = {};
  for (const def of type.fields) {
    const v = fieldsRaw[def.id];
    fields[def.id] = coerceFieldValue(def, v);
  }
  // Preserve unknown field keys (forward-compat).
  for (const [k, v] of Object.entries(fieldsRaw)) {
    if (type.fields.some((d) => d.id === k)) continue;
    if (isFieldValue(v)) fields[k] = v as FieldValue;
  }

  return {
    id,
    type: typeId,
    column,
    parent:
      typeof raw.parent === "string" && raw.parent ? raw.parent : null,
    title: typeof raw.title === "string" ? raw.title : "(untitled)",
    body: typeof raw.body === "string" && raw.body ? raw.body : undefined,
    done: raw.done === true,
    fields,
    created:
      typeof raw.created === "string"
        ? raw.created
        : new Date().toISOString(),
    sources: Array.isArray(raw.sources)
      ? raw.sources.filter((x): x is string => typeof x === "string")
      : undefined,
  };
}

function coerceFieldValue(def: FieldDef, raw: unknown): FieldValue {
  if (raw === undefined || raw === null || raw === "") {
    return def.defaultValue ?? (def.type === "multiselect" ? [] : undefined);
  }
  switch (def.type) {
    case "number": {
      const n = Number(raw);
      return Number.isFinite(n) ? n : undefined;
    }
    case "checkbox":
      return raw === true || raw === "true";
    case "multiselect":
      return Array.isArray(raw)
        ? raw.map(String)
        : String(raw).split("|").map((s) => s.trim()).filter(Boolean);
    default:
      return Array.isArray(raw) ? String(raw[0]) : String(raw);
  }
}

// ── small utils ────────────────────────────────────────────────────

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isFieldValue(v: unknown): boolean {
  return (
    typeof v === "string" ||
    typeof v === "number" ||
    typeof v === "boolean" ||
    Array.isArray(v) ||
    v === null ||
    v === undefined
  );
}

function stripUndef<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (isObject(v) && Object.keys(v).length === 0) continue;
    (out as Record<string, unknown>)[k] = v;
  }
  return out;
}
