//! Serviço de Hábitos — define 1× → task colorida surge sozinha no dia certo
//! → concluir vira métrica.
//!
//! * `sync_habit_tasks_today` é **idempotente** (índice único parcial
//!   `(habit_id, week_id, due_date)` + checagem prévia): tick N× = 1 task.
//! * `on_habit_task_moved` mantém a métrica em `user_tabular_data` em
//!   sincronia com a coluna da task — a task é a fonte única.
//! * Desativar (`ativo=0`) para de gerar sem apagar histórico; hard delete
//!   só quando o hábito **nunca** gerou task.
use crate::db::Database;
use crate::domain::errors::DomainError;
use crate::domain::models::habit as rules;
use crate::domain::models::{
    Habit, KanbanTask, KanbanWeek, TaskColumn, TaskKind, TaskStatus, WeekStatus,
};
use crate::domain::traits::stores::{HabitStore, KanbanStore};
use crate::infra::sqlite::{SqliteHabitRepo, SqliteKanbanRepo};
use crate::services::kanban_srv::{iso_week_of, week_id_for};
use chrono::{Datelike, Local, Utc};
use std::sync::Arc;
use uuid::Uuid;

pub struct HabitService {
    db: Arc<Database>,
    repo: SqliteHabitRepo,
    kanban: SqliteKanbanRepo,
}

impl HabitService {
    pub fn new(db: Arc<Database>) -> Self {
        let pool = db.get_pool();
        let repo = SqliteHabitRepo::new(pool.clone());
        let kanban = SqliteKanbanRepo::new(pool);
        Self { db, repo, kanban }
    }

    fn now() -> String {
        Utc::now().to_rfc3339()
    }

    /// Valida e normaliza os campos editáveis (título, cron, cor) — mesma
    /// regra para criação e edição (mensagens tipadas para IPC/tool).
    fn validate_fields(
        titulo: &str,
        cron_expr: &str,
        cor: Option<&str>,
    ) -> Result<(String, String, String), DomainError> {
        let titulo = titulo.trim();
        if titulo.is_empty() {
            return Err(DomainError::InvalidInput(
                "título do hábito é obrigatório".to_string(),
            ));
        }
        rules::validate_cron(cron_expr)?;
        let cor = cor
            .map(str::trim)
            .filter(|c| !c.is_empty())
            .unwrap_or("#22c55e");
        if cor.len() != 7
            || !cor.starts_with('#')
            || !cor[1..].chars().all(|c| c.is_ascii_hexdigit())
        {
            return Err(DomainError::InvalidInput(format!(
                "cor inválida: '{}' (use #rrggbb)",
                cor
            )));
        }
        Ok((
            titulo.to_string(),
            cron_expr.trim().to_string(),
            cor.to_string(),
        ))
    }

    /// Cria o hábito (valida título, cron e cor cedo — mensagens tipadas
    /// para IPC/tool).
    pub fn create_habit(
        &self,
        titulo: &str,
        cron_expr: &str,
        cor: Option<&str>,
    ) -> Result<Habit, DomainError> {
        let (titulo, cron, cor) = Self::validate_fields(titulo, cron_expr, cor)?;
        let habit = Habit::new(Uuid::new_v4().to_string(), titulo, cron, cor, Self::now());
        self.repo.insert_habit(&habit)?;
        Ok(habit)
    }

    /// Edita título/cron/cor de um hábito existente. Tasks já geradas e
    /// métricas históricas permanecem intactas — só o futuro muda.
    pub fn update_habit(
        &self,
        id: &str,
        titulo: &str,
        cron_expr: &str,
        cor: Option<&str>,
    ) -> Result<Habit, DomainError> {
        if self.repo.get_habit(id)?.is_none() {
            return Err(DomainError::NotFound(format!(
                "hábito não encontrado: {}",
                id
            )));
        }
        let (titulo, cron, cor) = Self::validate_fields(titulo, cron_expr, cor)?;
        self.repo
            .update_habit(id, &titulo, &cron, &cor, &Self::now())?;
        self.repo
            .get_habit(id)?
            .ok_or_else(|| DomainError::NotFound(format!("hábito não encontrado: {}", id)))
    }

    /// Lista com `streak_atual` derivado das métricas (`user_tabular_data`).
    pub fn list_habits(&self) -> Result<Vec<Habit>, DomainError> {
        let mut habits = self.repo.list_habits()?;
        let today = Local::now().date_naive().format("%Y-%m-%d").to_string();
        for habit in &mut habits {
            habit.streak_atual = self.streak(&habit.id, &today)?;
        }
        Ok(habits)
    }

    /// Sequência de dias consecutivos com métrica até `today` (YYYY-MM-DD).
    pub fn streak(&self, habit_id: &str, today: &str) -> Result<u64, DomainError> {
        let rows = self
            .db
            .query_tabular_metrics(Some("habito"), None, Some(today), Some(habit_id))
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        let mut dates: Vec<String> = rows.into_iter().map(|r| r.record_date).collect();
        dates.sort();
        dates.dedup();
        dates.reverse();
        Ok(rules::compute_streak(&dates, today))
    }

    /// Ativa/desativa a geração. Desativar preserva tasks e métricas.
    pub fn set_active(&self, id: &str, ativo: bool) -> Result<Habit, DomainError> {
        let mut habit = self
            .repo
            .get_habit(id)?
            .ok_or_else(|| DomainError::NotFound(format!("hábito não encontrado: {}", id)))?;
        self.repo.set_habit_active(id, ativo, &Self::now())?;
        habit.ativo = ativo;
        habit.updated_at = Self::now();
        Ok(habit)
    }

