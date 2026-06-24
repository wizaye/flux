/**
 * Plugin app-root — always-mounted React surface.
 *
 * Responsibilities:
 *   • Listen for `flux-kanban-link-work-item` and open the
 *     link-picker dialog.
 *   • Listen for `flux-kanban-new-board` (palette command) and
 *     bridge it to the same event the sidebar's "+" handles.
 *   • Listen for `flux-kanban-open-work-item` (chip click in a
 *     markdown note) and resolve the embedded `boardId` to a board
 *     file path. Boards are referenced by stable id, not path, so
 *     this lookup MUST be done at click time — the path may have
 *     changed since the link was inserted.
 *
 * Mounted by the host via the plugin store's `appRoot` slot — see
 * `App.tsx::PluginAppRoots`.
 */
import * as React from "react";
import { toast } from "sonner";

import { useVaultStore, useTabSyncStore, useFileOperations } from "@flux/plugin-sdk/bridge";
import type { FileNode } from "@flux/plugin-sdk/bridge";

import { LinkWorkItemDialog } from "./link-picker";
import { parseBoard, serialiseBoard } from "./codec";
import type { KanbanBoard } from "./schema";

const BOARD_EXT = ".board.yaml";

function flattenBoards(tree: FileNode[]): string[] {
  const out: string[] = [];
  function walk(nodes: FileNode[]) {
    for (const n of nodes) {
      if (n.kind === "file" && n.id.toLowerCase().endsWith(BOARD_EXT)) {
        out.push(n.id);
      }
      if (n.children) walk(n.children);
    }
  }
  walk(tree);
  out.sort();
  return out;
}

