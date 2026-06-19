/**
 * File content hook — handles in-memory file content and dirty tracking.
 * 
 * Use case: Editor content management, unsaved changes tracking, batch saves.
 * Used by: Editor components, status bar, auto-save features.
 */

import { useCallback } from 'react';
import { useVaultStore } from '@/state/vault-store';
import { toast } from 'sonner';
import * as backend from '@/bindings';
import { formatError } from '@/lib/errors';

export function useFileContent() {
  // Selectors — see use-file-operations.ts for the rationale (avoid
  // re-rendering on every unrelated vault-store mutation).
  const openFiles = useVaultStore((s) => s.openFiles);
  const dirtyFiles = useVaultStore((s) => s.dirtyFiles);
  const setFileContent = useVaultStore((s) => s.setFileContent);
  const markDirty = useVaultStore((s) => s.markDirty);
  const markClean = useVaultStore((s) => s.markClean);
  
  /**
   * Get file content from memory cache.
   */
  const getContent = useCallback((path: string) => {
    return openFiles.get(path);
  }, [openFiles]);
  
  /**
   * Update file content in memory (doesn't save to disk).
   * Marks the file as dirty.
   */
  const updateContent = useCallback((path: string, content: string) => {
    setFileContent(path, content);
    markDirty(path);
  }, [setFileContent, markDirty]);
  
  /**
   * Check if a file has unsaved changes.
   */
  const isDirty = useCallback((path: string) => {
    return dirtyFiles.has(path);
  }, [dirtyFiles]);
  
  /**
   * Get all dirty file paths.
   */
  const getDirtyFiles = useCallback(() => {
    return Array.from(dirtyFiles);
  }, [dirtyFiles]);
  
  /**
   * Get count of files with unsaved changes.
   */
  const getDirtyCount = useCallback(() => {
    return dirtyFiles.size;
  }, [dirtyFiles]);
  
  /**
   * Save all dirty files.
   */
  const saveAll = useCallback(async () => {
    if (dirtyFiles.size === 0) {
      toast.info('No files to save');
      return { saved: 0, failed: 0 };
    }
    
    const paths = Array.from(dirtyFiles);
    let saved = 0;
    let failed = 0;
    
    for (const path of paths) {
      try {
        const content = openFiles.get(path);
        if (content === undefined) {
          console.warn(`No content found for dirty file: ${path}`);
          failed++;
          continue;
        }
        
        await backend.writeFile(path, content);
        markClean(path);
        saved++;
      } catch (error) {
        failed++;
        console.error(`Failed to save ${path}:`, error);
      }
    }
    
    if (failed === 0) {
      toast.success(`Saved ${saved} file(s)`);
    } else {
      toast.warning(`Saved ${saved} file(s), ${failed} failed`);
    }
    
    return { saved, failed };
  }, [dirtyFiles, openFiles, markClean]);
  
  /**
   * Discard unsaved changes for a file.
   * Reloads content from disk.
   */
  const discardChanges = useCallback(async (path: string) => {
    try {
      const content = await backend.readFile(path);
      setFileContent(path, content);
      markClean(path);
      toast.info(`Discarded changes: ${path}`);
    } catch (error) {
      toast.error(`Failed to reload file: ${path}`, {
        description: formatError(error),
      });
      throw error;
    }
  }, [setFileContent, markClean]);
  
  return {
    getContent,
    updateContent,
    isDirty,
    getDirtyFiles,
    getDirtyCount,
    saveAll,
    discardChanges,
  };
}
