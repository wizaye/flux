# Zenvault — Corrected Tech Stack (2026)

> This document supersedes the `library.md` and Cargo/package.json snippets in
> the prior conversation. Every entry below has been corrected for the actual
> crate/package name, a realistic version constraint, and the underlying
> architectural constraint that motivates the choice.

---

## 0. Corrections to Prior Claims

> Consolidates corrections to **both** the Perplexity and Gemini chats. Where
> the two chats disagreed, the row notes which one was wrong.

| Prior claim | Source | Status | Correct value |
|---|---|---|---|
| `pdfium-bind = "0.2"` | Perplexity | ❌ Wrong crate name | **`pdfium-render`** |
| `llm-chunker = "0.1"` | Perplexity | ❌ Not a real crate | **`text-splitter`** (semantic Markdown/code splitting) |
| `warpgate = "0.3"` (Extism plugin manager) | Perplexity | ❌ Warpgate is an SSH bastion, unrelated | Use Extism's own host APIs; no manager needed |
| `extism = "0.5"` | Perplexity | ❌ Outdated | **`extism = "1"`** (v1 GA) |
| `pixi.js@3.0` | Perplexity | ❌ Ancient | **`pixi.js@8`** |
| `reactflow` | Both | ⚠️ Renamed | **`@xyflow/react@12`** |
| `@uiw/react-md-editor` for "unmanaged CodeMirror" | Perplexity | ❌ Contradicts the architecture | Use raw **`@codemirror/*` v6** packages directly |
| `@uiw/react-codemirror` for editor | Gemini | ❌ Same problem (React wrapper) | Use raw **`@codemirror/*` v6** |
| `hiraku` | Perplexity | ❌ Not a standard React lib | Use **Radix `@radix-ui/react-dialog`** alone |
| `Arc<Mutex<Connection>>` | Both | ❌ Serializes all DB I/O | **`r2d2` + `r2d2_sqlite`** pool OR **`sqlx`** for async |
| `async_trait` on rusqlite repos | Perplexity | ⚠️ rusqlite is sync | Wrap calls in **`tokio::task::spawn_blocking`** or switch repos to `sqlx` |
| `^blk_NNN` incremental block IDs | Perplexity | ⚠️ Breaks on merge | **UUID v7** anchors (`^blk_01HE3...`) — time-ordered, merge-safe |
| Task toggle by raw `line_number` only | Both | ⚠️ Drifts after external edits/merges | Toggle by **`block_anchor`** (line is a soft hint) |
| "Anki uses FSRS v4 (stuck in legacy)" | Perplexity | ❌ False | Anki ships FSRS v5/v6 via the same `fsrs-rs` engine |
| `Ollama auto-detect` | Both | ⚠️ Requires `ollama serve` running | Ping `GET /v1/models`; fall back to BYOM provider list |
| SharedArrayBuffer between Worker and Pixi | Both | ⚠️ Needs COOP/COEP headers on the webview | Use `postMessage` + `Float32Array` transfer for v1; SAB only when required |
| Custom `asset://localhost/` protocol registration | Both | ⚠️ Tauri 2 ships this | Use built-in **`asset:`** protocol with `convertFileSrc` and `assetProtocol.scope` |
| `urlencoding` crate for asset paths | Gemini | ⚠️ Not needed | Tauri's built-in asset protocol handles URI decoding |
| Sync = "compare hashes, upload newer" | Both | ⚠️ Loses concurrent edits | Use **3-way diff with conflict files** (`Note (conflict 2026-06-14).md`) |
| Nested `<ul>` recursion for file tree | Implied | ❌ Crashes at 50k+ files | **`@tanstack/react-virtual`** flat-tree (Rust flattens with depth) |
| HTML5 native DnD for file tree | Implied | ⚠️ Broken with virtualization | **`@dnd-kit/core`** + `@dnd-kit/sortable` |
| Wikilink breakage on file rename/move | Both omitted | ⚠️ Silent data corruption | Add **Wikilink Healer** that rewrites referrers transactionally |
| Archive = "remove from links table only" | Gemini | ⚠️ Incomplete | Archive → `files.state='archived'`; mirror into `archive_fts` for opt-in search |
| Trash = "DELETE FROM files" immediately | Gemini | ⚠️ Conflates state-change with physical purge | Trash → `state='trashed'` + cascade derived rows; janitor purges file after retention |
| `env_logger` | Perplexity | ⚠️ Sync-only, unstructured | **`tracing` + `tracing-subscriber`** (async-aware, JSON logs) |

