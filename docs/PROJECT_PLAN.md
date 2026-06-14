# Flux — Project Plan

> Local-first PKM + active-learning desktop app (codename "Zenvault" → product
> name "Flux"). Tauri 2 · Rust · React 18 · CodeMirror 6 · SQLite FTS5.
>
> Use this document as the single source of truth for **what** we're building
> and **in what order**. The **how** lives in `docs/architecture.md`,
> `docs/feature_spec.md`, and `docs/tech_stack.md`.

---

## 1. Product Goal

Ship a desktop app that:

- Stores user notes as plain Markdown on the user's disk (no lock-in).
- Indexes, searches, and graphs them locally with zero cloud dependency.
- Turns PDFs into linked notes + FSRS flashcards when an AI model is available;
  degrades gracefully to deterministic chunking when not.
- Restores the user's exact workspace (tabs, layout, scroll, cursor) on launch.
- Syncs via Git or cloud-drive adapters **without ever syncing the SQLite index**.
- Auto-updates via signed releases.

Success in V1 = "60-second magic demo": *drop a PDF → study a flashcard → see a
mastery heatmap*, all offline-capable.

---

## 2. Non-Goals (Explicitly out of scope)

| Non-goal | Reason |
|---|---|
| Real-time multi-user collab on the same note | Local-first first; collab is a V4+ concern |
| Mobile apps (iOS / Android) | Different stack; later platform |
| Web version (browser-only) | Local FS access + native perf is the wedge |
| Cloud-hosted backend / accounts | Users own their data; no servers |
| Built-in AI provider hosting | BYOM / BYOC only; we never ship model weights |
| Importer for every PKM (Notion, Roam, Logseq) | V1 supports Markdown + PDF. Others later. |
| Custom theming engine | Tailwind tokens cover V1 |

---

## 3. Principles (Locked — do not relitigate)

1. **File system is the source of truth.**
2. **`.zenvault/index.db` is derived state.** Never synced. Always rebuildable.
3. **Rust owns I/O.** All blocking work in Rust; the webview only renders.
4. **Typed IPC.** Tauri commands generate TS bindings via `tauri-specta`.
5. **Async-correct DB.** Pool + `spawn_blocking`. Never hold a `Mutex<Conn>` across `.await`.
6. **UUID v7 + Markdown block anchors.** Never incremental IDs. Never line-number-only references.
7. **Plugins are capability-scoped.** Extism v1 WASM + manifest grants.
8. **Graceful AI degradation.** Every AI feature has a deterministic fallback.
9. **Conflict files, not auto-merge of prose.** Sync uses Obsidian-style conflict files.
10. **No invented libraries.** See `docs/LLM_ANTIHALLUCINATION.md` for the verified list.

---

## 4. Phase Map (24-week horizon)

> Weeks are upper bounds. Each milestone has explicit acceptance criteria; don't
> move on until they're green.

### Phase 0 — Bootstrap (Week 0)

**Goal:** Repo green, CI passing, empty app launches.

| Task | Acceptance |
|---|---|
| Repo layout per `docs/architecture.md` §6 | `cargo check --workspace` passes |
| CI matrix (mac / linux / windows) | All 3 jobs green on `main` |
| `cargo tauri dev` launches an empty window | App opens in <2 s |
| Tracing wired (`RUST_LOG=flux=debug`) | JSON logs to stderr |

### Phase 1 — MVP-1: Vault, Editor, Search (Weeks 1–3)

**Goal:** Open a folder, edit notes, search via FTS5.

Features (numbers refer to `docs/feature_spec.md`):

- **F1** Vault Bootstrap + File Watcher Loop
- **F2** Unmanaged CodeMirror 6 Editor (Live Preview)
- **F3** Asset Protocol (built-in `asset:`)
- **F13** Workspace Persistence
- **F15** Search (FTS5, BM25)
- **F19** File Explorer (virtualized; DnD comes in Phase 2)

Acceptance:
- Open a 5k-file vault in <2 s after bootstrap.
- Edit + save round-trips through watcher → index in <500 ms p95.
- Search for any word returns results in <30 ms p95.
- Quit + reopen → exact same tabs, scroll, cursor, sidebar width.

### Phase 2 — MVP-2: Tasks, Trash/Archive, Move-Safe (Weeks 4–6)

- **F5** Global Tasks (two-way binding via block anchors)
- **F12** Archive & Trash (state machine + janitor)
- **F19** Explorer DnD via `@dnd-kit`
- **F20** Wikilink Auto-Heal on rename/move
- **F21** Command Palette (`cmdk`)

Acceptance:
- Toggle a task from dashboard → underlying Markdown line flipped.
- Move 1 file referenced by 50 others → all `[[links]]` rewritten in <300 ms p95.
- Delete → restore round-trip preserves block IDs.

### Phase 3 — MVP-3: Tutor Mode + FSRS (Weeks 7–10)

- **F7** PDF Semantic Ingestion (BYOM)
- **F8** Deterministic Fallback (no AI)
- **F9** FSRS-6 Spaced Repetition
- **F16** LLM Router (Ollama / OpenAI / Anthropic / Azure)

