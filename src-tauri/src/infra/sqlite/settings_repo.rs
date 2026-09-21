use crate::domain::errors::DomainError;
use crate::domain::traits::stores::SettingsStore;
use crate::infra::sqlite::pool::DbPool;
use async_trait::async_trait;
use rusqlite::params;

#[derive(Clone)]
pub struct SqliteSettingsRepo {
    pool: DbPool,
}

impl SqliteSettingsRepo {
    pub fn new(pool: DbPool) -> Self {
        Self { pool }
    }

    pub fn delete_setting(&self, key: &str) -> Result<(), DomainError> {
        let conn = self
            .pool
            .get()
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        conn.execute("DELETE FROM settings WHERE key = ?1", params![key])
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        Ok(())
    }
}

#[async_trait]
impl SettingsStore for SqliteSettingsRepo {
    fn get_setting(&self, key: &str) -> Result<Option<String>, DomainError> {
        let conn = self
            .pool
            .get()
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        let mut stmt = conn
            .prepare("SELECT value FROM settings WHERE key = ?1")
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        let mut rows = stmt
            .query(params![key])
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        if let Some(row) = rows
            .next()
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?
        {
            Ok(Some(
                row.get(0)
                    .map_err(|e| DomainError::DatabaseError(e.to_string()))?,
            ))
        } else {
            Ok(None)
        }
    }

    fn set_setting(&self, key: &str, value: &str) -> Result<(), DomainError> {
        let conn = self
            .pool
            .get()
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2",
            params![key, value],
        )
        .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        Ok(())
    }
}
