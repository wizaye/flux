/**
 * External loader unit tests. We pass a custom importer function
 * so we never have to wrestle with Vite/Vitest's module-mock guards
 * for fabricated `asset://` URLs.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://${p.replace(/\\/g, "/")}`,
}));

import {
  buildExternalLoader,
  buildExternalEntries,
} from "@/plugins/external-loader";
import type { ScannedPlugin } from "@/bindings";

function scanned(id: string): ScannedPlugin {
  return {
    manifest: {
      id,
      name: id,
      version: "0.1.0",
      author: "tests",
      description: "test",
      apiVersion: "1.0",
      capabilities: { required: [], optional: [] },
      contributes: {},
    },
    pluginDir: `/vault/.zenvault/plugins/${id}`,
    entryPath: `/vault/.zenvault/plugins/${id}/dist/index.js`,
  };
}

describe("buildExternalLoader", () => {
  it("resolves a plugin module's Components export", async () => {
    const importer = vi.fn().mockResolvedValueOnce({
      Manifest: { id: "demo" },
      Components: { sidebarPanel: () => null },
    });
    const loader = buildExternalLoader(scanned("demo"), importer);
    const components = await loader();
    expect(components.sidebarPanel).toBeTypeOf("function");
    expect(importer).toHaveBeenCalledWith(
      "asset:///vault/.zenvault/plugins/demo/dist/index.js",
    );
  });

  it("falls back to default.Components when the module wraps under default", async () => {
    const importer = vi.fn().mockResolvedValueOnce({
      default: { Components: { sidebarPanel: () => null } },
    });
    const loader = buildExternalLoader(scanned("wrapped"), importer);
    const components = await loader();
    expect(components.sidebarPanel).toBeTypeOf("function");
  });

  it("throws when the plugin omits Components", async () => {
    const importer = vi.fn().mockResolvedValueOnce({});
    const loader = buildExternalLoader(scanned("empty"), importer);
    await expect(loader()).rejects.toThrow(/must export `Components`/);
  });

  it("wraps lower-level import errors with context", async () => {
    const importer = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"));
    const loader = buildExternalLoader(scanned("flaky"), importer);
    await expect(loader()).rejects.toThrow(/failed to import plugin "flaky"/);
  });
});

describe("buildExternalEntries", () => {
  it("converts a list of scanned plugins into store entries", () => {
    const entries = buildExternalEntries([scanned("demo"), scanned("wrapped")]);
    expect(entries).toHaveLength(2);
    expect(entries[0].manifest.id).toBe("demo");
    expect(entries[0].pluginDir).toBe("/vault/.zenvault/plugins/demo");
    expect(entries[0].loader).toBeTypeOf("function");
  });

  it("threads a custom importer through to every loader", async () => {
    const importer = vi.fn().mockResolvedValue({
      Components: { sidebarPanel: () => null },
    });
    const entries = buildExternalEntries([scanned("a"), scanned("b")], importer);
    await entries[0].loader();
    await entries[1].loader();
    expect(importer).toHaveBeenCalledTimes(2);
  });
});
