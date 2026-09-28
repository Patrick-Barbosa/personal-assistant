use crate::domain::errors::DomainError;
use crate::domain::models::InboxItem;
use crate::domain::traits::stores::InboxStore;
use crate::infra::sqlite::pool::DbPool;
use async_trait::async_trait;
use chrono::Utc;
use rusqlite::params;

#[derive(Clone)]
pub struct SqliteInboxRepo {
    pool: DbPool,
}

impl SqliteInboxRepo {
    pub fn new(pool: DbPool) -> Self {
        Self { pool }
    }

    pub fn sanitize_decision_reason(reason: Option<&str>) -> Option<String> {
        let r = reason.unwrap_or("").trim();
        if r.is_empty() {
            return None;
        }
        let clean: String = r.chars().take(140).collect();
        let clean = clean.trim().to_string();
        if clean.is_empty() {
            None
        } else {
            Some(clean)
        }
    }

    pub fn prune_dismissed_older_than_hours(&self, hours: i64) -> Result<usize, DomainError> {
        let conn = self
            .pool
            .get()
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        let cutoff = (Utc::now() - chrono::Duration::hours(hours)).to_rfc3339();
        let affected = conn
            .execute(
                "DELETE FROM inbox_items WHERE status = 'dismissed' AND COALESCE(updated_at, created_at) < ?1",
                params![cutoff],
            )
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        Ok(affected)
    }
}

#[async_trait]
impl InboxStore for SqliteInboxRepo {
    fn insert_inbox_item(&self, item: &InboxItem) -> Result<(), DomainError> {
        let conn = self
            .pool
            .get()
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        conn.execute(
            "INSERT INTO inbox_items (id, session_id, title, summary, content, item_type, status, requires_decision, created_at, target_base_note_slug, proposed_content, diff_data, updated_at, decision_reason)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![
                item.id,
                item.session_id,
                item.title,
                item.summary,
                item.content,
                item.item_type,
                item.status,
                if item.requires_decision { 1 } else { 0 },
                item.created_at,
                item.target_base_note_slug,
                item.proposed_content,
                item.diff_data,
                item.updated_at,
                item.decision_reason,
            ],
        )
        .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        Ok(())
    }

    fn list_inbox_items(
        &self,
        status: Option<&str>,
        limit: Option<usize>,
    ) -> Result<Vec<InboxItem>, DomainError> {
        let conn = self
            .pool
            .get()
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        let query = match (status, limit) {
            (Some(_), Some(lim)) => format!(
                "SELECT id, session_id, title, summary, content, item_type, status, requires_decision, created_at, target_base_note_slug, proposed_content, diff_data, updated_at, decision_reason
                 FROM inbox_items WHERE status = ?1 ORDER BY created_at DESC LIMIT {lim}"
            ),
            (Some(_), None) => {
                "SELECT id, session_id, title, summary, content, item_type, status, requires_decision, created_at, target_base_note_slug, proposed_content, diff_data, updated_at, decision_reason
                 FROM inbox_items WHERE status = ?1 ORDER BY created_at DESC".to_string()
            }
            (None, Some(lim)) => format!(
                "SELECT id, session_id, title, summary, content, item_type, status, requires_decision, created_at, target_base_note_slug, proposed_content, diff_data, updated_at, decision_reason
                 FROM inbox_items ORDER BY created_at DESC LIMIT {lim}"
            ),
            (None, None) => {
                "SELECT id, session_id, title, summary, content, item_type, status, requires_decision, created_at, target_base_note_slug, proposed_content, diff_data, updated_at, decision_reason
                 FROM inbox_items ORDER BY created_at DESC".to_string()
            }
        };

        let mut stmt = conn
            .prepare(&query)
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        let map_row = |row: &rusqlite::Row| {
            let req_dec_int: i64 = row.get(7)?;
            Ok(InboxItem {
                id: row.get(0)?,
                session_id: row.get(1)?,
                title: row.get(2)?,
                summary: row.get(3)?,
                content: row.get(4)?,
                item_type: row.get(5)?,
                status: row.get(6)?,
                requires_decision: req_dec_int == 1,
                created_at: row.get(8)?,
                target_base_note_slug: row.get(9)?,
                proposed_content: row.get(10)?,
                diff_data: row.get(11)?,
                updated_at: row.get(12)?,
                decision_reason: row.get(13)?,
            })
        };

        let mut items = Vec::new();
        if let Some(st) = status {
            let rows = stmt
                .query_map(params![st], map_row)
                .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
            for r in rows {
                items.push(r.map_err(|e| DomainError::DatabaseError(e.to_string()))?);
            }
        } else {
            let rows = stmt
                .query_map([], map_row)
                .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
            for r in rows {
                items.push(r.map_err(|e| DomainError::DatabaseError(e.to_string()))?);
            }
        }
        Ok(items)
    }

    fn get_inbox_item(&self, id: &str) -> Result<Option<InboxItem>, DomainError> {
        let conn = self
            .pool
            .get()
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        let mut stmt = conn
            .prepare(
                "SELECT id, session_id, title, summary, content, item_type, status, requires_decision, created_at, target_base_note_slug, proposed_content, diff_data, updated_at, decision_reason
                 FROM inbox_items WHERE id = ?1",
            )
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;

        let mut rows = stmt
            .query_map(params![id], |row| {
                let req_dec_int: i64 = row.get(7)?;
                Ok(InboxItem {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    title: row.get(2)?,
                    summary: row.get(3)?,
                    content: row.get(4)?,
                    item_type: row.get(5)?,
                    status: row.get(6)?,
                    requires_decision: req_dec_int == 1,
                    created_at: row.get(8)?,
                    target_base_note_slug: row.get(9)?,
                    proposed_content: row.get(10)?,
                    diff_data: row.get(11)?,
                    updated_at: row.get(12)?,
                    decision_reason: row.get(13)?,
                })
            })
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;

        if let Some(r) = rows.next() {
            Ok(Some(
                r.map_err(|e| DomainError::DatabaseError(e.to_string()))?,
            ))
        } else {
            Ok(None)
        }
    }

    fn update_inbox_status(
        &self,
        id: &str,
        status: &str,
        decision_reason: Option<&str>,
    ) -> Result<bool, DomainError> {
        let conn = self
            .pool
            .get()
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        let now = Utc::now().to_rfc3339();
        let clean_reason = Self::sanitize_decision_reason(decision_reason);
        let affected = conn
            .execute(
                "UPDATE inbox_items SET status = ?1, updated_at = ?2, decision_reason = COALESCE(?3, decision_reason) WHERE id = ?4",
                params![status, now, clean_reason, id],
            )
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        Ok(affected > 0)
    }

    fn delete_inbox_item(&self, id: &str) -> Result<bool, DomainError> {
        let conn = self
            .pool
            .get()
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        let affected = conn
            .execute("DELETE FROM inbox_items WHERE id = ?1", params![id])
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        Ok(affected > 0)
    }

    fn get_unread_inbox_count(&self) -> Result<i64, DomainError> {
        let conn = self
            .pool
            .get()
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        let mut stmt = conn
            .prepare("SELECT COUNT(*) FROM inbox_items WHERE status IN ('unread', 'pending')")
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        let count: i64 = stmt
            .query_row([], |r| r.get(0))
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        Ok(count)
    }
}
