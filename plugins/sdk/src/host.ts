/**
 * Plugin-side host bridge.
 *
 * `createPluginHost({ pluginId, apiVersion })` returns a typed
 * `PluginHost` that proxies every method to the Rust broker via
 * the `plugin_backend_call` Tauri command. The broker re-validates
 * the manifest + capability grant on every request so a plugin
 * cannot lie about its identity.
 *
 * Usage:
 *
 * ```ts
 * import { createPluginHost } from "@flux/plugin-sdk/host";
 *
 * const host = createPluginHost({ pluginId: "my-plugin", apiVersion: "1.0" });
 * const text = await host.vault.readText("Welcome.md");
 * await host.workspace.showNotice({ title: "Hello!" });
 * ```
 *
 * The contract surface mirrors `docs/plugin-system.md` §17.3 and
 * the host broker's `capability_for(...)` table in
 * `src-tauri/src/commands/plugins/broker.rs`. Adding a new method
 * requires changes in three places (broker handler, capability
 * table, manifest allow-list); the SDK is the last layer so a
 * mismatch surfaces at compile time here.
 */
import type {
  PluginHost,
  PluginStorageApi,
  SearchApi,
  SearchResult,
  VaultApi,
  VaultFileEntry,
  WorkspaceApi,
} from "./types";

export interface CreatePluginHostOptions {
  pluginId: string;
  apiVersion: string;
}

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

let invokeCache: Invoke | null = null;

async function getInvoke(): Promise<Invoke> {
  if (invokeCache) return invokeCache;
  const mod = await import("@tauri-apps/api/core");
  invokeCache = mod.invoke as Invoke;
  return invokeCache;
}

interface PluginBackendRequest {
  pluginId: string;
  apiVersion: string;
  capability: string;
  contract: string;
  action: string;
  payloadJson: string;
}

type PluginBackendResponse =
  | { ok: "true"; dataJson: string }
  | { ok: "false"; error: { code: string; message: string } };

/** Thrown when the broker rejects a host call. `code` matches the
 *  string the broker emits (`capability_denied`, `bad_payload`,
 *  `vault_read_failed`, …) so plugin code can branch on it. */
export class HostCallError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "HostCallError";
    this.code = code;
  }
}

async function call(
  opts: CreatePluginHostOptions,
  capability: string,
  contract: string,
  action: string,
  payload: unknown,
): Promise<unknown> {
  const invoke = await getInvoke();
  const req: PluginBackendRequest = {
    pluginId: opts.pluginId,
    apiVersion: opts.apiVersion,
    capability,
    contract,
    action,
    payloadJson: JSON.stringify(payload ?? null),
  };
  const resp = await invoke<PluginBackendResponse>("plugin_backend_call", {
    req,
  });
  if (resp.ok === "true") {
    return resp.dataJson ? JSON.parse(resp.dataJson) : null;
  }
  throw new HostCallError(resp.error.code, resp.error.message);
}

export function createPluginHost(opts: CreatePluginHostOptions): PluginHost {
  const vault: VaultApi = {
    async readText(path: string): Promise<string> {
      return (await call(opts, "vault.read", "vault", "readText", {
        path,
      })) as string;
    },
    async writeText(path: string, content: string): Promise<void> {
      await call(opts, "vault.write", "vault", "writeText", { path, content });
    },
    async listDir(path: string): Promise<VaultFileEntry[]> {
      return (await call(opts, "vault.list", "vault", "listDir", {
        path,
      })) as VaultFileEntry[];
    },
  };

  const workspace: WorkspaceApi = {
    async openPath(path: string): Promise<void> {
      await call(opts, "workspace.open", "workspace", "openPath", { path });
      // Broker has validated the request; route the actual tab
      // switch through the host event bus so we don't have to
      // thread `AppHandle` into a Rust handler that needs to
      // touch the React tab system.
      if (typeof window !== "undefined") {
        try {
          window.dispatchEvent(
            new CustomEvent("flux-open-file", { detail: { fileId: path } }),
          );
        } catch {
          /* non-DOM environment (tests) */
        }
      }
    },
    async revealInSidebar(path: string): Promise<void> {
      // Dedicated `workspace.reveal` capability — the host gates
      // this separately so a plugin that just wants to open a file
      // in a tab doesn't get sidebar-scroll access too.
      await call(
        opts,
        "workspace.reveal",
        "workspace",
        "revealInSidebar",
        { path },
      );
      if (typeof window !== "undefined") {
        try {
          window.dispatchEvent(
            new CustomEvent("flux-reveal-in-sidebar", {
              detail: { fileId: path },
            }),
          );
        } catch {
          /* non-DOM environment (tests) */
        }
      }
    },
    async showNotice({ title, message, tone }) {
      // Broker validates payload shape; toast surface is the
      // frontend's responsibility, dispatched via a window event
      // so plugins stay decoupled from any specific toaster lib.
      await call(opts, "workspace.notice", "workspace", "showNotice", {
        title,
        message,
        tone,
      });
      if (typeof window !== "undefined") {
        try {
          window.dispatchEvent(
            new CustomEvent("flux-plugin-notice", {
              detail: { pluginId: opts.pluginId, title, message, tone },
            }),
          );
        } catch {
          /* non-DOM environment (tests) */
        }
      }
    },
  };

  const search: SearchApi = {
    async query(input) {
      return (await call(
        opts,
        "search.query",
        "search",
        "query",
        input,
      )) as SearchResult[];
    },
  };

  const storage: PluginStorageApi = {
    async get<T = unknown>(key: string): Promise<T | undefined> {
      const raw = await call(opts, "plugin.storage.read", "plugin.storage", "get", {
        key,
      });
      return raw == null ? undefined : (raw as T);
    },
    async set(key: string, value: unknown): Promise<void> {
      await call(opts, "plugin.storage.write", "plugin.storage", "set", {
        key,
        value,
      });
    },
    async delete(key: string): Promise<void> {
      await call(opts, "plugin.storage.write", "plugin.storage", "delete", {
        key,
      });
    },
  };

  return { vault, workspace, search, storage };
}

/** Test-only escape hatch: swap the cached `invoke` implementation
 *  so unit tests don't have to spin up the Tauri runtime. */
export function __setInvokeForTests(impl: Invoke | null): void {
  invokeCache = impl;
}