export default function KanbanAppRoot() {
  const fileTree = useVaultStore((s) => s.fileTree);
  const boardPaths = React.useMemo(() => flattenBoards(fileTree), [fileTree]);
  const { openFile, saveFile } = useFileOperations();

  // ── boardId → path index ────────────────────────────────────────
  // Built lazily by reading every `*.board.yaml` once. Re-derived
  // when the set of board paths changes (file added / renamed /
  // deleted). The index lives in a ref so the click handler reads
  // the latest snapshot without re-binding on every change.
  const indexRef = React.useRef<Map<string, string>>(new Map());
  const buildPromiseRef = React.useRef<Promise<Map<string, string>> | null>(
    null,
  );

  const rebuildIndex = React.useCallback(async () => {
    const next = new Map<string, string>();
    // Concurrency cap: parsing N small YAML files is cheap, but we
    // still cap to avoid hammering the IPC bridge if the vault has
    // hundreds of boards.
    const CONCURRENCY = 8;
    let cursor = 0;
    async function worker() {
      while (cursor < boardPaths.length) {
        const idx = cursor++;
        const path = boardPaths[idx];
        try {
          const raw = await openFile(path);
          const board = parseBoard(raw);
          if (board.id) next.set(board.id, path);
        } catch {
          /* unreadable / unparseable board — skip */
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, boardPaths.length) }, worker),
    );
    indexRef.current = next;
    return next;
  }, [boardPaths, openFile]);

  // Invalidate + re-prime the cache whenever the board file set
  // changes. We don't block on it; the click handler awaits the
  // in-flight build if a user happens to click during the rebuild.
  React.useEffect(() => {
    buildPromiseRef.current = rebuildIndex();
  }, [rebuildIndex]);

  const resolveBoardPath = React.useCallback(
    async (boardId: string): Promise<string | null> => {
      // Fast path: cache hit.
      const hit = indexRef.current.get(boardId);
      if (hit) return hit;
      // Slow path: wait for any in-flight rebuild, then check again.
      const promise = buildPromiseRef.current ?? rebuildIndex();
      buildPromiseRef.current = promise;
      const map = await promise;
      return map.get(boardId) ?? null;
    },
    [rebuildIndex],
  );

  // ── link-picker dialog state ───────────────────────────────────
  const [linkOpen, setLinkOpen] = React.useState(false);
  const [linkSeed, setLinkSeed] = React.useState<string | undefined>(undefined);
  // Pinned insertion target captured when the picker is opened from
  // an explicit affordance (e.g. the task-line chip). When set, the
  // resolved link replaces this range in the named file instead of
  // landing at the user's current cursor.
  const targetRef = React.useRef<{
    fileId: string;
    from: number;
    to: number;
  } | null>(null);

  React.useEffect(() => {
    const onLink = (e: Event) => {
      const detail =
        (
          e as CustomEvent<{
            initialTitle?: string;
            fileId?: string | null;
            replaceFrom?: number;
            replaceTo?: number;
          }>
        ).detail ?? {};
      setLinkSeed(detail.initialTitle);
      if (
        detail.fileId &&
        typeof detail.replaceFrom === "number" &&
        typeof detail.replaceTo === "number" &&
        detail.replaceFrom >= 0 &&
        detail.replaceTo >= detail.replaceFrom
      ) {
        targetRef.current = {
          fileId: detail.fileId,
          from: detail.replaceFrom,
          to: detail.replaceTo,
        };
      } else {
        targetRef.current = null;
      }
      setLinkOpen(true);
    };
    window.addEventListener("flux-kanban-link-work-item", onLink as EventListener);
    return () =>
      window.removeEventListener(
        "flux-kanban-link-work-item",
        onLink as EventListener,
      );
  }, []);

  // ── work-item link click resolution ────────────────────────────
  React.useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (
        e as CustomEvent<{ boardId?: string; itemId?: string }>
      ).detail;
      const boardId = detail?.boardId;
      const itemId = detail?.itemId;
      if (!boardId || !itemId) return;
      void (async () => {
        const path = await resolveBoardPath(boardId);
        if (!path) {
          toast.error("Work item link broken", {
            description: `Board ${boardId} not found in this vault.`,
          });
          return;
        }
        window.dispatchEvent(
          new CustomEvent("flux-open-file", { detail: { fileId: path } }),
        );
        // Slight delay so the editor view has time to mount before
        // we ask it to scroll a specific card into view.
        window.setTimeout(() => {
          window.dispatchEvent(
            new CustomEvent("flux-kanban-focus-item", {
              detail: { boardId, itemId },
            }),
          );
        }, 80);
      })();
    };
    window.addEventListener(
      "flux-kanban-open-work-item",
      onOpen as EventListener,
    );
    return () =>
      window.removeEventListener(
        "flux-kanban-open-work-item",
        onOpen as EventListener,
      );
  }, [resolveBoardPath]);

  const loadBoard = React.useCallback(
    async (path: string): Promise<KanbanBoard> => {
      const raw = await openFile(path);
      return parseBoard(raw);
    },
    [openFile],
  );

  const saveBoard = React.useCallback(
    async (path: string, next: KanbanBoard) => {
      await saveFile(path, serialiseBoard(next));
      // Keep the id → path cache fresh — a save may have created a
      // brand-new board file the index hasn't seen yet.
      indexRef.current.set(next.id, path);
    },
    [saveFile],
  );

  const handlePicked = React.useCallback((link: string) => {
    const pinned = targetRef.current;
    if (pinned) {
      window.dispatchEvent(
        new CustomEvent("flux-insert-at-cursor", {
          detail: {
            fileId: pinned.fileId,
            text: link,
            from: pinned.from,
            to: pinned.to,
          },
        }),
      );
      toast.success("Work item linked", {
        description: "Replaced the task text on this line.",
      });
      targetRef.current = null;
      return;
    }

    const active = useTabSyncStore.getState().activeFile;
    if (active?.fileId) {
      window.dispatchEvent(
        new CustomEvent("flux-insert-at-cursor", {
          detail: { fileId: active.fileId, text: link },
        }),
      );
      toast.success("Work item linked", {
        description: "Inserted at the cursor.",
      });
    } else {
      void navigator.clipboard.writeText(link).then(() => {
        toast.message("Work item link copied", {
          description: "Open a note and paste to insert it.",
        });
      });
    }
  }, []);

  // Clear the pinned target if the dialog is closed without picking.
  const handleOpenChange = (open: boolean) => {
    if (!open) targetRef.current = null;
    setLinkOpen(open);
  };

  return (
    <LinkWorkItemDialog
      open={linkOpen}
      onOpenChange={handleOpenChange}
      boardPaths={boardPaths}
      loadBoard={loadBoard}
      saveBoard={saveBoard}
      onPicked={handlePicked}
      initialTitle={linkSeed}
    />
  );
}
