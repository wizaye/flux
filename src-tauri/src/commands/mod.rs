//! Command modules organized by domain.
//!
//! - vault: Vault lifecycle operations
//! - fs: File system operations (files and directories)
//! - links: Link / tag indexer for the backlinks + graph views
//! - export: PDF export
//! - plugins: Plugin scanner, installer, broker, scoped storage

pub mod export;
pub mod fs;
pub mod links;
pub mod plugins;
pub mod vault;
