/**
 * File operations hook — handles file CRUD operations.
 * 
 * Use case: Reading, writing, creating, deleting, moving, renaming files.
 * Used by: Editor, file tree context menus, command palette.
 */

import { useCallback } from 'react';
import { useVaultStore } from '@/state/vault-store';
import { toast } from 'sonner';
import * as backend from '@/bindings';

export function useFileOperations() {
  const {
    openFiles,
    setFileContent,
    removeFileContent,
    markClean,
  } = useVaultStore();
  
  /**
   * Open/read a file (loads from backend if not cached).
   */
  const openFile = useCallback(async (path: string) => {
    // Return cached content if available
    if (openFiles.has(path)) {
      return openFiles.get(path)!;
    }
    
    try {
      const content = await backend.readFile(path);
      setFileContent(path, content);
      return content;
    } catch (error) {
      toast.error(`Failed to open file: ${path}`, {
        description: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }, [openFiles, setFileContent]);
  
  /**
   * Save a file to disk.
   */
  const saveFile = useCallback(async (path: string, content: string) => {
    try {
      await backend.writeFile(path, content);
      setFileContent(path, content);
      markClean(path);
      toast.success(`Saved: ${path}`);
    } catch (error) {
      toast.error(`Failed to save file: ${path}`, {
        description: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }, [setFileContent, markClean]);
  
  /**
   * Create a new file with initial content.
   */
  const createFile = useCallback(async (path: string, content = '') => {
    try {
      // Create file with content on disk
      await backend.createFile(path, content);
      
      // Also cache the content immediately so it's available when opened
      if (content) {
        setFileContent(path, content);
      }
      
      toast.success(`Created file: ${path}`);
    } catch (error) {
      toast.error(`Failed to create file: ${path}`, {
        description: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }, [setFileContent]);
  
  /**
   * Delete a file (moves to trash).
   */
  const deleteFile = useCallback(async (path: string) => {
    try {
      await backend.deleteFile(path);
      
      // Remove from cache
      removeFileContent(path);
      markClean(path);
      
      toast.success(`Moved to trash: ${path}`);
    } catch (error) {
      toast.error(`Failed to delete file: ${path}`, {
        description: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }, [removeFileContent, markClean]);
  
  /**
   * Move a file to a new location.
   */
  const moveFile = useCallback(async (src: string, dst: string) => {
    try {
      const result = await backend.moveFile(src, dst);
      
      // Update cache (move content from src to dst)
      const content = openFiles.get(src);
      if (content) {
        removeFileContent(src);
        setFileContent(dst, content);
      }
      
      const healedMsg = result.links_healed > 0
        ? ` (${result.links_healed} links healed)`
        : '';
      toast.success(`Moved: ${src} → ${dst}${healedMsg}`);
      
      return result;
    } catch (error) {
      toast.error(`Failed to move file: ${src}`, {
        description: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }, [openFiles, removeFileContent, setFileContent]);
  
  /**
   * Rename a file.
   */
  const renameFile = useCallback(async (path: string, newName: string) => {
    try {
      const result = await backend.renameFile(path, newName);
      
      // Update cache (move content to new path)
      const content = openFiles.get(path);
      if (content) {
        removeFileContent(path);
        setFileContent(result.new_path, content);
      }
      
      const healedMsg = result.links_healed > 0
        ? ` (${result.links_healed} links healed)`
        : '';
      toast.success(`Renamed: ${path} → ${newName}${healedMsg}`);
      
      return result;
    } catch (error) {
      toast.error(`Failed to rename file: ${path}`, {
        description: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }, [openFiles, removeFileContent, setFileContent]);
  
  return {
    openFile,
    saveFile,
    createFile,
    deleteFile,
    moveFile,
    renameFile,
  };
}
