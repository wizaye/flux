/**
 * Plugin install orchestration. The IPC wrappers + the store
 * reconciliation that follows each install/uninstall/scan.
 *
 * We stub the bindings module so the test never touches Tauri,
 * and verify:
 *   • `refreshExternalPlugins` translates scan results into store
 *     entries via `buildExternalEntries`.
 *   • `installFromFolder`/`installFromZip` call the matching IPC
 *     command, then trigger a rescan.
 *   • `uninstall` cleans the disk via IPC then refreshes.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const scanPlugins = vi.fn();
const installPluginFromFolder = vi.fn();
const installPluginFromZip = vi.fn();
const uninstallPlugin = vi.fn();

vi.mock("@/bindings", () => ({
  scanPlugins: (...args: unknown[]) => scanPlugins(...args),
  installPluginFromFolder: (...args: unknown[]) =>
    installPluginFromFolder(...args),
  installPluginFromZip: (...args: unknown[]) => installPluginFromZip(...args),
  uninstallPlugin: (...args: unknown[]) => uninstallPlugin(...args),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://${p}`,
}));

import {
  installFromFolder,
  installFromZip,
  uninstall,
  refreshExternalPlugins,
} from "@/plugins/install";
import { usePluginStore } from "@/state/plugin-store";

function makeManifest(id: string) {
  return {
    id,
    name: id,
    version: "0.1.0",
    author: "tests",
    description: "test",
    apiVersion: "1.0",
    capabilities: { required: [], optional: [] },
    contributes: {},
  };
}

function scanned(id: string) {
  return {
    manifest: makeManifest(id),
    pluginDir: `/vault/.zenvault/plugins/${id}`,
    entryPath: `/vault/.zenvault/plugins/${id}/dist/index.js`,
  };
}

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
  scanPlugins.mockReset();
  installPluginFromFolder.mockReset();
  installPluginFromZip.mockReset();
  uninstallPlugin.mockReset();
});

describe("refreshExternalPlugins", () => {
  it("registers every scanned plugin as external in the store", async () => {
    scanPlugins.mockResolvedValueOnce([scanned("alpha"), scanned("beta")]);
    await refreshExternalPlugins();
    const ids = usePluginStore.getState().plugins.map((p) => p.id);
    expect(ids).toEqual(["alpha", "beta"]);
    expect(
      usePluginStore.getState().plugins.every((p) => p.loaderKind === "external"),
    ).toBe(true);
  });

  it("drops a previously-scanned plugin that is no longer present", async () => {
    scanPlugins.mockResolvedValueOnce([scanned("alpha")]);
    await refreshExternalPlugins();
    scanPlugins.mockResolvedValueOnce([]);
    await refreshExternalPlugins();
    expect(usePluginStore.getState().plugins).toHaveLength(0);
  });
});

describe("installFromFolder", () => {
  it("invokes the IPC command then rescans", async () => {
    installPluginFromFolder.mockResolvedValueOnce({
      manifest: makeManifest("alpha"),
      pluginDir: "/vault/.zenvault/plugins/alpha",
      entryPath: "/vault/.zenvault/plugins/alpha/dist/index.js",
      replaced: false,
    });
    scanPlugins.mockResolvedValueOnce([scanned("alpha")]);

    const result = await installFromFolder("/source/alpha");
    expect(installPluginFromFolder).toHaveBeenCalledWith("/source/alpha");
    expect(result.manifest.id).toBe("alpha");
    expect(usePluginStore.getState().plugins.map((p) => p.id)).toEqual(["alpha"]);
  });
});

describe("installFromZip", () => {
  it("invokes the zip IPC command then rescans", async () => {
    installPluginFromZip.mockResolvedValueOnce({
      manifest: makeManifest("beta"),
      pluginDir: "/vault/.zenvault/plugins/beta",
      entryPath: "/vault/.zenvault/plugins/beta/dist/index.js",
      replaced: true,
    });
    scanPlugins.mockResolvedValueOnce([scanned("beta")]);

    const result = await installFromZip("/tmp/beta.zip");
    expect(installPluginFromZip).toHaveBeenCalledWith("/tmp/beta.zip");
    expect(result.replaced).toBe(true);
    expect(usePluginStore.getState().plugins.map((p) => p.id)).toEqual(["beta"]);
  });
});

describe("uninstall", () => {
  it("calls the IPC command then rescans to drop the plugin from the store", async () => {
    scanPlugins.mockResolvedValueOnce([scanned("doomed")]);
    await refreshExternalPlugins();
    expect(usePluginStore.getState().plugins).toHaveLength(1);

    uninstallPlugin.mockResolvedValueOnce(undefined);
    scanPlugins.mockResolvedValueOnce([]);
    await uninstall("doomed");

    expect(uninstallPlugin).toHaveBeenCalledWith("doomed");
    expect(usePluginStore.getState().plugins).toHaveLength(0);
  });
});
