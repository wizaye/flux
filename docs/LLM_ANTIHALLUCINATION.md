# LLM Anti-Hallucination Reference — Flux

> **Purpose:** Stop AI assistants from inventing libraries, APIs, versions,
> or "facts" that don't exist. Every entry below is verified against the
> upstream project as of late 2025.
>
> **Rule:** If a library, function, or claim isn't in this document or in
> `Cargo.toml` / `package.json`, treat it as **unverified**. Either grep the
> source or ask the user — do not write code against it.

---

## 1. Verified Library Corrections

These are real errors that earlier AI-generated specs made. **Do not
regenerate them.**

| ❌ Hallucinated / Wrong | ✅ Correct | Notes |
|---|---|---|
| `pdfium-bind` | **`pdfium-render`** | The real maintained crate for PDFium FFI |
| `llm-chunker` | **`text-splitter` + `tiktoken-rs`** | No crate named `llm-chunker` exists |
| `ollama-rs` (as primary) | **`async-openai`** pointed at `http://localhost:11434/v1` | Ollama ships an OpenAI-compatible endpoint |
| `warpgate` (as Extism manager) | **DELETE** — Warpgate is an SSH bastion server, unrelated to plugins | |
| `extism = "0.5"` | **`extism = "1"`** | v1 is the GA release |
| `pixi.js@3` / `pixi.js@4` | **`pixi.js@8`** | v8 is the current major; APIs are different (no `PIXI.Application` defaults, async init) |
| `reactflow` (legacy package) | **`@xyflow/react@12`** | The package was renamed when xyflow took over |
| `@uiw/react-codemirror` | Raw `@codemirror/state`, `@codemirror/view`, `@codemirror/commands`, `@codemirror/language`, `@codemirror/lang-markdown` | React wrappers fight CM6's lifecycle; mount unmanaged in `useEffect` |
| `@uiw/react-md-editor` | Build the editor on raw CM6 directly | Same lifecycle issue |
| `hiraku` (UI library) | **DELETE** — fictional. Use **Radix UI** primitives + shadcn/ui | |
| `Arc<Mutex<Connection>>` global | **`r2d2` + `r2d2_sqlite`** connection pool | A mutex serializes the whole DB and deadlocks under load |
| `env_logger` | **`tracing` + `tracing-subscriber`** | Required for span-aware async logs |
| Custom `asset://localhost/` protocol | Built-in Tauri **`asset:`** + `convertFileSrc` from `@tauri-apps/api/core` (Tauri 2) | Do not reinvent the asset protocol |
| `urlencoding` crate (for asset URLs) | Not needed; Tauri 2 handles it | |
| `sqlite-vss` | **`sqlite-vec`** | `sqlite-vss` is deprecated; `sqlite-vec` is the actively maintained successor |
| `tantivy` (claimed as default search) | **SQLite FTS5** (default) + optional `sqlite-vec` | Don't add Tantivy unless explicitly required |
| `wasmtime` for plugins (DIY) | **`extism` v1** wraps Wasmtime with capabilities | |
| `node-pty` / spawning `ollama` from app | **HTTP only** to user-managed Ollama (`GET /v1/models` health check) | Don't spawn user services |
| `tauri-plugin-fs-watch` | **`tauri-plugin-fs`** (Tauri 2) + `notify` crate for watchers | Plugin names changed in Tauri 2 |
| `tauri-plugin-store` v1 syntax | Use **Tauri 2** store API (different store handle pattern) | |

---

## 2. Verified Dependency Pins

> **Always** read `Cargo.toml` / `package.json` before suggesting a version.
> The pins below are the floor — exact version is whatever is locked.

### Rust (workspace `Cargo.toml`)

