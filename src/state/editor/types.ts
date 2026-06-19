/**
 * Editor split-tree, tabs, and vault types.
 *
 * Ported 1:1 from `lattice/src/state/types.ts` — same shapes, same
 * semantics. The flux editor reuses these names because they're
 * already battle-tested across the lattice codebase and any deviation
 * would risk silent drift between the two implementations.
 */

/**
 * A node in the vault tree.
 *
 * `kind`:
 *  - `"folder"`: contains `children`, no `content`.
 *  - `"file"`:   markdown file. `content` holds the raw body.
 *  - `"canvas"`: JSON Canvas file. `content` holds the serialized JSON.
 *  - `"pdf"`:    binary PDF. `content` is either a base64 string
 *                (mock vault) or empty (real vault — `id` is the
 *                absolute path on disk).
 *  - `"graph"`:  virtual entry that opens the graph view when clicked.
 */
export type FileNode = {
  id: string;
  name: string;
  kind: "file" | "folder" | "canvas" | "pdf" | "graph";
  children?: FileNode[];
  content?: string;
};

/**
 * A single tab inside a `leaf` pane.
 *
 * `viewMode` defaults to `"source"` when undefined so older serialized
 * layouts still work unchanged.
 */
export type Tab = {
  id: string;
  /** id of the file in the vault, or null for an empty "New tab". */
  fileId: string | null;
  title: string;
  viewMode?: "source" | "live" | "preview" | "slides";
  isPinned?: boolean;
};

/**
 * A node in the editor split-tree.
 *  - `"leaf"`  → a pane containing a list of tabs.
 *  - `"split"` → two children composed horizontally or vertically.
 *
 * Splits store the ratio of the FIRST child's size in [0.05, 0.95].
 */
export type SplitTree =
  | {
      kind: "leaf";
      id: string;
      tabs: Tab[];
      activeTabId: string;
    }
  | {
      kind: "split";
      id: string;
      direction: "horizontal" | "vertical";
      /** Fraction of the first child's size in [0.05, 0.95]. */
      ratio: number;
      a: SplitTree;
      b: SplitTree;
    };

/** Drop-zone edge inside a pane. `"center"` = merge into the leaf. */
export type DropEdge = "left" | "right" | "top" | "bottom" | "center";

/**
 * DataTransfer payload carried during a drag.
 *  - `kind: "tab"`  → an existing tab being moved (between or within leaves).
 *  - `kind: "file"` → a vault file being opened in a target leaf.
 */
export type DragPayload =
  | { kind: "tab"; leafId: string; tabId: string }
  | { kind: "file"; fileId: string };

/** MIME types used for native HTML5 drag-and-drop. */
export const DRAG_MIME = {
  tab: "application/x-flux-tab",
  file: "application/x-flux-file-id",
  text: "text/plain",
} as const;
