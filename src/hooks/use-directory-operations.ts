/**
 * Directory operations hook — handles directory/folder operations.
 * 
 * Use case: Creating directories, listing directory contents.
 * Used by: File tree, new folder dialogs, file browser.
 */

import { useCallback } from 'react';
import { toast } from 'sonner';
import * as backend from '@/bindings';

export function useDirectoryOperations() {
  /**
   * Create a new directory.
   */
  const createDirectory = useCallback(async (path: string) => {
    try {
      await backend.createDirectory(path);
      toast.success(`Created directory: ${path}`);
    } catch (error) {
      toast.error(`Failed to create directory: ${path}`, {
        description: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }, []);
  
  /**
   * List directory contents.
   */
  const listDirectory = useCallback(async (path: string) => {
    try {
      return await backend.listDirectory(path);
    } catch (error) {
      toast.error(`Failed to list directory: ${path}`, {
        description: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }, []);
  
  return {
    createDirectory,
    listDirectory,
  };
}
