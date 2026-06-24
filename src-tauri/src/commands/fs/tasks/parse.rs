//! Pure Markdown task line parser. Zero I/O, zero SQLite — the
//! same function powers both the indexer and the toggle command's
//! "what does this line currently look like" probe.
//!
//! Recognised syntax (matches GFM tasklists):
//!
//! ```text
//! - [ ] open
//! - [x] done
//! - [X] done (capital X also valid)
//! * [ ] alternative bullet
//! 1. [ ] ordered-list tasks supported
//!   - [ ] indented inside another list
//! ```
//!
//! NOT recognised on purpose:
//!   * `> - [ ] inside blockquote` — Obsidian/Bear historically
//!     don't toggle these.
//!   * Tasks inside fenced code blocks — the scanner tracks fence
//!     state explicitly.

use serde::{Deserialize, Serialize};
use specta::Type;

/// 0/1 status flag mirrored in `tasks.status` as `"open"`/`"done"`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum TaskStatus {
    Open,
    Done,
}

impl TaskStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            TaskStatus::Open => "open",
            TaskStatus::Done => "done",
        }
    }
    pub fn from_db_str(raw: &str) -> Self {
        if raw == "done" {
            TaskStatus::Done
        } else {
            TaskStatus::Open
        }
    }
}

/// One task line as parsed from a file body. The toggle command
/// needs the byte range (`start_byte..end_byte`) so it can rewrite
/// the exact slice without disturbing surrounding lines.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedTask {
    /// 0-based line index.
    pub line: usize,
    pub status: TaskStatus,
    /// Task text WITHOUT the leading bullet + `[ ]` / `[x]` and
    /// WITHOUT any trailing `^blk_…` anchor. Trimmed.
    pub raw_text: String,
    /// The anchor as written in the file, including the `^` prefix.
    /// `None` when the line has no anchor — toggle will mint one.
    pub block_anchor: Option<String>,
    /// Byte offset of the start of the line (exclusive of any
    /// preceding `\n`).
    pub start_byte: usize,
    /// Byte offset of the end of the line (exclusive of the
    /// trailing `\n`, if any).
    pub end_byte: usize,
}

/// Parse every task line in `body`. Skips fenced code blocks
/// (``` and ~~~) and HTML comments (`<!-- ... -->`).
pub fn parse_tasks(body: &str) -> Vec<ParsedTask> {
    let mut out = Vec::new();
    let bytes = body.as_bytes();
    let mut offset = 0usize;
    let mut in_fence: Option<char> = None;
    let mut in_html_comment = false;

    for (line_idx, line) in body.split('\n').enumerate() {
        let line_start = offset;
        let line_end = offset + line.len();
        offset = line_end + 1; // account for the \n we split on

        // HTML comment open/close. Tracked simply; nested comments
        // are not legal in Markdown so a flat flag is enough.
        if in_html_comment {
            if line.contains("-->") {
                in_html_comment = false;
            }
            continue;
        }
        if line.trim_start().starts_with("<!--") && !line.contains("-->") {
            in_html_comment = true;
            continue;
        }

        // Fenced code block toggle. We accept both ``` and ~~~ with
        // any length ≥3.
        if let Some(fence_char) = in_fence {
            if is_code_fence(line, fence_char) {
                in_fence = None;
            }
            continue;
        }
        if let Some(c) = open_code_fence(line) {
            in_fence = Some(c);
            continue;
        }

        let Some(task) = parse_task_line(line, line_idx, line_start, line_end) else {
            continue;
        };
        out.push(task);
    }

    // Validate end_byte against the source so callers that slice
    // can trust the range.
    debug_assert!(out.iter().all(|t| t.end_byte <= bytes.len()));

    out
}

fn open_code_fence(line: &str) -> Option<char> {
    let trimmed = line.trim_start();
    if let Some(rest) = trimmed.strip_prefix("```") {
        // `````` is still a fence open as long as the rest doesn't
        // contain a closing run; we conservatively call it open.
        let _ = rest;
        return Some('`');
    }
    if let Some(rest) = trimmed.strip_prefix("~~~") {
        let _ = rest;
        return Some('~');
    }
    None
}

