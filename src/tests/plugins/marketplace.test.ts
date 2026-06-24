/**
 * Marketplace install path tests. The unit under test calls
 * `fetch` for the download + `crypto.subtle.digest` for the
 * verification. We stub fetch and use jsdom's WebCrypto.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const installPluginFromBytes = vi.fn();
const scanPlugins = vi.fn();

vi.mock("@/bindings", () => ({
  isTauri: true,
  installPluginFromBytes: (...args: unknown[]) =>
    installPluginFromBytes(...args),
  installPluginFromFolder: vi.fn(),
  installPluginFromZip: vi.fn(),
  uninstallPlugin: vi.fn(),
  scanPlugins: (...args: unknown[]) => scanPlugins(...args),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://${p}`,
}));

import {
  fetchRegistry,
  installFromUrl,
  sha256Hex,
} from "@/plugins/marketplace";

const fetchMock = vi.fn();
beforeEach(() => {
  installPluginFromBytes.mockReset();
  scanPlugins.mockReset();
  fetchMock.mockReset();
  // jsdom doesn't ship a fetch by default; the vitest env provides
  // one but we still override per-test so we don't hit the network.
  vi.stubGlobal("fetch", fetchMock);
});

function arrayBufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

describe("sha256Hex", () => {
  it("computes the canonical sha256 for known input", async () => {
    const bytes = new TextEncoder().encode("abc");
    expect(await sha256Hex(bytes)).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("fetchRegistry", () => {
  it("returns the entries on a healthy 200 response", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => [
        {
          id: "demo",
          name: "Demo",
          author: "a",
          description: "d",
          latestVersion: "0.1.0",
          downloadUrl: "https://example/test.zip",
        },
      ],
    });
    const entries = await fetchRegistry("https://example/registry.json");
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe("demo");
  });

  it("throws when the index is not an array", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ plugins: [] }),
    });
    await expect(
      fetchRegistry("https://example/registry.json"),
    ).rejects.toThrow(/expected a top-level array/);
  });

  it("filters invalid entries silently", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => [
        {
          id: "ok",
          name: "Ok",
          author: "a",
          description: "d",
          latestVersion: "0.1",
          downloadUrl: "https://x",
        },
        { id: "bad" }, // missing required fields
      ],
    });
    const entries = await fetchRegistry("https://example/registry.json");
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe("ok");
  });
});

describe("installFromUrl", () => {
  it("downloads, installs, and refreshes the store", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      arrayBuffer: async () => arrayBufferOf(bytes),
    });
    installPluginFromBytes.mockResolvedValueOnce({
      manifest: {
        id: "demo",
        name: "Demo",
        version: "1.0",
        author: "x",
        description: "y",
        apiVersion: "1.0",
        capabilities: { required: [], optional: [] },
        contributes: {},
      },
      pluginDir: "/vault/.zenvault/plugins/demo",
      entryPath: "/vault/.zenvault/plugins/demo/dist/index.js",
      replaced: false,
    });
    scanPlugins.mockResolvedValueOnce([]);

    const result = await installFromUrl("https://example/demo.zip");
    expect(result.manifest.id).toBe("demo");
    expect(installPluginFromBytes).toHaveBeenCalledWith(
      expect.any(Uint8Array),
    );
    expect(scanPlugins).toHaveBeenCalled();
  });

  it("aborts before install when the sha256 doesn't match", async () => {
    const bytes = new TextEncoder().encode("abc");
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      arrayBuffer: async () => arrayBufferOf(bytes),
    });
    await expect(
      installFromUrl("https://example/x.zip", {
        expectedSha256: "deadbeef",
      }),
    ).rejects.toThrow(/checksum mismatch/);
    expect(installPluginFromBytes).not.toHaveBeenCalled();
  });

  it("rejects oversized payloads before hashing", async () => {
    // Allocate just over the 8 MiB cap.
    const big = new Uint8Array(8 * 1024 * 1024 + 1);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      arrayBuffer: async () => arrayBufferOf(big),
    });
    await expect(installFromUrl("https://example/big.zip")).rejects.toThrow(
      /exceeds/,
    );
    expect(installPluginFromBytes).not.toHaveBeenCalled();
  });
});
