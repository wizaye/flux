/**
 * Unit tests for canvas state helpers (parse / serialize / color
 * presets / stroke geometry). Pure data — no DOM needed.
 */
import { describe, expect, it } from "vitest";

import {
  emptyCanvasDoc,
  parseCanvas,
  pointsBounds,
  resolveCanvasColor,
  serializeCanvas,
  strokeToPath,
  type CanvasDoc,
  type CanvasTextNode,
} from "../../../plugins/canvas/src/state";

describe("emptyCanvasDoc", () => {
  it("returns a doc with empty arrays", () => {
    const doc = emptyCanvasDoc();
    expect(doc.nodes).toEqual([]);
    expect(doc.edges).toEqual([]);
  });
});

describe("parseCanvas", () => {
  it("returns empty doc for null / undefined / blank input", () => {
    expect(parseCanvas(null)).toEqual(emptyCanvasDoc());
    expect(parseCanvas(undefined)).toEqual(emptyCanvasDoc());
    expect(parseCanvas("")).toEqual(emptyCanvasDoc());
    expect(parseCanvas("   \n\t  ")).toEqual(emptyCanvasDoc());
  });

  it("returns empty doc for non-JSON garbage", () => {
    expect(parseCanvas("not json at all")).toEqual(emptyCanvasDoc());
  });

  it("returns empty doc when nodes/edges are missing", () => {
    const result = parseCanvas("{}");
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it("coerces non-array nodes/edges to empty arrays", () => {
    const result = parseCanvas('{"nodes": "garbage", "edges": null}');
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it("preserves arbitrary node + edge shapes (JSON Canvas spec)", () => {
    const raw = JSON.stringify({
      nodes: [
        { id: "n1", type: "text", x: 0, y: 0, width: 100, height: 50, text: "hi" },
      ],
      edges: [{ id: "e1", fromNode: "n1", toNode: "n2" }],
    });
    const doc = parseCanvas(raw);
    expect(doc.nodes).toHaveLength(1);
    expect((doc.nodes[0] as CanvasTextNode).text).toBe("hi");
    expect(doc.edges).toHaveLength(1);
    expect(doc.edges[0].fromNode).toBe("n1");
  });
});

describe("serializeCanvas", () => {
  it("round-trips a non-empty doc", () => {
    const doc: CanvasDoc = {
      nodes: [
        {
          id: "n1",
          type: "text",
          x: 10,
          y: 20,
          width: 200,
          height: 80,
          text: "hello",
        },
      ],
      edges: [
        { id: "e1", fromNode: "n1", toNode: "n2", toEnd: "arrow" },
      ],
    };
    const round = parseCanvas(serializeCanvas(doc));
    expect(round).toEqual(doc);
  });

  it("emits tab-indented JSON for Obsidian-compat diffs", () => {
    const out = serializeCanvas({
      nodes: [],
      edges: [],
    });
    expect(out).toBe('{\n\t"nodes": [],\n\t"edges": []\n}');
  });
});

describe("resolveCanvasColor", () => {
  it("returns undefined for empty input", () => {
    expect(resolveCanvasColor(undefined)).toBeUndefined();
    expect(resolveCanvasColor("")).toBeUndefined();
  });

  it("passes through hex colors unchanged", () => {
    expect(resolveCanvasColor("#ff00aa")).toBe("#ff00aa");
  });

  it.each([
    ["1", "red"],
    ["2", "orange"],
    ["3", "yellow"],
    ["4", "green"],
    ["5", "cyan"],
    ["6", "purple"],
  ])("maps preset %s to a css var containing %s", (preset, hue) => {
    const out = resolveCanvasColor(preset);
    expect(out).toBeDefined();
    expect(out).toContain(hue);
  });

  it("returns undefined for unknown preset numbers", () => {
    expect(resolveCanvasColor("99")).toBeUndefined();
  });
});

describe("strokeToPath", () => {
  it("returns empty string for fewer than one point", () => {
    expect(strokeToPath([])).toBe("");
    expect(strokeToPath([1])).toBe("");
  });

  it("emits a degenerate move-to/line-to for a single point", () => {
    expect(strokeToPath([5, 10])).toBe("M 5 10 L 5 10");
  });

  it("midpoint-smooths three or more points", () => {
    const d = strokeToPath([0, 0, 10, 0, 20, 0, 30, 0]);
    expect(d.startsWith("M 0 0")).toBe(true);
    // Must contain a quadratic control + final straight line.
    expect(d).toMatch(/Q /);
    expect(d).toMatch(/L 30 0$/);
  });
});

describe("pointsBounds", () => {
  it("returns a zero box for fewer than one point", () => {
    expect(pointsBounds([])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it("computes the axis-aligned bbox of a point list", () => {
    const b = pointsBounds([0, 0, 10, 20, -5, 15]);
    expect(b).toEqual({ x: -5, y: 0, width: 15, height: 20 });
  });

  it("applies symmetric padding when requested", () => {
    const b = pointsBounds([0, 0, 10, 10], 3);
    expect(b).toEqual({ x: -3, y: -3, width: 16, height: 16 });
  });
});