fn is_code_fence(line: &str, fence_char: char) -> bool {
    let trimmed = line.trim();
    let needle = match fence_char {
        '`' => "```",
        '~' => "~~~",
        _ => return false,
    };
    trimmed.starts_with(needle) && trimmed.chars().all(|c| c == fence_char || c.is_whitespace())
}

fn parse_task_line(
    line: &str,
    line_idx: usize,
    start_byte: usize,
    end_byte: usize,
) -> Option<ParsedTask> {
    let trimmed = line.trim_start();
    // Bullet: `-`, `*`, `+`, or `N.`/`N)`.
    let after_bullet = strip_bullet(trimmed)?;
    let after_space = after_bullet.strip_prefix(' ')?;
    // `[ ]` / `[x]` / `[X]`.
    let (status, rest) = if let Some(rest) = after_space.strip_prefix("[ ]") {
        (TaskStatus::Open, rest)
    } else if let Some(rest) = after_space
        .strip_prefix("[x]")
        .or_else(|| after_space.strip_prefix("[X]"))
    {
        (TaskStatus::Done, rest)
    } else {
        return None;
    };
    // After the marker there must be a space OR end-of-line —
    // guards against `[ ]extra` (no separator) being treated as a
    // task. This is how every standards-aware Markdown tasklist
    // tokeniser behaves.
    let rest = match rest.chars().next() {
        None => "",
        Some(' ') => rest.trim_start_matches(' '),
        Some(_) => return None,
    };
    let (raw_text, anchor) = split_trailing_anchor(rest);
    Some(ParsedTask {
        line: line_idx,
        status,
        raw_text: raw_text.trim().to_string(),
        block_anchor: anchor,
        start_byte,
        end_byte,
    })
}

fn strip_bullet(line: &str) -> Option<&str> {
    if let Some(rest) = line
        .strip_prefix("- ")
        .or_else(|| line.strip_prefix("* "))
        .or_else(|| line.strip_prefix("+ "))
    {
        // Put back the consumed space so `parse_task_line` can
        // do the next strip uniformly.
        let leading_space_byte = line.len() - rest.len() - 1;
        return Some(&line[leading_space_byte..]);
    }
    // Ordered list: `<digit+><.|)> <rest>`
    let mut i = 0;
    let bytes = line.as_bytes();
    while i < bytes.len() && bytes[i].is_ascii_digit() {
        i += 1;
    }
    if i == 0 {
        return None;
    }
    let marker = *bytes.get(i)?;
    if marker != b'.' && marker != b')' {
        return None;
    }
    i += 1;
    if bytes.get(i) != Some(&b' ') {
        return None;
    }
    Some(&line[i..])
}

/// Split a task body into `(text, Option<anchor>)`. The anchor
/// pattern is `^blk_[a-z0-9]+` appearing as the trailing token of
/// the line. We accept any chunk after the last whitespace that
/// starts with `^blk_` to keep the parser permissive (Obsidian
/// allows underscores + digits + letters in the suffix).
pub fn split_trailing_anchor(text: &str) -> (&str, Option<String>) {
    let trimmed = text.trim_end();
    let Some(idx) = trimmed.rfind(|c: char| c.is_whitespace()) else {
        // Single-token line — check if the whole thing is an anchor.
        if is_anchor_token(trimmed) {
            return ("", Some(trimmed.to_string()));
        }
        return (trimmed, None);
    };
    let candidate = &trimmed[idx + 1..];
    if is_anchor_token(candidate) {
        return (trimmed[..idx].trim_end(), Some(candidate.to_string()));
    }
    (trimmed, None)
}

