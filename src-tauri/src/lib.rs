// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// ── Unit tests ────────────────────────────────────────────────────────────
//
// Run with:  cargo test  (inside src-tauri/)
//
// These tests exercise the command logic directly without spinning up a
// Tauri runtime.  Integration tests that need a real AppHandle live in
// src-tauri/tests/ (added as the backend grows).

#[cfg(test)]
mod tests {
    use super::*;

    // ── greet command ────────────────────────────────────────────────────

    /// The greeting format must not change without a matching frontend
    /// update — the webview parses this string.
    #[test]
    fn greet_returns_expected_format() {
        let result = greet("World");
        assert_eq!(result, "Hello, World! You've been greeted from Rust!");
    }

    #[test]
    fn greet_interpolates_the_name() {
        assert!(greet("Alice").contains("Alice"));
        assert!(greet("Bob").contains("Bob"));
    }

    #[test]
    fn greet_with_empty_string() {
        let result = greet("");
        // Should still produce a well-formed sentence even for empty input.
        assert_eq!(result, "Hello, ! You've been greeted from Rust!");
    }

    #[test]
    fn greet_with_unicode_name() {
        let result = greet("日本語");
        assert!(result.contains("日本語"));
    }

    #[test]
    fn greet_with_special_characters() {
        let result = greet("O'Brien & Co.");
        assert!(result.contains("O'Brien & Co."));
    }

    // ── Greeting string structure ────────────────────────────────────────

    #[test]
    fn greet_starts_with_hello() {
        assert!(greet("test").starts_with("Hello,"));
    }

    #[test]
    fn greet_ends_with_exclamation() {
        assert!(greet("test").ends_with('!'));
    }
}
