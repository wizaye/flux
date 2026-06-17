// TypeScript bindings for Flux Tauri commands
// This file provides type-safe access to the backend API

import { invoke } from '@tauri-apps/api/core';

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
  entry_type: 'file' | 'directory';
  state: FileState;
  size: number;
  modified_at: number;
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
  new_path: string;
  links_healed: number;
  files_updated: number;
}

export interface RenameResult {
  new_path: string;
  links_healed: number;
  files_updated: number;
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

export async function writeFile(path: string, content: string): Promise<void> {
  return await invoke('write_file', { path, content });
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

// ── Test Command ──────────────────────────────────────────────────────────

export async function greet(name: string): Promise<string> {
  return await invoke('greet', { name });
}
