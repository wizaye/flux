/**
 * Plugin-side host stub. Phase A ships an in-process shim so the
 * Kanban plugin can develop against a real `PluginHost` shape; the
 * Phase C broker swaps in the actual Tauri-IPC transport without
 * changing the plugin's import surface.
 *
 * Usage from a plugin:
 *
 *   import { createPluginHost } from "@flux/plugin-sdk/host";
 *   const host = createPluginHost({ pluginId: "kanban", apiVersion: "1.0" });
 *   await host.vault.writeText("My Board.kanban.json", body);
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

/**
 * Returns a `PluginHost` bound to the calling plugin. The Phase A
 * stub returns "not implemented" rejections from every contract
 * method; Phase C will swap the implementation for one that calls
 * `plugin_backend_call` over Tauri IPC.
 *
 * Plugins should NOT rely on the rejection shape — treat any error
 * from a host call as a generic failure and surface it via
 * `workspace.showNotice` when possible.
 */
export function createPluginHost(
  opts: CreatePluginHostOptions,
): PluginHost {
  const notImplemented = (api: string, method: string) =>
    Promise.reject(
      new Error(
        `[flux-plugin-sdk] ${api}.${method} not implemented in Phase A. ` +
          `Plugin "${opts.pluginId}" (apiVersion ${opts.apiVersion}) called a ` +
          `host method before the broker was wired. Use plugin-local state ` +
          `for now or wait for Phase C.`,
      ),
    );

  const vault: VaultApi = {
    readText: (_p) => notImplemented("vault", "readText") as Promise<string>,
    writeText: (_p, _c) => notImplemented("vault", "writeText") as Promise<void>,
    listDir: (_p) =>
      notImplemented("vault", "listDir") as Promise<VaultFileEntry[]>,
  };

  const workspace: WorkspaceApi = {
    openPath: (_p) => notImplemented("workspace", "openPath") as Promise<void>,
    revealInSidebar: (_p) =>
      notImplemented("workspace", "revealInSidebar") as Promise<void>,
    showNotice: async ({ title, message, tone }) => {
      // The notice contract is universally useful even pre-broker —
      // route it through the host's sonner instance, which all
      // plugins running in-process share access to.
      const w = window as unknown as {
        __fluxToast?: (
          t: { title: string; description?: string; tone?: string },
        ) => void;
      };
      if (w.__fluxToast) {
        w.__fluxToast({ title, description: message, tone });
        return;
      }
      // Fallback: a simple custom event the host can listen for so
      // we don't tie plugins to a particular toast lib.
      window.dispatchEvent(
        new CustomEvent("flux-plugin-notice", {
          detail: { pluginId: opts.pluginId, title, message, tone },
        }),
      );
    },
  };

  const search: SearchApi = {
    query: (_i) => notImplemented("search", "query") as Promise<SearchResult[]>,
  };

  // Phase A storage stub: per-plugin namespace inside the host's
  // localStorage. Survives reloads, scoped so two plugins don't
  // collide.
  const lsKey = (k: string) => `flux-plugin:${opts.pluginId}:${k}`;
  const storage: PluginStorageApi = {
    async get<T>(key: string) {
      try {
        const raw = localStorage.getItem(lsKey(key));
        return raw ? (JSON.parse(raw) as T) : undefined;
      } catch {
        return undefined;
      }
    },
    async set(key, value) {
      try {
        localStorage.setItem(lsKey(key), JSON.stringify(value));
      } catch {
        /* quota / disabled — silent */
      }
    },
    async delete(key) {
      try {
        localStorage.removeItem(lsKey(key));
      } catch {
        /* noop */
      }
    },
  };

  return { vault, workspace, search, storage };
}
