# Zenvault — Corrected Feature Specification (2026)

> Supersedes the 14-feature mechanics in the prior chat. Every feature uses the
> contract: **Disk truth → Index (derived) → Transient UI → Sync event → IPC command**.

---

## Global Conventions (Apply to Every Feature)

| Concern | Rule |
|---|---|
| IDs | UUID **v7** (time-ordered, merge-safe). Never incremental counters. |
| Block anchors | Markdown trailing `^blk_<26-char-base32>` injected by the parser; survives Git merges. |
| Atomic writes | Always `write → fsync → rename` via a temp file in the same dir. Never partial writes. |
| Hashing | **BLAKE3** for file/content hashes (faster than SHA-256, used everywhere). |
| Errors | `thiserror` per crate, `AppError` at the Tauri boundary; never panic across IPC. |
| IPC | Generated TS types via `tauri-specta`; no hand-written DTOs. |
| Telemetry | `tracing` spans per command; opt-in metrics only. |

---

## 1. Vault Bootstrap & File Watcher Loop

**Goal:** Open or create a vault in <2 s; surface index updates within 500 ms of any file change.

**Disk truth**
- User content: `*.md`, `*.canvas`, `assets/**`.
- `.zenvault/` (hidden brain): `index.db`, `workspace.json`, `plugins/`, `logs/`, `keys/`.
- `.trash/`, `.archive/` at vault root.

**Index (derived)**
- `files(id UUID v7, path TEXT UNIQUE, title, blake3_hash, modified_at, state)`
- WAL mode, `synchronous=NORMAL`, mmap 256 MB.

**Watcher**
- `notify` + `notify-debouncer-full` (250 ms window, coalesces save bursts).
- Excludes `.zenvault/`, `.git/`, `node_modules/`, anything in `.gitignore`.
- Cross-platform caveats handled: macOS FSEvents needs full-disk-access prompt on first run; Linux uses inotify with a watch-count fallback to polling above 8192 dirs.

**IPC**
```ts
openVault(path: string): VaultHandle
createVault(path: string): VaultHandle
listChangedSince(ts: number): FileChange[]
```

**Failure modes**
- Path not writable → surface dialog, no index created.
- inotify exhausted → degrade to 2 s polling, warn in status bar.
- DB lock contention → retry with exponential backoff (busy_timeout = 5 s).

**Complexity** — Bulk index: O(F) bounded by parser throughput (target ≥ 5 k files/min).

---

## 2. Markdown Editor (CodeMirror 6, Truly Unmanaged)

**Goal:** Live-preview editing without React lifecycle interference.

**Implementation**
- A single `useRef<HTMLDivElement>()` mounts `EditorView` in `useEffect`, returns cleanup `view.destroy()`.
- All updates flow through CodeMirror transactions; React never sets editor state.
- File save = debounced 600 ms `Transaction` listener → atomic `write_file` IPC.

**Widgets (Live Preview)**
- A `StateField` listens to `selection.main.head`.
- When cursor leaves a line containing `![[image.png]]`, `- [ ]`, `$$...$$`, the field issues `Decoration.replace` with a `WidgetType` that:
  - Image → `<img src="asset://...">` (Tauri asset protocol).
  - Task → `<input type=checkbox>` bound to `toggle_task`.
  - Math → `katex.renderToString` (sync).
- Cursor returning to the line shows raw Markdown again.

**Extensions used**
- `@codemirror/lang-markdown` with `GFM` and `Math` extensions.
- `@codemirror/autocomplete` for wikilink suggestions, sourced from FTS5 prefix queries.
- `@codemirror/search` for in-file find/replace.

**Failure modes**
- File deleted under cursor → editor goes read-only with banner; new edits buffered to swap file in `.zenvault/swap/`.

**Complexity** — Viewport-bound rendering O(V); reparse on local edit is incremental via Lezer.

---

## 3. Asset Protocol (Local CORS-Safe Media)

**Goal:** Render local images/PDF previews without `file://` security blocks.

