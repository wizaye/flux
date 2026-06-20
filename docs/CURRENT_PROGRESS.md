# Flux — Current Progress (Status Snapshot)

> Last updated: 2026-06-20 — written for AI agents / contributors who need a
> single-page status of what's built, what's planned, and where the seams are.
> Cross-reference with `docs/PROJECT_PLAN.md`, `docs/feature_spec.md`,
> `docs/architecture.md`, and `docs/plugin-system.md`.

---

## 1. App identity & stack

- **Codename**: Zenvault (product) / Flux (repo)
- **Type**: Local-first PKM + active-learning desktop app, Obsidian-class
- **Stack** (verified, no inventions):
  - **Shell**: Tauri 2 (Rust 1.x + WebView2/WebKit/WebKitGTK)
  - **Frontend**: React 19, Vite 8, Tailwind v4, TypeScript ~6, shadcn/ui
  - **Editor**: CodeMirror 6 (mounted unmanaged via `useRef` + `view.destroy`)
  - **DB**: SQLite (bundled via `rusqlite`) with FTS5; pooled via `r2d2`
  - **Watcher**: `notify` + `notify-debouncer-full`
  - **IPC types**: `tauri-specta` (typed bindings; **no hand-written DTOs**)
  - **PKG mgr**: **pnpm only** (never npm/bun); workspace mode
  - **Lockfile**: `pnpm-lock.yaml` is canonical

- **Workspace layout** (root `pnpm-workspace.yaml`):
  - `.` — host app (`flux`)
  - `plugins/*` — first-party + future community plugins

---

## 2. File system + index — STATUS

### Implemented end-to-end (Rust → typed bindings → React hooks)

| Capability                       | Command                          | Notes |
|----------------------------------|----------------------------------|-------|
| Vault open / create / close      | `open_vault` / `create_vault` / `close_vault` | Atomic; starts file watcher |
| Get last vault path              | `get_last_vault_path`            | Auto-reopen on boot, wrapped in `withBusy` overlay |
| Read text                        | `read_file`                      | |
| Read binary                      | `read_file_binary`               | For PDFs / images via pdfjs |
| Write text                       | `write_file`                     | Atomic write → SQLite index update → FTS5 upsert |
| Create file                      | `create_file`                    | Wraps `write_file` after existence check |
| Delete file                      | `delete_file`                    | Soft-delete to `.trash/YYYY-MM/`; drops FTS row |
| Move / rename                    | `move_file` / `rename_file`      | **With wikilink healing** + FTS row rewrite |
| Create directory                 | `create_directory`               | |
| List directory                   | `list_directory`                 | |
| Get file tree                    | `get_file_tree`                  | Returns flat `FileTreeNode[]` |
| Get metadata                     | `get_file_metadata`              | size / mtime / ctime |
| List / restore / purge trash     | `list_trash` / `restore_from_trash` / `purge_trash_entry` | |
| **Write external (out-of-vault)**| `write_external_file`            | Used by export-to-PDF save dialog |
| **FTS5 search**                  | `search_files`                   | BM25 ranking, `<mark>`-pre-highlighted snippets |
| **Native Markdown → PDF**        | `export_markdown_to_pdf`         | `pulldown-cmark` + `printpdf` w/ 14 built-in fonts |

### Source of truth: filesystem; index is derived

- `.zenvault/index.db` — WAL mode, `synchronous=NORMAL`
- Schema: `migrations/001_init.sql` (`files`) + `migrations/002_fts.sql` (`files_fts`)
- Atomic writes everywhere (temp → fsync → rename)
- UUID v7 as `BLOB(16)`; BLAKE3 content hashing
- **Best-effort DB updates** — FS op never blocks on index write

### File watcher (`src-tauri/src/watcher.rs`)

- `notify-debouncer-full` with 250 ms window
- Coalesces inotify / FSEvents / ReadDirectoryChangesW bursts
- Filters `.zenvault/`, `.git/`, `node_modules/`, `.trash/`, dotfolders
- Reindexes changed files in a transaction (files + FTS together)
- Emits `flux://fs-changed` event with `{ changed: string[], removed: string[] }`
- Frontend listener: `src/hooks/use-fs-watcher-sync.ts` — debounced silent `refreshVault(true)`

