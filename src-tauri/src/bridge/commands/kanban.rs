use crate::bridge::emitter::emit_kanban_changed;
use crate::domain::models::{
    EntityIndexEntry, EntitySubtipo, Habit, Insights, KanbanBoard, KanbanTask, TaskColumn,
    TaskLinks,
};
use crate::services::kanban_srv::SharedKanbanService;
use tauri::{AppHandle, State};

/// Converte o id de coluna vindo do frontend (aceita variações comuns).
fn parse_column(raw: Option<&str>) -> Result<TaskColumn, String> {
    match raw.unwrap_or_default().trim().to_ascii_lowercase().as_str() {
        "" | "todo" | "a_fazer" | "planejado" => Ok(TaskColumn::Todo),
        "doing" | "in_progress" | "fazendo" | "em_progresso" => Ok(TaskColumn::Doing),
        "done" | "feito" | "concluido" | "concluído" => Ok(TaskColumn::Done),
        other => Err(format!("coluna inválida: '{}'", other)),
    }
}

/// Emite `kanban-changed` com a semana dona de `task_id` (melhor esforço —
/// a mutação em si já foi aplicada pelo serviço).
fn emit_task_event(app: &AppHandle, kanban: &SharedKanbanService, task_id: &str, motivo: &str) {
    if let Ok(task) = kanban.get_task(task_id) {
        let _ = emit_kanban_changed(app, &task.week_id, motivo);
    }
}

// ─── Leitura ─────────────────────────────────────────────────

/// Lê o quadro. Sem `semana`, devolve **apenas a semana aberta** (invariante
/// anti-alucinação): nunca uma semana antiga arbitrária.
#[tauri::command]
pub async fn list_kanban_week(
    semana: Option<String>,
    kanban: State<'_, SharedKanbanService>,
) -> Result<KanbanBoard, String> {
    kanban
        .list_board(semana.as_deref())
        .map_err(|e| e.to_string())
}

// ─── Mutações ────────────────────────────────────────────────

#[tauri::command]
pub async fn create_kanban_task(
    titulo: String,
    column: Option<String>,
    due_date: Option<String>,
    app: AppHandle,
    kanban: State<'_, SharedKanbanService>,
) -> Result<KanbanTask, String> {
    let column = parse_column(column.as_deref())?;
    let task = kanban
        .create_task(&titulo, column, due_date.as_deref())
        .map_err(|e| e.to_string())?;
    let week_id = task.week_id.clone();
    let _ = emit_kanban_changed(&app, &week_id, "task_created");
    Ok(task)
}

#[tauri::command]
pub async fn move_kanban_task(
    id: String,
    column: String,
    index: usize,
    app: AppHandle,
    kanban: State<'_, SharedKanbanService>,
) -> Result<KanbanTask, String> {
    let column = parse_column(Some(&column))?;
    let task = kanban
        .move_task(&id, column, index)
        .map_err(|e| e.to_string())?;
    let week_id = task.week_id.clone();
    let _ = emit_kanban_changed(&app, &week_id, "task_moved");
    Ok(task)
}

#[tauri::command]
pub async fn update_kanban_task(
    id: String,
    titulo: String,
    due_date: Option<String>,
    app: AppHandle,
    kanban: State<'_, SharedKanbanService>,
) -> Result<KanbanTask, String> {
    let task = kanban
        .update_task(&id, &titulo, due_date.as_deref())
        .map_err(|e| e.to_string())?;
    let week_id = task.week_id.clone();
    let _ = emit_kanban_changed(&app, &week_id, "task_updated");
    Ok(task)
}

/// Desvincula a tarefa do SQLite. O arquivo `.md` (se houver) **permanece**
/// no cofre — a exclusão aqui é apenas de vínculo.
#[tauri::command]
pub async fn delete_kanban_task(
    id: String,
    app: AppHandle,
    kanban: State<'_, SharedKanbanService>,
) -> Result<(), String> {
    let task = kanban.get_task(&id).map_err(|e| e.to_string())?;
    kanban.delete_task(&id).map_err(|e| e.to_string())?;
    let _ = emit_kanban_changed(&app, &task.week_id, "task_deleted");
    Ok(())
}

