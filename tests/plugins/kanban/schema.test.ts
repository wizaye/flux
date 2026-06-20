/**
 * Unit tests for kanban schema helpers + the work-item URL scheme.
 */
import { describe, expect, it } from "vitest";

import {
  BOARD_TEMPLATES,
  FALLBACK_ITEM_TYPE_ID,
  WORK_ITEM_PREFIX,
  WORK_ITEM_SCHEME,
  emptyBoard,
  parseWorkItemUrl,
  shortId,
  workItemLink,
  type WorkItem,
} from "../../../plugins/kanban/src/schema";

function makeItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "wi_abc12345",
    type: FALLBACK_ITEM_TYPE_ID,
    column: "todo",
    parent: null,
    title: "Sample item",
    body: "",
    done: false,
    fields: {},
    created: "2026-06-20T12:00:00Z",
    sources: [],
    ...overrides,
  };
}

describe("shortId", () => {
  it("returns a 12-char hex string", () => {
    const id = shortId();
    expect(id).toHaveLength(12);
    expect(id).toMatch(/^[a-f0-9]{12}$/);
  });

  it("is collision-resistant across many invocations", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(shortId());
    expect(seen.size).toBe(1000);
  });
});

describe("emptyBoard", () => {
  it("comes prefilled with three columns and a fallback item type", () => {
    const b = emptyBoard();
    expect(b.columns.map((c) => c.id)).toEqual(["todo", "doing", "done"]);
    expect(b.itemTypes).toHaveLength(1);
    expect(b.itemTypes[0].id).toBe(FALLBACK_ITEM_TYPE_ID);
    expect(b.defaultItemType).toBe(FALLBACK_ITEM_TYPE_ID);
    expect(b.items).toHaveLength(0);
  });

  it("emits a unique brd_-prefixed id", () => {
    const a = emptyBoard();
    const b = emptyBoard();
    expect(a.id).toMatch(/^brd_/);
    expect(b.id).toMatch(/^brd_/);
    expect(a.id).not.toBe(b.id);
  });
});

describe("BOARD_TEMPLATES", () => {
  it("ships three named templates", () => {
    expect(BOARD_TEMPLATES.map((t) => t.id).sort()).toEqual([
      "basic",
      "personal",
      "scrum",
    ]);
  });

  it("every template builds a valid board with at least one item type", () => {
    for (const tpl of BOARD_TEMPLATES) {
      const board = tpl.build();
      expect(board.columns.length).toBeGreaterThan(0);
      expect(board.itemTypes.length).toBeGreaterThan(0);
      const typeIds = new Set(board.itemTypes.map((t) => t.id));
      expect(typeIds.has(board.defaultItemType)).toBe(true);
    }
  });
});

describe("workItemLink", () => {
  it("emits a markdown link with the flux-wi:// scheme", () => {
    const link = workItemLink("brd_abc", makeItem({ title: "Implement OAuth" }));
    expect(link).toBe("[Implement OAuth](flux-wi://brd_abc#wi_abc12345)");
  });

  it("strips brackets from the title so the markdown stays valid", () => {
    const link = workItemLink(
      "brd_abc",
      makeItem({ title: "[REVIEW] Login [v2]" }),
    );
    // Extract just the label text (everything after the opening `[`
    // and before `](`). No `[` or `]` may remain inside, otherwise
    // Markdown parsers terminate the link text early.
    const label = link.slice(1, link.indexOf("]("));
    expect(label).not.toMatch(/[\[\]]/);
  });
});

describe("parseWorkItemUrl", () => {
  it("returns null for non-flux URLs", () => {
    expect(parseWorkItemUrl("https://example.com#frag")).toBeNull();
    expect(parseWorkItemUrl("notes/foo.md")).toBeNull();
  });

  it("returns null when missing the # separator", () => {
    expect(parseWorkItemUrl(WORK_ITEM_SCHEME + "brd_abc")).toBeNull();
  });

  it("returns null when the board id prefix is wrong", () => {
    expect(
      parseWorkItemUrl(WORK_ITEM_SCHEME + "abc#wi_def"),
    ).toBeNull();
  });

  it("returns null when the work-item id prefix is wrong", () => {
    expect(
      parseWorkItemUrl(WORK_ITEM_SCHEME + "brd_abc#xyz"),
    ).toBeNull();
  });

  it("round-trips via workItemLink", () => {
    const link = workItemLink("brd_HE3WBOARD", makeItem({ id: "wi_HE3X" }));
    // Extract the URL portion `(...)`.
    const url = link.slice(link.indexOf("(") + 1, -1);
    const parsed = parseWorkItemUrl(url);
    expect(parsed).toEqual({ boardId: "brd_HE3WBOARD", itemId: "wi_HE3X" });
  });

  it("preserves WORK_ITEM_PREFIX convention", () => {
    // Sanity: ensure the constant matches what parseWorkItemUrl checks.
    expect(WORK_ITEM_PREFIX).toBe("wi_");
  });
});
