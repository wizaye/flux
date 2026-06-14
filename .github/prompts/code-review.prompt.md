---
mode: agent
description: Review a diff or PR against the 10 locked principles and banned-API list for Flux.
---

# Code Review — Flux

You are reviewing a code change. Be **strict but useful**: only surface
issues that genuinely matter (bugs, principle violations, security,
data-safety, perf budget). **Do not** comment on style, formatting, or
trivial wording. The linters cover those.

## Inputs

- The diff to review (paste, file, or branch — I will provide).
- Optional: the feature spec section the change targets.

## Reference docs (read before reviewing)

- `docs/LLM_SYSTEM_INSTRUCTIONS.md` §1 — non-negotiable rules
- `docs/LLM_ANTIHALLUCINATION.md` §3 — banned APIs / patterns
- `docs/feature_spec.md` — feature mechanics
- `docs/architecture.md` — diagrams + ADRs
- `docs/PROJECT_PLAN.md` §6 — perf budget
- `.github/instructions/rust.instructions.md`
- `.github/instructions/typescript.instructions.md`

## Checklist (run every item against the diff)

### Data safety
- [ ] No file write that isn't `write → fsync → rename`?
- [ ] No `rm` / delete that bypasses `.zenvault/trash/`?
- [ ] No rename/move without triggering the Wikilink Healer (Feature 20)?
- [ ] No code that would sync `.zenvault/`?
- [ ] No silent prose merge on sync conflict?

### Concurrency / DB
- [ ] No `Arc<Mutex<Connection>>` as app state?
- [ ] No connection / mutex held across `.await`?
- [ ] All SQLite calls inside `spawn_blocking` (or `sqlx`)?
- [ ] Writes use `BEGIN IMMEDIATE`?
- [ ] PRAGMAs set at pool init, not per query?

### IDs & anchors
- [ ] UUID v7 stored as `BLOB(16)` (not `TEXT`)?
- [ ] Block references use `^blk_<base32>` anchors, not line numbers?
- [ ] Anchor regen is idempotent (no duplicates on re-parse)?

### IPC
- [ ] Command DTOs in `zenvault-domain`?
- [ ] `#[specta::specta]` on the command?
- [ ] `bindings.ts` was regenerated (not hand-edited)?
- [ ] Errors return `Result<T, AppError>`?

### Frontend
- [ ] No `@uiw/react-codemirror`, `@uiw/react-md-editor`, `reactflow` (old),
      `pixi.js@<8`?
- [ ] CM6 mounted unmanaged in `useEffect`, destroyed on unmount?
- [ ] Vault data sourced via React Query + Tauri command, not `useState`?
- [ ] Lists > 100 rows virtualized?
- [ ] No `dangerouslySetInnerHTML` on unsanitized Markdown?

### AI / LLM
- [ ] Deterministic fallback present?
- [ ] LLM JSON output schema-validated with retries?
- [ ] No background job sending vault content to cloud?
- [ ] "Fully local" mode respected if the user has it on?

### Plugins
- [ ] Capabilities declared in plugin manifest?
- [ ] Plugin host enforces default-deny?

### Errors & logging
- [ ] No `unwrap()` / `expect()` outside tests?
- [ ] `tracing::instrument` on new async public fns?
- [ ] No `println!` / `eprintln!`?
- [ ] No `try/catch` that silences errors in TS?

### Tests
- [ ] Happy-path test added?
- [ ] At least one failure-mode test?
- [ ] Integration test if crossing process boundaries (watcher, plugin host)?

### Dependencies
- [ ] If a new dep was added, is there an ADR in `docs/adr/`?
- [ ] Version pin matches what's in lockfile?
- [ ] Dep is in `docs/tech_stack.md` or `docs/LLM_ANTIHALLUCINATION.md` §2?

### Performance
- [ ] Stays within `docs/PROJECT_PLAN.md` §6 budgets?
- [ ] No O(n) work on every keystroke / paint?
- [ ] No unbounded React Query cache growth?

### Docs
- [ ] `docs/feature_spec.md` updated if behavior changed?
- [ ] ADR added if architectural?

## Output format

Group findings as:

1. **Blockers** — must fix before merge (data safety, principle violation,
   security, banned API, broken contract).
2. **Should fix** — likely a bug, perf issue, or test gap.
3. **Consider** — design improvement; not blocking.

For each finding:

```
- [<severity>] <file>:<line> — <one-sentence summary>
  Why: <which principle / rule / risk>
  Fix: <concrete suggestion>
```

If the diff is clean, say so in one sentence and stop. Don't pad.
