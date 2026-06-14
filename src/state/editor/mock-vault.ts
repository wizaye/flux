/**
 * Mock vault — a tiny in-memory file tree the editor can render
 * against before the real Tauri-backed vault store lands. Mirrors the
 * shape `lattice/src/state/mockVault.ts` produces (folder + a handful
 * of markdown files), trimmed to the minimum needed to exercise the
 * editor chassis.
 *
 * Real-vault integration will replace this with a `useVaultStore`
 * read in a later phase.
 */
import type { FileNode } from "./types";

export const MOCK_VAULT_TREE: FileNode[] = [
  {
    id: "/welcome.md",
    name: "welcome.md",
    kind: "file",
    content:
      "# Welcome to flux\n\nThis is a placeholder note used while the editor chassis is wired up. " +
      "The full CodeMirror + Markdown stack lands in a follow-up phase.\n\n" +
      "Try dragging this tab between panes, splitting the pane via the icon in the doc header, " +
      "or right-clicking the tab for the context menu.",
  },
  {
    id: "/projects/",
    name: "projects",
    kind: "folder",
    children: [
      {
        id: "/projects/flux.md",
        name: "flux.md",
        kind: "file",
        content:
          "# flux\n\nDesktop knowledge base — Tauri + React 19 + Tailwind v4 + shadcn.\n\n" +
          "Phase 1 ports the editor *chassis*: panes, tabs, splits, drag-drop, drop overlays, " +
          "tab insertion indicator, in-pane menus, doc-header.\n\n" +
          "Phase 2 adds the real editor body (CodeMirror 6 + markdown-it).",
      },
      {
        id: "/projects/roadmap.md",
        name: "roadmap.md",
        kind: "file",
        content: "# Roadmap\n\n- [x] Shell\n- [ ] Editor chassis\n- [ ] CodeMirror\n- [ ] Reading mode",
      },
    ],
  },
  {
    id: "/scratch.md",
    name: "scratch.md",
    kind: "file",
    content: "# Scratch\n\nQuick notes go here.",
  },
];

/**
 * Flatten a tree of FileNodes into a `Map<id, FileNode>` for O(1)
 * lookup. The editor passes this map around so file-tab body
 * components can resolve `tab.fileId → FileNode` without walking the
 * tree on every render.
 */
export function flattenVault(tree: FileNode[]): Map<string, FileNode> {
  const out = new Map<string, FileNode>();
  function walk(nodes: FileNode[]) {
    for (const n of nodes) {
      out.set(n.id, n);
      if (n.children) walk(n.children);
    }
  }
  walk(tree);
  return out;
}

/** Default vault built from `MOCK_VAULT_TREE`. */
export const MOCK_VAULT: Map<string, FileNode> = flattenVault(MOCK_VAULT_TREE);
