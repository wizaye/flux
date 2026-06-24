/**
 * Host-internal bridge. Plugins import vault state, file ops and
 * shared utility helpers via `@flux/plugin-sdk/bridge` so they
 * never reach into the host's private `@/*` namespace directly.
 *
 * STATUS — Phase A
 *   These re-exports are an explicit thin shim. In the standalone-
 *   template flow (Phase C broker + npm-published SDK) these will
 *   be replaced by the typed `PluginHost` IPC surface in `./host`.
 *   The import paths stay the same so plugin sources do not change
 *   when the swap happens.
 */
export { useVaultStore } from "@/state/vault-store";
export { useTabSyncStore } from "@/state/tab-sync-store";
export { useFileOperations } from "@/hooks/use-file-operations";
export { useVaultOperations } from "@/hooks/use-vault-operations";
export type { FileNode } from "@/state/editor";
export { cn } from "@/lib/utils";
