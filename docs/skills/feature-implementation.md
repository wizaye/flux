# Skill: Feature Implementation

> Activate when adding or changing a feature in `docs/feature_spec.md`.

## The 5-Step Feature Contract

Every feature in Flux must answer five questions, in this order. Skipping a
step is a defect.

### 1. Disk

> What changes on disk? What's the file shape, location, atomicity?

- Where does the data live? (e.g., `vault/**/*.md`, `.zenvault/index.db`,
  `.zenvault/trash/`)
- Is the write atomic? (`write_atomic`: temp file in same dir → fsync → rename)
- Is it crash-safe? (What happens if the app dies mid-write?)
- Are paths sanitized? (No `..`, no absolute-out-of-vault, no reserved
  Windows names.)
- Does it interact with the **Wikilink Healer** (Feature 20)? Renames/moves
  always trigger it.

### 2. Index

> What changes in `index.db`? Migration? Query path?

- Which tables are touched? (See `docs/architecture.md` §2 for the ER
  diagram.)
- Is there a new migration in `crates/zenvault-db/migrations/NNN_*.sql`?
- Are IDs UUID v7 stored as `BLOB(16)`?
- Are block references via `^blk_<base32>` anchors, not line numbers?
- Are writes in `BEGIN IMMEDIATE` transactions?
- Are queries served via the pool + `spawn_blocking`?

### 3. UI

> What does the user see? What component owns it?

- Which route / panel? (Editor, Graph, Canvas, Tutor, Cards, Settings…)
- New components go in `src/features/<feature>/`.
- State: Zustand store key, React Query key, or component-local?
- Keyboard shortcuts: registered in the global shortcut registry, surfaced
  in the Command Palette (Feature 21).
- Loading and empty states are explicit, not optional.
- The component must work offline and with an empty vault.

### 4. Command

> What Tauri command(s) does the UI invoke? Typed via tauri-specta.

- Command name: snake_case in Rust, camelCase in TS bindings.
- Input/output types in `crates/zenvault-domain` so they're sharable.
- Return `Result<T, AppError>`.
- Register in `src-tauri/src/main.rs` `tauri::generate_handler![...]`.
- Regenerate `src/bindings.ts` (`pnpm gen:bindings` or the tauri-specta build
  hook).
- Add `tracing::instrument` and emit a span per command.

### 5. Failure

> What can go wrong? What's the deterministic fallback? How do we test it?

- Enumerate failure modes:
  - Disk full / read-only
  - File deleted out from under us
  - Sync conflict (file already moved)
  - LLM offline / 429 / malformed JSON
  - Permission denied (mobile / sandbox)
  - Migration mismatch (older index version)
- Each failure → either a typed `AppError` variant or a deterministic
  fallback (Feature 8 covers AI fallbacks).
- Add a unit test for the happy path and at least one failure mode.
- Add an integration test under `crates/<crate>/tests/` if it crosses
  process boundaries (file watcher, plugin host, etc.).

## Output Template

When proposing a feature change, structure the plan as:

```
## Feature: <name> (F<NN>)

**Disk**
- ...

**Index**
- migration: NNN_<title>.sql
- tables: ...

**UI**
- route/panel: ...
- components: src/features/<feature>/...
- state: ...

**Command**
- `command_name(...) -> Result<T, AppError>`
- registered in src-tauri/src/main.rs

**Failure**
- modes: ...
- fallback: ...
- tests: ...
```

Only after this is approved do you write code.

## Cross-Feature Triggers

If you touch the file system, you almost certainly trigger:

| Triggered by | What runs |
|---|---|
| File create / change | Watcher → parse → upsert in index |
| File rename / move | Watcher → Wikilink Healer (F20) → reindex |
| File delete | Move to `.zenvault/trash/` (F12), don't `rm` |
| Markdown body change | Re-parse blocks → reconcile anchors → tasks/links update |
| Asset added | Asset protocol cache invalidation if cached |

Document which triggers your feature relies on.
