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

/**
 * Showcase note — exercises every renderer surface so we can eyeball
 * the editor stack end-to-end:
 *   • headings / lists / tables / blockquotes / inline code
 *   • [[wikilinks]] (both plain and piped) — click in preview to jump
 *   • task lists
 *   • fenced code blocks (syntax-highlighted in source, KaTeX/mermaid
 *     in preview)
 *   • inline + block KaTeX math
 *   • a mermaid diagram
 *   • slide separators (`---`) so toggling Slides view works
 *
 * Open this file from the left sidebar, then use the eye icon in the
 * doc-header to toggle Source ↔ Reading, or the ⋯ menu → "Slides view"
 * to see Reveal.js take over.
 */
const FEATURE_TOUR_MD = `# Feature tour

A single note that exercises every editor surface in flux.

> Toggle **Reading view** in the doc-header to render this with
> markdown-it + KaTeX + mermaid. Toggle **Slides view** from the
> overflow menu to see Reveal.js split on \`---\`.

## Wikilinks

Plain: [[welcome]]
Piped: [[projects/flux|the flux roadmap]]
Missing target (won't resolve): [[ghost-note]]

## Task list

- [x] Render headings
- [x] Render task checkboxes
- [ ] Wire real vault writes
- [ ] Persist scroll position across mode toggles

## Table

| Surface       | Library          | Trigger              |
| ------------- | ---------------- | -------------------- |
| Editor        | CodeMirror 6     | default              |
| Preview       | markdown-it      | eye icon             |
| Slides        | Reveal.js        | ⋯ → Slides view      |
| Graph         | force-graph      | "Graph" in sidebar   |
| PDF           | pdf.js           | open a .pdf file     |

## Code

\`\`\`ts
import { CodeMirrorEditor } from "@/components/flux-ui/editor/codemirror-editor";

export function Demo() {
  return <CodeMirrorEditor content="# hi" filePath="/x.md" onChange={() => {}} onSave={() => {}} />;
}
\`\`\`

## Math (KaTeX)

Inline: the Euler identity \\(e^{i\\pi} + 1 = 0\\) — or in dollars: $a^2 + b^2 = c^2$.

Block:

$$
\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}
$$

## Diagram (Mermaid)

\`\`\`mermaid
flowchart LR
  A[Source] -->|toggle| B[Preview]
  B -->|⋯ menu| C[Slides]
  A --> D[Graph]
  A --> E[PDF]
\`\`\`

---

## Slide two

Anything after a top-level \`---\` becomes a new slide in Reveal.js,
but stays a horizontal rule in the reading view.

- Bullet A
- Bullet B
- Bullet C

---

## Slide three

\`\`\`bash
pnpm dev
\`\`\`

Press <kbd>Esc</kbd> in Slides view to see the overview grid.
`;

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
  {
    id: "/feature-tour.md",
    name: "feature-tour.md",
    kind: "file",
    content: FEATURE_TOUR_MD,
  },
  {
    id: "/graph",
    name: "Graph",
    kind: "graph",
    content: "",
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