---

## 1. Architectural Principles (Locked)

1. **File system is the source of truth.** Markdown, `.canvas`, attachments are user-owned files.
2. **`.zenvault/index.db` is derived state.** Never synced, always rebuildable from disk in <2 min for 100k files.
3. **Rust owns I/O.** All blocking work (FS, SQLite, PDF, Git, LLM HTTP) lives in Rust; the webview only renders.
4. **Typed IPC.** Tauri commands expose strongly-typed contracts to TypeScript via `tauri-specta` — no hand-written DTOs.
5. **Async-correct DB.** SQLite calls are either async-native (`sqlx`) or wrapped in `spawn_blocking` (rusqlite + pool). Never hold a `Mutex<Connection>` across `.await`.
6. **Plugins are capability-scoped.** WASM sandbox with explicit host-function grants in a manifest.
7. **Graceful degradation.** Every AI feature has a deterministic fallback.

---

## 2. Rust Backend — `Cargo.toml`

```toml
[package]
name = "zenvault"
version = "0.1.0"
edition = "2021"
rust-version = "1.78"

[dependencies]
# ── Tauri 2 (GA) ─────────────────────────────────────────────────────────
tauri                   = { version = "2", features = ["protocol-asset"] }
tauri-plugin-dialog     = "2"
tauri-plugin-fs         = "2"
tauri-plugin-store      = "2"
tauri-plugin-updater    = "2"
tauri-plugin-shell      = "2"
tauri-plugin-clipboard-manager = "2"
tauri-plugin-window-state      = "2"
tauri-specta            = { version = "2", features = ["derive", "typescript"] }
specta                  = { version = "2", features = ["derive"] }

# ── Async runtime / errors / logging ─────────────────────────────────────
tokio                   = { version = "1", features = ["full"] }
async-trait             = "0.1"
futures                 = "0.3"
thiserror               = "1"
anyhow                  = "1"
tracing                 = "0.1"
tracing-subscriber      = { version = "0.3", features = ["env-filter"] }
tracing-appender        = "0.2"

# ── SQLite + FTS5 + migrations + pool ────────────────────────────────────
rusqlite                = { version = "0.31", features = ["bundled", "fts5", "uuid", "chrono", "serde_json"] }
r2d2                    = "0.8"
r2d2_sqlite             = "0.24"
rusqlite_migration      = "1"

# Optional vector layer (V2 semantic search). Pull in only when enabled.
sqlite-vec              = { version = "0.1", optional = true }

# ── File watcher ─────────────────────────────────────────────────────────
notify                  = "6"
notify-debouncer-full   = "0.3"

# ── Markdown / parsing ───────────────────────────────────────────────────
pulldown-cmark          = "0.10"
pulldown-cmark-to-cmark = "13"   # round-trip serialization for block-id injection
gray_matter             = "0.2"  # YAML/TOML frontmatter

# ── PDF / PPTX / DOCX extraction ─────────────────────────────────────────
pdfium-render           = "0.8"  # ships bindings; bundle libpdfium per platform
zip                     = "0.6"  # PPTX / DOCX are zip containers
quick-xml               = "0.31" # parse slide/document XML
calamine                = "0.24" # optional, XLSX import

# ── Text chunking (semantic-aware) ───────────────────────────────────────
text-splitter           = { version = "0.13", features = ["markdown", "tiktoken-rs"] }
tiktoken-rs             = "0.5"

# ── Spaced repetition (FSRS-6) ───────────────────────────────────────────
fsrs                    = "1"    # open-spaced-repetition/fsrs-rs

# ── LLM router (BYOM/BYOC) ───────────────────────────────────────────────
reqwest                 = { version = "0.12", features = ["json", "stream", "rustls-tls"] }
async-openai            = "0.23" # Works for OpenAI + Azure OpenAI + Ollama (OpenAI-compat /v1)
eventsource-stream      = "0.2"  # SSE streaming
schemars                = "0.8"  # JSON Schema for structured outputs

# ── Git sync ─────────────────────────────────────────────────────────────
git2                    = { version = "0.18", default-features = false, features = ["vendored-libgit2", "vendored-openssl"] }
keyring                 = "2"    # OS keychain for SSH/PAT secrets

# ── Plugins (WASM sandbox) ───────────────────────────────────────────────
extism                  = "1"    # v1 GA

# ── Serde / IDs / hashing / time ─────────────────────────────────────────
serde                   = { version = "1", features = ["derive"] }
serde_json              = "1"
uuid                    = { version = "1", features = ["v4", "v7", "serde"] }
sha2                    = "0.10"
blake3                  = "1"    # faster than SHA-256 for content hashing
chrono                  = { version = "0.4", features = ["serde"] }
time                    = { version = "0.3", features = ["serde"] }

# ── Image / asset MIME ───────────────────────────────────────────────────
mime_guess              = "2"
image                   = { version = "0.25", default-features = false, features = ["png", "jpeg", "webp"] }

[build-dependencies]
tauri-build             = { version = "2", features = [] }

[dev-dependencies]
insta                   = { version = "1", features = ["yaml"] }
tempfile                = "3"
proptest                = "1"
criterion               = "0.5"
mockall                 = "0.12"
tokio-test              = "0.4"

[[bench]]
name = "indexer_bench"
harness = false

[profile.release]
opt-level     = 3
lto           = "fat"
codegen-units = 1
strip         = "symbols"
panic         = "abort"
```

