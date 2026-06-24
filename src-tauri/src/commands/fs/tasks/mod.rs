//! Markdown task scanner + indexer + toggle.
//!
//! Implements feature §5 "Global Tasks" from `docs/feature_spec.md`:
//! every `- [ ]` / `- [x]` line in any indexed Markdown file lands
//! in the `tasks` table, keyed by a stable block anchor when
//! present.
//!
//! Three layers, each independently testable:
//!
//!   * **`parse`** — pure string → `ParsedTask` list. No I/O, no
//!     SQLite. The toggle command + the scanner share this.
//!   * **`indexer`** — drives `parse` over a file body and writes
//!     rows to SQLite inside a transaction. Called from the
//!     watcher's reindex path and from `scan_tasks`.
//!   * **`toggle`** — opens a file, locates the target task line
//!     (by anchor first, raw-text fuzzy fallback otherwise),
//!     flips `[ ]` ↔ `[x]`, inserts an anchor if missing, and
//!     atomically writes the file back.
//!
//! The anchor format is `^blk_<base32 of 6 bytes BLAKE3>` —
//! 6 bytes (~48 bits) is enough to avoid collisions inside a
//! single document while keeping the anchor inline-readable.

pub mod commands;
pub mod parse;
pub mod repo;
pub mod toggle;

pub use commands::*;
pub use parse::{ParsedTask, TaskStatus, parse_tasks};
pub use repo::{TaskRecord, reindex_file_tasks, list_open_tasks, list_tasks_for_file};
pub use toggle::toggle_task_in_file;
