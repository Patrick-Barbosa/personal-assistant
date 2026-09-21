use crate::domain::errors::DomainError;
use crate::domain::models::ScheduledRoutine;
use crate::infra::sqlite::pool::DbPool;
use chrono::Utc;
use rusqlite::params;

#[derive(Clone)]
pub struct SqlitePluginRepo {
    pool: DbPool,
}

impl SqlitePluginRepo {
    pub fn new(pool: DbPool) -> Self {
        Self { pool }
    }

    pub fn save_plugin(
        &self,
        id: &str,
        name: &str,
        version: &str,
        plugin_type: &str,
        enabled: bool,
        config_json: &str,
    ) -> Result<(), DomainError> {
        let conn = self
            .pool
            .get()
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO plugins (id, name, version, plugin_type, enabled, config_json, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET
                name = ?2,
                version = ?3,
                plugin_type = ?4,
                config_json = ?6,
                updated_at = ?7",
            params![
                id,
                name,
                version,
                plugin_type,
                if enabled { 1 } else { 0 },
                config_json,
                now
            ],
        )
        .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        Ok(())
    }

    pub fn is_plugin_enabled(&self, id: &str) -> Result<bool, DomainError> {
        let conn = self
            .pool
            .get()
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        let mut stmt = conn
            .prepare("SELECT enabled FROM plugins WHERE id = ?1")
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        let mut rows = stmt
            .query(params![id])
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        if let Some(row) = rows
            .next()
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?
        {
            let enabled: i64 = row
                .get(0)
                .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
            Ok(enabled == 1)
        } else {
            Ok(true) // Habilitado por padrão
        }
    }

    pub fn set_plugin_enabled(&self, id: &str, enabled: bool) -> Result<(), DomainError> {
        let conn = self
            .pool
            .get()
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE plugins SET enabled = ?1, updated_at = ?2 WHERE id = ?3",
            params![if enabled { 1 } else { 0 }, now, id],
        )
        .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        Ok(())
    }

    pub fn list_scheduled_routines(&self) -> Result<Vec<ScheduledRoutine>, DomainError> {
        let conn = self
            .pool
            .get()
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        let mut stmt = conn
            .prepare("SELECT id, titulo, cron_expr, prompt, skill_id, ativo, ultima_execucao, created_at FROM scheduled_routines ORDER BY created_at DESC")
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        let rows = stmt
            .query_map([], |row| {
                let ativo_int: i64 = row.get(5)?;
                Ok(ScheduledRoutine {
                    id: row.get(0)?,
                    titulo: row.get(1)?,
                    cron_expr: row.get(2)?,
                    prompt: row.get(3)?,
                    skill_id: row.get(4)?,
                    ativo: ativo_int == 1,
                    ultima_execucao: row.get(6)?,
                    created_at: row.get(7)?,
                })
            })
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;

        let mut routines = Vec::new();
        for r in rows {
            routines.push(r.map_err(|e| DomainError::DatabaseError(e.to_string()))?);
        }
        Ok(routines)
    }

    pub fn save_scheduled_routine(&self, routine: &ScheduledRoutine) -> Result<(), DomainError> {
        let conn = self
            .pool
            .get()
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        conn.execute(
            "INSERT INTO scheduled_routines (id, titulo, cron_expr, prompt, skill_id, ativo, ultima_execucao, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(id) DO UPDATE SET
                titulo = excluded.titulo,
                cron_expr = excluded.cron_expr,
                prompt = excluded.prompt,
                skill_id = excluded.skill_id,
                ativo = excluded.ativo,
                ultima_execucao = excluded.ultima_execucao",
            params![
                routine.id,
                routine.titulo,
                routine.cron_expr,
                routine.prompt,
                routine.skill_id,
                if routine.ativo { 1 } else { 0 },
                routine.ultima_execucao,
                routine.created_at,
            ],
        )
        .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        Ok(())
    }

    pub fn delete_scheduled_routine(&self, id: &str) -> Result<bool, DomainError> {
        let conn = self
            .pool
            .get()
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        let affected = conn
            .execute("DELETE FROM scheduled_routines WHERE id = ?1", params![id])
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        Ok(affected > 0)
    }

    pub fn toggle_scheduled_routine(&self, id: &str, ativo: bool) -> Result<(), DomainError> {
        let conn = self
            .pool
            .get()
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        conn.execute(
            "UPDATE scheduled_routines SET ativo = ?1 WHERE id = ?2",
            params![if ativo { 1 } else { 0 }, id],
        )
        .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        Ok(())
    }

    pub fn update_routine_last_run(&self, id: &str, timestamp: &str) -> Result<(), DomainError> {
        let conn = self
            .pool
            .get()
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        conn.execute(
            "UPDATE scheduled_routines SET ultima_execucao = ?1 WHERE id = ?2",
            params![timestamp, id],
        )
        .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        Ok(())
    }
}