fn is_anchor_token(token: &str) -> bool {
    let Some(rest) = token.strip_prefix("^blk_") else {
        return false;
    };
    !rest.is_empty()
        && rest
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Generate a fresh `^blk_<base32>` anchor seeded by content. Pure
/// helper so the toggle command can guarantee stable anchors for
/// the same content under repeated toggles inside the same file
/// (idempotency across re-runs without an external RNG).
pub fn mint_anchor(file_id: &str, raw_text: &str, line: usize) -> String {
    use blake3::Hasher;
    let mut h = Hasher::new();
    h.update(file_id.as_bytes());
    h.update(b"\0");
    h.update(raw_text.as_bytes());
    h.update(b"\0");
    h.update(&(line as u64).to_le_bytes());
    let hash = h.finalize();
    let bytes = &hash.as_bytes()[..6];
    let mut out = String::with_capacity(6 + 11);
    out.push_str("^blk_");
    // Lower-case base32 a-z2-7 (RFC 4648). Hand-rolled to skip the
    // padding chars `=` and avoid pulling in a base32 crate for
    // 6 bytes.
    let alphabet: &[u8; 32] = b"abcdefghijklmnopqrstuvwxyz234567";
    let mut buf = 0u64;
    let mut bits = 0u32;
    for b in bytes {
        buf = (buf << 8) | (*b as u64);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            let v = ((buf >> bits) & 0x1f) as usize;
            out.push(alphabet[v] as char);
        }
    }
    if bits > 0 {
        let v = ((buf << (5 - bits)) & 0x1f) as usize;
        out.push(alphabet[v] as char);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_simple_open_task() {
        let body = "- [ ] buy milk\n";
        let tasks = parse_tasks(body);
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].status, TaskStatus::Open);
        assert_eq!(tasks[0].raw_text, "buy milk");
        assert_eq!(tasks[0].block_anchor, None);
        assert_eq!(tasks[0].line, 0);
    }

    #[test]
    fn parses_done_task_both_cases() {
        let body = "- [x] lower\n- [X] upper\n";
        let tasks = parse_tasks(body);
        assert_eq!(tasks.len(), 2);
        assert!(tasks.iter().all(|t| t.status == TaskStatus::Done));
    }

    #[test]
    fn parses_indented_and_ordered_list_tasks() {
        let body = "  - [ ] nested\n1. [ ] ordered\n2) [x] also ordered\n";
        let tasks = parse_tasks(body);
        assert_eq!(tasks.len(), 3);
        assert_eq!(tasks[0].raw_text, "nested");
        assert_eq!(tasks[1].raw_text, "ordered");
        assert_eq!(tasks[2].raw_text, "also ordered");
        assert_eq!(tasks[2].status, TaskStatus::Done);
    }

    #[test]
    fn captures_trailing_anchor() {
        let body = "- [ ] buy milk ^blk_abc12\n";
        let tasks = parse_tasks(body);
        assert_eq!(tasks[0].block_anchor.as_deref(), Some("^blk_abc12"));
        assert_eq!(tasks[0].raw_text, "buy milk");
    }

    #[test]
    fn ignores_tasks_inside_code_fence() {
        let body = "```\n- [ ] not a task\n```\n- [ ] real one\n";
        let tasks = parse_tasks(body);
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].raw_text, "real one");
        assert_eq!(tasks[0].line, 3);
    }

    #[test]
    fn ignores_tasks_inside_tilde_fence() {
        let body = "~~~md\n- [ ] not a task\n~~~\n- [ ] real one\n";
        let tasks = parse_tasks(body);
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].raw_text, "real one");
    }

    #[test]
    fn rejects_invalid_marker_runons() {
        let body = "- [ ]nope\n- [a] not\n- [ ] yes\n";
        let tasks = parse_tasks(body);
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].raw_text, "yes");
    }

    #[test]
    fn byte_offsets_round_trip_to_source() {
        let body = "first\n- [ ] task\nlast\n";
        let tasks = parse_tasks(body);
        let t = &tasks[0];
        assert_eq!(&body[t.start_byte..t.end_byte], "- [ ] task");
    }

    #[test]
    fn mint_anchor_is_deterministic_and_stable() {
        let a = mint_anchor("notes/x.md", "buy milk", 5);
        let b = mint_anchor("notes/x.md", "buy milk", 5);
        assert_eq!(a, b);
        assert!(a.starts_with("^blk_"));
    }

    #[test]
    fn mint_anchor_differs_per_input() {
        let a = mint_anchor("notes/x.md", "buy milk", 5);
        let b = mint_anchor("notes/x.md", "buy eggs", 5);
        let c = mint_anchor("notes/y.md", "buy milk", 5);
        assert_ne!(a, b);
        assert_ne!(a, c);
    }

    #[test]
    fn split_trailing_anchor_handles_anchor_only_line() {
        let (text, anchor) = split_trailing_anchor("^blk_alone");
        assert_eq!(text, "");
        assert_eq!(anchor.as_deref(), Some("^blk_alone"));
    }
}
