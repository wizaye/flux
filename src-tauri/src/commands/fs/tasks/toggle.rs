//! Toggle a single Markdown task line from `[ ]` ↔ `[x]`.
//!
//! Locate strategy (matches feature_spec §5):
//!   1. If the task has a `block_anchor`, scan the file for a line
//!      ending in that anchor. Anchors are stable across reorders.
//!   2. If the anchor is missing OR the line has shifted, fall
//!      back to the `line_hint` for an O(1) probe.
//!   3. If that line's text doesn't match `raw_text`, fuzzy-match
//!      every task line in the file by `raw_text` (case-sensitive
//!      equality after trimming) and take the unique winner.
//!   4. No match → return `ToggleError::Vanished` so the caller can
//!      drop the stale row.
//!
//! Atomic write: writes to `<file>.tmp.<uuid>` in the same dir,
//! fsyncs, renames over the original. The watcher will reindex
//! after debounce.

use crate::commands::fs::tasks::parse::{
    mint_anchor, parse_tasks, ParsedTask, TaskStatus,
};
use crate::commands::fs::tasks::repo::TaskRecord;
use std::path::Path;

#[derive(Debug, thiserror::Error)]
pub enum ToggleError {
    #[error("file not found: {0}")]
    NotFound(String),
    #[error("io: {0}")]
    Io(String),
    #[error("task vanished from source — no matching line")]
    Vanished,
    #[error("multiple ambiguous fuzzy matches for task — refusing to toggle")]
    Ambiguous,
}

impl From<std::io::Error> for ToggleError {
    fn from(e: std::io::Error) -> Self {
        if e.kind() == std::io::ErrorKind::NotFound {
            ToggleError::NotFound(e.to_string())
        } else {
            ToggleError::Io(e.to_string())
        }
    }
}

/// Result of a successful toggle: the new file body, the new
/// status, and (if the task was previously un-anchored) the newly
/// minted block anchor so the caller can refresh its row.
#[derive(Debug, Clone)]
pub struct ToggleOutcome {
    pub new_body: String,
    pub new_status: TaskStatus,
    pub new_anchor: Option<String>,
    pub line: usize,
}

/// Apply the toggle to an in-memory body. Pure for testability —
/// the disk-touching variant lives below.
pub fn toggle_task_in_body(
    body: &str,
    record: &TaskRecord,
) -> Result<ToggleOutcome, ToggleError> {
    let parsed = parse_tasks(body);
    let Some((idx, target)) = locate_task(&parsed, record) else {
        return Err(ToggleError::Vanished);
    };
    // Reject when the fuzzy match is ambiguous (multiple un-
    // anchored siblings with identical raw_text).
    if record.block_anchor.is_none() {
        let count = parsed
            .iter()
            .filter(|t| t.block_anchor.is_none() && t.raw_text == record.raw_text)
            .count();
        if count > 1 {
            return Err(ToggleError::Ambiguous);
        }
    }
    let next_status = match target.status {
        TaskStatus::Open => TaskStatus::Done,
        TaskStatus::Done => TaskStatus::Open,
    };
    let rewritten_line = rewrite_line(body, target, next_status);
    let new_anchor = if target.block_anchor.is_none() {
        Some(mint_anchor(&record.file_id, &target.raw_text, target.line))
    } else {
        None
    };
    let line_with_anchor = match &new_anchor {
        Some(a) => format!("{rewritten_line} {a}"),
        None => rewritten_line,
    };
    let mut out = String::with_capacity(body.len() + 16);
    out.push_str(&body[..target.start_byte]);
    out.push_str(&line_with_anchor);
    out.push_str(&body[target.end_byte..]);
    let _ = idx;
    Ok(ToggleOutcome {
        new_body: out,
        new_status: next_status,
        new_anchor,
        line: target.line,
    })
}

fn locate_task<'a>(
    parsed: &'a [ParsedTask],
    record: &TaskRecord,
) -> Option<(usize, &'a ParsedTask)> {
    // 1. Anchor match (canonical).
    if let Some(anchor) = record.block_anchor.as_deref() {
        if let Some((idx, t)) = parsed
            .iter()
            .enumerate()
            .find(|(_, t)| t.block_anchor.as_deref() == Some(anchor))
        {
            return Some((idx, t));
        }
    }
    // 2. Line-hint probe.
    if let Some(t) = parsed.iter().find(|t| t.line == record.line_hint as usize) {
        if t.raw_text == record.raw_text {
            return Some((record.line_hint as usize, t));
        }
    }
    // 3. raw_text equality across the doc.
    let mut iter = parsed
        .iter()
        .enumerate()
        .filter(|(_, t)| t.raw_text == record.raw_text);
    let first = iter.next()?;
    if iter.next().is_some() {
        // Ambiguous — caller decides whether to refuse.
        return Some(first); // returns first; caller checks counts
    }
    Some(first)
}

/// Replace the `[ ]` / `[x]` inside the original line text, preserving
/// every other byte so leading whitespace / bullet style / trailing
/// content are untouched.
fn rewrite_line(body: &str, target: &ParsedTask, next: TaskStatus) -> String {
    let line = &body[target.start_byte..target.end_byte];
    let marker_pos = line.find("[ ]").or_else(|| line.find("[x]")).or_else(|| line.find("[X]"));
    let Some(idx) = marker_pos else {
        // Defensive — parse_tasks already promised one of these
        // markers is present.
        return line.to_string();
    };
    let replacement = match next {
        TaskStatus::Open => "[ ]",
        TaskStatus::Done => "[x]",
    };
    let mut out = String::with_capacity(line.len());
    out.push_str(&line[..idx]);
    out.push_str(replacement);
    out.push_str(&line[idx + 3..]);
    out
}

