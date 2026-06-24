//! End-to-end integration for the Markdown tasks subsystem.
//!
//! Drives the full pipeline a real user would: open a vault,
//! write a file containing tasks, expect `list_open_tasks_impl`
//! to enumerate them, call `toggle_task_impl`, then verify the
//! file body changed AND the index reflects the new status +
//! freshly-minted anchor.

use flux_lib::commands::fs::tasks::{
    list_open_tasks_impl, parse_tasks, toggle_task_impl, TaskStatus,
};
use flux_lib::commands::fs::write_file_impl;
use flux_lib::db;
use flux_lib::state::AppState;
use std::fs;
use std::sync::Arc;

mod common;

fn open_vault_state() -> (tempfile::TempDir, Arc<AppState>) {
    let tmp = tempfile::tempdir().unwrap();
    let vault = tmp.path().join("vault");
    fs::create_dir_all(vault.join(".zenvault")).unwrap();
    let pool = db::init_pool(&vault.join(".zenvault").join("index.db")).unwrap();
    let state = Arc::new(AppState::default());
    *state.vault_path.lock().unwrap() = Some(vault.to_string_lossy().to_string());
    *state.db_pool.lock().unwrap() = Some(pool);
    (tmp, state)
}

#[tokio::test]
async fn write_indexes_tasks_then_toggle_flips_status_and_mints_anchor() {
    let (_tmp, state) = open_vault_state();
    write_file_impl(
        "todo.md".into(),
        "# Today\n\n- [ ] buy milk\n- [ ] cook dinner\n".into(),
        &state,
    )
    .await
    .unwrap();

    // Index has both tasks as `open`.
    let open = list_open_tasks_impl(Some(100), &state).await.unwrap();
    let owned: Vec<_> = open
        .iter()
        .filter(|t| t.file_id == "todo.md")
        .collect();
    assert_eq!(owned.len(), 2);
    let buy_milk = owned.iter().find(|t| t.raw_text == "buy milk").unwrap();
    assert!(buy_milk.block_anchor.is_none());

    // Toggle the first task.
    let result = toggle_task_impl(buy_milk.id.clone(), &state).await.unwrap();
    assert_eq!(result.new_status, TaskStatus::Done);
    assert!(result.new_anchor.is_some());

    // File body now contains `[x]` + the new anchor on that line.
    let vault_path = state.vault_path.lock().unwrap().clone().unwrap();
    let body = fs::read_to_string(format!("{vault_path}/todo.md")).unwrap();
    assert!(body.contains("- [x] buy milk ^blk_"), "body = {body:?}");
    assert!(body.contains("- [ ] cook dinner"));

    // Index shows only one open task remaining.
    let open = list_open_tasks_impl(Some(100), &state).await.unwrap();
    let remaining: Vec<_> = open
        .iter()
        .filter(|t| t.file_id == "todo.md")
        .collect();
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].raw_text, "cook dinner");
}

#[tokio::test]
async fn toggling_back_to_open_preserves_anchor() {
    let (_tmp, state) = open_vault_state();
    write_file_impl(
        "todo.md".into(),
        "- [ ] one ^blk_existing\n".into(),
        &state,
    )
    .await
    .unwrap();
    let open = list_open_tasks_impl(Some(100), &state).await.unwrap();
    let task = open.iter().find(|t| t.file_id == "todo.md").unwrap();
    assert_eq!(task.block_anchor.as_deref(), Some("^blk_existing"));

    // Toggle to done.
    let r1 = toggle_task_impl(task.id.clone(), &state).await.unwrap();
    assert_eq!(r1.new_status, TaskStatus::Done);
    assert!(r1.new_anchor.is_none(), "existing anchor must NOT be re-minted");

    // Toggle back to open. Reindexed → look up new state.
    let r2 = toggle_task_impl(task.id.clone(), &state).await.unwrap();
    assert_eq!(r2.new_status, TaskStatus::Open);

    let vault_path = state.vault_path.lock().unwrap().clone().unwrap();
    let body = fs::read_to_string(format!("{vault_path}/todo.md")).unwrap();
    assert_eq!(body.matches("^blk_existing").count(), 1, "{body}");
    assert!(body.contains("- [ ] one ^blk_existing"));
}

#[test]
fn parse_handles_realistic_obsidian_note() {
    // Smoke check the parser on a mixed-shape document.
    let body = r#"# Daily

Some prose paragraph.

## Tasks

- [ ] open one
  - [ ] nested open
- [x] done one ^blk_abc12
1. [ ] ordered open

Some text inline `- [ ] not a task in code`.

```md
- [ ] inside fence
```

- [ ] last one
"#;
    let tasks = parse_tasks(body);
    let texts: Vec<&str> = tasks.iter().map(|t| t.raw_text.as_str()).collect();
    assert_eq!(
        texts,
        vec![
            "open one",
            "nested open",
            "done one",
            "ordered open",
            "last one",
        ]
    );
}