**Implementation**
- Use Tauri's built-in `asset:` protocol (no custom protocol needed in v2).
- `tauri.conf.json > app.security.assetProtocol.scope: ["$VAULT/**"]`.
- `convertFileSrc()` from `@tauri-apps/api/core` converts paths to safe URLs.

**Why corrected**
- Prior spec described registering a custom `asset://localhost/` and parsing requests manually. Tauri 2 ships this as a first-class plugin — don't reinvent.

**Failure modes**
- Path outside scope → 403; show broken-image placeholder + link to open externally.

---

## 4. Knowledge Graph (Pixi v8 + Worker, no SharedArrayBuffer in V1)

**Goal:** Smooth pan/zoom over ≥ 100 k nodes.

**Implementation (V1)**
1. `get_graph_slice(viewport_filter)` returns only nodes within a tag/folder/depth filter — never the full graph.
2. A dedicated Web Worker runs **`d3-force`** or a custom Barnes-Hut implementation; positions are streamed back via `comlink` with **transferable** `Float32Array`s on each tick.
3. Main thread renders with **Pixi v8** using `ParticleContainer` for nodes (instanced) and `Graphics` for edges.

**V2 upgrade path**
- If 100 k+ nodes need true zero-copy, add COOP/COEP headers and switch to SAB. Behind a feature flag.

**Why corrected**
- Pixi v3 was wrong (v8 is current; v3 lacks WebGPU backend).
- SAB requires COOP/COEP, which trips up other libs; not needed at V1 scale.

**Complexity** — Render O(V_visible + E_visible) per frame; physics O(N log N) Barnes-Hut.

---

## 5. Global Tasks (Two-Way Binding, Conflict-Aware)

**Goal:** Toggle a task anywhere; underlying Markdown stays canonical.

**Index**
- `tasks(id, file_id, block_anchor, line_hint, status, raw_text, due_at, project, indexed_at)`
- `block_anchor` is authoritative; `line_hint` is a soft cache for fast jumps.

**Toggle flow**
1. UI calls `toggle_task({ task_id, new_status })`.
2. Rust opens the file, **locates the line by `block_anchor`** (not by line number — line numbers drift after merges).
3. Replaces `- [ ]` ↔ `- [x]` and writes atomically.
4. Watcher reindexes; UI updated by invalidation event.

**Why corrected**
- Prior spec used raw `line_number` indexing, which silently corrupts on out-of-app edits or Git merges. Anchors fix this.

**Failure modes**
- Anchor missing (legacy line) → fall back to fuzzy match on `raw_text`, prompt user if ambiguous.

---

## 6. JSON Canvas (Whiteboards via @xyflow/react)

**Goal:** Portable mind maps with no vendor lock-in.

