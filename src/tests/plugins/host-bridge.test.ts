/**
 * SDK host bridge tests. Mock the cached invoke transport via the
 * `__setInvokeForTests` escape hatch and assert that:
 *
 *   • Every contract method routes to the right
 *     `(capability, contract, action)` triple.
 *   • Success responses are decoded from `dataJson`.
 *   • Error responses become typed `HostCallError` throws.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createPluginHost,
  HostCallError,
  __setInvokeForTests,
} from "@flux/plugin-sdk/host";

const invoke = vi.fn();

beforeEach(() => {
  invoke.mockReset();
  __setInvokeForTests(invoke as unknown as <T>(
    cmd: string,
    args?: Record<string, unknown>,
  ) => Promise<T>);
});

const opts = { pluginId: "demo", apiVersion: "1.0" } as const;

describe("createPluginHost — vault contract", () => {
  it("readText decodes a string response", async () => {
    invoke.mockResolvedValueOnce({
      ok: "true",
      dataJson: JSON.stringify("hello"),
    });
    const host = createPluginHost(opts);
    const text = await host.vault.readText("a.md");
    expect(text).toBe("hello");
    const call = invoke.mock.calls[0];
    expect(call[0]).toBe("plugin_backend_call");
    const req = (call[1] as { req: { capability: string; action: string } }).req;
    expect(req.capability).toBe("vault.read");
    expect(req.action).toBe("readText");
  });

  it("writeText sends the payload and resolves to undefined", async () => {
    invoke.mockResolvedValueOnce({ ok: "true", dataJson: "null" });
    const host = createPluginHost(opts);
    await host.vault.writeText("a.md", "body");
    const req = (invoke.mock.calls[0][1] as {
      req: { capability: string; payloadJson: string };
    }).req;
    expect(req.capability).toBe("vault.write");
    expect(JSON.parse(req.payloadJson)).toEqual({ path: "a.md", content: "body" });
  });

  it("listDir parses a JSON array response", async () => {
    const entries = [{ name: "a", path: "/a", kind: "file" }];
    invoke.mockResolvedValueOnce({
      ok: "true",
      dataJson: JSON.stringify(entries),
    });
    const host = createPluginHost(opts);
    const out = await host.vault.listDir("/");
    expect(out).toEqual(entries);
  });
});

describe("createPluginHost — storage contract", () => {
  it("get returns undefined when storage holds null", async () => {
    invoke.mockResolvedValueOnce({ ok: "true", dataJson: "null" });
    const host = createPluginHost(opts);
    const out = await host.storage.get("missing");
    expect(out).toBeUndefined();
  });

  it("set sends the JSON-encoded value", async () => {
    invoke.mockResolvedValueOnce({ ok: "true", dataJson: "null" });
    const host = createPluginHost(opts);
    await host.storage.set("k", { n: 1 });
    const req = (invoke.mock.calls[0][1] as { req: { payloadJson: string } }).req;
    expect(JSON.parse(req.payloadJson)).toEqual({ key: "k", value: { n: 1 } });
  });

  it("delete uses the write capability", async () => {
    invoke.mockResolvedValueOnce({ ok: "true", dataJson: "null" });
    const host = createPluginHost(opts);
    await host.storage.delete("k");
    const req = (invoke.mock.calls[0][1] as { req: { capability: string } }).req;
    expect(req.capability).toBe("plugin.storage.write");
  });
});

describe("createPluginHost — error translation", () => {
  it("throws HostCallError with the broker's error code", async () => {
    invoke.mockResolvedValueOnce({
      ok: "false",
      error: { code: "capability_denied", message: "nope" },
    });
    const host = createPluginHost(opts);
    await expect(host.vault.readText("a")).rejects.toMatchObject({
      name: "HostCallError",
      code: "capability_denied",
    });
  });

  it("HostCallError preserves the message", async () => {
    invoke.mockResolvedValueOnce({
      ok: "false",
      error: { code: "vault_read_failed", message: "file missing" },
    });
    const host = createPluginHost(opts);
    try {
      await host.vault.readText("a");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(HostCallError);
      expect((e as HostCallError).message).toContain("vault_read_failed");
    }
  });
});

describe("createPluginHost — workspace.showNotice", () => {
  it("calls the broker AND dispatches the toast event", async () => {
    invoke.mockResolvedValueOnce({ ok: "true", dataJson: "null" });
    const host = createPluginHost(opts);
    const events: CustomEvent[] = [];
    const listener = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener("flux-plugin-notice", listener);
    try {
      await host.workspace.showNotice({
        title: "Hi",
        message: "msg",
        tone: "success",
      });
    } finally {
      window.removeEventListener("flux-plugin-notice", listener);
    }
    expect(events).toHaveLength(1);
    expect(events[0].detail).toMatchObject({
      pluginId: "demo",
      title: "Hi",
      tone: "success",
    });
  });
});