/// Disk-touching wrapper. Reads `<vault>/<file_id>`, computes the
/// new body via [`toggle_task_in_body`], and writes atomically.
pub fn toggle_task_in_file(
    vault_root: &Path,
    record: &TaskRecord,
) -> Result<ToggleOutcome, ToggleError> {
    let abs = vault_root.join(&record.file_id);
    let body = std::fs::read_to_string(&abs)?;
    let outcome = toggle_task_in_body(&body, record)?;
    atomic_write(&abs, &outcome.new_body)?;
    Ok(outcome)
}

fn atomic_write(target: &Path, contents: &str) -> Result<(), ToggleError> {
    use std::io::Write;
    let dir = target.parent().ok_or_else(|| {
        ToggleError::Io(format!("path has no parent: {}", target.display()))
    })?;
    let tmp_name = format!(
        ".{}.{}.tmp",
        target
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("task"),
        uuid::Uuid::new_v4().simple(),
    );
    let tmp = dir.join(tmp_name);
    {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(contents.as_bytes())?;
        f.sync_all().ok();
    }
    if let Err(e) = std::fs::rename(&tmp, target) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e.into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::fs::tasks::repo::task_id;

    fn make_record(
        file_id: &str,
        anchor: Option<&str>,
        raw_text: &str,
        line_hint: u32,
        status: TaskStatus,
    ) -> TaskRecord {
        TaskRecord {
            id: task_id(file_id, anchor, raw_text),
            file_id: file_id.to_string(),
            block_anchor: anchor.map(|a| a.to_string()),
            line_hint,
            status,
            raw_text: raw_text.to_string(),
            indexed_at: 0,
        }
    }

    #[test]
    fn flip_open_to_done_appends_anchor_on_first_toggle() {
        let body = "- [ ] buy milk\n";
        let rec = make_record("n.md", None, "buy milk", 0, TaskStatus::Open);
        let out = toggle_task_in_body(body, &rec).unwrap();
        assert_eq!(out.new_status, TaskStatus::Done);
        assert!(out.new_anchor.is_some());
        assert!(out.new_body.contains("- [x] buy milk ^blk_"));
    }

    #[test]
    fn flip_done_to_open_preserves_existing_anchor() {
        let body = "- [x] buy milk ^blk_abc12\n";
        let rec = make_record(
            "n.md",
            Some("^blk_abc12"),
            "buy milk",
            0,
            TaskStatus::Done,
        );
        let out = toggle_task_in_body(body, &rec).unwrap();
        assert_eq!(out.new_status, TaskStatus::Open);
        assert!(out.new_anchor.is_none());
        // Anchor still present, exactly once.
        assert_eq!(
            out.new_body.matches("^blk_abc12").count(),
            1,
            "{}",
            out.new_body
        );
    }

    #[test]
    fn anchor_match_works_when_line_hint_is_stale() {
        let body = "intro\nintro2\n- [ ] task ^blk_xyz09\n";
        let rec = make_record("n.md", Some("^blk_xyz09"), "task", 0, TaskStatus::Open);
        let out = toggle_task_in_body(body, &rec).unwrap();
        assert_eq!(out.line, 2);
        assert!(out.new_body.contains("- [x] task ^blk_xyz09"));
    }

    #[test]
    fn fuzzy_match_falls_back_when_anchor_missing() {
        let body = "- [ ] buy milk\n";
        let rec = make_record("n.md", None, "buy milk", 9, TaskStatus::Open);
        let out = toggle_task_in_body(body, &rec).unwrap();
        assert!(out.new_body.contains("- [x] buy milk ^blk_"));
    }

    #[test]
    fn returns_ambiguous_when_two_anchorless_tasks_share_text() {
        let body = "- [ ] same\n- [ ] same\n";
        let rec = make_record("n.md", None, "same", 0, TaskStatus::Open);
        let err = toggle_task_in_body(body, &rec).unwrap_err();
        assert!(matches!(err, ToggleError::Ambiguous));
    }

    #[test]
    fn returns_vanished_when_task_removed_from_file() {
        let body = "no tasks here\n";
        let rec = make_record("n.md", Some("^blk_gone"), "task", 0, TaskStatus::Open);
        let err = toggle_task_in_body(body, &rec).unwrap_err();
        assert!(matches!(err, ToggleError::Vanished));
    }

    #[test]
    fn preserves_indentation_and_bullet_style() {
        let body = "  * [ ] indented star\n";
        let rec = make_record("n.md", None, "indented star", 0, TaskStatus::Open);
        let out = toggle_task_in_body(body, &rec).unwrap();
        assert!(out.new_body.starts_with("  * [x] indented star"));
    }

    #[test]
    fn anchor_is_idempotent_within_same_file() {
        let body = "- [ ] buy milk\n";
        let rec = make_record("n.md", None, "buy milk", 0, TaskStatus::Open);
        let first = toggle_task_in_body(body, &rec).unwrap();
        // Re-parse the post-toggle body to extract the new anchor,
        // then build a record around it and toggle again.
        let second_rec = make_record(
            "n.md",
            first.new_anchor.as_deref(),
            "buy milk",
            0,
            TaskStatus::Done,
        );
        let second = toggle_task_in_body(&first.new_body, &second_rec).unwrap();
        // Status flipped back. Anchor stays.
        assert_eq!(second.new_status, TaskStatus::Open);
        assert!(second.new_body.contains(first.new_anchor.as_deref().unwrap()));
    }
}