```toml
tauri              = { version = "2",   features = ["protocol-asset"] }
tauri-build        = { version = "2" }
tauri-specta       = { version = "2",   features = ["typescript"] }
specta             = "2"
serde              = { version = "1",   features = ["derive"] }
serde_json         = "1"
thiserror          = "1"
anyhow             = "1"
tokio              = { version = "1",   features = ["full"] }
tracing            = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
rusqlite           = { version = "0.31", features = ["bundled", "uuid", "blob"] }
r2d2               = "0.8"
r2d2_sqlite        = "0.24"
uuid               = { version = "1",   features = ["v7", "serde"] }
notify             = "6"
ignore             = "0.4"
walkdir            = "2"
pulldown-cmark     = "0.10"
text-splitter      = "0.13"
tiktoken-rs        = "0.5"
fsrs               = "1"
extism             = "1"
async-openai       = "0.20"
pdfium-render      = "0.8"
ed25519-dalek      = "2"
```

### Frontend (`package.json`)

```jsonc
{
  "dependencies": {
    "@tauri-apps/api":            "^2",
    "@tauri-apps/plugin-fs":      "^2",
    "@tauri-apps/plugin-dialog":  "^2",
    "@tauri-apps/plugin-store":   "^2",
    "@tauri-apps/plugin-updater": "^2",
    "@codemirror/state":          "^6",
    "@codemirror/view":           "^6",
    "@codemirror/commands":       "^6",
    "@codemirror/language":       "^6",
    "@codemirror/lang-markdown":  "^6",
    "@xyflow/react":              "^12",
    "pixi.js":                    "^8",
    "@dnd-kit/core":              "^6",
    "@dnd-kit/sortable":          "^8",
    "@tanstack/react-virtual":    "^3",
    "@tanstack/react-query":      "^5",
    "fuse.js":                    "^7",
    "cmdk":                       "^1",
    "zustand":                    "^4",
    "react":                      "^18",
    "react-dom":                  "^18",
    "@radix-ui/react-*":          "latest",
    "tailwindcss":                "^3"
  }
}
```

If you find this file disagreeing with `package.json` / `Cargo.toml`, the
lockfile wins. Open an ADR to reconcile.

---

## 3. Banned APIs / Patterns

These are forbidden in this codebase. **Reject the request** if asked to use
them.

### Rust

| Banned | Why | Use instead |
|---|---|---|
| `Arc<Mutex<rusqlite::Connection>>` as app state | Serializes all DB access; deadlocks across `.await` | `r2d2::Pool<SqliteConnectionManager>` |
| Holding `MutexGuard` / `PooledConnection` across `.await` | UB / deadlock | Move blocking work into `tokio::task::spawn_blocking` |
| `.unwrap()` / `.expect()` in non-test code | Crashes user data flows | `?` with typed `AppError` |
| `println!` / `eprintln!` for diagnostics | No structured context | `tracing::{info,warn,error}!` with spans |
| `std::fs::read_to_string` on the async path | Blocks the runtime | `tokio::fs` or `spawn_blocking` |
| `env_logger` | Not span-aware | `tracing-subscriber` |
| `serde_json::from_str` against LLM output without retry | Hallucinates JSON | Schema-validated parser + 2 retries + fallback |
| Direct `std::process::Command::new("ollama")` | We don't manage user services | HTTP to user-managed Ollama |
| Storing UUIDs as `TEXT` | 36 bytes vs 16, lexicographic sort | `BLOB(16)` |
| Path joins via string concat (`"a/" + b`) | Breaks on Windows | `PathBuf::join` |
| Soft-deleting by SQL-only flag without moving the file | Disk and index disagree | Move to `.trash/` AND mark in DB |

### TypeScript / React

| Banned | Why | Use instead |
|---|---|---|
| `@uiw/react-codemirror`, `@uiw/react-md-editor`, `react-codemirror2` | React wrappers fight CM6 lifecycle | Raw `@codemirror/*` mounted in `useEffect` |
| `reactflow` (the old npm name) | Deprecated; new home is xyflow | `@xyflow/react@12` |
| `pixi.js@<8` | v8 changed init / renderer API | `pixi.js@8` with async `await app.init()` |
| Hand-written types for Tauri commands | Drift from Rust | `bindings.ts` generated by tauri-specta |
| `useState` for vault data (notes, tasks, graph) | Re-renders & stale data | React Query + Tauri commands |
| `localStorage` for vault data | Not multi-vault, not durable | Tauri store plugin or SQLite |
| `dangerouslySetInnerHTML` on Markdown render | XSS via vault content | A vetted sanitizer + restricted schema |
| Editing the DOM inside CM6 directly | Fights CM6's view layer | `Decoration`, `ViewPlugin`, `StateField` |
| `import` from a path like `node_modules/...` | Bypasses bundler | Package import only |
| `fetch` to a cloud LLM in background tasks | Leaks vault content | User-initiated only |

