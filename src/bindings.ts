// TypeScript bindings for Flux Tauri commands
// This file provides type-safe access to the backend API

import { invoke as tauriInvoke } from '@tauri-apps/api/core';

/**
 * Detect whether we're running inside the Tauri webview. `false` when
 * the bundle is loaded by a plain browser (Vite dev preview, Playwright
 * tests, future web build). Bindings short-circuit to a rejected
 * promise so the UI can fall through to mock-vault / no-op flows
 * instead of throwing the "Cannot read properties of undefined
 * (reading 'invoke')" runtime error from `@tauri-apps/api/core`.
 */
export const isTauri: boolean =
  typeof window !== 'undefined' &&
  // Tauri 2 injects this internal namespace on the window before any
  // app code runs.
  ((window as unknown as { __TAURI_INTERNALS__?: unknown })
    .__TAURI_INTERNALS__ !== undefined ||
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ !== undefined);

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri) {
    return Promise.reject(
      new Error(
        `[flux] Tauri command "${cmd}" called outside the Tauri runtime — ` +
          `running in browser preview mode. Set up a mock if you need this in the browser.`,
      ),
    );
  }
  return tauriInvoke<T>(cmd, args);
}

// ── Types ─────────────────────────────────────────────────────────────────

export interface VaultHandle {
  path: string;
  name: string;
  fileCount: number;    // ✅ Matches Rust camelCase: file_count → fileCount
  openedAt: number;     // ✅ Matches Rust camelCase: opened_at → openedAt
}

export type FileState = 'active' | 'archived' | 'trashed';

export interface FileEntry {
  path: string;
  name: string;
  // Rust serializes as `type` (explicit serde rename on the Rust struct).
  type: 'file' | 'directory';
  state: FileState | null;
  size: number | null;
  modifiedAt: number;
}

export interface FileTreeNode {
  id: string;
  type: 'file' | 'directory';
  name: string;
  depth: number;
  parentId: string | null;
  isOpen: boolean | null;
  state: FileState | null;
  childCount: number | null;
  size: number | null;
  modifiedAt: number;
}

export interface MoveResult {
  // Rust struct uses `#[serde(rename_all = "camelCase")]` — these
  // MUST match the JSON wire format, not the Rust field names.
  newPath: string;
  linksHealed: number;
  filesUpdated: number;
}

export interface RenameResult {
  newPath: string;
  linksHealed: number;
  filesUpdated: number;
}

export interface TrashEntry {
  trashPath: string;
  originalPath: string;
  name: string;
  size: number;
  trashedAt: number;
}

export interface ArchiveEntry {
  archivePath: string;
  originalPath: string;
  name: string;
  size: number;
  isDir: boolean;
  archivedAt: number;
}

// ── Vault Commands ────────────────────────────────────────────────────────

export async function openVault(path: string): Promise<VaultHandle> {
  return await invoke('open_vault', { path });
}

export async function createVault(path: string): Promise<VaultHandle> {
  return await invoke('create_vault', { path });
}

export async function closeVault(): Promise<void> {
  return await invoke('close_vault');
}

export async function getVaultInfo(): Promise<VaultHandle> {
  return await invoke('get_vault_info');
}

/**
 * Returns the path of the most-recently-opened vault, or null if
 * nothing has been opened yet (or the previously-opened path no
 * longer exists on disk). The backend cleans up stale pointers.
 */
export async function getLastVaultPath(): Promise<string | null> {
  return await invoke('get_last_vault_path');
}

// ── File System Commands ──────────────────────────────────────────────────

export async function readFile(path: string): Promise<string> {
  return await invoke('read_file', { path });
}

export async function readFileBinary(path: string): Promise<Uint8Array> {
  // Tauri serializes Vec<u8> as number[] over IPC. Re-wrap as
  // Uint8Array so consumers (pdf.js, image decoders, etc.) can use it
  // directly without another copy.
  const raw = await invoke<number[] | Uint8Array>('read_file_binary', { path });
  return raw instanceof Uint8Array ? raw : new Uint8Array(raw);
}

export interface FileMetadata {
  size: number;
  createdAt: number;
  modifiedAt: number;
  isDir: boolean;
}

export async function getFileMetadata(path: string): Promise<FileMetadata> {
  return await invoke('get_file_metadata', { path });
}

export async function writeFile(path: string, content: string): Promise<void> {
  return await invoke('write_file', { path, content });
}

/** Write raw bytes to an absolute path *outside* the vault.
 *  Use for export flows where the user picked the destination via
 *  the OS save dialog. The Rust side validates the path is absolute
 *  and the parent directory exists. */
