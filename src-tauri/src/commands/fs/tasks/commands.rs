//! Tauri command shims for the Markdown tasks subsystem. Mirrors
//! the convention used by every other fs command: a thin shim that
//! takes `State<Arc<AppState>>` plus a typed `_impl` body that
//! takes `&AppState` so integration tests can drive without Tauri.

use crate::commands::fs::common::{get_db_pool, get_vault_path};
use crate::commands::fs::tasks::parse::{parse_tasks, TaskStatus};
use crate::commands::fs::tasks::repo::{
    list_open_tasks, list_tasks_for_file, reindex_file_tasks, TaskRecord,
};
use crate::commands::fs::tasks::toggle::{toggle_task_in_file, ToggleError};
use crate::db;
use crate::state::AppState;
use crate::types::AppError;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::sync::Arc;
use tauri::State;

// ── DTOs ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TaskDto {
    pub id: String,
    pub file_id: String,
    pub block_anchor: Option<String>,
    pub line_hint: u32,
    pub status: TaskStatus,
    pub raw_text: String,
    pub indexed_at: i64,
}

impl From<TaskRecord> for TaskDto {
    fn from(r: TaskRecord) -> Self {
        Self {
            id: r.id,
            file_id: r.file_id,
            block_anchor: r.block_anchor,
            line_hint: r.line_hint,
            status: r.status,
            raw_text: r.raw_text,
            indexed_at: r.indexed_at,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ToggleResult {
    pub task_id: String,
    pub new_status: TaskStatus,
    pub new_anchor: Option<String>,
    pub line: u32,
}

// ── Commands ──────────────────────────────────────────────────────────────

/// Return every open task in the vault. The Tasks pane lists these.
#[tauri::command]
pub async fn list_open_tasks_cmd(
    limit: Option<u32>,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<TaskDto>, AppError> {
    list_open_tasks_impl(limit, &state).await
}

pub async fn list_open_tasks_impl(
    limit: Option<u32>,
    state: &AppState,
) -> Result<Vec<TaskDto>, AppError> {
    let pool = get_db_pool(state)?;
    let cap = limit.unwrap_or(500).min(5000);
    let rows = db::run_blocking(&pool, move |conn| list_open_tasks(conn, cap))
        .await
        .map_err(|e| AppError::Database(e.to_string()))?;
    Ok(rows.into_iter().map(TaskDto::from).collect())
}

/// All tasks (open + done) for a single file. Used by the editor
/// to render task state inline and by the right-sidebar Outline.
#[tauri::command]
pub async fn list_tasks_for_file_cmd(
    file_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<TaskDto>, AppError> {
    list_tasks_for_file_impl(file_id, &state).await
}

pub async fn list_tasks_for_file_impl(
    file_id: String,
    state: &AppState,
) -> Result<Vec<TaskDto>, AppError> {
    let pool = get_db_pool(state)?;
    let rows =
        db::run_blocking(&pool, move |conn| list_tasks_for_file(conn, &file_id))
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;
    Ok(rows.into_iter().map(TaskDto::from).collect())
}

/// Re-scan a single file's tasks. Idempotent — safe to call after
/// any write. The watcher calls this from its reindex path; the
/// frontend doesn't need to call it directly.
pub async fn reindex_file_tasks_impl(
    file_id: String,
    state: &AppState,
) -> Result<(), AppError> {
    let vault = get_vault_path(state)?;
    let pool = get_db_pool(state)?;
    let abs = vault.join(&file_id);
    let body = match tokio::fs::read_to_string(&abs).await {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            // File deleted between scan and read — drop its rows.
            let owned = file_id.clone();
            return db::run_blocking(&pool, move |conn| {
                crate::commands::fs::tasks::repo::delete_tasks_for_file(conn, &owned)
            })
            .await
            .map(|_| ())
            .map_err(|e| AppError::Database(e.to_string()));
        }
        Err(e) => return Err(AppError::Io(e.to_string())),
    };
    let parsed = parse_tasks(&body);
    let indexed_at = chrono::Utc::now().timestamp_millis();
    let owned_file_id = file_id;
    db::run_blocking(&pool, move |conn| {
        reindex_file_tasks(conn, &owned_file_id, &parsed, indexed_at)
    })
    .await
    .map_err(|e| AppError::Database(e.to_string()))?;
    Ok(())
}

/// Toggle a task's `[ ]` ↔ `[x]` state. Rewrites the source file
/// atomically and reindexes the affected file so the in-memory
/// task list refreshes without a full rescan.
#[tauri::command]
pub async fn toggle_task_cmd(
    task_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<ToggleResult, AppError> {
    toggle_task_impl(task_id, &state).await
}

pub async fn toggle_task_impl(
    task_id: String,
    state: &AppState,
) -> Result<ToggleResult, AppError> {
    let vault = get_vault_path(state)?;
    let pool = get_db_pool(state)?;
    let lookup_id = task_id.clone();
    let record = db::run_blocking(&pool, move |conn| {
        crate::commands::fs::tasks::repo::get_task(conn, &lookup_id)
    })
    .await
    .map_err(|e| AppError::Database(e.to_string()))?
    .ok_or_else(|| AppError::NotFound(format!("task {task_id} not indexed")))?;

    // Capture file_id before handing the record to the blocking
    // worker (closures need `'static`).
    let file_id_for_reindex = record.file_id.clone();
    let vault_clone = vault.clone();
    let outcome = tokio::task::spawn_blocking(move || {
        toggle_task_in_file(&vault_clone, &record)
    })
    .await
    .map_err(|e| AppError::Other(e.to_string()))?
    .map_err(toggle_error_to_app)?;

    // Reindex the affected file so the new anchor + status land in
    // SQLite before the watcher catches up.
    reindex_file_tasks_impl(file_id_for_reindex, state).await?;

    Ok(ToggleResult {
        task_id,
        new_status: outcome.new_status,
        new_anchor: outcome.new_anchor,
        line: outcome.line as u32,
    })
}

fn toggle_error_to_app(e: ToggleError) -> AppError {
    match e {
        ToggleError::NotFound(s) => AppError::NotFound(s),
        ToggleError::Io(s) => AppError::Io(s),
        ToggleError::Vanished => AppError::NotFound("task vanished from source".into()),
        ToggleError::Ambiguous => AppError::Other(
            "multiple identical anchorless tasks — add a block anchor to disambiguate".into(),
        ),
    }
}