### Cross-cutting

| Banned | Why |
|---|---|
| Syncing `.zenvault/` to Git/Dropbox/iCloud | Index is derived state; corrupts on multi-device write |
| Auto-merging Markdown prose on sync conflict | Silent data loss |
| Renaming a file without running Wikilink Healer | Dangling links |
| Adding a new top-level dependency without an ADR | Drift between docs and reality |

---

## 4. False / Stale Claims to Reject

If you see these in a prompt, **correct them** before acting:

1. **"Anki is stuck on FSRS v4."**
   FALSE. Anki ships **FSRS v5/v6** via the same `fsrs-rs` engine we use.
   Our differentiation is **UX and explainability**, not algorithm version.

2. **"Ollama auto-detects without `ollama serve`."**
   FALSE. The Ollama desktop app or `ollama serve` must be running. We
   detect via `GET http://localhost:11434/v1/models` and surface a
   "Start Ollama" CTA if it fails.

3. **"SharedArrayBuffer just works between a Worker and Pixi."**
   FALSE in Tauri's default config. SAB requires COOP/COEP cross-origin
   isolation headers. V1 uses **`postMessage` with transferable Float32Array**.
   SAB is a V2 optimization gated on Tauri header config.

4. **"Tauri 2 uses the same plugin/asset APIs as Tauri 1."**
   FALSE. Tauri 2 plugins (`@tauri-apps/plugin-*`), capabilities system,
   and asset protocol are different. Use Tauri 2 docs only.

5. **"`pixi.js` constructs synchronously."**
   FALSE since v8. Use `const app = new Application(); await app.init({...});`.

6. **"`@xyflow/react` is the same package as `reactflow`."**
   Same maintainers, different package name and updated API. Import from
   `@xyflow/react`, not `reactflow`.

7. **"PRAGMA foreign_keys is on by default in rusqlite."**
   FALSE. Must be set per connection. Do it in the pool's `on_connect` hook.

8. **"sqlite-vss is the standard."**
   STALE. `sqlite-vss` is deprecated. Use **`sqlite-vec`** (loadable extension
   or `sqlite-vec` Rust binding) if a vector path is enabled.

9. **"You can ship a single binary with all loadable SQLite extensions baked in."**
   PARTIAL. Some extensions need OS-specific dynamic libs. Bundle as
   resources and load at runtime; verify per-platform.

10. **"FSRS schedules from raw rating with no review history."**
    FALSE. FSRS needs `(card_state, rating, elapsed_days, scheduled_days,
    review_history)`. Persist `Card` and `ReviewLog` rows in SQLite.

---

## 5. Version & Date Discipline

- **Never** cite a version from memory. Open `Cargo.toml` or `package.json`.
- **Never** assume a feature exists in the pinned version. Check the changelog.
- When suggesting a bump, propose it as an ADR with the changelog diff link.
- When a Tauri / Rust / Node major changes, search for breakage before
  proposing the bump.

---

## 6. Self-Check Before Replying

Ask yourself before sending a response that contains code:

1. Did I cite a library? Is it in §1 or §2 above (or in the lockfile)?
2. Did I cite an API? Have I verified its signature or said "unverified"?
3. Did I assume a version? Did I read the lockfile?
4. Does my code break any rule in `docs/LLM_SYSTEM_INSTRUCTIONS.md` §1?
5. If I'm proposing a new dep, am I also opening an ADR?

If any answer is "no", revise before sending.
