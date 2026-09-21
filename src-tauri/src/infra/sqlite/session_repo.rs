use crate::domain::errors::DomainError;
use crate::domain::models::{Message, Session};
use crate::domain::traits::stores::{MessageStore, SessionStore};
use crate::infra::sqlite::pool::DbPool;
use async_trait::async_trait;
use chrono::Utc;
use rusqlite::params;
use uuid::Uuid;

#[derive(Clone)]
pub struct SqliteSessionRepo {
    pool: DbPool,
}

impl SqliteSessionRepo {
    pub fn new(pool: DbPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl SessionStore for SqliteSessionRepo {
    fn create_session(&self, id: Option<&str>, title: &str) -> Result<Session, DomainError> {
        let conn = self
            .pool
            .get()
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        let sid = id
            .map(|s| s.to_string())
            .unwrap_or_else(|| Uuid::new_v4().simple().to_string()[..16].to_string());
        let now = Utc::now().to_rfc3339();
        let trimmed_title = title.trim();
        let final_title = if trimmed_title.is_empty() {
            format!("Sessão {}", &now[..16])
        } else {
            trimmed_title.to_string()
        };

        conn.execute(
            "INSERT INTO sessions (id, titulo, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params![sid, final_title, now, now],
        )
        .map_err(|e| DomainError::DatabaseError(e.to_string()))?;

        Ok(Session {
            id: sid,
            titulo: final_title,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    fn list_sessions(&self) -> Result<Vec<Session>, DomainError> {
        let conn = self
            .pool
            .get()
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        let mut stmt = conn
            .prepare(
                "SELECT id, titulo, created_at, updated_at FROM sessions ORDER BY updated_at DESC, rowid DESC",
            )
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;

        let rows = stmt
            .query_map([], |row| {
                Ok(Session {
                    id: row.get(0)?,
                    titulo: row.get(1)?,
                    created_at: row.get(2)?,
                    updated_at: row.get(3)?,
                })
            })
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;

        let mut sessions = Vec::new();
        for s in rows {
            sessions.push(s.map_err(|e| DomainError::DatabaseError(e.to_string()))?);
        }
        Ok(sessions)
    }

    fn get_session(&self, session_id: &str) -> Result<Option<Session>, DomainError> {
        let conn = self
            .pool
            .get()
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        let mut stmt = conn
            .prepare("SELECT id, titulo, created_at, updated_at FROM sessions WHERE id = ?1")
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;

        let mut rows = stmt
            .query(params![session_id])
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;

        if let Some(row) = rows
            .next()
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?
        {
            Ok(Some(Session {
                id: row
                    .get(0)
                    .map_err(|e| DomainError::DatabaseError(e.to_string()))?,
                titulo: row
                    .get(1)
                    .map_err(|e| DomainError::DatabaseError(e.to_string()))?,
                created_at: row
                    .get(2)
                    .map_err(|e| DomainError::DatabaseError(e.to_string()))?,
                updated_at: row
                    .get(3)
                    .map_err(|e| DomainError::DatabaseError(e.to_string()))?,
            }))
        } else {
            Ok(None)
        }
    }

    fn rename_session(&self, session_id: &str, new_title: &str) -> Result<bool, DomainError> {
        let trimmed = new_title.trim();
        if trimmed.is_empty() {
            return Err(DomainError::InvalidInput(
                "Título não pode ser vazio".into(),
            ));
        }
        let conn = self
            .pool
            .get()
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        let now = Utc::now().to_rfc3339();
        let affected = conn
            .execute(
                "UPDATE sessions SET titulo = ?1, updated_at = ?2 WHERE id = ?3",
                params![trimmed, now, session_id],
            )
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        Ok(affected > 0)
    }

    fn delete_session(&self, session_id: &str) -> Result<bool, DomainError> {
        let conn = self
            .pool
            .get()
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        let affected = conn
            .execute("DELETE FROM sessions WHERE id = ?1", params![session_id])
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        Ok(affected > 0)
    }
}

#[async_trait]
impl MessageStore for SqliteSessionRepo {
    fn add_message(
        &self,
        session_id: &str,
        role: &str,
        content: &str,
        tool_call_id: Option<&str>,
        tool_calls: Option<&str>,
        tokens: Option<i64>,
        parent_id: Option<i64>,
    ) -> Result<Message, DomainError> {
        if !["system", "user", "assistant", "tool"].contains(&role) {
            return Err(DomainError::InvalidInput(format!("Role inválido: {role}")));
        }
        let conn = self
            .pool
            .get()
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        let now = Utc::now().to_rfc3339();

        let mut check = conn
            .prepare("SELECT 1 FROM sessions WHERE id = ?1")
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        if !check
            .exists(params![session_id])
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?
        {
            return Err(DomainError::NotFound(format!(
                "Sessão não encontrada: {session_id}"
            )));
        }

        conn.execute(
            "INSERT INTO messages (session_id, role, content, tool_call_id, tool_calls, created_at, tokens, parent_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                session_id,
                role,
                content,
                tool_call_id,
                tool_calls,
                now,
                tokens.unwrap_or(0),
                parent_id
            ],
        )
        .map_err(|e| DomainError::DatabaseError(e.to_string()))?;

        let id = conn.last_insert_rowid();

        let _ = conn.execute(
            "UPDATE sessions SET updated_at = ?1 WHERE id = ?2",
            params![now, session_id],
        );

        Ok(Message {
            id,
            session_id: session_id.to_string(),
            role: role.to_string(),
            content: content.to_string(),
            tool_call_id: tool_call_id.map(|s| s.to_string()),
            tool_calls: tool_calls.map(|s| s.to_string()),
            created_at: now,
            tokens,
            parent_id,
        })
    }

    fn get_messages(&self, session_id: &str) -> Result<Vec<Message>, DomainError> {
        let conn = self
            .pool
            .get()
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        let mut stmt = conn
            .prepare(
                "SELECT id, session_id, role, content, tool_call_id, tool_calls, created_at, tokens, parent_id FROM messages WHERE session_id = ?1 ORDER BY id ASC",
            )
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;

        let rows = stmt
            .query_map(params![session_id], |row| {
                Ok(Message {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    role: row.get(2)?,
                    content: row.get(3)?,
                    tool_call_id: row.get(4)?,
                    tool_calls: row.get(5)?,
                    created_at: row.get(6)?,
                    tokens: row.get(7)?,
                    parent_id: row.get(8)?,
                })
            })
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;

        let mut messages = Vec::new();
        for m in rows {
            messages.push(m.map_err(|e| DomainError::DatabaseError(e.to_string()))?);
        }
        Ok(messages)
    }

    fn delete_message(&self, message_id: i64) -> Result<bool, DomainError> {
        let conn = self
            .pool
            .get()
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        let affected = conn
            .execute("DELETE FROM messages WHERE id = ?1", params![message_id])
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        Ok(affected > 0)
    }

    fn truncate_messages_from(&self, session_id: &str, from_id: i64) -> Result<usize, DomainError> {
        let conn = self
            .pool
            .get()
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        let affected = conn
            .execute(
                "DELETE FROM messages WHERE session_id = ?1 AND id >= ?2",
                params![session_id, from_id],
            )
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        Ok(affected)
    }
}
