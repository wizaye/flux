/**
 * Vault store — manages the active vault, file tree, and file operations.
 * 
 * This is the main integration point with the Tauri backend. All file system
 * operations go through the backend commands defined in src/bindings.ts.
 * 
 * Key responsibilities:
 * - Vault lifecycle (open, create, close)
 * - File tree management
 * - File CRUD operations (create, read, update, delete)
 * - Dirty tracking for unsaved changes
 */

/**
 * Vault store — central state for the active vault.
 * 
 * This is the single source of truth for vault state. Import specific
 * operation hooks from @/hooks for different use cases:
 * - useVaultOperations: vault lifecycle (open, close, create)
 * - useFileOperations: file CRUD (read, write, delete, move)
 * - useDirectoryOperations: directory operations
 * - useFileContent: content & dirty tracking
 */

import { create } from 'zustand';
import type { VaultHandle } from '@/bindings';
import type { FileNode } from './editor/types';

export interface VaultState {
  // ── Vault lifecycle ────────────────────────────────────────────────
  vaultHandle: VaultHandle | null;
  isVaultOpen: boolean;
  
  // ── File tree ──────────────────────────────────────────────────────
  fileTree: FileNode[]; // Frontend format (nested)
  isLoadingTree: boolean;
  
  // ── File contents ──────────────────────────────────────────────────
  openFiles: Map<string, string>; // path -> content
  dirtyFiles: Set<string>; // paths with unsaved changes
  
  // ── State setters (used by operation hooks) ────────────────────────
  setVaultHandle: (handle: VaultHandle | null) => void;
  setVaultOpen: (open: boolean) => void;
  setFileTree: (tree: FileNode[]) => void;
  setLoadingTree: (loading: boolean) => void;
  setFileContent: (path: string, content: string) => void;
  removeFileContent: (path: string) => void;
  markDirty: (path: string) => void;
  markClean: (path: string) => void;
  clearAllState: () => void;
}

export const useVaultStore = create<VaultState>((set) => ({
  // ── Initial state ──────────────────────────────────────────────────
  vaultHandle: null,
  isVaultOpen: false,
  fileTree: [],
  isLoadingTree: false,
  openFiles: new Map(),
  dirtyFiles: new Set(),
  
  // ── State setters ──────────────────────────────────────────────────
  
  setVaultHandle: (handle) => set({ vaultHandle: handle }),
  
  setVaultOpen: (open) => set({ isVaultOpen: open }),
  
  setFileTree: (tree) => set({ fileTree: tree }),
  
  setLoadingTree: (loading) => set({ isLoadingTree: loading }),
  
  setFileContent: (path, content) =>
    set((state) => {
      const newOpenFiles = new Map(state.openFiles);
      newOpenFiles.set(path, content);
      return { openFiles: newOpenFiles };
    }),
  
  removeFileContent: (path) =>
    set((state) => {
      const newOpenFiles = new Map(state.openFiles);
      newOpenFiles.delete(path);
      return { openFiles: newOpenFiles };
    }),
  
  markDirty: (path) =>
    set((state) => {
      if (state.dirtyFiles.has(path)) return state;
      const newDirtyFiles = new Set(state.dirtyFiles);
      newDirtyFiles.add(path);
      return { dirtyFiles: newDirtyFiles };
    }),
  
  markClean: (path) =>
    set((state) => {
      if (!state.dirtyFiles.has(path)) return state;
      const newDirtyFiles = new Set(state.dirtyFiles);
      newDirtyFiles.delete(path);
      return { dirtyFiles: newDirtyFiles };
    }),
  
  clearAllState: () =>
    set({
      vaultHandle: null,
      isVaultOpen: false,
      fileTree: [],
      isLoadingTree: false,
      openFiles: new Map(),
      dirtyFiles: new Set(),
    }),
}));
