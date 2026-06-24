//! Unit tests for domain types and error conversions in `flux_lib::types`.

use flux_lib::types::{AppError, FileState};
use r2d2::{Pool, ManageConnection};

#[test]
fn file_state_as_str_returns_lowercase_string() {
    assert_eq!(FileState::Active.as_str(), "active");
    assert_eq!(FileState::Archived.as_str(), "archived");
    assert_eq!(FileState::Trashed.as_str(), "trashed");
}

#[test]
fn file_state_from_db_str_round_trips_every_variant() {
    for variant in [FileState::Active, FileState::Archived, FileState::Trashed] {
        assert_eq!(
            FileState::from_db_str(variant.as_str()),
            variant,
            "round-trip failed for {:?}",
            variant,
        );
    }
}

#[test]
fn file_state_from_db_str_defaults_unknown_to_active() {
    // Forward-compat: unknown / corrupted state strings must NOT
    // hide the row — a future variant rolling back to this build
    // should still show the file in the user's vault.
    assert_eq!(FileState::from_db_str(""), FileState::Active);
    assert_eq!(FileState::from_db_str("future-state"), FileState::Active);
    assert_eq!(FileState::from_db_str("ACTIVE"), FileState::Active);
}

#[test]
fn app_error_from_std_io_error() {
    // 1. NotFound -> AppError::NotFound
    let err_not_found = std::io::Error::new(std::io::ErrorKind::NotFound, "file not found");
    let app_err = AppError::from(err_not_found);
    assert!(
        matches!(app_err, AppError::NotFound(ref msg) if msg.contains("file not found")),
        "expected AppError::NotFound, got {:?}",
        app_err
    );

    // 2. PermissionDenied -> AppError::PermissionDenied
    let err_denied = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "access denied");
    let app_err = AppError::from(err_denied);
    assert!(
        matches!(app_err, AppError::PermissionDenied(ref msg) if msg.contains("access denied")),
        "expected AppError::PermissionDenied, got {:?}",
        app_err
    );

    // 3. AlreadyExists -> AppError::AlreadyExists
    let err_exists = std::io::Error::new(std::io::ErrorKind::AlreadyExists, "file exists");
    let app_err = AppError::from(err_exists);
    assert!(
        matches!(app_err, AppError::AlreadyExists(ref msg) if msg.contains("file exists")),
        "expected AppError::AlreadyExists, got {:?}",
        app_err
    );

    // 4. Other kinds -> AppError::Io
    let err_other = std::io::Error::new(std::io::ErrorKind::ConnectionAborted, "conn aborted");
    let app_err = AppError::from(err_other);
    assert!(
        matches!(app_err, AppError::Io(ref msg) if msg.contains("conn aborted")),
        "expected AppError::Io, got {:?}",
        app_err
    );
}

#[test]
fn app_error_from_rusqlite_error() {
    let db_err = rusqlite::Error::QueryReturnedNoRows;
    let app_err = AppError::from(db_err);
    assert!(
        matches!(app_err, AppError::Database(ref msg) if msg.contains("Query returned no rows")),
        "expected AppError::Database, got {:?}",
        app_err
    );
}

#[derive(Debug)]
struct DummyManager;
impl ManageConnection for DummyManager {
    type Connection = ();
    type Error = std::io::Error;

    fn connect(&self) -> Result<Self::Connection, Self::Error> {
        Err(std::io::Error::new(std::io::ErrorKind::Other, "connection failed"))
    }

    fn is_valid(&self, _conn: &mut Self::Connection) -> Result<(), Self::Error> {
        Ok(())
    }

    fn has_broken(&self, _conn: &mut Self::Connection) -> bool {
        false
    }
}

#[test]
fn app_error_from_r2d2_error() {
    let r2d2_err = Pool::builder()
        .connection_timeout(std::time::Duration::from_millis(1))
        .build(DummyManager)
        .unwrap_err();
    let app_err = AppError::from(r2d2_err);
    assert!(
        matches!(app_err, AppError::Database(ref msg) if msg.contains("connection failed") || msg.contains("timed out")),
        "expected AppError::Database, got {:?}",
        app_err
    );
}