// ─── Fase 2: notas, entities e vínculos ─────────────────────

/// Cria (idempotente) a nota canônica da tarefa no vault padrão e devolve a
/// tarefa com `note_path` preenchido. Hábitos não recebem nota.
#[tauri::command]
pub async fn create_task_note(
    id: String,
    app: AppHandle,
    kanban: State<'_, SharedKanbanService>,
) -> Result<KanbanTask, String> {
    let task = kanban.create_task_note(&id).map_err(|e| e.to_string())?;
    let _ = emit_kanban_changed(&app, &task.week_id, "task_note_created");
    Ok(task)
}

/// Corpo da nota da tarefa (sem frontmatter). `None` quando não existe nota.
#[tauri::command]
pub async fn get_task_note(
    id: String,
    kanban: State<'_, SharedKanbanService>,
) -> Result<Option<String>, String> {
    kanban.get_task_note(&id).map_err(|e| e.to_string())
}

/// Substituição atômica do corpo da nota (editor com debounce; o
/// frontmatter `tipo: tarefa` é preservado). Não emite `kanban-changed` —
/// o conteúdo não é estado do quadro.
#[tauri::command]
pub async fn save_task_note(
    id: String,
    content: String,
    kanban: State<'_, SharedKanbanService>,
) -> Result<String, String> {
    kanban
        .save_task_note(&id, &content)
        .map_err(|e| e.to_string())
}

/// Vincula uma nota existente do vault padrão à tarefa (chip no card).
#[tauri::command]
pub async fn link_task_note(
    id: String,
    note_path: String,
    app: AppHandle,
    kanban: State<'_, SharedKanbanService>,
) -> Result<TaskLinks, String> {
    let links = kanban
        .link_task_note(&id, &note_path)
        .map_err(|e| e.to_string())?;
    emit_task_event(&app, &kanban, &id, "task_linked");
    Ok(links)
}

/// Desvincula a nota — o `.md` permanece no cofre.
#[tauri::command]
pub async fn unlink_task_note(
    id: String,
    note_path: String,
    app: AppHandle,
    kanban: State<'_, SharedKanbanService>,
) -> Result<TaskLinks, String> {
    let links = kanban
        .unlink_task_note(&id, &note_path)
        .map_err(|e| e.to_string())?;
    emit_task_event(&app, &kanban, &id, "task_unlinked");
    Ok(links)
}

/// Lista o índice derivado de entities (filtro opcional por subtipo/título).
#[tauri::command]
pub async fn list_entities(
    subtipo: Option<String>,
    query: Option<String>,
    kanban: State<'_, SharedKanbanService>,
) -> Result<Vec<EntityIndexEntry>, String> {
    kanban
        .list_entities(subtipo.as_deref(), query.as_deref())
        .map_err(|e| e.to_string())
}

/// Cria a entity como nota canônica (`tipo: entidade`) + upsert no índice.
#[tauri::command]
pub async fn create_entity(
    titulo: String,
    subtipo: Option<String>,
    kanban: State<'_, SharedKanbanService>,
) -> Result<EntityIndexEntry, String> {
    let parsed = match subtipo.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        None => EntitySubtipo::default(),
        Some("pessoa") => EntitySubtipo::Pessoa,
        Some("projeto") => EntitySubtipo::Projeto,
        Some("lugar") => EntitySubtipo::Lugar,
        Some("livre") => EntitySubtipo::Livre,
        Some(other) => {
            return Err(format!(
                "subtipo inválido: '{}' (use pessoa|projeto|lugar|livre)",
                other
            ))
        }
    };
    kanban
        .create_entity(&titulo, parsed)
        .map_err(|e| e.to_string())
}

/// Vincula uma entity existente (validada no índice) à tarefa.
#[tauri::command]
pub async fn link_task_entity(
    id: String,
    entity_id: String,
    app: AppHandle,
    kanban: State<'_, SharedKanbanService>,
) -> Result<TaskLinks, String> {
    let links = kanban
        .link_task_entity(&id, &entity_id)
        .map_err(|e| e.to_string())?;
    emit_task_event(&app, &kanban, &id, "entity_linked");
    Ok(links)
}

