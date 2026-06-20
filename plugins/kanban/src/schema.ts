/**
 * Board + work item schema — the in-memory shape, and what each
 * `*.board.yaml` file persists.
 *
 * Why YAML and not Markdown:
 *   • Boards are structured data (typed fields, item types, columns,
 *     parent/child links). Markdown forced us to invent escape rules
 *     for every field; YAML just types them.
 *   • Hand-editable in a text editor — the vault-as-truth principle
 *     holds.
 *   • Diffable for git sync. Renaming an item produces a one-line
 *     diff, not a whole-section reshuffle.
 *   • Linkable. Each work item has a globally unique id (`wi_XXXX`)
 *     so any Markdown file in the vault can reference it via
 *     `[[Sprint 23.board#wi_01HE3X]]`.
 *
 * Storage layout (per board, single file):
 *
 *   ---
 *   flux: board
 *   version: 1
 *   id: brd_01HE3WBOARD
 *   title: Sprint 23
 *   columns:
 *     - { id: todo,  name: Todo,        wip: 5 }
 *     - { id: doing, name: In progress, wip: 3 }
 *     - { id: done,  name: Done }
 *   itemTypes:
 *     - id: story
 *       name: Story
 *       icon: book-open
 *       color: "#22c55e"
 *       fields:
 *         - { id: assignee, label: Assignee, type: text, required: true }
 *         - { id: priority, label: Priority, type: select,
 *             options: [Low, Med, High], required: true }
 *   defaultItemType: story
 *   swimlaneField: priority
 *   filters: []
 *   items:
 *     - id: wi_01HE3X
 *       type: story
 *       column: todo
 *       parent: null
 *       title: Implement login
 *       done: false
 *       fields: { assignee: alice, priority: High }
 *       created: 2026-06-20T12:00:00Z
 *       sources: ["Notes/Sprint23.md", "Designs/login.md"]
 *     - id: wi_01HE3Y
 *       type: story
 *       column: todo
 *       parent: wi_01HE3X
 *       title: Wire up OAuth callback
 *       ...
 *
 * Note that the entire file is a single YAML document — no
 * frontmatter / body split. The leading `---` is optional but
 * preserved on write for visual consistency with notes.
 */

/** Supported field input types. Keep this list small + portable. */
export type FieldType =
  | "text"
  | "textarea"
  | "number"
  | "date"
  | "select"
  | "multiselect"
  | "checkbox"
  | "user";

export interface FieldDef {
  id: string;
  label: string;
  type: FieldType;
  /** Render in card header instead of body. */
  showOnCard?: boolean;
  required?: boolean;
  /** Options for `select` / `multiselect`. */
  options?: string[];
  defaultValue?: FieldValue;
  hint?: string;
}

export type FieldValue =
  | string
  | number
  | boolean
  | string[]
  | null
  | undefined;

export interface ItemType {
  id: string;
  name: string;
  /** Lucide icon name. Falls back to `square-check-big` when unknown. */
  icon?: string;
  color?: string;
  fields: FieldDef[];
}

export interface ColumnDef {
  id: string;
  name: string;
  /** WIP limit — `cards.length >= wip` paints the badge red. */
  wip?: number;
}

export interface WorkItem {
  /** Globally unique. Stable across renames; how Markdown files
   *  reference this card (`[[Board.board#wi_XXX]]`). */
  id: string;
  /** Item type id (from `KanbanBoard.itemTypes`). */
  type: string;
  /** Column id (from `KanbanBoard.columns`). */
  column: string;
  /** Optional parent — must be another item in the same board. */
  parent: string | null;
  title: string;
  /** Free-form markdown notes / description. */
  body?: string;
  done: boolean;
  fields: Record<string, FieldValue>;
  /** ISO timestamp of creation. Used as a stable secondary sort. */
  created: string;
  /** Paths of Markdown files that reference this item. Populated
   *  by the host's wikilink indexer when it lands; the plugin
   *  writes whatever we see from the link-picker dialog so the
   *  data is at least directionally correct today. */
  sources?: string[];
}

