/**
 * Vault operations hook — handles vault lifecycle.
 * 
 * Use case: Opening, creating, closing vaults, refreshing vault info.
 * Used by: Vault picker, window controls, settings.
 */

import { useCallback } from 'react';
import { useVaultStore } from '@/state/vault-store';
import { toast } from 'sonner';
import * as backend from '@/bindings';
import { fileTreeToFileNodes } from '@/lib/file-tree-utils';

export function useVaultOperations() {
  const {
    setVaultHandle,
    setVaultOpen,
    setFileTree,
    setLoadingTree,
    dirtyFiles,
    clearAllState,
  } = useVaultStore();
  
  /**
   * Open an existing vault.
   */
  const openVault = useCallback(async (path: string) => {
    console.log('[useVaultOperations] Opening vault:', path);
    try {
      const handle = await backend.openVault(path);
      console.log('[useVaultOperations] Vault handle received:', handle);
      setVaultHandle(handle);
      setVaultOpen(true);
      
      // Load file tree
      setLoadingTree(true);
      try {
        const flatTree = await backend.getFileTree();
        console.log('[useVaultOperations] File tree nodes:', flatTree.length);
        const nestedTree = fileTreeToFileNodes(flatTree);
        console.log('[useVaultOperations] Nested tree nodes:', nestedTree.length);
        setFileTree(nestedTree);
      } finally {
        setLoadingTree(false);
      }
      
      toast.success(`Opened vault: ${handle.name}`, {
        description: `${handle.fileCount} files indexed`,
      });
    } catch (error) {
      console.error('[useVaultOperations] Failed to open vault:', error);
      toast.error('Failed to open vault', {
        description: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }, [setVaultHandle, setVaultOpen, setFileTree, setLoadingTree]);
  
  /**
   * Create a new vault.
   */
  const createVault = useCallback(async (path: string) => {
    try {
      const handle = await backend.createVault(path);
      setVaultHandle(handle);
      setVaultOpen(true);
      
      // Load file tree
      setLoadingTree(true);
      try {
        const flatTree = await backend.getFileTree();
        const nestedTree = fileTreeToFileNodes(flatTree);
        setFileTree(nestedTree);
      } finally {
        setLoadingTree(false);
      }
      
      toast.success(`Created vault: ${handle.name}`);
    } catch (error) {
      toast.error('Failed to create vault', {
        description: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }, [setVaultHandle, setVaultOpen, setFileTree, setLoadingTree]);
  
  /**
   * Close the current vault.
   */
  const closeVault = useCallback(async () => {
    // Warn if there are unsaved changes
    if (dirtyFiles.size > 0) {
      const proceed = window.confirm(
        `You have ${dirtyFiles.size} unsaved file(s). Close anyway?`
      );
      if (!proceed) return;
    }
    
    try {
      await backend.closeVault();
      clearAllState();
      toast.info('Vault closed');
    } catch (error) {
      toast.error('Failed to close vault', {
        description: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }, [dirtyFiles, clearAllState]);
  
  /**
   * Refresh vault info and file tree.
   */
  const refreshVault = useCallback(async () => {
    try {
      const handle = await backend.getVaultInfo();
      setVaultHandle(handle);
      
      // Reload file tree
      setLoadingTree(true);
      try {
        const flatTree = await backend.getFileTree();
        const nestedTree = fileTreeToFileNodes(flatTree);
        setFileTree(nestedTree);
      } finally {
        setLoadingTree(false);
      }
      
      toast.success('Vault refreshed');
    } catch (error) {
      toast.error('Failed to refresh vault', {
        description: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }, [setVaultHandle, setFileTree, setLoadingTree]);
  
  return {
    openVault,
    createVault,
    closeVault,
    refreshVault,
  };
}
