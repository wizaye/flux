/**
 * Public types shared between the Flux host and every plugin.
 *
 * Plugins import from `@flux/plugin-sdk/types`. The host imports
 * the same module so the contribution-point types stay in lockstep
 * — no manual DTO drift.
 */

// ── Manifest schema ──────────────────────────────────────────────────

export type ActivityBarPlacement = "left" | "right";

export interface PluginActivityBarItem {
  id: string;
  /** `dist/icon.svg` path (resolved to `asset://` by the host loader)
   *  OR an inline lucide icon name like `lucide:layout-grid`. */
  iconUrl: string;
  tooltip: string;
  placement?: ActivityBarPlacement;
}

export interface PluginSidebarPanel {
  id: string;
  /** Path inside the plugin folder, e.g. `dist/sidebar.js`. The host
   *  resolves it to an `asset://` URL before storing it. */
  bundleUrl: string;
  placement: ActivityBarPlacement;
}

export interface PluginEditorView {
  /** File extensions this view handles (lowercase, with leading dot). */
  extensions: string[];
  bundleUrl: string;
}

export interface PluginCommand {
  id: string;
  label: string;
  /** When true, appears in the global command palette. */
  palette: boolean;
}

export interface PluginSettingsPanel {
  label: string;
  bundleUrl: string;
}

export interface PluginCapabilities {
  /** Granted at install time. Must be approved by the user before
   *  the plugin loads any of its bundles. */
  required: string[];
  /** May be requested later behind an in-app prompt. */
  optional?: string[];
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  /** Minimum Flux version this plugin is known to work against. */
  minAppVersion?: string;
  /** Host SDK API version this plugin targets — checked at load
   *  time. Bump the major when the contract breaks. */
  apiVersion: string;
  capabilities: PluginCapabilities;
  contributes: {
    activityBarItem?: PluginActivityBarItem;
    sidebarPanel?: PluginSidebarPanel;
    editorViews?: PluginEditorView[];
    commands?: PluginCommand[];
    settingsPanel?: PluginSettingsPanel;
  };
}

// ── Host contracts (used in Phase C / broker — included now so plugin
//    authors get full IntelliSense even before backend wiring lands) ──

export interface VaultFileEntry {
  name: string;
  path: string;
  kind: "file" | "dir";
}

export interface VaultApi {
  readText(path: string): Promise<string>;
  writeText(path: string, content: string): Promise<void>;
  listDir(path: string): Promise<VaultFileEntry[]>;
}

export interface WorkspaceApi {
  openPath(path: string): Promise<void>;
  revealInSidebar(path: string): Promise<void>;
  showNotice(input: {
    title: string;
    message?: string;
    tone?: "info" | "success" | "warning" | "error";
  }): Promise<void>;
}

export interface SearchResult {
  path: string;
  title: string;
  snippet: string;
}

export interface SearchApi {
  query(input: { text: string; limit?: number }): Promise<SearchResult[]>;
}

export interface PluginStorageApi {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface PluginHost {
  vault: VaultApi;
  workspace: WorkspaceApi;
  search: SearchApi;
  storage: PluginStorageApi;
}

// ── Editor-view contract — the React component an `editorViews`
//    bundle must default-export ─────────────────────────────────────

export interface EditorViewProps<TFile = unknown> {
  /** Vault-relative file path. */
  path: string;
  /** Display name (filename or frontmatter title). */
  title: string;
  /** Current file body. Plugin must NOT mutate this directly; call
   *  `onChange(next)` so the host can debounce, dirty-track, save. */
  content: string;
  /** Mark the file dirty + buffer the new body for the next save. */
  onChange: (next: string) => void;
  /** Force an immediate save of the buffered body. */
  onSave: () => void;
  /** Optional file metadata passed by host-specific views (graph,
   *  pdf, kanban can stash a parsed body here in the future). */
  file?: TFile;
}
