//! Repositório SQLite do domínio de Hábitos (CRUD puro — sem regras).
use crate::domain::errors::DomainError;
use crate::domain::models::Habit;
use crate::domain::traits::stores::HabitStore;
use crate::infra::sqlite::pool::DbPool;
use async_trait::async_trait;
use rusqlite::params;

const SELECT_HABIT: &str =
    "SELECT id, titulo, cron_expr, cor, ativo, created_at, updated_at FROM habits";

#[derive(Clone)]
pub struct SqliteHabitRepo {
    pool: DbPool,
}

impl SqliteHabitRepo {
    pub fn new(pool: DbPool) -> Self {
        Self { pool }
    }
}

fn db_err(e: impl std::fmt::Display) -> DomainError {
    DomainError::DatabaseError(e.to_string())
}

fn map_habit(row: &rusqlite::Row<'_>) -> rusqlite::Result<Habit> {
    let ativo_raw: i64 = row.get(4)?;
    Ok(Habit {
        id: row.get(0)?,
        titulo: row.get(1)?,
        cron_expr: row.get(2)?,
        cor: row.get(3)?,
        ativo: ativo_raw != 0,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
        streak_atual: 0,
    })
}

#[async_trait]
impl HabitStore for SqliteHabitRepo {
    fn insert_habit(&self, habit: &Habit) -> Result<(), DomainError> {
        let conn = self.pool.get().map_err(db_err)?;
        conn.execute(
            "INSERT INTO habits (id, titulo, cron_expr, cor, ativo, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                habit.id,
                habit.titulo,
                habit.cron_expr,
                habit.cor,
                if habit.ativo { 1 } else { 0 },
                habit.created_at,
                habit.updated_at,
            ],
        )
        .map_err(db_err)?;
        Ok(())
    }

    fn get_habit(&self, id: &str) -> Result<Option<Habit>, DomainError> {
        let conn = self.pool.get().map_err(db_err)?;
        let mut stmt = conn
            .prepare(&format!("{SELECT_HABIT} WHERE id = ?1"))
            .map_err(db_err)?;
        let mut rows = stmt.query_map(params![id], map_habit).map_err(db_err)?;
        match rows.next() {
            Some(row) => Ok(Some(row.map_err(db_err)?)),
            None => Ok(None),
        }
    }

    fn list_habits(&self) -> Result<Vec<Habit>, DomainError> {
        let conn = self.pool.get().map_err(db_err)?;
        let mut stmt = conn
            .prepare(&format!("{SELECT_HABIT} ORDER BY created_at ASC, id ASC"))
            .map_err(db_err)?;
        let rows = stmt.query_map([], map_habit).map_err(db_err)?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(db_err)?);
        }
        Ok(out)
    }

    fn set_habit_active(
        &self,
        id: &str,
        ativo: bool,
        updated_at: &str,
    ) -> Result<bool, DomainError> {
        let conn = self.pool.get().map_err(db_err)?;
        let affected = conn
            .execute(
                "UPDATE habits SET ativo = ?1, updated_at = ?2 WHERE id = ?3",
                params![if ativo { 1 } else { 0 }, updated_at, id],
            )
            .map_err(db_err)?;
        Ok(affected > 0)
    }

    fn update_habit(
        &self,
        id: &str,
        titulo: &str,
        cron_expr: &str,
        cor: &str,
        updated_at: &str,
    ) -> Result<bool, DomainError> {
        let conn = self.pool.get().map_err(db_err)?;
        let affected = conn
            .execute(
                "UPDATE habits SET titulo = ?1, cron_expr = ?2, cor = ?3, updated_at = ?4
                 WHERE id = ?5",
                params![titulo, cron_expr, cor, updated_at, id],
            )
            .map_err(db_err)?;
        Ok(affected > 0)
    }

    fn delete_habit(&self, id: &str) -> Result<bool, DomainError> {
        let conn = self.pool.get().map_err(db_err)?;
        let affected = conn
            .execute("DELETE FROM habits WHERE id = ?1", params![id])
            .map_err(db_err)?;
        Ok(affected > 0)
    }
}