export interface SavedFilter {
  id: string;
  name: string;
  /** Right-hand side of a boolean expression evaluated with the
   *  card in scope. Identifiers available: `fields`, `done`,
   *  `column`, `type`, `title`, `parent`. */
  expression: string;
}

export interface KanbanBoard {
  version: 1;
  /** Globally unique board id. Stable across renames so wikilinks
   *  could one day target it directly. */
  id: string;
  title: string;
  columns: ColumnDef[];
  itemTypes: ItemType[];
  defaultItemType: string;
  swimlaneField?: string;
  filters: SavedFilter[];
  items: WorkItem[];
}

export interface BoardTemplate {
  id: string;
  name: string;
  description: string;
  build: () => KanbanBoard;
}

// ── Defaults ────────────────────────────────────────────────────────

export const FALLBACK_ITEM_TYPE_ID = "task";

const BASE_ITEM_TYPE: ItemType = {
  id: FALLBACK_ITEM_TYPE_ID,
  name: "Task",
  icon: "square-check-big",
  color: "#64748b",
  fields: [
    { id: "assignee", label: "Assignee", type: "text", showOnCard: true },
    {
      id: "priority",
      label: "Priority",
      type: "select",
      options: ["Low", "Medium", "High", "Critical"],
      defaultValue: "Medium",
      showOnCard: true,
    },
    { id: "due", label: "Due", type: "date", showOnCard: true },
  ],
};

export function emptyBoard(): KanbanBoard {
  return {
    version: 1,
    id: `brd_${shortId()}`,
    title: "New board",
    columns: [
      { id: "todo", name: "Todo" },
      { id: "doing", name: "In progress" },
      { id: "done", name: "Done" },
    ],
    itemTypes: [structuredClone(BASE_ITEM_TYPE)],
    defaultItemType: FALLBACK_ITEM_TYPE_ID,
    filters: [],
    items: [],
  };
}

// ── Templates ──────────────────────────────────────────────────────

export const BOARD_TEMPLATES: BoardTemplate[] = [
  {
    id: "basic",
    name: "Basic",
    description: "Three columns, one Task type. Good for personal todos.",
    build: emptyBoard,
  },
  {
    id: "scrum",
    name: "Scrum sprint",
    description:
      "Backlog → Todo → In progress → Review → Done. Story / Bug / Task with assignee, priority, points.",
    build: () => ({
      version: 1,
      id: `brd_${shortId()}`,
      title: "Sprint",
      columns: [
        { id: "backlog", name: "Backlog" },
        { id: "todo", name: "Todo", wip: 5 },
        { id: "doing", name: "In progress", wip: 3 },
        { id: "review", name: "In review" },
        { id: "done", name: "Done" },
      ],
      itemTypes: [
        {
          id: "epic",
          name: "Epic",
          icon: "layers",
          color: "#a855f7",
          fields: [
            { id: "owner", label: "Owner", type: "text", showOnCard: true },
            { id: "goal", label: "Goal", type: "textarea" },
          ],
        },
        {
          id: "story",
          name: "Story",
          icon: "book-open",
          color: "#22c55e",
          fields: [
            { id: "assignee", label: "Assignee", type: "text", showOnCard: true, required: true },
            { id: "priority", label: "Priority", type: "select",
              options: ["Low", "Medium", "High"], defaultValue: "Medium",
              showOnCard: true, required: true },
            { id: "points", label: "Story points", type: "number", showOnCard: true },
            { id: "due", label: "Due", type: "date" },
            { id: "description", label: "Description", type: "textarea" },
          ],
        },
        {
          id: "bug",
          name: "Bug",
          icon: "bug",
          color: "#ef4444",
          fields: [
            { id: "assignee", label: "Assignee", type: "text", showOnCard: true, required: true },
            { id: "priority", label: "Priority", type: "select",
              options: ["Low", "Medium", "High", "Critical"], defaultValue: "High",
              showOnCard: true, required: true },
            { id: "severity", label: "Severity", type: "select",
              options: ["Minor", "Major", "Blocker"], defaultValue: "Major", showOnCard: true },
            { id: "steps", label: "Repro steps", type: "textarea", required: true },
          ],
        },
        {
          id: "task",
          name: "Task",
          icon: "square-check-big",
          color: "#64748b",
          fields: [
            { id: "assignee", label: "Assignee", type: "text", showOnCard: true },
            { id: "priority", label: "Priority", type: "select",
              options: ["Low", "Medium", "High"], defaultValue: "Medium", showOnCard: true },
            { id: "due", label: "Due", type: "date", showOnCard: true },
          ],
        },
      ],
      defaultItemType: "task",
      filters: [
        { id: "mine", name: "Assigned to me", expression: "fields.assignee === 'me'" },
        { id: "due-soon", name: "Due this week",
          expression: "fields.due && new Date(fields.due) - Date.now() < 7*864e5" },
        { id: "high-prio", name: "High priority",
          expression: "['High','Critical'].includes(fields.priority)" },
        { id: "blockers", name: "Bugs (blocker / critical)",
          expression: "type === 'bug' && ['Blocker','Critical'].includes(fields.severity || fields.priority)" },
      ],
      items: [],
    }),
  },
  {
    id: "personal",
    name: "Personal todos",
    description: "Single Task type across four columns. Minimal schema.",
    build: () => ({
      version: 1,
      id: `brd_${shortId()}`,
      title: "Todos",
      columns: [
        { id: "today", name: "Today" },
        { id: "soon", name: "Soon" },
        { id: "later", name: "Later" },
        { id: "done", name: "Done" },
      ],
      itemTypes: [structuredClone(BASE_ITEM_TYPE)],
      defaultItemType: FALLBACK_ITEM_TYPE_ID,
      filters: [],
      items: [],
    }),
  },
];