### Frontmatter / title extraction (`src-tauri/src/commands/fs/mod.rs::extract_title`)

Precedence: YAML `title:` → first H1 → filename stem.
Capped to first 16 KiB of YAML to avoid pathological scans.

### Wikilink healer (`src-tauri/src/commands/fs/wikilink.rs`)

Triggered from `move_file` / `rename_file`.
Walks `.md` files in vault, rewrites:
- `[[Old Name]]`
- `[[Old Name|Alias]]`
- `[[Old Name#Section]]`
- `[[path/to/Old Name]]`

Returns real `links_healed` + `files_updated` counts to the UI.

### Known gaps (not yet built; see `docs/feature_spec.md` §1, §5, §20)

- `.gitignore` exclusion in tree walks (crate is in `Cargo.toml`, not wired)
- inotify-exhaustion polling fallback
- Block anchors (`^blk_<base32>`) — required for §5 task toggling

---

## 3. Loading + busy overlay system

- **`src/state/busy-store.ts`** — Zustand registry of active long-running ops
  - `begin(label, detail) → id`, `end(id)`, `update`, `clear`
  - Helper: `withBusy(label, asyncFn, detail?)`
  - Concurrent ops stack; overlay shows most-recently-started entry
- **`src/components/flux-ui/common/global-busy-overlay.tsx`** — full-screen scrim + `DotmCircular5` loader
  - 160 ms grace timer (quick ops never paint)
  - Blocks pointer / click / context-menu events while active
- **Wired into**: vault auto-open (`App.tsx`), vault picker (manual open/create), native PDF export

---

## 4. PDF export (TWO paths, by environment)

### Native Rust (Tauri runtime)

- `src-tauri/src/commands/export.rs` — `export_markdown_to_pdf(title, md, output_path)`
- Pipeline: `pulldown-cmark` (with GFM extensions: tables, strikethrough,
  tasklists, footnotes, smart punctuation, heading attributes, YAML frontmatter)
  → custom layout walker → `printpdf` w/ 14 built-in PDF fonts (Helvetica + Courier)
- **Zero font files bundled**; ~150 KB of extra Rust crates total
- Runs on `tokio::task::spawn_blocking` so the Tauri runtime stays responsive
- Wrapped in `withBusy("Exporting…")` so user can't double-trigger

### Browser preview fallback (`vite dev` standalone)

