use serde::{Deserialize, Serialize};

// ─── Enums de domínio ────────────────────────────────────────

/// Estado de uma semana ISO no quadro Kanban (`open` | `closed`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum WeekStatus {
    #[default]
    Open,
    Closed,
}

impl WeekStatus {
    pub fn as_db(&self) -> &'static str {
        match self {
            WeekStatus::Open => "open",
            WeekStatus::Closed => "closed",
        }
    }

    pub fn from_db(raw: &str) -> Self {
        if raw.trim().eq_ignore_ascii_case("closed") {
            WeekStatus::Closed
        } else {
            WeekStatus::Open
        }
    }
}

/// Coluna do quadro — três colunas fixas, sempre nesta ordem.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum TaskColumn {
    /// Planejado para a semana ("A fazer").
    #[default]
    Todo,
    /// Em andamento ("Em progresso").
    Doing,
    /// Concluído ("Feito").
    Done,
}

impl TaskColumn {
    pub fn as_db(&self) -> &'static str {
        match self {
            TaskColumn::Todo => "todo",
            TaskColumn::Doing => "doing",
            TaskColumn::Done => "done",
        }
    }

    pub fn from_db(raw: &str) -> Self {
        match raw.trim() {
            "doing" => TaskColumn::Doing,
            "done" => TaskColumn::Done,
            _ => TaskColumn::Todo,
        }
    }

    /// Ordem canônica das colunas no quadro (frontend e agregados).
    pub const ALL: [TaskColumn; 3] = [TaskColumn::Todo, TaskColumn::Doing, TaskColumn::Done];
}

/// Ciclo de vida da tarefa — **independente** da coluna.
///
/// Conclusão é expressa por `task_column == done`; `status` cobre apenas o
/// destino administrativo (ativa / carregada p/ outra semana / cancelada).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    #[default]
    Active,
    Carried,
    Cancelled,
}

impl TaskStatus {
    pub fn as_db(&self) -> &'static str {
        match self {
            TaskStatus::Active => "active",
            TaskStatus::Carried => "carried",
            TaskStatus::Cancelled => "cancelled",
        }
    }

    pub fn from_db(raw: &str) -> Self {
        match raw.trim() {
            "carried" => TaskStatus::Carried,
            "cancelled" => TaskStatus::Cancelled,
            _ => TaskStatus::Active,
        }
    }
}

/// Origem da tarefa: manual (humano/agente) ou gerada por hábito.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum TaskKind {
    #[default]
    Normal,
    Habit,
}

impl TaskKind {
    pub fn as_db(&self) -> &'static str {
        match self {
            TaskKind::Normal => "normal",
            TaskKind::Habit => "habit",
        }
    }

    pub fn from_db(raw: &str) -> Self {
        if raw.trim().eq_ignore_ascii_case("habit") {
            TaskKind::Habit
        } else {
            TaskKind::Normal
        }
    }
}

// ─── Entidades ───────────────────────────────────────────────

/// Semana ISO do quadro. `id` é o identificador canônico `"2026-W39"`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct KanbanWeek {
    pub id: String,
    pub year: i32,
    pub iso_week: u32,
    /// Segunda-feira da semana, `YYYY-MM-DD`.
    pub week_start: String,
    /// Domingo da semana, `YYYY-MM-DD`.
    pub week_end: String,
    #[serde(default)]
    pub status: WeekStatus,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub closed_at: Option<String>,
}

/// Tarefa do quadro.
///
/// Tarefas de hábito (`task_kind = habit`) **nunca** recebem `note_path` nem
/// qualquer nota `.md` no cofre.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct KanbanTask {
    pub id: String,
    pub week_id: String,
    pub titulo: String,
    /// Nota principal do editor (doc rico no vault padrão). Nulo p/ hábitos.
    #[serde(default)]
    pub note_path: Option<String>,
    pub task_column: TaskColumn,
    #[serde(default)]
    pub status: TaskStatus,
    /// Semana de destino quando `status = carried`.
    #[serde(default)]
    pub carried_to: Option<String>,
    /// Posição fracionária dentro da coluna (menor = mais ao topo).
    pub position: f64,
    #[serde(default)]
    pub task_kind: TaskKind,
    #[serde(default)]
    pub habit_id: Option<String>,
    /// Data de vencimento `YYYY-MM-DD`.
    #[serde(default)]
    pub due_date: Option<String>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}

impl KanbanTask {
    /// Ainda precisa de decisão (entra no rollover do fechamento de semana).
    pub fn is_pending(&self) -> bool {
        self.status == TaskStatus::Active && self.task_column != TaskColumn::Done
    }

    /// Concluída = na coluna `done` (fonte da métrica de hábito).
    pub fn is_done(&self) -> bool {
        self.task_column == TaskColumn::Done
    }
}

/// Payload completo de uma leitura de quadro (semana + tarefas ordenadas).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct KanbanBoard {
    pub week: KanbanWeek,
    pub tasks: Vec<KanbanTask>,
    /// Vínculos por tarefa (notas além da principal + entities).
    #[serde(default)]
    pub links: Vec<TaskLinks>,
    /// Hábitos ativos usados para colorir tarefas de hábito no quadro (Fase 4).
    /// Derivado (lista `ativo=1`) — não é estado do quadro em si.
    #[serde(default)]
    pub habits: Vec<super::Habit>,
}

// ─── Entities (nota `.md` canônica + índice derivado) ────────

/// Subtipo de uma entity no índice derivado.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum EntitySubtipo {
    Pessoa,
    Projeto,
    Lugar,
    #[default]
    Livre,
}

impl EntitySubtipo {
    pub fn as_db(&self) -> &'static str {
        match self {
            EntitySubtipo::Pessoa => "pessoa",
            EntitySubtipo::Projeto => "projeto",
            EntitySubtipo::Lugar => "lugar",
            EntitySubtipo::Livre => "livre",
        }
    }

    pub fn from_db(raw: &str) -> Self {
        match raw.trim() {
            "pessoa" => EntitySubtipo::Pessoa,
            "projeto" => EntitySubtipo::Projeto,
            "lugar" => EntitySubtipo::Lugar,
            _ => EntitySubtipo::Livre,
        }
    }
}

/// Linha do índice **derivado** de entities — sempre reconstruível a partir das
/// notas com frontmatter `tipo: entidade`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EntityIndexEntry {
    /// Igual ao `id` do frontmatter da nota canônica.
    pub id: String,
    #[serde(default)]
    pub subtipo: EntitySubtipo,
    pub titulo: String,
    /// Caminho relativo ao cofre padrão (`.md` nunca é apagado pelo app).
    pub note_path: String,
    /// Metadados livres serializados em JSON.
    #[serde(default)]
    pub metadata: Option<String>,
    #[serde(default)]
    pub created_at: String,
}

/// Vínculos de uma tarefa: notas relacionadas + entities.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct TaskLinks {
    pub task_id: String,
    /// Caminhos relativos ao cofre padrão (além de `KanbanTask::note_path`).
    #[serde(default)]
    pub notes: Vec<String>,
    #[serde(default)]
    pub entities: Vec<EntityIndexEntry>,
}
