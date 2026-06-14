# Skill: Debugging

> Activate when investigating a bug, regression, or weird behavior.

## Triage Flow

### 0. Reproduce

- Get exact repro steps (or write them).
- Capture: vault size, OS, app version, recent git SHA, error text.
- Try in a **fresh vault** (`~/.flux-debug-vault`) — does it still fail?
  - Yes → core bug.
  - No → vault-data specific. Bisect on vault.

### 1. Layer Localization

Where does the failure live? Pick the topmost layer that's actually misbehaving.

| Symptom | Likely layer |
|---|---|
| UI doesn't update after action | React state, React Query cache, Zustand store |
| Action throws "command not found" | tauri-specta binding drift; regenerate |
| Action returns serde error | Type mismatch between Rust DTO and TS; regenerate bindings |
| Action is slow (>200 ms) | DB query plan or unindexed FS walk |
| App freezes | Mutex across `.await`, or blocking call on async runtime |
| Editor doesn't render | CM6 mount/unmount order, or extension throwing |
| Graph blank | Pixi v8 init not awaited, or worker postMessage failed |
| File edits "lost" | Watcher debounce ate them, or atomic write failed |
| Wikilink dangling after rename | Wikilink Healer didn't run, or anchor regen failed |
| LLM returns junk | Schema validation off, or JSON repair failed |

### 2. Get Logs

Always with structured logs, never `println`:

```rust
RUST_LOG=info,zenvault=trace,sqlx=warn pnpm tauri dev
```

Key spans to look for:

- `command.<name>` — every Tauri command
- `fs.watch.event` — debounced file events
- `db.tx.<name>` — DB transactions
- `ai.call` — LLM calls with provider + model
- `plugin.host.<id>` — plugin invocations

In the UI, the dev console shows React Query devtools (enabled in dev).
Inspect query keys and stale state.

### 3. Bisect

- **Git bisect** when a regression appeared "recently". Mark the last known
  good commit and the first known bad.
- **Feature flag bisect** when multiple features could be involved — disable
  in Settings or via `localStorage.flux_disable_<feature>=1`.
- **Vault bisect** when only certain notes trigger it: binary-halve the
  vault into a temp folder.

### 4. Hypothesize → Test → Fix

For each hypothesis:

1. State the hypothesis in one sentence.
2. State the test that would falsify it.
3. Run the test (add a `tracing::debug!`, a temp script, or a test case).
4. If falsified, next hypothesis.
5. If confirmed, write the fix **plus a regression test** before claiming done.

### 5. After-Fix Checklist

- [ ] Regression test added (Rust `#[test]` or TS `*.test.ts`).
- [ ] Logs you added during debugging are removed or downgraded to `trace`.
- [ ] If the root cause was a doc inaccuracy, fix the doc too.
- [ ] If it was caused by a banned pattern (`Mutex<Conn>` etc.), add a
      lint or `#[deny]` if possible.
- [ ] CHANGELOG / commit message names the user-visible behavior change.

## Common Patterns by Class

### "It works in dev, breaks in production build"

- Tauri capability missing in `src-tauri/capabilities/`.
- Asset path needs `convertFileSrc` — dev permits `file://`, prod doesn't.
- Vite dev proxy hiding a CORS issue.
- Worker import path differs (`new Worker(new URL('./worker.ts', import.meta.url))`).

### "It works on macOS, breaks on Windows"

- Path separators (`PathBuf::join` is mandatory).
- File watcher behavior differs; debounce more aggressively on Windows.
- Reserved filenames (`CON`, `PRN`, `NUL`, …) — sanitize on note create.
- Long paths >260 chars need `\\?\` prefix or registry opt-in.

### "Intermittent test failures"

- Almost always a tokio test sharing state with another test. Use `tempfile`
  vaults per test, never a shared path.
- File watchers across tests — drop the watcher explicitly.
- SQLite WAL files left behind — close the pool before delete.

### "App slows down over time"

- Tracing subscriber buffering without flush.
- React Query stale cache growing unbounded.
- Pixi textures not destroyed on graph rebuild.
- A `notify` watcher attached to too many files (use `ignore` to filter).

## Don'ts

- Don't "fix" by removing the test — find the bug.
- Don't add `try/catch` to silence errors; surface them or fix the cause.
- Don't bump a dependency to make a bug go away — understand what changed.
- Don't disable lint rules to ship the fix.
