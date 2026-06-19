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
import { formatError } from '@/lib/errors';

export function useVaultOperations() {
  // Selectors — see use-file-operations.ts for the rationale.
  const setVaultHandle = useVaultStore((s) => s.setVaultHandle);
  const setVaultOpen = useVaultStore((s) => s.setVaultOpen);
  const setFileTree = useVaultStore((s) => s.setFileTree);
  const setLoadingTree = useVaultStore((s) => s.setLoadingTree);
  const dirtyFiles = useVaultStore((s) => s.dirtyFiles);
  const clearAllState = useVaultStore((s) => s.clearAllState);
  
  /**
   * Open an existing vault.
   */
  const openVault = useCallback(async (path: string) => {
    try {
      const handle = await backend.openVault(path);
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
      
      toast.success(`Opened vault: ${handle.name}`, {
        description: `${handle.fileCount} files indexed`,
      });
    } catch (error) {
      toast.error('Failed to open vault', {
        description: formatError(error),
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
        description: formatError(error),
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
        description: formatError(error),
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
        description: formatError(error),
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
