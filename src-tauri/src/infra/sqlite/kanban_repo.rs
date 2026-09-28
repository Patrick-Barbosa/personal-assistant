use crate::domain::errors::DomainError;
use crate::domain::traits::stores::{InsightsStore, KanbanStore};
use crate::infra::sqlite::pool::DbPool;
use async_trait::async_trait;
use chrono::Utc;
use rusqlite::params;

const SELECT_WEEK: &str = "SELECT id, year, iso_week, week_start, week_end, status, created_at, closed_at FROM kanban_weeks";
const SELECT_TASK: &str = "SELECT id, week_id, titulo, note_path, task_column, status, carried_to, position, task_kind, habit_id, due_date, created_at, updated_at FROM kanban_tasks";

fn map_week(row: &rusqlite::Row<'_>) -> rusqlite::Result<KanbanWeek> {
    let iso_raw: i64 = row.get(2)?;
    let status_raw: String = row.get(5)?;
    Ok(KanbanWeek {
        id: row.get(0)?,
        year: row.get(1)?,
        iso_week: u32::try_from(iso_raw).unwrap_or(0),
        week_start: row.get(3)?,
        week_end: row.get(4)?,
        status: WeekStatus::from_db(&status_raw),
        created_at: row.get(6)?,
        closed_at: row.get(7)?,
    })
}

fn map_task(row: &rusqlite::Row<'_>) -> rusqlite::Result<KanbanTask> {
    let column_raw: String = row.get(4)?;
    let status_raw: String = row.get(5)?;
    let kind_raw: String = row.get(8)?;
    Ok(KanbanTask {
        id: row.get(0)?,
        week_id: row.get(1)?,
        titulo: row.get(2)?,
        note_path: row.get(3)?,
        task_column: TaskColumn::from_db(&column_raw),
        status: TaskStatus::from_db(&status_raw),
        carried_to: row.get(6)?,
        position: row.get(7)?,
        task_kind: TaskKind::from_db(&kind_raw),
        habit_id: row.get(9)?,
        due_date: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
    })
}

fn db_err(err: rusqlite::Error) -> DomainError {
    DomainError::DatabaseError(err.to_string())
}

// Re-export das entidades de semana/tarefa usadas no mapeamento de linhas.
use crate::domain::models::{
    DayHabitMetric, DayTaskCount, KanbanTask, KanbanWeek, TaskColumn, TaskKind, TaskStatus,
    WeekStatus, WeekTaskCount,
};

/// Repositório SQLite do quadro Kanban — implementa `KanbanStore` sem regra de negócio.
#[derive(Clone)]
pub struct SqliteKanbanRepo {
    pool: DbPool,
}

impl SqliteKanbanRepo {
    pub fn new(pool: DbPool) -> Self {
        Self { pool }
    }

    fn conn(
        &self,
    ) -> Result<r2d2::PooledConnection<r2d2_sqlite::SqliteConnectionManager>, DomainError> {
        self.pool
            .get()
            .map_err(|e| DomainError::DatabaseError(e.to_string()))
    }
}

#[async_trait]
impl KanbanStore for SqliteKanbanRepo {
    fn get_week(&self, id: &str) -> Result<Option<KanbanWeek>, DomainError> {
        let conn = self.conn()?;
        let mut stmt = conn
            .prepare(&format!("{} WHERE id = ?1", SELECT_WEEK))
            .map_err(db_err)?;
        let mut rows = stmt.query_map(params![id], map_week).map_err(db_err)?;
        match rows.next() {
            Some(row) => Ok(Some(row.map_err(db_err)?)),
            None => Ok(None),
        }
    }

    fn insert_week(&self, week: &KanbanWeek) -> Result<(), DomainError> {
        let conn = self.conn()?;
        conn.execute(
            "INSERT INTO kanban_weeks (id, year, iso_week, week_start, week_end, status, created_at, closed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(id) DO NOTHING",
            params![
                week.id,
                week.year,
                week.iso_week as i64,
                week.week_start,
                week.week_end,
                week.status.as_db(),
                week.created_at,
                week.closed_at,
            ],
        )
        .map_err(db_err)?;
        Ok(())
    }