- `src/lib/doc-actions.ts::exportToPdf` — when no Tauri runtime:
  - Renders an off-screen `<iframe>` with hex/rgb-only stylesheet (avoids
    html2canvas's `oklch()` parser crash)
  - `iframe.contentWindow.print()` → native browser print dialog (`Save as PDF`)
  - `@page { margin: 0 }` suppresses Chrome's auto URL/date headers
  - `<title>` embedded in iframe HTML so OS save dialog pre-fills filename

### NOT supported (intentional)

- Mermaid SVGs, syntax-highlighted code, MathJax in the native path
- Either bundle a TTF (`resvg`, ~2 MB) OR switch to Typst-as-library (~10 MB)
  to enable — both are tracked as Phase D / nice-to-have

---

## 5. Plugin system — STATUS (Phase A + Phase B-b complete)

> Design spec: `docs/plugin-system.md`. Implementation order tracked in §16 there.

### Phase A — Infrastructure ✅

**Workspace + SDK**:

- `pnpm-workspace.yaml` includes `plugins/*`
- `plugins/sdk/` → `@flux/plugin-sdk` (workspace package)
  - `src/types.ts` — `PluginManifest`, `PluginCapabilities`, contribution
    point types (`ActivityBarItem`, `SidebarPanel`, `EditorView`, `Command`,
    `SettingsPanel`), `EditorViewProps`, host contracts (`VaultApi`,
    `WorkspaceApi`, `SearchApi`, `PluginStorageApi`, `PluginHost`)
  - `src/host.ts` — `createPluginHost({ pluginId, apiVersion })` returns a
    `PluginHost`. Phase A stub: `storage` works via localStorage namespace;
    other contracts reject with "not implemented in Phase A". Broker (Phase
    C) will swap the implementation, plugin import surface stays stable.
  - `src/layout.tsx` — `PluginPaneLayout` exposed via
    `@flux/plugin-sdk/layout`. Gives plugins the same chrome built-in
    editor views get (title row + body wrapper with `overflow-hidden`).
  - `src/drag.ts` — `pluginDragMime(pluginId, kind)`, `HOST_DRAG_MIMES`,
    `isHostDrag(e)`. Documents the MIME contract: plugins must never
    write `application/x-flux-tab` or `application/x-flux-file-id`.
  - `src/ui.ts` — re-exports curated shadcn primitives. **PHASE A ONLY**;
    today these point at the host's `src/components/ui/*`. See §5.5 for the
    migration plan once we publish the SDK to npm.

**Plugin store**:

- `src/state/plugin-store.ts` — Zustand `persist`-backed registry
  - Persists `{ id, enabled, version, pluginDir, manifest, loaderKind }` to `localStorage[flux-plugins]`
  - Derived contribution maps (recomputed on every mutation):
    - `activityBarContributions`
    - `editorViewRegistry` — `.kanban.json` → pluginId
    - `paletteCommands`
    - `settingsSections`
  - Non-persisted `builtinComponents` map — component refs for in-repo plugins
  - `loaderKind: "builtin" | "external"`:
    - "builtin" = bundled in this repo, ref passed at boot via registry
    - "external" = scanned from `.zenvault/plugins/`, lazy `import(asset://…)` (Phase C)

**Boot loader**:

- `src/plugins/registry.ts::registerBuiltinPlugins()`
- Called once from `FullShell` in `App.tsx`
- Idempotent; preserves user's previously-toggled enabled state
- All builtins start **disabled by default** (opt-in via Settings)

### UI contribution wiring ✅

| Contribution point | Where wired                                                 | Notes |
|--------------------|-------------------------------------------------------------|-------|
| `activityBarItem`  | `src/components/flux-ui/layout/activity-strip.tsx`          | Hairline divider above plugin icons |
| `sidebarPanel`     | `src/components/flux-ui/layout/left-sidebar.tsx`            | Plugin panel takes precedence over built-in view |
| `editorViews`      | `src/components/flux-ui/editor/pane.tsx::PaneBody`          | Longest-suffix match: `.kanban.json` beats `.json` |
| `commands`         | `src/components/flux-ui/common/command-palette.tsx`         | "Plugins" group at the end |
| `settingsPanel`    | `src/components/flux-ui/modals/settings-dialog.tsx`         | `CommunityPluginsBody` + per-plugin sections |

### Phase A drag-contract enforcement (3-layer defence) ✅

- **Layer A (host)**: `pane.tsx::handleBodyDragOver` ignores any drag whose
  `dataTransfer.types` doesn't include a reserved flux MIME — plugin drags
  never trigger split-preview.
- **Layer B (SDK)**: `pluginDragMime()` helper namespaces every plugin's
  drag MIME, two plugins can't collide.
- **Layer C (plugin)**: Plugins are expected to call `stopPropagation()` on
  drag handlers as belt-and-suspenders. Kanban does.

### Phase B-b — First-party Kanban plugin ✅

- `plugins/kanban/` → `@flux/plugin-kanban` (workspace package)
- `manifest.json` ships 5 contributions: activityBarItem, sidebarPanel,
  editorViews (`.kanban.json` / `.kanban`), commands (`kanban.new-board`),
  settingsPanel
- `src/board.ts` — `KanbanBoard` schema, `parseBoard`, `serializeBoard`,
  `emptyBoard`. Hand-editable JSON; resilient to malformed input.
- `src/view.tsx` — **`@dnd-kit/core` + `@dnd-kit/sortable`** drag-and-drop
  (NOT HTML5 drag — avoids OS ghost + host split-preview conflict). Custom
  `DragOverlay` shows a pixel-identical preview of the dragged card. All
  controls go through shadcn `Button` / `Input` / `Textarea` / `Badge`.
- `src/sidebar.tsx` — Lists `*.kanban.json` files. Toolbar `+` creates a
  new board via the existing `create_file` IPC; opens it via `flux-open-file`.
- `src/settings.tsx` — Two `PluginStorageApi`-backed inputs.
- `src/index.ts` — Bundles manifest + component refs for the boot loader.

### Phase B-b deps

- `plugins/kanban/package.json`:
  - `@dnd-kit/core ^6`, `@dnd-kit/sortable ^10`, `@dnd-kit/utilities ^3`
  - `@flux/plugin-sdk` (workspace:*)

### What users see

1. Open the app → nothing kanban-related visible.
2. Settings → Community plugins → "Kanban Board" with toggle. Flip on.
3. Activity bar gains a `LayoutGrid` icon below a hairline divider.
4. Click → left sidebar swaps to Kanban panel (board list + `+`).
5. `+` → creates `New Board <stamp>.kanban.json`, opens immediately in the
   board view.
6. `Cmd/Ctrl-K` → palette shows "Plugins → Kanban: New board".
7. Settings → Kanban section appears under "Community plugins".
8. Flip toggle off → everything disappears.
9. Restart app → state persists (enabled stays enabled).

### Phase A-only caveats (must address before npm publish of SDK)

**5.5. `@flux/plugin-sdk/ui` is currently host-coupled.**

Today `plugins/sdk/src/ui.ts` re-exports from `@/components/ui/*` (host
shadcn copies). This works for in-repo plugins because the host alias
resolves; it will **NOT** work for a standalone plugin template repo that
installs the SDK from npm.

**Plan for Phase D — Detach SDK from host shadcn**:

1. Copy curated shadcn primitives from `src/components/ui/*` into
   `plugins/sdk/src/ui/` (one folder per component).
2. Move `class-variance-authority`, `clsx`, `tailwind-merge`,
   `@radix-ui/react-*` from root `dependencies` to
   `plugins/sdk/package.json` `dependencies`.
3. Host can either:
   - keep its own copy under `src/components/ui/` (no migration needed), OR
   - also import from the SDK after publish (collapses duplication).
4. Plugin authors' contract remains identical: always import from
   `@flux/plugin-sdk/ui`, never from `@/components/ui`.

This is intentional debt; Phase A optimises for "ship Kanban quickly in
the repo", Phase D pays the debt before community plugins exist.

### Phase C — Backend broker (NOT YET BUILT)

Required to ship a non-trivial second plugin (Git VCS, real Excalidraw).
Per `docs/plugin-system.md` §17:

- Rust `load_plugin_manifests` for external plugins under `.zenvault/plugins/`
- `plugin_backend_call` broker with validation pipeline:
  1. plugin exists + enabled
  2. apiVersion compatibility
  3. capability granted
  4. payload schema valid
  5. route to contract handler
- Contract handlers:
  - `VaultApi.{read,write,listDir}` ← wraps existing fs commands
  - `WorkspaceApi.{openPath,revealInSidebar,showNotice}`
  - `SearchApi.query` ← wraps `search_files`
  - `PluginStorageApi` ← namespaced SQLite kv (or JSON in `.zenvault/plugins/<id>/storage.json`)
  - `GitApi.*` (status / fetch / pull / push / commit) — proves a real
    community plugin is possible
- Frontend SDK transport swap: `createPluginHost` returns broker-backed
  contracts instead of the Phase A localStorage stub.
- Capability prompt UX in Settings (show required capabilities at install time).

### Phase D — Marketplace (NOT YET BUILT)

- Plugin template repo + GH Actions release workflow (zip + sha256)
- Community `registry.json` (github-hosted)
- Install flow: download → verify checksum → unzip into
  `.zenvault/plugins/<id>/` → call `load_plugin_manifests`
- Update badge in Settings → Community plugins
- (See plugin-system.md §13 + §14.)

---

## 6. Editor surfaces — STATUS

| Surface          | File                                              | Status   |
|------------------|---------------------------------------------------|----------|
| Source CM6       | `src/components/flux-ui/editor/views/codemirror-editor.tsx` | Working, unmanaged |
| Live preview     | `src/components/flux-ui/editor/views/codemirror-editor.tsx` (livePreview prop) | Cursor-aware widgets |
| Reading view     | `src/components/flux-ui/editor/views/markdown-preview/*` | mermaid + shiki + mathjax3 |
| Slides           | `src/components/flux-ui/editor/views/slides-view.tsx` | reveal.js |
| Graph            | `src/components/flux-ui/editor/views/graph-view.tsx` | force-graph (will move to Pixi v8 per spec §4) |
| PDF              | `src/components/flux-ui/editor/views/pdf-view.tsx` | pdfjs-dist |
| Plugin views     | via `editorViewRegistry`                          | Kanban (`.kanban.json`) |

- **`EditorPaneLayout`** standardises chrome for built-in views.
- **`PluginPaneLayout`** (SDK) does the same for plugin views.
- **`PaneBody`** wrapper added `overflow-hidden` so no view (built-in or
  plugin) can spill past the editor pane bounds.

---

## 7. Doc-header `⋯` menu (per-tab actions)

Wired in `src/components/flux-ui/editor/views/document-header.tsx` (~12 items).
Highlights:

- **Open in new window** → detached Tauri webview (`src/detached-doc-shell.tsx`)
- **Bookmark** → opens `AddBookmarkDialog` (or removes if already bookmarked)
- **Move to…** / **Merge…** / **Frontmatter properties…** — all use shared dialogs
- **Export to PDF** → native Rust command in Tauri, browser-print fallback
- **Find / Replace** → opens left-sidebar search (NOT CM6 inline panel)

---

## 8. Sidebars

### Left sidebar (`src/components/flux-ui/layout/left-sidebar.tsx`)

- Views: Files, Search, Bookmarks (`changes`, `calendar`, `canvas` are stubs)
- Plugin sidebar takes precedence when `activePluginPanel` is set
- All panels share the layout contract:
  - 30 px centred icon toolbar (`SidebarToolbar`)
  - `SidebarRow` primitive (h-6, gap-1.5, paddingLeft = 8 + depth*12)
- Search panel uses FTS5 (with JS-scan fallback for browser preview)
- Bookmarks panel uses obsidian-parity layout: groups + group dropdown

### Right sidebar (`src/components/flux-ui/layout/right-sidebar.tsx`)

- Views: Backlinks (placeholder), Outgoing Links (placeholder), Tags (placeholder), Outline (placeholder)
- Saved view was removed (Bookmarks moved to left sidebar)

---

## 9. Settings dialog (`src/components/flux-ui/modals/settings-dialog.tsx`)

- 1100 × 740 Obsidian-parity dialog
- Sections: General, Editor, Files & links, AI & Privacy, Appearance,
  Hotkeys, Keychain, Core plugins (12 stubs), Community plugins (dynamic)
- All controls use shadcn primitives (Switch, Select, Slider, RadioGroup,
  Checkbox, ScrollArea, Input, Button)
- Hotkeys section: per-row reset + `HotkeyRecorder` (focus-trap that captures
  next non-modifier keydown)
- Theme + font-size sync via `useThemeAndFontSync` hook

---

## 10. Theme system

- `src/components/theme-provider.tsx` — own `useTheme` (replaces `next-themes`)
- D-key shortcut toggles dark mode (when not in an editable target)
- No transition-disable hack (removed; was causing visible stutter)

---

## 11. Removed / deprecated deps

| Dep             | Removed because                                           |
|-----------------|-----------------------------------------------------------|
| `next-themes`   | One trivial use; replaced with own `theme-provider`       |
| `html2pdf.js`   | Froze main thread + bundled 21 transitive deps; replaced by Rust + browser-print |

Active deps that drag a lot in transitively but earn their keep:
`mermaid`, `shiki`, `markdown-it`, `pdfjs-dist`, `force-graph`, `reveal.js`,
`@dnd-kit/*` (kanban only).

---

## 12. What an AI agent should do next (priority queue)

> Pick from the top; each item is self-contained.

### Tier 1 — Plugin Phase C (broker + contracts)

Without these, no real community plugin can do meaningful work.

1. **`plugin_backend_call` Rust command** + handler routing skeleton
   (`src-tauri/src/plugins/{mod.rs,broker.rs,permissions.rs}`)
2. **`VaultApi` handlers** (`src-tauri/src/plugins/contracts/vault.rs`)
   wrapping existing `read_file` / `write_file` / `list_directory`
3. **`WorkspaceApi.showNotice`** routes to sonner via a window event
4. **`SearchApi.query`** wraps `search_files`
5. **`PluginStorageApi`** — namespaced SQLite kv table or per-plugin JSON
6. Replace `createPluginHost` stub rejections with real broker calls
7. **Capability prompt** in Settings → Community plugins (show
   `manifest.capabilities.required` before allowing enable)

### Tier 2 — File-system spec compliance gaps

8. `.gitignore` exclusion in tree + watcher walks
9. inotify-exhaustion polling fallback
10. Block anchors (`^blk_<base32>`) — prereq for Feature 5 (Tasks)

### Tier 3 — SDK npm publish prep (§5.5)

11. Copy shadcn primitives into `plugins/sdk/src/ui/`, move deps
12. Verify Kanban still builds without host alias resolution

### Tier 4 — Marketplace

13. Plugin template repo (`zenvault-plugin-template`)
14. GH Actions release workflow (zip + sha256)
15. Community `registry.json` schema + validation CI
16. In-app install flow (download → verify → unzip → load_manifests)

### Tier 5 — Feature spec advances

17. Pixi v8 graph rewrite (spec §4)
18. JSON Canvas via `@xyflow/react@12` (spec §6)
19. Tutor mode (PDF → notes pipeline) (spec §7, §8)
20. FSRS v6 spaced repetition (spec §9)

---

## 13. Build / test commands

```bash
# Install
pnpm install

# Dev (Tauri + Vite)
pnpm tauri dev

# Production build
pnpm tauri build

# Type check (use this, NOT `pnpm exec tsc` which hits a core-js build approval)
node node_modules/typescript/bin/tsc --noEmit

# Frontend lint / test
pnpm lint
pnpm test
pnpm test:e2e

# Rust
cd src-tauri
cargo check --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo fmt --all
```

---

## 14. Non-negotiable rules (recap)

From `docs/LLM_SYSTEM_INSTRUCTIONS.md` §1 + `.github/copilot-instructions.md`:

1. **File system is source of truth.** `.zenvault/index.db` is derived.
2. **Rust owns all I/O.** UI never touches disk directly.
3. **Typed IPC via tauri-specta.** Never hand-write a TS DTO for a Rust
   command (regen `src/bindings.ts`).
4. **DB pool not Mutex.** Never hold a connection across `.await`. All
   SQLite inside `spawn_blocking`.
5. **UUID v7 as BLOB(16).** Block refs via `^blk_<base32>` anchors,
   never line numbers.
6. **Atomic writes** for user files: temp → fsync → rename.
7. **CM6 mounted unmanaged.** Raw `@codemirror/*`; never
   `@uiw/react-codemirror`.
8. **No invented libraries.** Lockfile + `docs/tech_stack.md` are the
   verified set.
9. **AI features have deterministic fallback.**
10. **Plugins are capability-scoped.**

---

## 15. Reading order for new contributors

1. `docs/PROJECT_PLAN.md`
2. This file (`docs/CURRENT_PROGRESS.md`)
3. `docs/architecture.md`
4. `docs/feature_spec.md`
5. `docs/plugin-system.md`
6. `docs/tech_stack.md`
7. `docs/LLM_SYSTEM_INSTRUCTIONS.md`
8. `docs/LLM_ANTIHALLUCINATION.md`