export async function writeExternalFile(
  path: string,
  bytes: Uint8Array,
): Promise<void> {
  // Tauri serializes a Uint8Array as `number[]` over the wire.
  return await invoke('write_external_file', {
    path,
    bytes: Array.from(bytes),
  });
}

/** Native Markdown → PDF export. Parses + lays out the document
 *  entirely in Rust using `pulldown-cmark` + `printpdf` with the 14
 *  PDF built-in fonts (no font bundling). Output goes straight to
 *  `outputPath`. */
export async function exportMarkdownToPdf(
  title: string,
  markdown: string,
  outputPath: string,
): Promise<void> {
  return await invoke('export_markdown_to_pdf', {
    title,
    markdown,
    outputPath,
  });
}

/** Single hit from `searchFiles`. `snippet` is pre-highlighted HTML
 *  with `<mark>` wrapping each match — render verbatim. */
export interface SearchHit {
  relativePath: string;
  title: string;
  snippet: string;
}

/** Full-text search over the vault's FTS5 index. Returns BM25-ranked
 *  hits. `limit` defaults to 100, capped at 500 on the Rust side. */
export async function searchFiles(
  query: string,
  limit?: number,
): Promise<SearchHit[]> {
  return await invoke('search_files', { query, limit });
}

export async function createFile(path: string, content: string): Promise<void> {
  return await invoke('create_file', { path, content });
}

export async function deleteFile(path: string): Promise<void> {
  return await invoke('delete_file', { path });
}

export async function moveFile(src: string, dst: string): Promise<MoveResult> {
  return await invoke('move_file', { src, dst });
}

export async function renameFile(path: string, newName: string): Promise<RenameResult> {
  return await invoke('rename_file', { path, newName });
}

export async function createDirectory(path: string): Promise<void> {
  return await invoke('create_directory', { path });
}

export async function listDirectory(path: string): Promise<FileEntry[]> {
  return await invoke('list_directory', { path });
}

export async function getFileTree(): Promise<FileTreeNode[]> {
  return await invoke('get_file_tree');
}

// ── Trash Commands ───────────────────────────────────────────────────────

export async function listTrash(): Promise<TrashEntry[]> {
  return await invoke('list_trash');
}

export async function restoreFromTrash(trashPath: string): Promise<string> {
  return await invoke('restore_from_trash', { trashPath });
}

export async function purgeTrashEntry(trashPath: string): Promise<void> {
  return await invoke('purge_trash_entry', { trashPath });
}

// ── Archive Commands ──────────────────────────────────────────
//
// Archive is a "soft retire" bucket separate from trash. Items go
// to `.archive/<original/path>` and stay until the user restores
// or hard-deletes them. The folder context menu's "Archive folder"
// option uses these.

export async function archiveFile(path: string): Promise<string> {
  return await invoke('archive_file', { path });
}

export async function listArchive(): Promise<ArchiveEntry[]> {
  return await invoke('list_archive');
}

export async function restoreFromArchive(archivePath: string): Promise<string> {
  return await invoke('restore_from_archive', { archivePath });
}

// ── Link / tag indexer ───────────────────────────────────────────────────

/** Outbound link in a markdown file. The frontend keys the
 *  reverse index on `targetNorm` (case-folded, `.md` stripped). */
export interface LinkRef {
  from: string;
  line: number;
  /** Raw target text from the link. */
  target: string;
  /** Lowercased, `.md`-stripped target for matching. */
  targetNorm: string;
  kind: 'wiki' | 'markdown';
  snippet: string;
}

export interface TagRef {
  from: string;
  line: number;
  tag: string;
}

export interface LinkScanResult {
  files: string[];
  links: LinkRef[];
  tags: TagRef[];
  scannedFiles: number;
  skippedTooLarge: number;
}

/** Full vault scan — every `*.md` file. Runs on vault open and
 *  whenever the user requests a manual reindex. */
export async function scanVaultLinks(): Promise<LinkScanResult> {
  return await invoke('scan_vault_links');
}

/** Incremental scan — re-extract links/tags for the listed paths.
 *  The frontend reconciles by removing rows whose `from` matches
 *  one of these paths, then appending the new entries. Paths that
 *  no longer exist on disk return without any links/tags but ARE
 *  included in the result's `files` array so the frontend knows to
 *  drop them. */
export async function scanVaultLinksSubset(
  paths: string[],
): Promise<LinkScanResult> {
  return await invoke('scan_vault_links_subset', { paths });
}

// ── Test Command ──────────────────────────────────────────────────────────

export async function greet(name: string): Promise<string> {
  return await invoke('greet', { name });
}
