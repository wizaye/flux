---
applyTo: "**/*.rs"
---

# Rust Instructions — Flux

Path-scoped rules for all `*.rs` files. Extends `.github/copilot-instructions.md`.

## Crate Layout (workspace)

```
src-tauri/                  app crate (Tauri commands, wiring, main)
crates/
  zenvault-domain/          pure types, IDs, anchors, errors. No I/O.
  zenvault-db/              pool, migrations, repositories
  zenvault-fs/              watcher, atomic writes, path safety, healer
  zenvault-parse/           Markdown → blocks, links, anchor regen
  zenvault-ai/              LLM router, providers, schema-enforced JSON
  zenvault-plugins/         Extism host, capability gate
```

A new domain type lives in `zenvault-domain`. A new SQL table lives in
`zenvault-db/migrations/NNN_*.sql`. Don't put I/O in `zenvault-domain`.

## Concurrency / DB

- **DB handle = `r2d2::Pool<SqliteConnectionManager>`** stored in Tauri
  managed state. Never `Arc<Mutex<Connection>>`.
- **All SQLite calls** run inside `tokio::task::spawn_blocking`. Borrow from
  the pool inside the closure.
- **Never** hold a `PooledConnection` or `MutexGuard` across `.await`.
- Writes use `BEGIN IMMEDIATE; ... COMMIT;` explicitly.
- PRAGMAs set in pool's `on_connect`:
  ```rust
  conn.execute_batch("
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous  = NORMAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      PRAGMA temp_store   = MEMORY;
      PRAGMA mmap_size    = 268435456;
  ")?;
  ```

## Tauri Commands

- Defined in `src-tauri/src/commands/<area>.rs`.
- Signature pattern:

  ```rust
  #[tauri::command]
  #[specta::specta]
  #[tracing::instrument(skip(state), err)]
  pub async fn <verb_noun>(
      state: tauri::State<'_, AppState>,
      input: <InputType>,
  ) -> Result<<OutputType>, AppError> {
      // 1. validate input (path safety, length, etc.)
      // 2. spawn_blocking for any DB / heavy work
      // 3. return typed result
  }
  ```

- Register in `tauri::generate_handler![...]` in `main.rs`.
- Regenerate `src/bindings.ts` via tauri-specta build hook.
- Input and output types live in `zenvault-domain` so they're sharable.

## Errors

- One `thiserror` enum per crate, e.g., `DbError`, `FsError`, `AiError`.
- App-level `AppError` (in `zenvault-domain`) wraps them with `#[from]`.
- `AppError` derives `serde::Serialize` + `specta::Type` so TS gets a
  discriminated union.
- **Never** `unwrap()` or `expect()` in production paths. Comment exceptions
  with `// invariant: ...`.

## Tracing

- Add `#[tracing::instrument(skip(big_args), err)]` to every public async fn.
- Span names: `command.<name>`, `fs.watch.<event>`, `db.tx.<name>`,
  `ai.call`, `plugin.host.<id>`.
- Log levels: `error` for user-visible failures, `warn` for recoverable,
  `info` for state changes, `debug`/`trace` for hot paths.
- **Never** `println!` / `eprintln!`.

## File System

- Use `PathBuf::join` — never string concat.
- Sanitize all incoming paths:
  - Reject `..`, absolute paths leaving the vault, NUL bytes.
  - Reject Windows reserved names (`CON`, `PRN`, `NUL`, `COM1..9`, `LPT1..9`).
  - Length-limit per platform; `\\?\` prefix on Windows for >260.
- Atomic writes:
  ```rust
  let tmp = path.with_extension("tmp.<uuid>");
  fs::write(&tmp, bytes)?;
  tmp_file.sync_all()?;
  fs::rename(&tmp, &path)?;
  ```
- Async file I/O: `tokio::fs` or `spawn_blocking`. Never `std::fs::*` on the
  runtime thread.

## IDs & Anchors

- IDs are `uuid::Uuid::now_v7()`, stored as `BLOB(16)`.
- Block anchors are `^blk_<26-char-base32>`. Anchor regeneration happens in
  `zenvault-parse` and is idempotent.
- A block reference is `(file_path, anchor)` — never a line number.

## Dependencies

- Check `Cargo.toml` before suggesting a version.
- A new dependency requires an ADR in `docs/adr/`.
- Verified crates listed in `docs/tech_stack.md` §1 and
  `docs/LLM_ANTIHALLUCINATION.md` §2. Anything else is unverified.

## Tests

- Unit: `#[cfg(test)] mod tests { ... }` next to code.
- Integration: `crates/<crate>/tests/<topic>.rs`; build a temp vault with
  `tempfile::TempDir`.
- DB tests use a per-test temp DB; close the pool before drop to avoid
  WAL file leaks.
- Async tests: `#[tokio::test(flavor = "multi_thread")]`.

## Forbidden

- `Arc<Mutex<Connection>>` as global DB handle
- Holding `MutexGuard` / `PooledConnection` across `.await`
- `unwrap()` / `expect()` outside tests (without invariant comment)
- `println!` / `eprintln!`
- `env_logger`
- `std::fs::*` on async paths
- `std::process::Command::new("ollama")` — Ollama is HTTP only
- Storing UUIDs as `TEXT`
- Path string concat
- `urlencoding` crate for asset URLs — Tauri 2 handles it
- Inventing Tauri APIs from Tauri 1 docs

## When to ask

- The change crosses crate boundaries in an unobvious way.
- A new SQL migration would need a backfill on existing user data.
- A new dependency is needed.
- A principle in `docs/LLM_SYSTEM_INSTRUCTIONS.md` §1 is in tension with the
  task.
