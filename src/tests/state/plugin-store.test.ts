/**
 * Tests for `plugin-store` — the registry of installed plugins and
 * their derived contribution maps (activity bar, editor views,
 * palette commands, settings sections).
 *
 * The store is `persist()`-backed; we wipe localStorage between
 * tests so persisted state from a previous case doesn't leak.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type * as React from "react";
import type { PluginManifest } from "@flux/plugin-sdk/types";

import { usePluginStore } from "@/state/plugin-store";

function manifest(
  id: string,
  overrides: Partial<PluginManifest> = {},
): PluginManifest {
  return {
    id,
    name: id,
    version: "1.0.0",
    apiVersion: "1.0",
    description: "test",
    author: "tests",
    contributes: {},
    capabilities: { required: [], optional: [] },
    ...overrides,
  };
}

const stub: React.ComponentType = () => null;

beforeEach(() => {
  if (typeof localStorage !== "undefined") localStorage.clear();
  usePluginStore.setState(
    {
      plugins: [],
      builtinComponents: {},
      activityBarContributions: [],
      editorViewRegistry: {},
      paletteCommands: [],
      settingsSections: [],
    },
    false,
  );
});

describe("registerBuiltin", () => {
  it("adds a plugin with the default enabled flag", () => {
    usePluginStore
      .getState()
      .registerBuiltin(manifest("plug.a"), { sidebarPanel: stub }, false);

    const s = usePluginStore.getState();
    expect(s.plugins).toHaveLength(1);
    expect(s.plugins[0].id).toBe("plug.a");
    expect(s.plugins[0].enabled).toBe(false);
    expect(s.plugins[0].loaderKind).toBe("builtin");
    expect(s.builtinComponents["plug.a"].sidebarPanel).toBe(stub);
  });

  it("preserves the previously-toggled enabled flag on re-register", () => {
    usePluginStore
      .getState()
      .registerBuiltin(manifest("plug.a"), {}, false);
    usePluginStore.getState().setEnabled("plug.a", true);

    usePluginStore
      .getState()
      .registerBuiltin(manifest("plug.a", { version: "1.1.0" }), {}, false);

    const s = usePluginStore.getState();
    expect(s.plugins).toHaveLength(1);
    expect(s.plugins[0].enabled).toBe(true);
    expect(s.plugins[0].version).toBe("1.1.0");
  });
});

describe("derived contribution maps", () => {
  it("activityBarContributions surface every enabled plugin with an item", () => {
    usePluginStore.getState().registerBuiltin(
      manifest("p.a", {
        contributes: {
          activityBarItem: { id: "p.a.bar", iconUrl: "lucide:box", tooltip: "A" },
        },
      }),
      {},
      true,
    );
    usePluginStore.getState().registerBuiltin(
      manifest("p.b", {
        contributes: {
          activityBarItem: { id: "p.b.bar", iconUrl: "lucide:box", tooltip: "B" },
        },
      }),
      {},
      false,
    );

    const s = usePluginStore.getState();
    expect(s.activityBarContributions).toHaveLength(1);
    expect(s.activityBarContributions[0].pluginId).toBe("p.a");

    // Enable B → derived map updates.
    usePluginStore.getState().setEnabled("p.b", true);
    expect(usePluginStore.getState().activityBarContributions).toHaveLength(2);
  });

  it("editorViewRegistry indexes file extensions to pluginId (lowercased)", () => {
    usePluginStore.getState().registerBuiltin(
      manifest("p.kanban", {
        contributes: {
          editorViews: [
            { extensions: [".KANBAN.JSON", ".KANBAN"], bundleUrl: "dist/view.js" },
          ],
        },
      }),
      {},
      true,
    );
    const reg = usePluginStore.getState().editorViewRegistry;
    expect(reg[".kanban.json"]).toBe("p.kanban");
    expect(reg[".kanban"]).toBe("p.kanban");
  });

  it("paletteCommands include only commands with palette=true", () => {
    usePluginStore.getState().registerBuiltin(
      manifest("p.x", {
        contributes: {
          commands: [
            { id: "p.x.run", label: "Run", palette: true },
            { id: "p.x.hidden", label: "Hidden", palette: false },
          ],
        },
      }),
      {},
      true,
    );
    const cmds = usePluginStore.getState().paletteCommands;
    expect(cmds).toHaveLength(1);
    expect(cmds[0].command.id).toBe("p.x.run");
  });

  it("settingsSections surface enabled plugins with a settingsPanel", () => {
    usePluginStore.getState().registerBuiltin(
      manifest("p.s", {
        contributes: {
          settingsPanel: { label: "S", bundleUrl: "dist/settings.js" },
        },
      }),
      {},
      true,
    );
    const sections = usePluginStore.getState().settingsSections;
    expect(sections).toHaveLength(1);
    expect(sections[0].pluginId).toBe("p.s");
  });

  it("disabling a plugin removes ALL its contributions in one step", () => {
    usePluginStore.getState().registerBuiltin(
      manifest("p.full", {
        contributes: {
          activityBarItem: { id: "p.full.bar", iconUrl: "lucide:box", tooltip: "F" },
          editorViews: [{ extensions: [".f"], bundleUrl: "dist/view.js" }],
          commands: [{ id: "p.full.cmd", label: "F", palette: true }],
          settingsPanel: { label: "F", bundleUrl: "dist/settings.js" },
        },
      }),
      {},
      true,
    );
    expect(
      usePluginStore.getState().activityBarContributions,
    ).toHaveLength(1);

    usePluginStore.getState().setEnabled("p.full", false);

    const s = usePluginStore.getState();
    expect(s.activityBarContributions).toHaveLength(0);
    expect(s.editorViewRegistry[".f"]).toBeUndefined();
    expect(s.paletteCommands).toHaveLength(0);
    expect(s.settingsSections).toHaveLength(0);
  });
});

describe("uninstall", () => {
  it("removes the plugin and drops its component refs + derived maps", () => {
    usePluginStore.getState().registerBuiltin(
      manifest("p.x", {
        contributes: {
          activityBarItem: { id: "bar", iconUrl: "lucide:box", tooltip: "X" },
        },
      }),
      { sidebarPanel: stub },
      true,
    );
    expect(usePluginStore.getState().plugins).toHaveLength(1);

    usePluginStore.getState().uninstall("p.x");

    const s = usePluginStore.getState();
    expect(s.plugins).toHaveLength(0);
    expect(s.builtinComponents["p.x"]).toBeUndefined();
    expect(s.activityBarContributions).toHaveLength(0);
  });

  it("is a no-op for unknown plugin ids", () => {
    usePluginStore
      .getState()
      .registerBuiltin(manifest("p.x"), {}, false);
    usePluginStore.getState().uninstall("p.unknown");
    expect(usePluginStore.getState().plugins).toHaveLength(1);
  });
});

describe("setEnabled", () => {
  it("toggles the enabled flag without touching version / manifest", () => {
    usePluginStore.getState().registerBuiltin(manifest("p.x"), {}, false);
    usePluginStore.getState().setEnabled("p.x", true);
    expect(usePluginStore.getState().plugins[0].enabled).toBe(true);
    usePluginStore.getState().setEnabled("p.x", false);
    expect(usePluginStore.getState().plugins[0].enabled).toBe(false);
  });

  it("is a no-op (structurally) for unknown plugin ids", () => {
    usePluginStore
      .getState()
      .registerBuiltin(manifest("p.x"), {}, true);
    const before = usePluginStore.getState().plugins;
    usePluginStore.getState().setEnabled("p.unknown", false);
    // Implementation maps over the whole array; reference may
    // change but the contents must not.
    expect(usePluginStore.getState().plugins).toStrictEqual(before);
  });
});

describe("persist middleware — migrate", () => {
  it("preserves a well-formed persisted shape", () => {
    const migrated = usePluginStore.persist
      .getOptions()
      .migrate?.(
        { plugins: [{ id: "p.x", enabled: true, version: "0.0.1", pluginDir: "", manifest: manifest("p.x"), loaderKind: "builtin" }] },
        1,
      );
    expect(migrated).toEqual(
      expect.objectContaining({ plugins: expect.any(Array) }),
    );
  });

  it("falls back to an empty plugin list when persisted shape is garbage", () => {
    const migrated = usePluginStore.persist
      .getOptions()
      .migrate?.("oops not an object", 0);
    expect(migrated).toEqual({ plugins: [] });
  });

  it("ignores null persisted state", () => {
    const migrated = usePluginStore.persist
      .getOptions()
      .migrate?.(null, 0);
    expect(migrated).toEqual({ plugins: [] });
  });
});

describe("persist middleware — partialize", () => {
  it("strips builtinComponents and derived maps from the serialised slice", () => {
    usePluginStore
      .getState()
      .registerBuiltin(manifest("p.x"), { sidebarPanel: stub }, true);
    const slice = usePluginStore.persist
      .getOptions()
      .partialize?.(usePluginStore.getState());
    expect(slice).toEqual({
      plugins: [
        {
          id: "p.x",
          enabled: true,
          version: "1.0.0",
          pluginDir: "",
          manifest: expect.any(Object),
          loaderKind: "builtin",
          // Built-ins auto-grant the full declared capability set.
          // The fixture manifest has none, so this is an empty
          // array (distinct from `null`, which means "not yet
          // prompted").
          grantedCapabilities: [],
        },
      ],
    });
    expect(slice).not.toHaveProperty("builtinComponents");
    expect(slice).not.toHaveProperty("activityBarContributions");
  });
});
describe("persist middleware — onRehydrateStorage null guard", () => {
  it("safely returns when persisted state is null", () => {
    const rehydrate = usePluginStore.persist.getOptions().onRehydrateStorage?.(
      usePluginStore.getState(),
    );
    // The returned callback should accept undefined / null without
    // throwing.
    expect(() => rehydrate?.(undefined as unknown as never, undefined)).not.toThrow();
  });
});