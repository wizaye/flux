//! Plugin runtime — manifest parsing, scanning, install/uninstall,
//! capability-gated host broker, scoped storage.
//!
//! On-disk layout follows `docs/plugin-system.md` §2:
//!
//! ```text
//! <vault>/.zenvault/plugins/<id>/
//!     manifest.json
//!     dist/
//!         index.js
//!         (any plugin-bundled assets)
//! ```
//!
//! The host never trusts `manifest.json` blindly. Every field is
//! validated by [`manifest::parse_manifest`] before the plugin is
//! surfaced to the frontend, and every privileged action goes
//! through [`broker::dispatch`] which re-checks the granted
//! capability list on every call (defence in depth — the frontend
//! could be compromised by a malicious plugin's React tree, so we
//! never rely on it to gate access).

pub mod broker;
pub mod commands;
pub mod dto;
pub mod install;
pub mod manifest;
pub mod scanner;
pub mod storage;

pub use commands::*;