### Removed from prior spec
- `pdfium-bind` → use `pdfium-render`
- `llm-chunker` → use `text-splitter`
- `ollama-rs` → not needed; Ollama is OpenAI-compatible, reuse `async-openai`
- `warpgate` → unrelated project, drop entirely
- `env_logger` → use `tracing` + `tracing-subscriber` (structured + async-aware)

---

## 3. Frontend — `package.json`

```json
{
  "name": "zenvault-ui",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "lint": "eslint . --max-warnings 0",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "@tauri-apps/api": "^2",
    "@tauri-apps/plugin-dialog": "^2",
    "@tauri-apps/plugin-fs": "^2",
    "@tauri-apps/plugin-store": "^2",
    "@tauri-apps/plugin-updater": "^2",
    "@tauri-apps/plugin-shell": "^2",
    "@tauri-apps/plugin-clipboard-manager": "^2",
    "@tauri-apps/plugin-window-state": "^2",

    "react": "^18.3",
    "react-dom": "^18.3",

    "@codemirror/state": "^6",
    "@codemirror/view": "^6",
    "@codemirror/commands": "^6",
    "@codemirror/language": "^6",
    "@codemirror/lang-markdown": "^6",
    "@codemirror/search": "^6",
    "@codemirror/autocomplete": "^6",
    "@lezer/markdown": "^1",

    "@xyflow/react": "^12",
    "pixi.js": "^8",
    "@pixi/react": "^8",
    "comlink": "^4",

    "zustand": "^4.5",
    "immer": "^10",

    "@tanstack/react-router": "^1",
    "@tanstack/react-query": "^5",
    "@tanstack/react-table": "^8",
    "@tanstack/react-virtual": "^3",

    "@dnd-kit/core": "^6",
    "@dnd-kit/sortable": "^8",
    "@dnd-kit/modifiers": "^7",
    "@dnd-kit/utilities": "^3",

    "@radix-ui/react-dialog": "^1",
    "@radix-ui/react-dropdown-menu": "^2",
    "@radix-ui/react-popover": "^1",
    "@radix-ui/react-tooltip": "^1",
    "@radix-ui/react-toast": "^1",
    "@radix-ui/react-tabs": "^1",
    "@radix-ui/react-context-menu": "^2",

    "class-variance-authority": "^0.7",
    "clsx": "^2",
    "tailwind-merge": "^2",
    "lucide-react": "^0.400",
    "sonner": "^1.5",
    "cmdk": "^1",
    "fuse.js": "^7",

    "react-dropzone": "^14",
    "katex": "^0.16",
    "mermaid": "^11",
    "shiki": "^1",

    "date-fns": "^3",
    "zod": "^3",

    "tauri-specta": "^2"
  },
  "devDependencies": {
    "@playwright/test": "^1",
    "@types/node": "^20",
    "@types/react": "^18.3",
    "@types/react-dom": "^18.3",
    "@vitejs/plugin-react": "^4",
    "autoprefixer": "^10",
    "eslint": "^9",
    "eslint-plugin-react-hooks": "^5",
    "eslint-plugin-react-refresh": "^0.4",
    "postcss": "^8",
    "tailwindcss": "^3.4",
    "typescript": "^5.4",
    "vite": "^5",
    "vitest": "^1"
  }
}
```

