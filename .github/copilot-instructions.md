# Copilot Instructions — Flux

> These are repo-wide rules. They apply to **every** Copilot interaction in
> this workspace (chat, inline edits, code completion).
>
> Path-scoped rules in `.github/instructions/*.instructions.md` extend (never
> override) these.

## You are working on

**Flux** (codename "Zenvault") — a local-first PKM + active-learning desktop
app. Stack: **Tauri 2 · Rust · React 18 · CodeMirror 6 · SQLite FTS5**.
Uses **pnpm** (not npm).

## Read these before suggesting code

1. `docs/PROJECT_PLAN.md` — phases, perf budget, principles
2. `docs/architecture.md` — HLD/LLD Mermaid diagrams, ADRs
3. `docs/feature_spec.md` — 21 features with exact mechanics
4. `docs/tech_stack.md` — verified libraries and versions
5. `docs/LLM_SYSTEM_INSTRUCTIONS.md` — non-negotiable rules
6. `docs/LLM_ANTIHALLUCINATION.md` — verified library table + banned APIs
7. `docs/skills/*.md` — task-specific skill cards

If a request conflicts with these docs, the docs win. Surface the conflict
to the user before writing code.

## Non-negotiable rules (summary)

1. **File system is the source of truth.** `.zenvault/index.db` is derived;
   never sync it.
2. **Rust owns all I/O.** UI never touches the disk directly.
3. **Typed IPC via tauri-specta.** Never hand-write a TS DTO for a Rust
   command. Regenerate `src/bindings.ts`.
4. **DB pool, not Mutex.** Use `r2d2` + `r2d2_sqlite`. Never hold a
   connection across `.await`. All SQLite calls inside `spawn_blocking`.
5. **UUID v7 as BLOB(16).** Block refs via `^blk_<base32>` anchors,
   never line numbers.
6. **Atomic writes** for user files: write to temp in same dir, fsync, rename.
7. **CM6 mounted unmanaged.** Use raw `@codemirror/*` packages — never
   `@uiw/react-codemirror`, `@uiw/react-md-editor`, or any React wrapper.
8. **No invented libraries.** If it's not in `docs/tech_stack.md` or the
   lockfile, treat it as unverified.
9. **AI features have deterministic fallback.** Cloud LLMs receive only
   user-initiated payloads.
10. **Plugins are capability-scoped** (Extism v1 + manifest, default-deny).

Full list with rationale: `docs/LLM_SYSTEM_INSTRUCTIONS.md` §1.

## Commands (use these — don't invent flags)

```bash
pnpm install               # install JS deps
pnpm tauri dev             # dev (Tauri + Vite hot reload)
pnpm tauri build           # production build
pnpm lint                  # TS lint
pnpm typecheck             # TS typecheck
pnpm test                  # TS unit tests
pnpm test:e2e              # E2E
cargo check --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo fmt --all
```

This repo uses **pnpm**. Never suggest `npm install` or `npm run`.

## Banned (refuse and explain)

- `Arc<Mutex<rusqlite::Connection>>` as app state
- Holding a connection / mutex across `.await`
- `@uiw/react-codemirror`, `@uiw/react-md-editor`, `reactflow` (old), `pixi.js@<8`
- Hand-written types for Tauri commands (use tauri-specta)
- `useState` for vault data (use React Query + Tauri commands)
- Syncing `.zenvault/`
- Auto-merging Markdown prose on sync conflict (use conflict files)
- Renaming files without running the Wikilink Healer
- Sending vault content to cloud LLMs during background indexing
- Adding a dependency without an ADR in `docs/adr/`

Full table: `docs/LLM_ANTIHALLUCINATION.md` §3.

## Workflow

For every change request:

1. **Plan** in 3–5 bullets (files, command(s), DB, UI, test).
2. **Check** the relevant feature in `docs/feature_spec.md` and the matching
   sequence diagram in `docs/architecture.md` §3.
3. **Code** following path-scoped rules in `.github/instructions/`.
4. **Verify** with the appropriate command above.
5. **Document** — update `docs/feature_spec.md` if behavior changed; add an
   ADR if a dependency changed.

If you must violate a principle, **stop and ask** the user; do not silently
do it.

## Output style

- Concise; no preambles ("Sure!", "Here's what I'll do…").
- Diffs over full files when editing existing code.
- Cite files with `path:line` (e.g., `crates/zenvault-db/src/pool.rs:42`).
- When uncertain, say so explicitly — do not guess.
