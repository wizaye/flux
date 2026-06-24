/**
 * Public constants the plugin SDK exports. Centralising them means
 * a plugin author can write capability-checked code with full
 * IntelliSense instead of relying on stringly-typed magic values.
 *
 * If you bump these here you MUST also update:
 *   * `src-tauri/src/commands/plugins/manifest.rs::HOST_API_VERSION`
 *   * `src-tauri/src/commands/plugins/manifest.rs::ALLOWED_CAPABILITIES`
 *   * `src-tauri/src/commands/plugins/broker.rs::capability_for`
 *
 * The host re-validates everything in `manifest.rs` so even a stale
 * SDK can't smuggle in an unknown capability — but keeping the
 * lists in sync makes every contract addition a single commit
 * spanning host + SDK.
 */

/** Plugin API version the host implements. A plugin's
 *  `manifest.json::apiVersion` MUST equal this exactly — there is
 *  no partial compat today. Bump the major segment on every
 *  breaking change to the manifest schema, broker contract, or
 *  capability semantics. */
export const HOST_API_VERSION = "1.0" as const;

/** Capability strings the host knows how to enforce. Plugins
 *  declare a subset of these in `manifest.json::capabilities.required`
 *  (and `.optional`) before they can call the matching broker
 *  contracts. Using the const map below instead of raw strings
 *  catches typos at compile time.
 *
 *  Capability → contract.action mapping (kept stable across V1):
 *  ```
 *  VAULT_READ              → vault.readText
 *  VAULT_WRITE             → vault.writeText
 *  VAULT_LIST              → vault.listDir
 *  WORKSPACE_OPEN          → workspace.openPath
 *  WORKSPACE_NOTICE        → workspace.showNotice
 *  SEARCH_QUERY            → search.query
 *  PLUGIN_STORAGE_READ     → plugin.storage.get
 *  PLUGIN_STORAGE_WRITE    → plugin.storage.set / delete
 *  ```
 */
export const CAPABILITIES = {
  VAULT_READ: "vault.read",
  VAULT_WRITE: "vault.write",
  VAULT_LIST: "vault.list",
  WORKSPACE_OPEN: "workspace.open",
  WORKSPACE_REVEAL: "workspace.reveal",
  WORKSPACE_NOTICE: "workspace.notice",
  SEARCH_QUERY: "search.query",
  PLUGIN_STORAGE_READ: "plugin.storage.read",
  PLUGIN_STORAGE_WRITE: "plugin.storage.write",
} as const;

/** Union of every capability string accepted by the host. */
export type Capability = (typeof CAPABILITIES)[keyof typeof CAPABILITIES];

/** Full ordered list of capabilities — useful for rendering a
 *  permission picker UI or printing a capability cheat-sheet in
 *  CLI tooling. */
export const ALL_CAPABILITIES: readonly Capability[] = Object.freeze(
  Object.values(CAPABILITIES),
);