/** Random short id used for board / work-item ids. UUID-strength
 *  collision resistance, base32-ish character set. */
export function shortId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

/** Stable id prefix the plugin treats as a work item link target. */
export const WORK_ITEM_PREFIX = "wi_";

/** Custom URL scheme for work-item references inside notes.
 *
 *  Format: `flux-wi://<board_id>#<wi_id>`
 *
 *  Deliberately NOT wikilink syntax (`[[...]]`) — that would make
 *  every Markdown note that mentions a work item show up as a
 *  backlink to the board file in the graph, polluting it with edges
 *  that don't represent real "this note is about that note"
 *  relationships. A markdown link with a custom scheme keeps the
 *  graph clean: the backlink indexer only looks at `[[ ]]` and
 *  standard markdown links to `.md` files.
 *
 *  Also deliberately path-FREE — the URL embeds only the stable
 *  `brd_…` and `wi_…` ids. Renaming or moving a board file does
 *  not invalidate existing links. The kanban app-root maintains
 *  an `id → path` index (built from a one-time scan of
 *  `*.board.yaml` files) and resolves clicks at lookup time. */
export const WORK_ITEM_SCHEME = "flux-wi://";

/** Markdown link rendered into a Markdown file. Uses only the
 *  stable board id + work-item id so renames / moves never break
 *  the link. */
export function workItemLink(boardId: string, item: WorkItem): string {
  const title = item.title.replace(/[\[\]]/g, ""); // keep brackets out of label
  return `[${title}](${WORK_ITEM_SCHEME}${boardId}#${item.id})`;
}

/** Inverse of `workItemLink` — returns the embedded ids when the
 *  URL matches our scheme. Path resolution happens elsewhere
 *  (kanban app-root) so the URL has zero filesystem coupling. */
export function parseWorkItemUrl(
  url: string,
): { boardId: string; itemId: string } | null {
  if (!url.startsWith(WORK_ITEM_SCHEME)) return null;
  const rest = url.slice(WORK_ITEM_SCHEME.length);
  const hashIdx = rest.lastIndexOf("#");
  if (hashIdx < 0) return null;
  const boardId = rest.slice(0, hashIdx);
  const itemId = rest.slice(hashIdx + 1);
  if (!boardId.startsWith("brd_")) return null;
  if (!itemId.startsWith(WORK_ITEM_PREFIX)) return null;
  return { boardId, itemId };
}
