/**
 * Lazy legacy migration.
 *
 * Two legacy formats exist in the wild:
 *   • `*.kanban.json` — pre-rewrite shape with `columns[].cards[]`.
 *   • `*.kanban.md`   — short-lived markdown-bodied attempt that
 *                       split columns by `## H2` headings.
 *
 * Both convert to the canonical `*.board.yaml`. Migration is
 * **lazy**: only the file the user opens is touched. The vault may
 * contain 10⁵ files; we never enumerate them eagerly.
 *
 * Atomicity: write the new file first, only then soft-delete the
 * old one. Mid-flight kill = duplicate files, next open re-migrates.
 */
import { dump as yamlDump, load as yamlLoad } from "js-yaml";

import { emptyBoard, shortId, type KanbanBoard, type WorkItem } from "./schema";
import { serialiseBoard } from "./codec";

const LEGACY_JSON_RE = /\.kanban\.json$/i;
const LEGACY_MD_RE = /\.kanban\.md$/i;

export function isLegacyKanbanPath(path: string): boolean {
  return LEGACY_JSON_RE.test(path) || LEGACY_MD_RE.test(path);
}

export function targetBoardPath(legacyPath: string): string {
  return legacyPath
    .replace(LEGACY_JSON_RE, ".board.yaml")
    .replace(LEGACY_MD_RE, ".board.yaml");
}

export interface MigrationDeps {
  readFile: (path: string) => Promise<string>;
  createFile: (path: string, content: string) => Promise<void>;
  deleteFile: (path: string) => Promise<void>;
}

export async function migrateLegacyBoard(
  legacyPath: string,
  deps: MigrationDeps,
): Promise<string> {
  const raw = await deps.readFile(legacyPath);
  const board = LEGACY_JSON_RE.test(legacyPath)
    ? legacyJsonToBoard(raw)
    : legacyMarkdownToBoard(raw);

  const desired = targetBoardPath(legacyPath);
  // Avoid clobbering an already-migrated sibling.
  const target = desired; // createFile errors on conflict — caller handles toast
  await deps.createFile(target, serialiseBoard(board));
  await deps.deleteFile(legacyPath);
  return target;
}

// ── legacy → canonical ────────────────────────────────────────────

interface LegacyJsonCard {
  id?: string;
  title?: string;
  notes?: string;
  color?: string;
  createdAt?: string;
}
interface LegacyJsonColumn {
  id?: string;
  title?: string;
  cards?: LegacyJsonCard[];
  wipLimit?: number;
}
interface LegacyJsonBoard {
  title?: string;
  columns?: LegacyJsonColumn[];
}

function legacyJsonToBoard(raw: string): KanbanBoard {
  let parsed: LegacyJsonBoard;
  try {
    parsed = JSON.parse(raw) as LegacyJsonBoard;
  } catch {
    return emptyBoard();
  }
  const cols = Array.isArray(parsed.columns) ? parsed.columns : [];
  if (cols.length === 0) return emptyBoard();

  const board = emptyBoard();
  board.title =
    typeof parsed.title === "string" ? parsed.title : "Imported board";
  board.columns = cols.map((c, i) => ({
    id: typeof c.id === "string" && c.id ? slug(c.id) : `col-${i}`,
    name: typeof c.title === "string" ? c.title : `Column ${i + 1}`,
    ...(typeof c.wipLimit === "number" && c.wipLimit > 0
      ? { wip: c.wipLimit }
      : {}),
  }));

  const items: WorkItem[] = [];
  cols.forEach((col, ci) => {
    const colId = board.columns[ci].id;
    (col.cards ?? []).forEach((card) => {
      items.push({
        id: `wi_${shortId()}`,
        type: board.defaultItemType,
        column: colId,
        parent: null,
        title: typeof card.title === "string" ? card.title : "(untitled)",
        body: typeof card.notes === "string" ? card.notes : undefined,
        done: false,
        fields: {},
        created:
          typeof card.createdAt === "string"
            ? card.createdAt
            : new Date().toISOString(),
      });
    });
  });
  board.items = items;
  return board;
}

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const H2_RE = /^##\s+(.+?)\s*$/;
const TASK_RE = /^(\s*)-\s*\[( |x|X)\]\s+(.*)$/;

interface MdFm {
  title?: string;
  columns?: Array<{ id?: string; name?: string; wip?: number }>;
}

/**
 * Best-effort parse of the short-lived `*.kanban.md` format. We
 * lose any inline `<!-- flux:item ... -->` metadata on purpose —
 * the YAML shape is strictly richer and the markdown form was only
 * shipped briefly. Hand-edits to that file are preserved as plain
 * task lines + body.
 */
function legacyMarkdownToBoard(raw: string): KanbanBoard {
  const board = emptyBoard();
  if (!raw || !raw.trim()) return board;

  const fmMatch = FM_RE.exec(raw);
  const body = fmMatch ? raw.slice(fmMatch[0].length) : raw;
  if (fmMatch) {
    try {
      const fm = yamlLoad(fmMatch[1]) as MdFm | undefined;
      if (fm && typeof fm === "object") {
        if (typeof fm.title === "string") board.title = fm.title;
        if (Array.isArray(fm.columns) && fm.columns.length > 0) {
          board.columns = fm.columns.map((c, i) => ({
            id: typeof c.id === "string" && c.id ? c.id : `col-${i}`,
            name: typeof c.name === "string" ? c.name : `Column ${i + 1}`,
            ...(typeof c.wip === "number" && c.wip > 0
              ? { wip: c.wip }
              : {}),
          }));
        }
      }
    } catch {
      /* fall through with default columns */
    }
  }

  const colByName = new Map(
    board.columns.map((c) => [c.name.toLowerCase(), c.id]),
  );

  let currentCol = board.columns[0]?.id ?? "todo";
  let pending: WorkItem | null = null;
  const bodyBuf: string[] = [];
  const items: WorkItem[] = [];

  const flush = () => {
    if (!pending) return;
    pending.body = bodyBuf.join("\n").trim() || undefined;
    bodyBuf.length = 0;
    items.push(pending);
    pending = null;
  };

  for (const line of body.split(/\r?\n/)) {
    const h = H2_RE.exec(line);
    if (h) {
      flush();
      const name = h[1].trim().toLowerCase();
      currentCol = colByName.get(name) ?? currentCol;
      continue;
    }
    const t = TASK_RE.exec(line);
    if (t) {
      flush();
      const done = t[2].toLowerCase() === "x";
      let tail = t[3];
      // Strip block anchor / flux:item comment if present.
      tail = tail.replace(/\s\^blk_[A-Za-z0-9]+/, "");
      tail = tail.replace(/<!--\s*flux:item[\s\S]*?-->/, "");
      pending = {
        id: `wi_${shortId()}`,
        type: board.defaultItemType,
        column: currentCol,
        parent: null,
        title: tail.trim() || "(untitled)",
        done,
        fields: {},
        created: new Date().toISOString(),
      };
      continue;
    }
    if (pending && /^\s{2,}\S/.test(line)) {
      bodyBuf.push(line.replace(/^\s{2,}/, ""));
      continue;
    }
    flush();
  }
  flush();

  board.items = items;
  return board;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "") || "col";
}

// re-export yamlDump in case future migrations want it; unused now
export const __yamlDump = yamlDump;