    fn set_week_status(
        &self,
        id: &str,
        status: WeekStatus,
        closed_at: Option<&str>,
    ) -> Result<bool, DomainError> {
        let conn = self.conn()?;
        let affected = conn
            .execute(
                "UPDATE kanban_weeks SET status = ?1, closed_at = ?2 WHERE id = ?3",
                params![status.as_db(), closed_at, id],
            )
            .map_err(db_err)?;
        Ok(affected > 0)
    }

    fn get_open_week(&self) -> Result<Option<KanbanWeek>, DomainError> {
        let conn = self.conn()?;
        let mut stmt = conn
            .prepare(&format!(
                "{} WHERE status = 'open' ORDER BY year DESC, iso_week DESC LIMIT 1",
                SELECT_WEEK
            ))
            .map_err(db_err)?;
        let mut rows = stmt.query_map([], map_week).map_err(db_err)?;
        match rows.next() {
            Some(row) => Ok(Some(row.map_err(db_err)?)),
            None => Ok(None),
        }
    }

    fn list_open_weeks(&self) -> Result<Vec<KanbanWeek>, DomainError> {
        let conn = self.conn()?;
        let mut stmt = conn
            .prepare(&format!(
                "{} WHERE status = 'open' ORDER BY year ASC, iso_week ASC",
                SELECT_WEEK
            ))
            .map_err(db_err)?;
        let rows = stmt.query_map([], map_week).map_err(db_err)?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(db_err)?);
        }
        Ok(out)
    }

    fn insert_task(&self, task: &KanbanTask) -> Result<(), DomainError> {
        let conn = self.conn()?;
        conn.execute(
            "INSERT INTO kanban_tasks
             (id, week_id, titulo, note_path, task_column, status, carried_to, position, task_kind, habit_id, due_date, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                task.id,
                task.week_id,
                task.titulo,
                task.note_path,
                task.task_column.as_db(),
                task.status.as_db(),
                task.carried_to,
                task.position,
                task.task_kind.as_db(),
                task.habit_id,
                task.due_date,
                task.created_at,
                task.updated_at,
            ],
        )
        .map_err(db_err)?;
        Ok(())
    }

    fn get_task(&self, id: &str) -> Result<Option<KanbanTask>, DomainError> {
        let conn = self.conn()?;
        let mut stmt = conn
            .prepare(&format!("{} WHERE id = ?1", SELECT_TASK))
            .map_err(db_err)?;
        let mut rows = stmt.query_map(params![id], map_task).map_err(db_err)?;
        match rows.next() {
            Some(row) => Ok(Some(row.map_err(db_err)?)),
            None => Ok(None),
        }
    }

    fn list_tasks(&self, week_id: &str) -> Result<Vec<KanbanTask>, DomainError> {
        let conn = self.conn()?;
        let mut stmt = conn
            .prepare(&format!(
                "{} WHERE week_id = ?1 ORDER BY position ASC, created_at ASC",
                SELECT_TASK
            ))
            .map_err(db_err)?;
        let rows = stmt.query_map(params![week_id], map_task).map_err(db_err)?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(db_err)?);
        }
        Ok(out)
    }

    fn max_position(&self, week_id: &str) -> Result<f64, DomainError> {
        let conn = self.conn()?;
        let value: Option<f64> = conn
            .query_row(
                "SELECT MAX(position) FROM kanban_tasks WHERE week_id = ?1",
                params![week_id],
                |row| row.get(0),
            )
            .map_err(db_err)?;
        Ok(value.unwrap_or(0.0))
    }

    fn update_task_layout(
        &self,
        id: &str,
        task_column: &str,
        position: f64,
        updated_at: &str,
    ) -> Result<bool, DomainError> {
        let conn = self.conn()?;
        let affected = conn
            .execute(
                "UPDATE kanban_tasks SET task_column = ?1, position = ?2, updated_at = ?3 WHERE id = ?4",
                params![task_column, position, updated_at, id],
            )
            .map_err(db_err)?;
        Ok(affected > 0)
    }

    fn update_task_content(
        &self,
        id: &str,
        titulo: &str,
        due_date: Option<&str>,
        updated_at: &str,
    ) -> Result<bool, DomainError> {
        let conn = self.conn()?;
        let affected = conn
            .execute(
                "UPDATE kanban_tasks SET titulo = ?1, due_date = ?2, updated_at = ?3 WHERE id = ?4",
                params![titulo, due_date, updated_at, id],
            )
            .map_err(db_err)?;
        Ok(affected > 0)
    }

    fn set_task_note_path(
        &self,
        id: &str,
        note_path: Option<&str>,
        updated_at: &str,
    ) -> Result<bool, DomainError> {
        let conn = self.conn()?;
        let affected = conn
            .execute(
                "UPDATE kanban_tasks SET note_path = ?1, updated_at = ?2 WHERE id = ?3",
                params![note_path, updated_at, id],
            )
            .map_err(db_err)?;
        Ok(affected > 0)
    }

    fn set_task_status(
        &self,
        id: &str,
        status: &str,
        carried_to: Option<&str>,
        updated_at: &str,
    ) -> Result<bool, DomainError> {
        let conn = self.conn()?;
        let affected = conn
            .execute(
                "UPDATE kanban_tasks SET status = ?1, carried_to = ?2, updated_at = ?3 WHERE id = ?4",
                params![status, carried_to, updated_at, id],
            )
            .map_err(db_err)?;
        Ok(affected > 0)
    }

    fn delete_task(&self, id: &str) -> Result<bool, DomainError> {
        let conn = self.conn()?;
        let affected = conn
            .execute("DELETE FROM kanban_tasks WHERE id = ?1", params![id])
            .map_err(db_err)?;
        Ok(affected > 0)
    }

    fn count_tasks_of_habit(&self, habit_id: &str) -> Result<i64, DomainError> {
        let conn = self.conn()?;
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM kanban_tasks WHERE habit_id = ?1",
                params![habit_id],
                |row| row.get(0),
            )
            .map_err(db_err)?;
        Ok(count)
    }

    // ── Vínculos: notas relacionadas ──

    fn link_task_note(&self, task_id: &str, note_path: &str) -> Result<(), DomainError> {
        let conn = self.conn()?;
        conn.execute(
            "INSERT INTO kanban_task_notes (task_id, note_path, created_at)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(task_id, note_path) DO NOTHING",
            params![task_id, note_path, Utc::now().to_rfc3339()],
        )
        .map_err(db_err)?;
        Ok(())
    }

    fn unlink_task_note(&self, task_id: &str, note_path: &str) -> Result<bool, DomainError> {
        let conn = self.conn()?;
        let affected = conn
            .execute(
                "DELETE FROM kanban_task_notes WHERE task_id = ?1 AND note_path = ?2",
                params![task_id, note_path],
            )
            .map_err(db_err)?;
        Ok(affected > 0)
    }

    fn list_task_notes(&self, task_id: &str) -> Result<Vec<String>, DomainError> {
        let conn = self.conn()?;
        let mut stmt = conn
            .prepare(
                "SELECT note_path FROM kanban_task_notes WHERE task_id = ?1 ORDER BY created_at ASC",
            )
            .map_err(db_err)?;
        let rows = stmt
            .query_map(params![task_id], |row| row.get::<_, String>(0))
            .map_err(db_err)?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(db_err)?);
        }
        Ok(out)
    }

    // ── Vínculos: entities ──

    fn link_task_entity(&self, task_id: &str, entity_id: &str) -> Result<(), DomainError> {
        let conn = self.conn()?;
        conn.execute(
            "INSERT INTO kanban_task_entities (task_id, entity_id, created_at)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(task_id, entity_id) DO NOTHING",
            params![task_id, entity_id, Utc::now().to_rfc3339()],
        )
        .map_err(db_err)?;
        Ok(())
    }

    fn unlink_task_entity(&self, task_id: &str, entity_id: &str) -> Result<bool, DomainError> {
        let conn = self.conn()?;
        let affected = conn
            .execute(
                "DELETE FROM kanban_task_entities WHERE task_id = ?1 AND entity_id = ?2",
                params![task_id, entity_id],
            )
            .map_err(db_err)?;
        Ok(affected > 0)
    }

    fn list_task_entity_ids(&self, task_id: &str) -> Result<Vec<String>, DomainError> {
        let conn = self.conn()?;
        let mut stmt = conn
            .prepare(
                "SELECT entity_id FROM kanban_task_entities WHERE task_id = ?1 ORDER BY created_at ASC",
            )
            .map_err(db_err)?;
        let rows = stmt
            .query_map(params![task_id], |row| row.get::<_, String>(0))
            .map_err(db_err)?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(db_err)?);
        }
        Ok(out)
    }
}

