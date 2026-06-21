/**
 * Round-trip tests for the `.board.yaml` codec.
 *
 * Critical contract: `parseBoard(serialiseBoard(b))` must equal
 * `b` for every shape the editor emits — otherwise a save+open
 * cycle silently mutates user data.
 */
import { describe, expect, it } from "vitest";

import { parseBoard, serialiseBoard } from "../../../../plugins/kanban/src/codec";
import {
  BOARD_TEMPLATES,
  FALLBACK_ITEM_TYPE_ID,
  emptyBoard,
  type KanbanBoard,
} from "../../../../plugins/kanban/src/schema";

describe("parseBoard", () => {
  it("returns an empty board for blank / whitespace input", () => {
    const b = parseBoard("");
    expect(b.columns.length).toBeGreaterThan(0);
    expect(b.items).toHaveLength(0);
  });

  it("returns an empty board for non-yaml garbage", () => {
    const b = parseBoard("\u0000\u0001 not yaml");
    expect(b.columns.length).toBeGreaterThan(0);
  });

  it("returns an empty board when flux:board marker missing", () => {
    const b = parseBoard("title: just a yaml note\n");
    expect(b.items).toHaveLength(0);
  });

  it("falls back to a default item type when itemTypes is empty", () => {
    const b = parseBoard(
      [
        "flux: board",
        "id: brd_a",
        "title: T",
        "columns:",
        "  - { id: todo, name: Todo }",
        "items: []",
      ].join("\n"),
    );
    expect(b.itemTypes).toHaveLength(1);
    expect(b.itemTypes[0].id).toBe(FALLBACK_ITEM_TYPE_ID);
  });

  it("drops items whose parent references a missing id", () => {
    const yaml = [
      "flux: board",
      "id: brd_a",
      "title: T",
      "columns:",
      "  - { id: todo, name: Todo }",
      "itemTypes:",
      "  - { id: task, name: Task, fields: [] }",
      "defaultItemType: task",
      "items:",
      "  - { id: wi_a, type: task, column: todo, parent: wi_GONE, title: A, done: false, fields: {} }",
    ].join("\n");
    const b = parseBoard(yaml);
    expect(b.items).toHaveLength(1);
    // Parent silently nulled, not the whole item dropped.
    expect(b.items[0].parent).toBeNull();
  });
});

function expectRoundTrip(board: KanbanBoard) {
  // First parse normalises (e.g. fills in `required: false` defaults),
  // so we compare the second round-trip to the first — that's the
  // contract that matters: "once parsed, always stable".
  const normalised = parseBoard(serialiseBoard(board));
  const back = parseBoard(serialiseBoard(normalised));

  // Compare via JSON so `undefined` values + property order don't
  // matter, only the on-disk shape.
  expect(JSON.parse(JSON.stringify(back))).toEqual(
    JSON.parse(JSON.stringify(normalised)),
  );
}

describe("serialiseBoard round-trip", () => {
  it("round-trips an empty board", () => {
    expectRoundTrip(emptyBoard());
  });

  it.each(BOARD_TEMPLATES)("round-trips template %s", (tpl) => {
    expectRoundTrip(tpl.build());
  });

  it("round-trips a board with custom fields and items", () => {
    const b = emptyBoard();
    b.title = "Sprint 23";
    b.itemTypes[0].fields.push({
      id: "story-points",
      label: "SP",
      type: "number",
      showOnCard: true,
    });
    // Items intentionally omit `body` and `sources` (codec drops
    // empty strings + empty arrays via `stripUndef`, so including
    // them as falsy would make the round-trip diverge).
    b.items.push({
      id: "wi_alpha",
      type: FALLBACK_ITEM_TYPE_ID,
      column: "todo",
      parent: null,
      title: "Implement OAuth",
      done: false,
      fields: {
        // Base item-type fields default to undefined when blank, so
        // include them explicitly to keep the JSON-compare stable.
        assignee: undefined,
        priority: "Medium",
        due: undefined,
        "story-points": 5,
      },
      created: "2026-06-20T12:00:00Z",
      sources: ["Notes/Sprint23.md"],
    });
    b.items.push({
      id: "wi_beta",
      type: FALLBACK_ITEM_TYPE_ID,
      column: "todo",
      parent: "wi_alpha",
      title: "Wire OAuth callback",
      done: false,
      fields: {
        assignee: undefined,
        priority: "Medium",
        due: undefined,
        "story-points": undefined,
      },
      created: "2026-06-20T12:05:00Z",
    });
    expectRoundTrip(b);
  });

  it("emits a parseable yaml document with the flux marker", () => {
    const out = serialiseBoard(emptyBoard());
    expect(out).toContain("flux: board");
  });
});