Acceptance:
- 30-page PDF → ≥20 high-quality cards in <60 s with Ollama running.
- Same PDF with AI disabled → emits chapter-split Markdown tagged `#orphan`.
- 100 reviews logged → FSRS scheduling matches reference implementation within 1 day variance.

### Phase 4 — MVP-4: Graph, Canvas, Sync, OTA (Weeks 11–16)

- **F4** Pixi v8 + Web Worker graph
- **F6** Canvas (`@xyflow/react`, JSON Canvas spec)
- **F10** Git sync + cloud-drive adapter
- **F14** OTA Updates (signed, ed25519)
- **F17** Concept Graph (V2)
- **F18** Mastery Dashboard

Acceptance:
- Graph sustains ≥45 fps on a 50k-node vault.
- Pull from remote with one local conflict → conflict file appears + UI prompt.
- Update from v0.1 → v0.2 verifies signature and restarts cleanly.

### Phase 5 — V3 Ecosystem (Weeks 17–24)

- **F11** Plugin Sandbox (Extism v1)
- Multi-vault switcher
- Hardening: telemetry opt-in, accessibility audit, localization scaffolding

Acceptance:
- Install a sample plugin → capability dialog appears, plugin runs sandboxed.
- 3 vaults open in tabs without state cross-pollution.

---

## 5. Cross-cutting Workstreams (run every phase)

| Stream | Cadence | Owner |
|---|---|---|
| Perf budget regression (`criterion`) | per PR touching hot paths | author |
| Snapshot tests (`insta`) for parser | per PR touching parser | author |
| Accessibility (Radix audit + keyboard nav) | per phase | UI |
| Security review (capabilities, plugin grants) | per release | reviewer |
| Docs sync (`feature_spec.md` ↔ code) | per phase | author |
| ADR creation when a Principle is bent | as needed | author |

---

## 6. Performance Budget (binding)

| Action | Target | Owner test |
|---|---|---|
| Cold launch | <2 s | E2E |
| Open 1 MB note | <50 ms | E2E |
| Search query | <30 ms p95 | criterion |
| Save → index reflect | <500 ms p95 | E2E |
| Graph render @ 100k nodes | ≥45 fps | manual perf rig |
| PDF (30 pp) → 30 cards | <60 s | E2E |
| Bulk index 100k files | ≤90 s | criterion |

---

## 7. Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | PDFium bundle bloats installer | High | M | Per-target lazy download in `build.rs`; document in README |
| R2 | Webview2 missing on older Windows | Med | H | Bundle bootstrapper; degrade message |
| R3 | macOS full-disk-access prompt fatigue | Med | M | Explain on first launch; remember choice |
| R4 | Ollama not running when user expects AI | High | M | Health check + clear "set up local model" CTA |
| R5 | Wikilink healer corrupts files mid-batch | Low | H | Transactional with diff log + rollback |
| R6 | FSRS optimization regression | Low | M | Snapshot reviews; compare to reference output |
| R7 | inotify exhaustion on large Linux vaults | Med | M | Fall back to polling, surface status bar warning |
| R8 | Plugin escapes WASM sandbox | Very Low | Critical | Capability default-deny; security audit per release |
| R9 | Sync overwrites local edits | Low | Critical | Conflict files + dry-run preview |
| R10 | LLM JSON schema drift across providers | High | M | Provider-specific adapters; retries with reprompt |

---

## 8. Release Cadence

- `main` is always shippable.
- Feature work on short-lived branches; PRs require CI + 1 review.
- Semver: `0.x.y` until V1 GA.
- Tag → GitHub Actions builds + signs → `latest.json` published → in-app updater picks it up.

---

## 9. Definition of Done (per feature)

A feature is **done** only when:

1. Storage / index / UI / IPC / failure cases match `docs/feature_spec.md`.
2. Tests at the appropriate layer pass (unit / repo / watcher / E2E).
3. `tracing` spans cover the happy path + 1 error path.
4. `docs/feature_spec.md` and (if behavior changes) `docs/architecture.md` are updated in the same PR.
5. Performance budget §6 is met for any operation it touches.
6. No new dependency added without an ADR in `docs/adr/`.

---

## 10. Adjacent Docs

- `docs/architecture.md` — HLD / LLD / ADR Mermaid diagrams.
- `docs/feature_spec.md` — 21 features in implementation detail.
- `docs/tech_stack.md` — verified crates + npm packages + corrections.
- `docs/LLM_SYSTEM_INSTRUCTIONS.md` — top-level rules for any AI assistant.
- `docs/LLM_ANTIHALLUCINATION.md` — verified library list + banned APIs.
- `docs/skills/` — skill cards for Copilot / Cursor / Continue / Cline.
- `.github/copilot-instructions.md` — VS Code Copilot repo-wide instructions.
- `.github/prompts/` — reusable VS Code prompt files.
- `.github/chatmodes/` — persistent chatmodes (architect, reviewer).
- `.github/instructions/` — path-scoped Copilot instructions.