/// Desvincula a entity — a `.md` canônica permanece no cofre.
#[tauri::command]
pub async fn unlink_task_entity(
    id: String,
    entity_id: String,
    app: AppHandle,
    kanban: State<'_, SharedKanbanService>,
) -> Result<TaskLinks, String> {
    let links = kanban
        .unlink_task_entity(&id, &entity_id)
        .map_err(|e| e.to_string())?;
    emit_task_event(&app, &kanban, &id, "entity_unlinked");
    Ok(links)
}

// ─── Fase 5: Insights ───────────────────────────────────────

/// Agregados prontos da aba Insights (streaks, barras, tendência e linhas
/// estimado vs realizado). O frontend só desenha — invariante de produto.
#[tauri::command]
pub async fn list_insights(
    periodo: Option<String>,
    kanban: State<'_, SharedKanbanService>,
) -> Result<Insights, String> {
    kanban
        .insights(periodo.as_deref())
        .map_err(|e| e.to_string())
}

// ─── Fase 4: hábitos ─────────────────────────────────────────

/// Lista os hábitos com `streak_atual` derivado das métricas.
#[tauri::command]
pub async fn list_habits(kanban: State<'_, SharedKanbanService>) -> Result<Vec<Habit>, String> {
    kanban.habit().list_habits().map_err(|e| e.to_string())
}

/// Cria o hábito (cron validado no domínio). A task do dia nasce no
/// próximo sync — nada é gerado no ato da criação.
#[tauri::command]
pub async fn create_habit(
    titulo: String,
    cron_expr: String,
    cor: Option<String>,
    app: AppHandle,
    kanban: State<'_, SharedKanbanService>,
) -> Result<Habit, String> {
    let habit = kanban
        .habit()
        .create_habit(&titulo, &cron_expr, cor.as_deref())
        .map_err(|e| e.to_string())?;
    if let Ok(week_id) = kanban.current_week_id() {
        let _ = emit_kanban_changed(&app, &week_id, "habit_created");
    }
    Ok(habit)
}

/// Edita título/cron/cor de um hábito existente (validação no domínio).
/// Tasks já geradas e métricas históricas ficam como estão.
#[tauri::command]
pub async fn update_habit(
    id: String,
    titulo: String,
    cron_expr: String,
    cor: Option<String>,
    app: AppHandle,
    kanban: State<'_, SharedKanbanService>,
) -> Result<Habit, String> {
    let habit = kanban
        .habit()
        .update_habit(&id, &titulo, &cron_expr, cor.as_deref())
        .map_err(|e| e.to_string())?;
    if let Ok(week_id) = kanban.current_week_id() {
        let _ = emit_kanban_changed(&app, &week_id, "habit_updated");
    }
    Ok(habit)
}

/// Ativa/desativa a geração do hábito (histórico e métricas preservados).
#[tauri::command]
pub async fn set_habit_active(
    id: String,
    ativo: bool,
    app: AppHandle,
    kanban: State<'_, SharedKanbanService>,
) -> Result<Habit, String> {
    let habit = kanban
        .habit()
        .set_active(&id, ativo)
        .map_err(|e| e.to_string())?;
    if let Ok(week_id) = kanban.current_week_id() {
        let _ = emit_kanban_changed(&app, &week_id, "habit_toggled");
    }
    Ok(habit)
}

/// Remove o hábito: hard delete **só** se nunca gerou task; caso contrário
/// apenas desativa (`ativo=0`). Devolve `true` quando apagou definitivamente.
#[tauri::command]
pub async fn delete_habit(
    id: String,
    app: AppHandle,
    kanban: State<'_, SharedKanbanService>,
) -> Result<bool, String> {
    let deleted = kanban
        .habit()
        .delete_habit(&id)
        .map_err(|e| e.to_string())?;
    if let Ok(week_id) = kanban.current_week_id() {
        let _ = emit_kanban_changed(&app, &week_id, "habit_deleted");
    }
    Ok(deleted)
}
