use crate::domain::errors::DomainError;
use crate::domain::models::{
    DayHabitMetric, DayTaskCount, EntityIndexEntry, Habit, InboxItem, KanbanTask, KanbanWeek,
    Message, Session, WeekStatus, WeekTaskCount,
};
use async_trait::async_trait;

#[async_trait]
pub trait SessionStore: Send + Sync {
    fn create_session(&self, id: Option<&str>, title: &str) -> Result<Session, DomainError>;
    fn list_sessions(&self) -> Result<Vec<Session>, DomainError>;
    fn get_session(&self, session_id: &str) -> Result<Option<Session>, DomainError>;
    fn rename_session(&self, session_id: &str, new_title: &str) -> Result<bool, DomainError>;
    fn delete_session(&self, session_id: &str) -> Result<bool, DomainError>;
}

#[async_trait]
pub trait MessageStore: Send + Sync {
    #[allow(clippy::too_many_arguments)]
    fn add_message(
        &self,
        session_id: &str,
        role: &str,
        content: &str,
        tool_call_id: Option<&str>,
        tool_calls: Option<&str>,
        tokens: Option<i64>,
        parent_id: Option<i64>,
    ) -> Result<Message, DomainError>;
    fn get_messages(&self, session_id: &str) -> Result<Vec<Message>, DomainError>;
    fn delete_message(&self, message_id: i64) -> Result<bool, DomainError>;
    fn truncate_messages_from(&self, session_id: &str, from_id: i64) -> Result<usize, DomainError>;
}

#[async_trait]
pub trait InboxStore: Send + Sync {
    fn insert_inbox_item(&self, item: &InboxItem) -> Result<(), DomainError>;
    fn list_inbox_items(
        &self,
        status: Option<&str>,
        limit: Option<usize>,
    ) -> Result<Vec<InboxItem>, DomainError>;
    fn get_inbox_item(&self, id: &str) -> Result<Option<InboxItem>, DomainError>;
    fn update_inbox_status(
        &self,
        id: &str,
        status: &str,
        decision_reason: Option<&str>,
    ) -> Result<bool, DomainError>;
    fn delete_inbox_item(&self, id: &str) -> Result<bool, DomainError>;
    fn get_unread_inbox_count(&self) -> Result<i64, DomainError>;
}

/// Porta de persistência do quadro Kanban (semanas ISO + tarefas).
///
/// Regras de negócio (semana aberta, validação de semana fechada, posição
/// fracionária) vivem no serviço — aqui só há CRUD e consultas.
#[async_trait]
pub trait KanbanStore: Send + Sync {
    // ── Semanas ──
    fn get_week(&self, id: &str) -> Result<Option<KanbanWeek>, DomainError>;
    fn insert_week(&self, week: &KanbanWeek) -> Result<(), DomainError>;
    fn set_week_status(
        &self,
        id: &str,
        status: WeekStatus,
        closed_at: Option<&str>,
    ) -> Result<bool, DomainError>;
    /// Semana aberta mais recente (ordem ano/semana decrescente).
    fn get_open_week(&self) -> Result<Option<KanbanWeek>, DomainError>;
    fn list_open_weeks(&self) -> Result<Vec<KanbanWeek>, DomainError>;

    // ── Tarefas ──
    fn insert_task(&self, task: &KanbanTask) -> Result<(), DomainError>;
    fn get_task(&self, id: &str) -> Result<Option<KanbanTask>, DomainError>;
    fn list_tasks(&self, week_id: &str) -> Result<Vec<KanbanTask>, DomainError>;
    /// Maior posição da semana (0.0 quando não há tarefas).
    fn max_position(&self, week_id: &str) -> Result<f64, DomainError>;
    fn update_task_layout(
        &self,
        id: &str,
        task_column: &str,
        position: f64,
        updated_at: &str,
    ) -> Result<bool, DomainError>;
    fn update_task_content(
        &self,
        id: &str,
        titulo: &str,
        due_date: Option<&str>,
        updated_at: &str,
    ) -> Result<bool, DomainError>;
    fn set_task_note_path(
        &self,
        id: &str,
        note_path: Option<&str>,
        updated_at: &str,
    ) -> Result<bool, DomainError>;

    /// Marca o destino administrativo (`carried`/`cancelled`) + semana alvo.
    fn set_task_status(
        &self,
        id: &str,
        status: &str,
        carried_to: Option<&str>,
        updated_at: &str,
    ) -> Result<bool, DomainError>;