/// Agregações da aba Insights — só SQL de leitura, sem regra de negócio.
#[async_trait]
impl InsightsStore for SqliteKanbanRepo {
    fn task_counts_by_day(&self, from: &str, to: &str) -> Result<Vec<DayTaskCount>, DomainError> {
        let conn = self.conn()?;
        let mut stmt = conn
            .prepare(
                "SELECT COALESCE(NULLIF(due_date, ''), substr(created_at, 1, 10)) AS dia,
                        COUNT(*),
                        SUM(CASE WHEN task_column = 'done' THEN 1 ELSE 0 END)
                 FROM kanban_tasks
                 WHERE status = 'active'
                   AND COALESCE(NULLIF(due_date, ''), substr(created_at, 1, 10)) BETWEEN ?1 AND ?2
                 GROUP BY dia
                 ORDER BY dia ASC",
            )
            .map_err(db_err)?;
        let rows = stmt
            .query_map(params![from, to], |row| {
                Ok(DayTaskCount {
                    date: row.get(0)?,
                    total: row.get::<_, i64>(1)?.max(0) as u64,
                    done: row.get::<_, Option<i64>>(2)?.unwrap_or(0).max(0) as u64,
                })
            })
            .map_err(db_err)?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(db_err)?);
        }
        Ok(out)
    }

    fn habit_metrics_by_day(
        &self,
        from: &str,
        to: &str,
    ) -> Result<Vec<DayHabitMetric>, DomainError> {
        let conn = self.conn()?;
        let mut stmt = conn
            .prepare(
                "SELECT record_date, COUNT(DISTINCT metric_key)
                 FROM user_tabular_data
                 WHERE category = 'habito' AND record_date BETWEEN ?1 AND ?2
                 GROUP BY record_date
                 ORDER BY record_date ASC",
            )
            .map_err(db_err)?;
        let rows = stmt
            .query_map(params![from, to], |row| {
                Ok(DayHabitMetric {
                    date: row.get(0)?,
                    habitos: row.get::<_, i64>(1)?.max(0) as u64,
                })
            })
            .map_err(db_err)?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(db_err)?);
        }
        Ok(out)
    }

    fn task_counts_by_week(&self, limit: u32) -> Result<Vec<WeekTaskCount>, DomainError> {
        let conn = self.conn()?;
        let mut stmt = conn
            .prepare(
                "SELECT w.id, w.week_start,
                        COUNT(t.id),
                        SUM(CASE WHEN t.task_column = 'done' THEN 1 ELSE 0 END),
                        SUM(CASE WHEN t.task_kind = 'habit' THEN 1 ELSE 0 END),
                        SUM(CASE WHEN t.task_kind = 'habit' AND t.task_column = 'done' THEN 1 ELSE 0 END)
                 FROM kanban_weeks w
                 LEFT JOIN kanban_tasks t
                   ON t.week_id = w.id AND t.status = 'active'
                 GROUP BY w.id, w.week_start
                 ORDER BY w.year DESC, w.iso_week DESC
                 LIMIT ?1",
            )
            .map_err(db_err)?;
        let rows = stmt
            .query_map(params![limit as i64], |row| {
                Ok(WeekTaskCount {
                    week_id: row.get(0)?,
                    week_start: row.get(1)?,
                    created: row.get::<_, i64>(2)?.max(0) as u64,
                    done: row.get::<_, Option<i64>>(3)?.unwrap_or(0).max(0) as u64,
                    habit_created: row.get::<_, Option<i64>>(4)?.unwrap_or(0).max(0) as u64,
                    habit_done: row.get::<_, Option<i64>>(5)?.unwrap_or(0).max(0) as u64,
                })
            })
            .map_err(db_err)?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(db_err)?);
        }
        Ok(out)
    }

    fn habit_metric_dates(&self, habit_id: &str) -> Result<Vec<String>, DomainError> {
        let conn = self.conn()?;
        let mut stmt = conn
            .prepare(
                "SELECT DISTINCT record_date FROM user_tabular_data
                 WHERE category = 'habito' AND metric_key = ?1
                 ORDER BY record_date DESC",
            )
            .map_err(db_err)?;
        let rows = stmt
            .query_map(params![habit_id], |row| row.get::<_, String>(0))
            .map_err(db_err)?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(db_err)?);
        }
        Ok(out)
    }
}
