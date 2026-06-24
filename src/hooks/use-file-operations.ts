/**
 * File operations hook — handles file CRUD operations.
 *
 * Use case: Reading, writing, creating, deleting, moving, renaming files.
 * Used by: Editor, file tree context menus, command palette.
 *
 * IMPORTANT: callbacks here are kept STABLE across renders. We don't
 * subscribe to `openFiles` (which mutates on every save / cache
 * write); when we need the latest map we pull it from
 * `useVaultStore.getState()` inside the callback. Same goes for the
 * tree mutators. This stops the hook from churning new callback
 * references through the component tree on every keystroke / save,
 * which used to make the app feel laggy after the vault grew.
 */

import { useCallback } from 'react';
import { useVaultStore } from '@/state/vault-store';
import { getTabSyncHandlers } from '@/state/tab-sync-store';
import { useEditorStore } from '@/state/editor-store';
import { formatError } from '@/lib/errors';
import { toast } from 'sonner';
import * as backend from '@/bindings';

export function useFileOperations() {
  /**
   * Open/read a file (loads from backend if not cached).
   */
  const openFile = useCallback(async (path: string) => {
    const store = useVaultStore.getState();
    if (store.openFiles.has(path)) {
      return store.openFiles.get(path)!;
    }
    try {
      const content = await backend.readFile(path);
      useVaultStore.getState().setFileContent(path, content);
      return content;
    } catch (error) {
      toast.error(`Failed to open file: ${path}`, {
        description: formatError(error),
      });
      throw error;
    }
  }, []);

  /**
   * Save a file to disk.
   *
   * Silent on success — saves happen frequently (autosave debounce
   * + Ctrl/Cmd+S + lifecycle flushes) and a toast per save would
   * spam the notification area. The vanishing dirty dot on the tab
   * is the signal the user needs. Failures still toast so they
   * never go unnoticed.
   */
  const saveFile = useCallback(async (path: string, content: string) => {
    try {
      await backend.writeFile(path, content);
      const store = useVaultStore.getState();
      store.setFileContent(path, content);
      store.markClean(path);
    } catch (error) {
      toast.error(`Failed to save file: ${path}`, {
        description: formatError(error),
      });
      throw error;
    }
  }, []);

  /**
   * Create a new file with initial content.
   */
  const createFile = useCallback(async (path: string, content = '') => {
    try {
      await backend.createFile(path, content);
      const store = useVaultStore.getState();
      if (content) store.setFileContent(path, content);
      store.addNodeToTree(path, 'file');
      toast.success(`Created file: ${path}`);
    } catch (error) {
      toast.error(`Failed to create file: ${path}`, {
        description: formatError(error),
      });
      throw error;
    }
  }, []);

  /**
   * Delete a file (moves to trash). Also closes any open tabs
   * pointing at it and drops the cached body so the editor doesn't
   * show "file not found" for a now-gone path.
   */
  const deleteFile = useCallback(async (path: string) => {
    try {
      await backend.deleteFile(path);
      getTabSyncHandlers()?.closeTabsForFile(path);
      const store = useVaultStore.getState();
      store.removeFileContent(path);
      store.markClean(path);
      useEditorStore.getState().markClean(path);
      store.removeNodeFromTree(path);
      toast.success(`Moved to trash: ${path}`);
    } catch (error) {
      toast.error(`Failed to delete file`, {
        description: formatError(error),
      });
      throw error;
    }
  }, []);

  /**
   * Archive a file or folder. Soft-retire: contents move under
   * `.archive/<original/path>` and stay until the user restores
   * or hard-deletes them. Distinct from delete — archive does NOT
   * surface for janitor purge. Folder archives close every tab
   * underneath.
   */
  const archiveFile = useCallback(async (path: string) => {
    try {
      const newPath = await backend.archiveFile(path);
      getTabSyncHandlers()?.closeTabsForFile(path);
      const store = useVaultStore.getState();
      store.removeFileContent(path);
      store.markClean(path);
      useEditorStore.getState().markClean(path);
      store.removeNodeFromTree(path);
      toast.success(`Archived: ${path}`, {
        description: `Moved to ${newPath}`,
      });
      return newPath;
    } catch (error) {
      toast.error(`Failed to archive`, {
        description: formatError(error),
      });
      throw error;
    }
  }, []);

  /**
   * Move a file to a new location. Updates open tabs to track the
   * new path so the editor doesn't end up holding a dangling ref.
   */
  const moveFile = useCallback(async (src: string, dst: string) => {
    try {
      const result = await backend.moveFile(src, dst);

      const store = useVaultStore.getState();
      const content = store.openFiles.get(src);
      if (content !== undefined) {
        store.removeFileContent(src);
        store.setFileContent(result.newPath, content);
      }

      const newName = result.newPath.split(/[\\/]/).pop() ?? result.newPath;
      getTabSyncHandlers()?.renameTabFile(
        src,
        result.newPath,
        newName.replace(/\.md$/i, ''),
      );
      store.renameNodeInTree(src, result.newPath);

      const healedMsg = result.linksHealed > 0
        ? ` (${result.linksHealed} links healed)`
        : '';
      toast.success(`Moved: ${src} → ${dst}${healedMsg}`);

      return result;
    } catch (error) {
      toast.error(`Failed to move file`, {
        description: formatError(error),
      });
      throw error;
    }
  }, []);

  /**
   * Rename a file. Updates open tabs so the editor follows the
   * rename instead of saying "file not found".
   */
  const renameFile = useCallback(async (path: string, newName: string) => {
    try {
      const result = await backend.renameFile(path, newName);

      const store = useVaultStore.getState();
      const content = store.openFiles.get(path);
      if (content !== undefined) {
        store.removeFileContent(path);
        store.setFileContent(result.newPath, content);
      }

      const displayName = newName.replace(/\.md$/i, '');
      getTabSyncHandlers()?.renameTabFile(path, result.newPath, displayName);
      store.renameNodeInTree(path, result.newPath);
      // Keep bookmarks in sync — pointing at the OLD path would 404
      // until the user re-bookmarks.
      try {
        const { useBookmarksStore } = await import("@/state/bookmarks-store");
        useBookmarksStore.getState().rename(path, result.newPath);
      } catch {
        /* bookmarks store optional — ignore if not loaded */
      }

      const healedMsg = result.linksHealed > 0
        ? ` (${result.linksHealed} links healed)`
        : '';
      toast.success(`Renamed: ${path} → ${newName}${healedMsg}`);

      return result;
    } catch (error) {
      toast.error(`Failed to rename file`, {
        description: formatError(error),
      });
      throw error;
    }
  }, []);

  return {
    openFile,
    saveFile,
    createFile,
    deleteFile,
    archiveFile,
    moveFile,
    renameFile,
  };
}
