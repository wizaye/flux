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
// Raw markdown content for the DQoS LLD fixture — kept in a sibling
// `.md` file so the prose can be edited freely without TS template-
// literal escaping. Vite's `?raw` query returns the file contents as
// a plain string at build time.
import DQOS_LLD_MD from "./dqos-lld.md?raw";

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
const FEATURE_TOUR_MD = `# Markdown edge-case test fixture

A single note that exercises every renderer surface in flux. Open it
in **Source** for the CodeMirror tokenizer, **Reading** for the
markdown-it / MathJax / Shiki / Mermaid pipeline, and toggle theme
with \`D\` while it's on screen to verify both palettes.

---

## 1. Headings (H1 → H6)

# H1 heading
## H2 heading
### H3 heading
#### H4 heading
##### H5 heading
###### H6 heading

Heading **with bold**, *italic*, ~~strike~~, \`code\`, and a [[wikilink]].

---

## 2. Paragraph emphasis

**Bold**, *italic*, ***bold italic***, ~~strikethrough~~, \`inline code\`,
and a single newline\\
forced linebreak.

A paragraph with multiple inline forms: \\(e^{i\\pi}+1=0\\), $a^2+b^2=c^2$,
inline \`code\`, **bold _nested italic_ bold**, and a [link](https://example.com).

---

## 3. Lists — every shape

Unordered nesting:

- alpha
- bravo
  - bravo.1
  - bravo.2
    - bravo.2.a
    - bravo.2.b
- charlie

Ordered (and ordered nesting):

1. first
2. second
   1. second.1
   2. second.2
3. third
4. fourth
5. fifth

Numbered list NOT starting at 1 (CommonMark would normally drop these,
but we render them):

5. five
6. six
7. seven

Mixed:

- item with \`inline code\`
- item with **bold** and *italic*
- item with a [link](https://example.com)
- item with $E = mc^2$

Task list (tight):

- [ ] todo one
- [x] done one
- [ ] todo two
  - [x] sub done
  - [ ] sub todo

Task list (loose — items separated by blank lines):

- [ ] loose todo

- [x] loose done

---

## 4. Tables

| Surface       | Library          | Trigger              |
| ------------- | ---------------- | -------------------- |
| Editor        | CodeMirror 6     | default              |
| Preview       | markdown-it      | eye icon             |
| Slides        | Reveal.js        | ⋯ → Slides view      |
| Graph         | force-graph      | "Graph" in sidebar   |
| PDF           | pdf.js           | open a .pdf file     |

Column alignment:

| Left | Center | Right |
| :--- | :----: | ----: |
| a    |   b    |     c |
| 100  |  10    |     1 |

---

## 5. Wikilinks

Plain: [[welcome]]
Piped: [[projects/flux|the flux roadmap]]
Missing target (won't resolve): [[ghost-note]]
Inside a list:

- See [[scratch]]
- And [[projects/roadmap|the roadmap]]

---

## 6. Code blocks — language coverage

\`\`\`ts
// TypeScript — type narrowing
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

function unwrap<T>(r: Result<T>): T {
  if (r.ok) return r.value;
  throw new Error(r.error);
}
\`\`\`

\`\`\`tsx
// TSX — JSX + types
export function Counter({ start = 0 }: { start?: number }) {
  const [n, setN] = React.useState(start);
  return <button onClick={() => setN(n + 1)}>{n}</button>;
}
\`\`\`

\`\`\`rust
// Rust — pattern matching
enum Shape { Circle(f64), Square { side: f64 } }

fn area(s: &Shape) -> f64 {
    match s {
        Shape::Circle(r) => std::f64::consts::PI * r * r,
        Shape::Square { side } => side * side,
    }
}
\`\`\`

\`\`\`python
# Python — list comprehension + f-strings
nums = [x * x for x in range(10) if x % 2 == 0]
print(f"squares of evens: {nums}")
\`\`\`

\`\`\`bash
# Bash — pipes and quoting
find . -name "*.md" -type f | xargs grep -l "TODO" | head -5
\`\`\`

\`\`\`json
{
  "name": "flux",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build"
  }
}
\`\`\`

\`\`\`sql
SELECT u.id, u.name, COUNT(o.id) AS orders
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
WHERE u.created_at > '2026-01-01'
GROUP BY u.id, u.name
HAVING COUNT(o.id) > 5;
\`\`\`

\`\`\`go
// Go — goroutines
package main

import (
    "fmt"
    "sync"
)

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 3; i++ {
        wg.Add(1)
        go func(n int) {
            defer wg.Done()
            fmt.Println("worker", n)
        }(i)
    }
    wg.Wait()
}
\`\`\`

Plain code block (no language):

\`\`\`
Plain text — no syntax highlighting,
just monospace chrome.
\`\`\`

Inline code with backticks: use \\\`\\\` to escape, or write \`const x = 1\`.

---

## 7. Math (MathJax)

Inline using parens: \\(e^{i\\pi} + 1 = 0\\)

Inline using dollars: $\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}$

Block (parens):

\\[
\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}
\\]

Block (dollars):

$$
\\begin{aligned}
\\nabla \\cdot \\vec{E} &= \\frac{\\rho}{\\epsilon_0} \\\\
\\nabla \\cdot \\vec{B} &= 0 \\\\
\\nabla \\times \\vec{E} &= -\\frac{\\partial \\vec{B}}{\\partial t} \\\\
\\nabla \\times \\vec{B} &= \\mu_0 \\vec{J} + \\mu_0 \\epsilon_0 \\frac{\\partial \\vec{E}}{\\partial t}
\\end{aligned}
$$

---

## 8. Diagrams (Mermaid)

Flowchart:

\`\`\`mermaid
flowchart LR
  A[Source] -->|toggle| B[Preview]
  B -->|⋯ menu| C[Slides]
  A --> D[Graph]
  A --> E[PDF]
\`\`\`

Sequence:

\`\`\`mermaid
sequenceDiagram
  participant U as User
  participant F as Flux
  participant R as Rust backend
  U->>F: open vault
  F->>R: open_vault(path)
  R-->>F: VaultHandle
  F-->>U: render tree
  Note over U,F: Toggle theme with D
\`\`\`

State:

\`\`\`mermaid
stateDiagram-v2
  [*] --> Idle
  Idle --> Loading: open file
  Loading --> Ready: bytes
  Loading --> Error: io err
  Ready --> Idle: close
  Error --> Idle: dismiss
\`\`\`

Class:

\`\`\`mermaid
classDiagram
  class Vault {
    +path: String
    +open()
    +close()
  }
  class FileNode {
    +id: String
    +name: String
    +kind: Kind
  }
  Vault o-- FileNode
\`\`\`

---

## 9. Blockquote variants

> Simple one-liner blockquote.

> Multi-paragraph blockquote.
>
> Second paragraph inside the same quote.

> Nested:
> > Inner quote.
> > > Deeper still.

> A blockquote with **markdown** inside, including \`code\` and a
> [link](https://example.com), and even a list:
>
> - one
> - two

---

## 10. Horizontal rules

Three styles — all should render as the same \`<hr>\`:

---

***

___

---

## 11. Edge cases that have bitten us before

Number-prefixed paragraph that should NOT become a list (no marker):

10 things you should know about flux. The sentence continues. The
number isn't followed by a dot+space so this is paragraph text.

Number-prefixed paragraph that SHOULD become a list:

10. an item
11. another item

Heading with inline code, math, and a wikilink: ## \`fn main\` $\\to$ [[scratch]]

Empty fenced code block:

\`\`\`
\`\`\`

Wikilink inside emphasis: *see [[scratch]] for details*.

Long URL that should wrap inside the column: https://example.com/very/long/path/that/keeps/going/and/going/and/needs/to/wrap/inside/the/preview/column/without/overflowing.

HTML-looking text that must be escaped: <script>alert("xss")</script>, <b>not bold</b>, &amp; literal ampersand.

---

## 12. Slide separators

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
    id: "/markdown-test.md",
    name: "markdown-test.md",
    kind: "file",
    content: FEATURE_TOUR_MD,
  },
  {
    id: "/dqos-lld.md",
    name: "dqos-lld.md",
    kind: "file",
    content: DQOS_LLD_MD,
  },
  {
    id: "/test.canvas",
    name: "test.canvas",
    kind: "canvas",
    // Minimal JSON Canvas 1.0 fixture so the canvas plugin can
    // render in browser preview without a real vault. Two text
    // nodes + one arrow between them.
    content: JSON.stringify(
      {
        nodes: [
          {
            id: "n1",
            type: "text",
            x: -200,
            y: -60,
            width: 220,
            height: 80,
            text: "Hello from the canvas plugin!",
          },
          {
            id: "n2",
            type: "text",
            x: 120,
            y: -60,
            width: 220,
            height: 80,
            text: "Drag, draw, sketch.",
          },
        ],
        edges: [
          { id: "e1", fromNode: "n1", toNode: "n2", toEnd: "arrow" },
        ],
      },
      null,
      "\t",
    ),
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