    /// Hard delete **só** se nunca gerou task; caso contrário `ativo=0`
    /// (histórico e métricas ficam). Devolve `true` quando apagou de vez.
    pub fn delete_habit(&self, id: &str) -> Result<bool, DomainError> {
        let habit = self
            .repo
            .get_habit(id)?
            .ok_or_else(|| DomainError::NotFound(format!("hábito não encontrado: {}", id)))?;
        let generated = self.kanban.count_tasks_of_habit(id)?;
        if generated == 0 {
            self.repo.delete_habit(&habit.id)?;
            Ok(true)
        } else {
            self.repo.set_habit_active(&habit.id, false, &Self::now())?;
            Ok(false)
        }
    }

    /// Gera a task de hoje na semana aberta para cada hábito ativo cujo
    /// cron casa com a data. Idempotente (tick N× = 1 task).
    ///
    /// Se não houver semana aberta (domingo 23h+, entre semanas), não gera:
    /// a task do próximo ciclo nasce na semana nova.
    pub fn sync_habit_tasks_today(&self) -> Result<usize, DomainError> {
        let habits = self.repo.list_habits()?;
        let today = Local::now().date_naive();
        let today_str = today.format("%Y-%m-%d").to_string();
        let (year, month, day) = (today.year(), today.month(), today.day());
        let weekday = today.weekday().num_days_from_sunday();

        let mut candidates = Vec::new();
        for habit in habits {
            if !habit.ativo {
                continue;
            }
            // Cron inválido não derruba o tick — só não gera.
            if let Ok(true) = rules::matches_date(&habit.cron_expr, year, month, day, weekday) {
                candidates.push(habit);
            }
        }
        if candidates.is_empty() {
            return Ok(0);
        }

        let Some(week) = self.open_week_for(today)? else {
            return Ok(0);
        };
        let existing = self.kanban.list_tasks(&week.id)?;
        let mut created = 0usize;
        for habit in candidates {
            let already = existing.iter().any(|t| {
                t.habit_id.as_deref() == Some(habit.id.as_str())
                    && t.due_date.as_deref() == Some(today_str.as_str())
            });
            if already {
                continue;
            }
            let task = KanbanTask {
                id: Uuid::new_v4().to_string(),
                week_id: week.id.clone(),
                titulo: habit.titulo.clone(),
                note_path: None,
                task_column: TaskColumn::Todo,
                status: TaskStatus::Active,
                carried_to: None,
                // `max_position` zera (0.0) sem tarefas — `+ GAP` mantém o
                // invariante > 0 do serviço canônico.
                position: self.kanban.max_position(&week.id)?
                    + crate::services::kanban_srv::POSITION_GAP,
                task_kind: TaskKind::Habit,
                habit_id: Some(habit.id.clone()),
                due_date: Some(today_str.clone()),
                created_at: Self::now(),
                updated_at: Self::now(),
            };
            self.kanban.insert_task(&task)?;
            created += 1;
        }
        Ok(created)
    }

    /// Semana aberta para gerar (`None` = janela entre semanas, domingo
    /// fechado — espera a semana nova). Se a semana de hoje não existe,
    /// cria em `open` (mesmo espelho de `KanbanService::get_or_create_week`).
    fn open_week_for(&self, today: chrono::NaiveDate) -> Result<Option<KanbanWeek>, DomainError> {
        if let Some(week) = self.kanban.get_open_week()? {
            return Ok(Some(week));
        }
        let (year, week_num) = iso_week_of(today);
        let id = week_id_for(year, week_num);
        if let Some(week) = self.kanban.get_week(&id)? {
            return Ok(if week.status == WeekStatus::Open {
                Some(week)
            } else {
                None
            });
        }
        let (start, end) = crate::services::kanban_srv::iso_week_bounds(year, week_num)
            .ok_or_else(|| DomainError::InvalidInput(format!("semana ISO inválida: {}", id)))?;
        let created = KanbanWeek {
            id,
            year,
            iso_week: week_num,
            week_start: start.format("%Y-%m-%d").to_string(),
            week_end: end.format("%Y-%m-%d").to_string(),
            status: WeekStatus::Open,
            created_at: Self::now(),
            closed_at: None,
        };
        self.kanban.insert_week(&created)?;
        Ok(Some(created))
    }

    /// Lista sem derivar streak (cor + cron para o quadro) — barato o bastante
    /// para o payload de `listar_kanban`.
    pub fn list_habits_basic(&self) -> Result<Vec<Habit>, DomainError> {
        self.repo.list_habits()
    }

    /// Task é a **fonte única** da métrica: entrou em `done` ⇒ linha do dia
    /// (`category='habito'`, `metric_key=habit_id`, `record_date=due_date`,
    /// `value=1`, `notes=titulo`); saiu ⇒ remove a linha do dia.
    pub fn on_habit_task_moved(&self, task: &KanbanTask) -> Result<(), DomainError> {
        if task.task_kind != TaskKind::Habit {
            return Ok(());
        }
        let (Some(habit_id), Some(due)) = (task.habit_id.as_deref(), task.due_date.as_deref())
        else {
            return Ok(());
        };
        if task.task_column == TaskColumn::Done {
            self.db
                .upsert_habit_metric(habit_id, due, &task.titulo)
                .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        } else {
            self.db
                .delete_habit_metric(habit_id, due)
                .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        }
        Ok(())
    }
}