**Implementation**
- File format: **JSON Canvas 1.0** spec (`.canvas` files; identical to Obsidian's format).
- Renderer: **`@xyflow/react@12`** (the renamed React Flow). Supports edge labels, mini-map, controls out of the box.
- Index: only `canvas_nodes(id, canvas_path, node_type, ref_path)` and `canvas_edges` — text inside nodes is **not** added to FTS5 (kept clean per the prior spec).
- Embedded note nodes use the asset protocol for live preview.

**Why corrected**
- `reactflow` package is now `@xyflow/react`; mind to import paths.
- Spec falsely implied Pixi was an option for canvases. Use Pixi for the *graph* (Feature 4), `@xyflow/react` for *canvases* (different UX).

---

## 7. Tutor Mode — PDF Ingestion (BYOM)

**Goal:** Turn a PDF into linked notes + flashcards in <60 s for a 30-page doc.

**Pipeline**
1. **Extract** — `pdfium-render`: per page, capture `text + (x,y,w,h)` per text run. Detect tables via column clustering (X-coordinate buckets).
2. **Chunk** — `text-splitter` with Markdown awareness, target ~1200 tokens (`tiktoken-rs` for accurate counts), 150-token overlap.
3. **Schema-enforced LLM** — Use **JSON Schema** as the response contract:
   ```json
   { "title": "...", "summary": "...", "concepts": [{"name":"...","wikilinks":["..."]}],
     "flashcards": [{"front":"...","back":"...","cloze":[]}] }
   ```
   Send via `async-openai` (Ollama runs on the OpenAI-compatible endpoint at `/v1`).
4. **Parallel batch** — `tokio::spawn` with a `Semaphore(max_in_flight = 4)` to avoid local-model OOM.
5. **Emit** — Atomic writes: `Imports/<doc-slug>/<concept-slug>.md` with frontmatter linking back to the source PDF page range.
6. **Index** — Watcher picks them up like any other Markdown.

**Failure modes**
- LLM returns malformed JSON → retry up to 2× with "fix this to match the schema" reprompt; on third failure, fall back to deterministic mode (Feature 8) for that chunk.
- Ollama not running → router pings `/api/tags`, surfaces a dialog with provider picker.

**Why corrected**
- Replaced fictional `llm-chunker` with `text-splitter`.
- Replaced `ollama-rs` with `async-openai` (one client, many providers).
- Added explicit JSON Schema instead of "instructed prose."

---

## 8. Tutor Mode — Deterministic Fallback

**Goal:** Ingestion works without any LLM.

**Implementation**
- After PDF text extraction, split on `H1`/`H2` heuristics (font size > median + 2σ from `pdfium-render` font metrics, **not** just `#` regex — PDFs rarely contain Markdown).
- Emit one Markdown file per top-level section; no wikilinks created.
- Tag emitted files with `#orphan` and surface in the graph as orange nodes for manual linking.

---

## 9. Spaced Repetition (FSRS v6 — Correct)

**Goal:** Anki-quality scheduling, fully local.

**Implementation**
- Use **`fsrs` crate** from `open-spaced-repetition`.
- Schema:
  ```sql
  CREATE TABLE flashcards (
    id BLOB PRIMARY KEY,                 -- UUID v7
    source_block_anchor TEXT NOT NULL,
    front TEXT NOT NULL,
    back TEXT NOT NULL,
    stability REAL NOT NULL,
    difficulty REAL NOT NULL,
    state INTEGER NOT NULL,              -- 0=new 1=learning 2=review 3=relearning
    last_review TIMESTAMP,
    due TIMESTAMP NOT NULL,
    reps INTEGER NOT NULL DEFAULT 0,
    lapses INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_flashcards_due ON flashcards(due);
  ```
- Review session pulls `WHERE due <= now() ORDER BY due LIMIT N`.
- Rating (1=Again .. 4=Easy) → `FSRS::next_state(card, rating, now)` → update row.
- **Personal optimization**: once a user has ≥ 500 reviews, run `fsrs::optimize(history)` weekly in a background tokio task to tune their `w` parameters.

**Why corrected**
- "Anki uses FSRS v4 (stuck in legacy)" was false. Same engine. The differentiator is **per-user parameter optimization** + **mastery-by-concept** rollups, not the algorithm itself.

---

## 10. Sync — Git + Conflict Files (Correct)

**Goal:** Multi-device sync without DB corruption or silent data loss.

**Implementation**
- `git2` for users with a remote; SSH/PAT in OS keychain via `keyring`.
- `.gitignore` auto-managed; includes `.zenvault/index.db`, `.zenvault/logs/`, `.zenvault/swap/`.
- **Conflict handling**: on 3-way merge failure, write `Note (conflict 2026-06-14T10-12-33).md` next to the original (Obsidian convention) and surface a "Resolve conflicts" panel. Do NOT attempt automatic line-level merge of prose.
- For cloud drives (Dropbox/Drive/OneDrive) without Git, use a `.zenvault/sync_ledger.json` of `{path, hash, modified_at, remote_etag}` and the same conflict-file strategy.

**Index rebuild after pull**
- Compare `files.blake3_hash` against fresh hashes of changed paths; reindex only the delta.
- A full rebuild for 100 k files completes in <90 s on a recent laptop.

**Why corrected**
- Prior "if local > remote, upload" loses concurrent edits. The conflict-file strategy mirrors what mature local-first apps actually ship.

---

## 11. Plugin Sandbox (Extism v1 + Explicit Manifest)

**Goal:** Third-party extensions without compromising vault data.

**Plugin layout**
```
.zenvault/plugins/<name>/
  manifest.json
  plugin.wasm
```

**`manifest.json` schema**
```json
{
  "name": "tag-cleanup",
  "version": "1.2.0",
  "api": "1",
  "entrypoints": ["on_file_indexed", "command:cleanup_tags"],
  "capabilities": {
    "fs": { "read": ["**/*.md"], "write": [] },
    "net": { "hosts": [] },
    "vault": { "read_blocks": true, "write_blocks": false },
    "ui": { "commands": ["Cleanup Tags"], "settings_panel": true }
  },
  "signature": "ed25519:..."
}
```

**Host functions exposed to WASM**
- `host_log(level, msg)`
- `host_read_block(block_id) -> Result<String>`  (only if `vault.read_blocks`)
- `host_emit_event(name, payload)`
- `host_http_get(url)`  (only if `net.hosts` matches)

**Trust UX**
- First-run dialog enumerates requested capabilities; user must approve each.
- Subsequent capability changes require re-consent.
- A "Restricted" mode disables all plugin network access globally.

**Why corrected**
- Prior spec had `extism = "0.5"` and a `warpgate` "manager." Extism v1 is GA and has its own plugin lifecycle; warpgate is unrelated.

---

## 12. Archive & Trash (Two Distinct Lifecycles)

**Goal:** Cleanly separate "hide from active workflow" (Archive) from "delete safely" (Trash), with bounded disk usage.

**State machine** (also see `architecture.md` §3.8)

| State | `files.state` | Physical location | Indexed in | Searchable | In graph |
|---|---|---|---|---|---|
| Active | `active` | vault root | `blocks`, `links`, `tasks`, `flashcards` | primary `blocks_fts` | ✅ |
| Archived | `archived` | `.archive/<orig_path>` | row kept in `files`, edges removed from `links` | secondary `archive_fts` (opt-in toggle) | ❌ |
| Trashed | `trashed` | `.trash/<YYYY-MM>/<orig_path>` | hard-deleted via `ON DELETE CASCADE` | ❌ | ❌ |
| Purged | — | gone (`fs::remove_file`) | — | — | — |

**Implementation**
- Delete = `fs::rename` into `.trash/<YYYY-MM>/<original-path>` **+** `UPDATE files SET state='trashed'` (and `ON DELETE CASCADE` wipes `blocks`/`links`/`tasks`/`flashcards`). The physical file still exists for restore.
- Archive = `fs::rename` into `.archive/<original-path>` **+** `UPDATE files SET state='archived'` **+** mirror block content into `archive_fts` (a separate FTS5 virtual table).
- Restore = inverse rename; reindex from scratch via the watcher.
- Janitor: `tokio` task on app start AND every 24 h scans `.trash/**` and `fs::remove_file` for any file whose mtime + retention < now. Retention configurable per vault (default 60 days). Same job sweeps zero-byte cache files in `.zenvault/swap/`.
- Search UI exposes a toggle: `[ ] Include archived`. When on, the SQL query `UNION ALL`s `blocks_fts` + `archive_fts`.

**Failure modes**
- Cross-device rename (vault on different FS than `.trash`) → fall back to `copy + remove` + verify hash before deleting source.
- Restore collision (file with same name re-created) → append `(restored)` suffix.
- DB / disk drift (file present in `.trash` but no `files` row) → janitor logs and skips; rebuild covers it.

---

## 13. Workspace Persistence

**Goal:** Reopen exactly where the user left off.

**Implementation**
- Zustand store with `subscribeWithSelector` + 1000 ms debounce → `tauri-plugin-store` writes `.zenvault/workspace.json`.
- Schema:
  ```ts
  {
    version: 1,
    activeVault: string,
    openTabs: { id: string, path: string, scrollTop: number, cursor: { line: number, ch: number } }[],
    activeTabId: string,
    sidebar: { width: number, collapsed: boolean, active: 'files'|'search'|'graph'|'tasks' },
    theme: 'light' | 'dark' | 'system',
    splits: SplitTree
  }
  ```
- **Pre-paint hydration**: Rust reads `workspace.json` during Tauri setup and ships it through `tauri::Manager::manage` so the initial React render already has the state — no flicker.
- Version field gates a migration function on schema changes.

---

## 14. OTA Updates (Signed, ed25519)

**Goal:** Background updates with zero user friction.

**Implementation**
- GitHub Actions matrix builds `{macos-14, ubuntu-22.04, windows-2022}` per release tag.
- Workflow signs binaries with `tauri signer sign`; private key in repo secret `TAURI_SIGNING_PRIVATE_KEY`.
- Publishes `latest.json` with per-platform URLs + ed25519 signatures.
- `tauri-plugin-updater` checks on startup AND every 6 h while idle; downloads delta to temp; verifies signature; prompts user; swaps binary; restarts.
- Rollback: keep the previous binary one version back; if first launch after update crashes within 30 s, auto-rollback.

---

## 15. Search (FTS5 + Optional Semantic Re-rank — New)

**Goal:** Keyword search instant; semantic search opt-in.

**Implementation**
- Primary: SQLite **FTS5** virtual table over `blocks.content`; BM25 ranking.
- Snippets via `snippet()` SQL function (start/end markers + context window).
- **Optional V2**: `sqlite-vec` table `blocks_vec(rowid, embedding FLOAT[768])`; embeddings generated via the configured LLM provider (or a local `gte-small` ONNX model). Re-rank top-100 FTS hits by cosine similarity for hybrid search.
- Query coalescing: identical queries within 200 ms share one DB roundtrip.

**Failure modes**
- FTS5 not available (custom SQLite build) → fall back to `LIKE` with full warning; this should never happen because `rusqlite` is built `bundled` with FTS5.

---

## 16. LLM Router (BYOM/BYOC — New, Explicit)

**Goal:** One backend that talks to local + cloud models with strict cost/safety controls.

**Providers**
- **Local**: Ollama (`http://localhost:11434/v1`), llama.cpp server, LM Studio. All OpenAI-compatible.
- **Cloud**: OpenAI, Azure OpenAI, Anthropic, Google. Each behind a thin adapter; keys in keychain.

**Router contract**
```rust
pub trait LlmProvider: Send + Sync {
    async fn complete(&self, req: ChatRequest) -> Result<ChatResponse, LlmError>;
    async fn complete_structured<T: schemars::JsonSchema + DeserializeOwned>(
        &self, req: ChatRequest, schema_name: &str
    ) -> Result<T, LlmError>;
    async fn stream(&self, req: ChatRequest) -> Result<BoxStream<Token>, LlmError>;
    fn capabilities(&self) -> Capabilities;   // ctx_size, tools, json_mode, vision
}
```

**Cost guardrails**
- Per-vault monthly token budget (configurable, default ∞ for local, $20 for cloud).
- Budget tracker logs `provider, model, in_tokens, out_tokens, cost_usd, command` to `.zenvault/usage.db`.

**Privacy guardrails**
- Cloud providers receive only the user-initiated payload; never background indexing content.
- A "fully local" toggle in settings refuses to instantiate cloud providers.

---

## 17. Concept Graph (V2 — Moved from prior V2 spec, refined)

**Goal:** Surface prerequisites without manual tagging.

**Implementation**
- Schema:
  ```sql
  CREATE TABLE concepts (id BLOB PRIMARY KEY, name TEXT UNIQUE, description TEXT, mastery REAL DEFAULT 0);
  CREATE TABLE concept_edges (source BLOB, target BLOB, relation TEXT, weight REAL, PRIMARY KEY(source, target, relation));
  CREATE INDEX idx_edges_target ON concept_edges(target);
  ```
- Population: LLM extracts `Concept{name, prerequisites[]}` per ingested document; deduped against `concepts.name` (lowercase + Levenshtein < 2).
- Mastery rollup: aggregate FSRS retrievability of all flashcards tagged to a concept; smoothed EMA.
- Prerequisite query: recursive CTE (already in your prior spec — correct).

---

## 18. Heatmap / Mastery Dashboard (V2)

- Read-only views over `flashcards` + `concepts`; pure SQL, rendered as a calendar heatmap (custom SVG, no extra dep).
- "Weak this week" = concepts with retrievability drop > 15 % WoW.

---

## 19. File Explorer (Virtualized, DnD, Wikilink-Safe)

**Goal:** Smooth 60 fps tree over ≥ 100k files; safe rename / move / delete that always keeps Markdown links valid.

### 19.1 Data shape (flat tree, depth-encoded)

Rust returns a 1-D array; the React tree is purely visual via `paddingLeft: depth * 16`. Lazy expansion: clicking a folder asks Rust for that subtree only — the array is spliced in place.

```ts
type Row = {
  id: string;            // absolute path, stable
  type: "folder" | "file";
  name: string;
  depth: number;         // 0 = vault root children
  parentId: string | null;
  isOpen?: boolean;      // folders only
  state?: "active" | "archived" | "trashed";
  childCount?: number;   // folders only
  size?: number;         // files only
  modified_at?: number;
};
```

### 19.2 Rendering

- **`@tanstack/react-virtual`** with `count = rows.length`, `estimateSize = () => 28`.
- Rows are absolutely positioned inside a measured container; only the ~30 visible rows live in the DOM at any moment.
- Folder open/close state lives in Zustand (`explorer.openFolders: Set<string>`), persisted to `workspace.json`.
- Right-click → **Radix `ContextMenu`** with: New Note · New Folder · Rename · Move … · Archive · Delete · Reveal in OS · Copy Path · Copy Wikilink.

### 19.3 Drag & Drop (`@dnd-kit/*`)

- `DndContext` with `closestCenter` collision strategy + `restrictToParentElement` modifier so users can't drag rows outside the panel.
- Each row is both `useDraggable` and `useDroppable` (folders only as drop targets).
- On `onDragEnd`, dispatch `move_file({ src, dst })`.
- Multi-select via `Ctrl/Cmd+Click`; batched moves use a single Rust transaction.

### 19.4 Filesystem operations (Rust, atomic)

| Op | Implementation | Concerns |
|---|---|---|
| Create file | write empty `.md` with frontmatter via `write_atomic` | name collision → append `(2)` |
| Create folder | `fs::create_dir_all` | — |
| Rename | `fs::rename` + **Wikilink Healer** (Feature 20) in one DB txn | case-only renames on case-insensitive FS need a 2-step rename |
| Move | `fs::rename` if same FS, else `copy + verify hash + remove` | cross-volume slow path; show progress toast |
| Reveal in OS | `tauri-plugin-shell` → `Finder` / `Explorer` / `xdg-open` | sandbox scope must allow vault path |
| Archive | move into `.archive/` + state transition (Feature 12) | preserve relative structure |
| Delete | move into `.trash/YYYY-MM/` + state transition (Feature 12) | retention janitor (Feature 12) |
| Copy Wikilink | clipboard write `[[<relative-no-ext>]]` | resolves the canonical short form |

All operations are dispatched as Tauri commands and wrapped in a single SQLite transaction so the index never sees a partial state.

### 19.5 Watcher coordination

- The watcher tags self-initiated moves with a sentinel (recent `(src, dst)` tuple kept in a `DashMap` with 5 s TTL) to avoid double-reindexing.
- External moves (the user edits the vault from VS Code / Finder while Zenvault is open) still flow through the same reindex path — index converges.

### 19.6 Failure modes

- Drop onto a path that no longer exists (concurrent external delete) → toast "Folder vanished — refreshing tree", reload from disk.
- Permission denied on rename → surface OS error; leave UI state unchanged.
- Move that would create a cycle (folder into itself) → reject pre-flight.

### 19.7 Performance budget

| Op | Target |
|---|---|
| Expand a 10k-file folder | <200 ms (Rust enumerate + IPC) |
| Drag-scroll a 100k-file tree | sustained 60 fps |
| Single move + wikilink heal across 50 referrers | <300 ms p95 |
| Tree initial paint on cold boot | <80 ms (rendered with already-restored open-folder set) |

---

## 20. Wikilink Auto-Heal (Rename / Move)

**Goal:** A file rename or move must never leave a dangling `[[link]]`. This is the single most common silent-data-loss bug in PKM apps.

**Trigger surfaces**
- Explorer rename / move / archive / restore (Feature 19, 12).
- External rename caught by the watcher.

**Algorithm**
1. Resolve the **source identity** = `(old_relative_path, file_id)`.
2. `SELECT source_block_id, source_file_id FROM links WHERE target_path = ?old OR target_file_id = ?file_id`.
3. For each referrer file, **load → edit AST → write atomically**:
   - Wikilinks: rewrite `[[Old]]` / `[[Old|Alias]]` → `[[New]]` / `[[New|Alias]]` (preserve aliases).
   - Embeds: rewrite `![[Old]]` similarly.
   - Markdown links: rewrite `[text](Old.md)` → `[text](New.md)` (relative paths resolved against the referrer's folder).
4. In the same SQLite transaction:
   - `UPDATE files SET relative_path = ?new WHERE id = ?file_id`.
   - `UPDATE links SET target_path = ?new WHERE target_path = ?old`.
   - `UPDATE links SET target_file_id = ?file_id WHERE target_path = ?new AND target_file_id IS NULL` (resolve any previously-orphan links pointing at the new name).
5. Emit `links-healed` event with `{ rewritten_files: number, rewritten_links: number }`; UI shows a toast with **Undo** (which simply reverses the rename).

**Concurrency**
- Hold the **rename mutex** for the duration; concurrent saves to referrers are blocked at the FS layer via a short-lived advisory lock recorded in `.zenvault/.locks/`.
- The watcher ignores writes whose `(path, content_hash)` matches the healer's own outgoing writes (sentinel cache).

**Edge cases**
- Case-only rename on Windows/macOS APFS-default → do `Foo.md` → `Foo.tmp.md` → `foo.md` two-step.
- Ambiguous short-form links (`[[Index]]` matching multiple files) → leave untouched; surface a "Link ambiguity report".
- Markdown link with URL fragment (`Foo.md#heading`) → preserve fragment.
- Broken (pre-existing) link → record in `links.target_file_id IS NULL`; healer doesn't try to invent targets.

**Failure modes**
- Write fails midway through batch → transaction rolls back DB; FS already-written changes are rolled back by re-applying the inverse from the in-memory diff log.
- File becomes read-only between read and write → abort that referrer, continue with the rest, surface a per-file error list.

---

## 21. Command Palette + Quick Switcher

**Goal:** Sub-100 ms keyboard-driven access to every action and file.

**Implementation**
- **`cmdk`** for the React palette UI (matches the Linear / Raycast UX).
- Two modes, both bound to `Cmd/Ctrl+K`:
  - **Files**: fuzzy match over `files.relative_path` + recent-files boost (MRU table in workspace state).
  - **Commands**: fuzzy match over a static registry of typed `Command` objects auto-extracted from `tauri-specta` bindings + plugin-provided commands.
- Query flow: keystroke → 80 ms debounce → `search_palette(query, mode, limit=50)` → re-render virtualized list.
- Selecting a result executes the command or opens the file; the palette closes via Radix `Dialog` focus return.
- All actions are undoable via a generic command bus (`undo_stack: VecDeque<Inverse>`).

---

## Feature → Phase Map

| Phase | Features | Target weeks |
|---|---|---|
| **V1 MVP** | 1, 2, 3, 5, 12, 13, 15, **19**, **20**, **21** | 0–6 |
| **V1 Magic Demo** | 7, 8, 9, 16 | 4–8 |
| **V2 Power** | 4, 6, 10, 14, 17, 18 | 8–16 |
| **V3 Ecosystem** | 11 (plugins), 16 hardening, multi-vault | 16–24 |

---

## What Was Cut from Prior Spec

- **"Self-correcting flashcards" weekly auto-rewrite** — pushes hard on LLM cost; deferred to V2 behind explicit user action.
- **Real-time Socratic sidebar** — V3 only; latency budget incompatible with editor UX in V1.
- **GraphBLAS / DuckDB for concept graph** — recursive CTE on SQLite handles 100 k concepts comfortably.
- **`Personal Learning Twin` marketing term** — kept as a product narrative, but not a technical feature.