    fn delete_task(&self, id: &str) -> Result<bool, DomainError>;
    /// Quantas tarefas já foram geradas para um hábito (limpa apagamento definitivo).
    fn count_tasks_of_habit(&self, habit_id: &str) -> Result<i64, DomainError>;

    // ── Vínculos (notas relacionadas + entities) ──
    fn link_task_note(&self, task_id: &str, note_path: &str) -> Result<(), DomainError>;
    fn unlink_task_note(&self, task_id: &str, note_path: &str) -> Result<bool, DomainError>;
    fn list_task_notes(&self, task_id: &str) -> Result<Vec<String>, DomainError>;
    fn link_task_entity(&self, task_id: &str, entity_id: &str) -> Result<(), DomainError>;
    fn unlink_task_entity(&self, task_id: &str, entity_id: &str) -> Result<bool, DomainError>;
    fn list_task_entity_ids(&self, task_id: &str) -> Result<Vec<String>, DomainError>;
}

/// Porta de persistência de hábitos (tabela `habits`).
///
/// Regras de negócio (cron, geração idempotente, métrica derivada) vivem no
/// serviço — aqui só CRUD.
#[async_trait]
pub trait HabitStore: Send + Sync {
    fn insert_habit(&self, habit: &Habit) -> Result<(), DomainError>;
    fn get_habit(&self, id: &str) -> Result<Option<Habit>, DomainError>;
    /// Todos os hábitos (ordem estável por criação).
    fn list_habits(&self) -> Result<Vec<Habit>, DomainError>;
    fn set_habit_active(
        &self,
        id: &str,
        ativo: bool,
        updated_at: &str,
    ) -> Result<bool, DomainError>;
    /// Atualiza os campos editáveis (`titulo`, `cron_expr`, `cor`).
    /// Validação pertence ao serviço — aqui só persiste.
    fn update_habit(
        &self,
        id: &str,
        titulo: &str,
        cron_expr: &str,
        cor: &str,
        updated_at: &str,
    ) -> Result<bool, DomainError>;
    /// Hard delete — o serviço só chama quando o hábito nunca gerou task.
    fn delete_habit(&self, id: &str) -> Result<bool, DomainError>;
}

/// Leitura analítica da aba Insights (só agregações SQL; sem regras).
#[async_trait]
pub trait InsightsStore: Send + Sync {
    /// Tasks por dia na janela `from..=to` (`YYYY-MM-DD`).
    fn task_counts_by_day(&self, from: &str, to: &str) -> Result<Vec<DayTaskCount>, DomainError>;
    /// Métricas de hábito por dia na janela (`category='habito'`).
    fn habit_metrics_by_day(
        &self,
        from: &str,
        to: &str,
    ) -> Result<Vec<DayHabitMetric>, DomainError>;
    /// As `limit` semanas ISO mais recentes (ordem decrescente) com contagens
    /// de tasks normais e de hábito (inclui a semana aberta atual).
    fn task_counts_by_week(&self, limit: u32) -> Result<Vec<WeekTaskCount>, DomainError>;
    /// Datas com métrica de um hábito, ordem decrescente — base do "maior
    /// streak".
    fn habit_metric_dates(&self, habit_id: &str) -> Result<Vec<String>, DomainError>;
}

/// Índice derivado de entities — descartável e sempre reconstruível do vault.
#[async_trait]
pub trait EntityIndexStore: Send + Sync {
    fn upsert_entity(&self, entry: &EntityIndexEntry) -> Result<(), DomainError>;
    fn get_entity(&self, id: &str) -> Result<Option<EntityIndexEntry>, DomainError>;
    /// Lista (opcionalmente filtrada por subtipo e/ou termo no título).
    fn list_entities(
        &self,
        subtipo: Option<&str>,
        query: Option<&str>,
    ) -> Result<Vec<EntityIndexEntry>, DomainError>;
    /// Remove do índice por id ou por caminho (a nota `.md` permanece).
    fn delete_entity_by_id(&self, id: &str) -> Result<bool, DomainError>;
    fn delete_entity_by_path(&self, note_path: &str) -> Result<bool, DomainError>;
    /// Zera o índice (usado no rebuild).
    fn clear_entities_index(&self) -> Result<usize, DomainError>;
}

#[async_trait]
pub trait SettingsStore: Send + Sync {
    fn get_setting(&self, key: &str) -> Result<Option<String>, DomainError>;
    fn set_setting(&self, key: &str, value: &str) -> Result<(), DomainError>;
}
