/**
 * Capability consent flow tests. Verifies the plugin store seeds
 * `grantedCapabilities` correctly per loaderKind and exposes a
 * `grantCapabilities` action that:
 *
 *   • Built-ins auto-grant required + optional caps.
 *   • External plugins persist `null` until the user consents.
 *   • `grantCapabilities` records the chosen set and survives the
 *     persist middleware's `partialize`.
 *   • Re-registering an external plugin preserves a previously-
 *     granted set (so a reinstall after a rescan doesn't blank
 *     the user's choice).
 */
import { describe, it, expect, beforeEach } from "vitest";
import * as React from "react";
import { usePluginStore } from "@/state/plugin-store";
import type { PluginManifest } from "@flux/plugin-sdk/types";

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
      builtinLoaders: {},
      activityBarContributions: [],
      editorViewRegistry: {},
      paletteCommands: [],
      settingsSections: [],
    },
    false,
  );
});

describe("plugin-store — capability consent", () => {
  it("built-in plugins auto-grant required + optional capabilities", () => {
    usePluginStore.getState().registerBuiltin(
      manifest("b1", {
        capabilities: {
          required: ["vault.read"],
          optional: ["search.query"],
        },
      }),
      { sidebarPanel: stub },
      false,
    );
    const p = usePluginStore.getState().plugins.find((x) => x.id === "b1")!;
    expect(p.grantedCapabilities?.sort()).toEqual(
      ["search.query", "vault.read"].sort(),
    );
  });

  it("external plugins start with grantedCapabilities = null", async () => {
    usePluginStore
      .getState()
      .registerExternalLazy(
        manifest("e1", {
          capabilities: { required: ["vault.read"], optional: [] },
        }),
        "/vault/.zenvault/plugins/e1",
        async () => ({ sidebarPanel: stub }),
        false,
      );
    const p = usePluginStore.getState().plugins.find((x) => x.id === "e1")!;
    expect(p.grantedCapabilities).toBeNull();
  });

  it("grantCapabilities records the approved set", () => {
    usePluginStore
      .getState()
      .registerExternalLazy(
        manifest("e2", {
          capabilities: {
            required: ["vault.read"],
            optional: ["search.query"],
          },
        }),
        "/vault/.zenvault/plugins/e2",
        async () => ({ sidebarPanel: stub }),
        false,
      );

    usePluginStore
      .getState()
      .grantCapabilities("e2", ["vault.read", "search.query"]);

    const p = usePluginStore.getState().plugins.find((x) => x.id === "e2")!;
    expect(p.grantedCapabilities?.sort()).toEqual(
      ["search.query", "vault.read"].sort(),
    );
  });

  it("re-registering an external plugin preserves an existing grant", () => {
    const m = manifest("e3", {
      capabilities: { required: ["vault.read"], optional: [] },
    });
    usePluginStore
      .getState()
      .registerExternalLazy(
        m,
        "/vault/.zenvault/plugins/e3",
        async () => ({ sidebarPanel: stub }),
        false,
      );
    usePluginStore.getState().grantCapabilities("e3", ["vault.read"]);

    // Simulate a rescan after install: replaceExternals wipes and
    // re-registers. The persisted grant must survive.
    usePluginStore.getState().replaceExternals([
      {
        manifest: m,
        pluginDir: "/vault/.zenvault/plugins/e3",
        loader: async () => ({ sidebarPanel: stub }),
      },
    ]);
    const p = usePluginStore.getState().plugins.find((x) => x.id === "e3")!;
    expect(p.grantedCapabilities).toEqual(["vault.read"]);
  });

  it("partialize includes grantedCapabilities so consent persists across reloads", () => {
    usePluginStore
      .getState()
      .registerExternalLazy(
        manifest("e4", {
          capabilities: { required: ["vault.read"], optional: [] },
        }),
        "/vault/.zenvault/plugins/e4",
        async () => ({ sidebarPanel: stub }),
        false,
      );
    usePluginStore.getState().grantCapabilities("e4", ["vault.read"]);

    const slice = usePluginStore.persist
      .getOptions()
      .partialize?.(usePluginStore.getState()) as
      | { plugins: Array<{ grantedCapabilities: string[] | null }> }
      | undefined;
    expect(slice?.plugins?.[0]?.grantedCapabilities).toEqual(["vault.read"]);
  });
});
