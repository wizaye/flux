/**
 * Directory operations hook — handles directory/folder operations.
 * 
 * Use case: Creating directories, listing directory contents.
 * Used by: File tree, new folder dialogs, file browser.
 */

import { useCallback } from 'react';
import { toast } from 'sonner';
import * as backend from '@/bindings';
import { formatError } from '@/lib/errors';
import { useVaultStore } from '@/state/vault-store';

export function useDirectoryOperations() {
  const addNodeToTree = useVaultStore((s) => s.addNodeToTree);

  /**
   * Create a new directory.
   */
  const createDirectory = useCallback(async (path: string) => {
    try {
      await backend.createDirectory(path);
      // Surgical tree insert so the sidebar reflects the new folder
      // without us paying for a full backend reload (which would
      // rebuild every FileNode reference and flicker the editor).
      addNodeToTree(path, 'folder');
      toast.success(`Created directory: ${path}`);
    } catch (error) {
      toast.error(`Failed to create directory: ${path}`, {
        description: formatError(error),
      });
      throw error;
    }
  }, [addNodeToTree]);
  
  /**
   * List directory contents.
   */
  const listDirectory = useCallback(async (path: string) => {
    try {
      return await backend.listDirectory(path);
    } catch (error) {
      toast.error(`Failed to list directory: ${path}`, {
        description: formatError(error),
      });
      throw error;
    }
  }, []);
  
  return {
    createDirectory,
    listDirectory,
  };
}