### Removed
- `@uiw/react-md-editor` — defeats the "unmanaged CodeMirror" pattern. Use `@codemirror/*` directly.
- `hiraku` — fictional. Use Radix.
- `framer-motion` — not required in V1; add only if motion specs land.
- `pixi.js@3` — replaced with v8.
- `reactflow` legacy package → `@xyflow/react@12`.

### Added (from Gemini chunk — Explorer / DnD)
- `@tanstack/react-virtual` — DOM virtualization for the 100k-file tree (only ~30 rows rendered).
- `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/modifiers` + `@dnd-kit/utilities` — headless drag-and-drop that composes cleanly with virtualized lists.

---

## 4. Layered Architecture (Corrected)

```
crates/
├── zenvault-domain/        # Pure types: File, Block, Flashcard, Concept. No I/O.
├── zenvault-db/            # rusqlite + r2d2 pool + migrations (versioned SQL).
├── zenvault-fs/            # notify watcher, atomic writes, trash/archive moves.
├── zenvault-parser/        # pulldown-cmark + block-id injector + frontmatter.
├── zenvault-pdf/           # pdfium-render extractor, page→text+coords.
├── zenvault-llm/           # provider router (Ollama/OpenAI/Azure/Anthropic) + JSON Schema enforcement.
├── zenvault-fsrs/          # thin wrapper around the `fsrs` crate.
├── zenvault-git/           # git2 wrapper + .gitignore enforcement for index.db.
├── zenvault-sync/          # cloud-drive adapters + 3-way conflict resolver.
├── zenvault-plugins/       # Extism host: capability checks + host fns.
├── zenvault-search/        # FTS5 query builder + ranking + optional sqlite-vec.
└── zenvault-app/           # Tauri shell, command surface, specta export.
```

### DB access pattern (the single most important fix)

```rust
// zenvault-db/src/pool.rs
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;

pub type DbPool = Pool<SqliteConnectionManager>;

pub fn init(path: &std::path::Path) -> anyhow::Result<DbPool> {
    let manager = SqliteConnectionManager::file(path)
        .with_init(|c| {
            c.pragma_update(None, "journal_mode", "WAL")?;
            c.pragma_update(None, "synchronous", "NORMAL")?;
            c.pragma_update(None, "foreign_keys", "ON")?;
            c.pragma_update(None, "busy_timeout", 5_000)?;
            c.pragma_update(None, "temp_store", "MEMORY")?;
            c.pragma_update(None, "mmap_size", 268_435_456_i64)?; // 256MB
            Ok(())
        });
    Ok(Pool::builder().max_size(8).build(manager)?)
}

// Every repo method follows this pattern — never .await while holding a conn.
pub async fn run<F, T>(pool: &DbPool, f: F) -> anyhow::Result<T>
where
    F: FnOnce(&rusqlite::Connection) -> anyhow::Result<T> + Send + 'static,
    T: Send + 'static,
{
    let pool = pool.clone();
    tokio::task::spawn_blocking(move || {
        let conn = pool.get()?;
        f(&conn)
    }).await?
}
```

