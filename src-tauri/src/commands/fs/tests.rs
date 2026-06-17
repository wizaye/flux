//! Integration tests for file system operations.
//!
//! Tests file and directory operations using a real vault setup.

#[cfg(test)]
mod fs_tests {
    use crate::commands::vault;
    use crate::db::{self, repo::FileRecord};
    use crate::state::AppState;
    use crate::types::FileState;
    use std::sync::Arc;
    use tempfile::tempdir;
    use uuid::Uuid;

    /// Helper to set up a test vault and return the temp dir and state.
    async fn setup_test_vault() -> (tempfile::TempDir, Arc<AppState>) {
        let dir = tempdir().unwrap();
        let vault_path = dir.path().join("test-vault");
        std::fs::create_dir(&vault_path).unwrap();

        let state = Arc::new(AppState::default());
        let path_str = vault_path.to_str().unwrap().to_string();

        // Open vault using impl function
        vault::open_vault_impl(path_str, &state)
            .await
            .unwrap();

        (dir, state)
    }

    /// Helper to get vault path from state.
    fn get_vault_path(state: &AppState) -> std::path::PathBuf {
        let vault_path = state.vault_path.lock().unwrap();
        std::path::PathBuf::from(vault_path.as_ref().unwrap())
    }

    /// Helper to get db pool from state.
    fn get_db_pool(state: &AppState) -> crate::db::DbPool {
        let pool = state.db_pool.lock().unwrap();
        pool.clone().unwrap()
    }

    #[tokio::test]
    async fn test_create_and_read_file() {
        let (_dir, state) = setup_test_vault().await;

        let content = "# Test Note\n\nThis is a test.";
        let path = "test.md".to_string();

        // Create file directly
        let vault_path = get_vault_path(&state);
        let file_path = vault_path.join(&path);
        tokio::fs::write(&file_path, content).await.unwrap();

        // Register in database
        let pool = get_db_pool(&state);
        let blake3_hash = blake3::hash(content.as_bytes()).as_bytes().to_vec();
        let record = FileRecord {
            id: Uuid::now_v7(),
            relative_path: path.clone(),
            title: "test".to_string(),
            blake3_hash,
            modified_at: chrono::Utc::now().timestamp_millis(),
            state: FileState::Active,
            size_bytes: content.len() as u64,
            created_at: chrono::Utc::now().timestamp_millis(),
        };
        db::run_blocking(&pool, move |conn| FileRecord::insert(conn, &record))
            .await
            .unwrap();

        // Read file directly
        let read_content = tokio::fs::read_to_string(&file_path).await.unwrap();
        assert_eq!(read_content, content);
    }

    #[tokio::test]
    async fn test_delete_file_moves_to_trash() {
        let (_dir, state) = setup_test_vault().await;
        let vault_path_buf = get_vault_path(&state);

        // Create file
        let path = "test.md";
        let file_path = vault_path_buf.join(path);
        tokio::fs::write(&file_path, "Test content").await.unwrap();

        // Register in database
        let pool = get_db_pool(&state);
        let record = FileRecord {
            id: Uuid::now_v7(),
            relative_path: path.to_string(),
            title: "test".to_string(),
            blake3_hash: vec![0u8; 32],
            modified_at: chrono::Utc::now().timestamp_millis(),
            state: FileState::Active,
            size_bytes: 12,
            created_at: chrono::Utc::now().timestamp_millis(),
        };
        db::run_blocking(&pool, move |conn| FileRecord::insert(conn, &record))
            .await
            .unwrap();

        // Delete file (move to trash)
        let now = chrono::Utc::now();
        let trash_month_dir = vault_path_buf.join(".trash").join(now.format("%Y-%m").to_string());
        tokio::fs::create_dir_all(&trash_month_dir).await.unwrap();

        let trash_file_path = trash_month_dir.join(path);
        tokio::fs::rename(&file_path, &trash_file_path).await.unwrap();

        // Update state
        db::run_blocking(&pool, |conn| {
            FileRecord::update_state(conn, path, FileState::Trashed)
        })
        .await
        .unwrap();

        // File should not exist in vault root
        assert!(!file_path.exists());

        // File should exist in trash
        assert!(trash_file_path.exists());
    }

    #[tokio::test]
    async fn test_path_validation() {
        use crate::commands::fs::common::validate_and_resolve_path;
        
        let (_dir, state) = setup_test_vault().await;
        let vault_path = get_vault_path(&state);

        // Test path traversal
        let result = validate_and_resolve_path(&vault_path, "../../../etc/passwd");
        assert!(result.is_err());

        // Test absolute path
        let result = validate_and_resolve_path(&vault_path, "/etc/passwd");
        assert!(result.is_err());

        // Test valid relative path
        let result = validate_and_resolve_path(&vault_path, "notes/test.md");
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_validate_and_resolve_path() {
        use crate::commands::fs::common::validate_and_resolve_path;
        
        let (_dir, state) = setup_test_vault().await;
        let vault_path = get_vault_path(&state);

        // Valid path
        let result = validate_and_resolve_path(&vault_path, "test.md");
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), vault_path.join("test.md"));

        // Path with subdirectory
        let result = validate_and_resolve_path(&vault_path, "notes/test.md");
        assert!(result.is_ok());
    }
}