### Migrations (versioned, deterministic)

```
zenvault-db/migrations/
  0001_init.sql
  0002_fts.sql
  0003_flashcards.sql
  0004_canvas_nodes.sql
  0005_concepts.sql           # V2
  0006_vectors.sql            # V2 (optional feature flag)
```

Apply with `rusqlite_migration::Migrations::new_iter(...)` on boot.

### Typed IPC

```rust
#[tauri::command]
#[specta::specta]
pub async fn search_vault(
    state: State<'_, AppState>,
    query: String,
    limit: u32,
) -> Result<Vec<SearchHit>, AppError> { ... }

// build.rs emits src-tauri/bindings.ts consumed by the React app.
```

---

## 5. Webview Configuration

| Setting | Value | Reason |
|---|---|---|
| `tauri.conf.json > app.security.csp` | `default-src 'self'; img-src 'self' asset: data:; connect-src 'self' http://localhost:11434 https://api.openai.com` | Lock down origins; allow Ollama + chosen BYOM endpoints |
| `withGlobalTauri` | `false` | Force typed `@tauri-apps/api` imports |
| `app.security.assetProtocol.scope` | `["$APPDATA/**", "$VAULT/**"]` | Vault-scoped only |
| COOP / COEP headers | Only set if SAB+Worker is actually used (V2 graph) | Don't pay the cost in V1 |

---

## 6. Build & Release

- **CI**: GitHub Actions matrix `{ubuntu-22.04, macos-14, windows-2022}` × `{stable rust}`.
- **Signing**: Tauri updater v2 uses `ed25519`; private key in GitHub Encrypted Secrets, public key shipped in `tauri.conf.json`.
- **Bundling**: `cargo tauri build` with `targets: ["app", "dmg", "deb", "appimage", "msi"]`.
- **PDFium**: prebuilt libs from `bblanchon/pdfium-binaries` downloaded in build script per target triple.
- **Reproducibility**: pin `rust-toolchain.toml` to a specific stable version per release branch.

---

## 7. Testing Strategy (was missing entirely)

| Layer | Tool | What |
|---|---|---|
| Domain unit | built-in `#[test]` | invariants on `Block`, `FileHash`, `BlockAnchor` |
| Repository | `tempfile` + `rusqlite_migration` | spin a fresh DB per test, assert FTS results |
| Watcher loop | `notify` + `tempfile` | simulate file write, assert reindex within N ms |
| Parser snapshots | `insta` | golden snapshots for Markdown → blocks/links |
| LLM router | `mockall` + `wiremock` | stub Ollama/OpenAI HTTP, assert schema enforcement |
| End-to-end | `playwright` + `tauri-driver` | open vault → import PDF → study card |
| Performance | `criterion` | indexer throughput target ≥ 5k files/min on M-class laptop |

---

## 8. Observability

- `tracing` JSON logs → rotated daily under `.zenvault/logs/`.
- Opt-in telemetry only; no content ever leaves the device.
- `RUST_LOG=zenvault=debug` for dev.

---

## 9. Security Notes

- All secrets (PAT, SSH key paths, API keys) live in the OS keychain via `keyring`. Never in `workspace.json`.
- `.zenvault/index.db` and `.zenvault/logs/` are added to `.gitignore` on vault init.
- Plugins denied network + FS by default; capabilities granted per-manifest with explicit user consent dialog.
- Updater verifies `ed25519` signature **before** swap; rollback on hash mismatch.
