use crate::db::Database;
use crate::domain::errors::DomainError;
use crate::domain::models::habit as rules;
use crate::domain::models::insights::{month_bounds, normalize_periodo, pct};
use crate::domain::models::{
    DayBarPoint, DayTaskCount, EntityIndexEntry, EntitySubtipo, Habit, Insights, KanbanBoard,
    KanbanTask, KanbanWeek, LineSeriesPoint, NoteFrontmatter, StreakCard, TaskColumn, TaskKind,
    TaskLinks, TaskStatus, WeekStatus, WeekTaskCount, WeekTrendPoint,
};
use crate::domain::traits::stores::{EntityIndexStore, InsightsStore, KanbanStore};
use crate::infra::sqlite::{SqliteKanbanRepo, SqliteVaultIndexRepo};
use crate::vault::VaultManager;
use chrono::{Datelike, Duration, Local, NaiveDate, Utc};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use uuid::Uuid;

/// Gap de posição ao inserir no fim da coluna: sobra espaço para muitas
/// inserções fracionárias (ponto médio) sem reescrever as demais.
pub const POSITION_GAP: f64 = 1024.0;

pub type SharedKanbanService = Arc<KanbanService>;

// ─── Cálculo ISO de semana (puro, sem I/O) ───────────────────

/// Identificador canônico de semana: `"2026-W39"` (sempre 2 dígitos na semana).
pub fn week_id_for(year: i32, week: u32) -> String {
    format!("{}-W{:02}", year, week)
}

/// Interpreta `"2026-W38"` → `(2026, 38)`. `None` se o formato for inválido.
pub fn parse_week_id(raw: &str) -> Option<(i32, u32)> {
    let raw = raw.trim();
    let (year_part, rest) = raw.split_once('-')?;
    let year: i32 = year_part.trim().parse().ok()?;
    let rest = rest.trim();
    let week_part = rest.strip_prefix('W').or_else(|| rest.strip_prefix('w'))?;
    let week: u32 = week_part.trim().parse().ok()?;
    if !(1..=53).contains(&week) {
        return None;
    }
    Some((year, week))
}

/// Limites (segunda → domingo) da semana ISO `week` do ano `year`.
///
/// Jan 4 pertence sempre à semana 1, então a segunda-feira dessa semana é o
/// âncora — evita APIs menos estáveis de chrono.
pub fn iso_week_bounds(year: i32, week: u32) -> Option<(NaiveDate, NaiveDate)> {
    if !(1..=53).contains(&week) {
        return None;
    }
    let anchor = NaiveDate::from_ymd_opt(year, 1, 4)?;
    let since_monday = i64::from(anchor.weekday().num_days_from_monday());
    let week1_monday = anchor - Duration::days(since_monday);
    let start = week1_monday + Duration::days(i64::from(week - 1) * 7);
    let end = start + Duration::days(6);
    Some((start, end))
}

/// Semana ISO de uma data civil → `(ano_ISO, semana_ISO)`.
pub fn iso_week_of(date: NaiveDate) -> (i32, u32) {
    let iso = date.iso_week();
    (iso.year(), iso.week())
}

/// Id da semana ISO que contém `date`.
pub fn week_id_of(date: NaiveDate) -> String {
    let (year, week) = iso_week_of(date);
    week_id_for(year, week)
}

/// Confere se `(year, week)` é uma combinação ISO real (não "2026-W53" inexistente).
pub fn is_valid_iso_week(year: i32, week: u32) -> bool {
    match iso_week_bounds(year, week) {
        Some((start, _)) => iso_week_of(start) == (year, week),
        None => false,
    }
}

/// Valida `YYYY-MM-DD` e devolve a data civil.
pub fn parse_iso_date(raw: &str) -> Result<NaiveDate, DomainError> {
    let raw = raw.trim();
    NaiveDate::parse_from_str(raw, "%Y-%m-%d")
        .map_err(|_| DomainError::InvalidInput(format!("data inválida: '{}'", raw)))
}

/// Posição fracionária para inserir na `index`-ésima casa da coluna.
///
/// Usa o ponto médio entre vizinhos; nunca reordena as demais tarefas.
pub fn target_position(siblings: &[KanbanTask], index: usize) -> f64 {
    if siblings.is_empty() {
        return POSITION_GAP;
    }
    let index = index.min(siblings.len());
    let prev = index.checked_sub(1).and_then(|i| siblings.get(i));
    let next = siblings.get(index);
    match (prev, next) {
        (Some(p), Some(n)) => (p.position + n.position) / 2.0,
        (Some(p), None) => p.position + POSITION_GAP,
        (None, Some(n)) => n.position - POSITION_GAP,
        (None, None) => POSITION_GAP,
    }
}

fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

fn date_string(date: NaiveDate) -> String {
    date.format("%Y-%m-%d").to_string()
}

fn normalize_due_date(raw: Option<&str>) -> Result<Option<String>, DomainError> {
    match raw.map(str::trim) {
        None | Some("") => Ok(None),
        Some(value) => Ok(Some(date_string(parse_iso_date(value)?))),
    }
}

/// Constrói a linha do índice **derivado** de entities a partir do frontmatter
/// de uma nota. Devolve `None` quando a nota não é `tipo: entidade`.
///
/// O `id` prefere o frontmatter; sem ele, deriva do caminho (estável entre
/// rebuilds). `metadata` guarda as chaves extras em JSON (exceto vazio).
pub fn entity_entry_from(
    fm: &NoteFrontmatter,
    titulo: &str,
    path_rel: &str,
) -> Option<EntityIndexEntry> {
    if !fm.tipo.as_deref()?.trim().eq_ignore_ascii_case("entidade") {
        return None;
    }
    let subtipo = fm
        .extra
        .get("subtipo")
        .and_then(|v| v.as_str())
        .map(EntitySubtipo::from_db)
        .unwrap_or_default();
    let id = fm
        .id
        .clone()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| path_rel.trim_end_matches(".md").replace('/', "_"));
    let titulo = titulo.trim();
    let titulo = if titulo.is_empty() {
        path_rel.trim_end_matches(".md")
    } else {
        titulo
    };
    let metadata = serde_json::to_string(&fm.extra)
        .ok()
        .filter(|serialized| serialized != "{}");
    Some(EntityIndexEntry {
        id,
        subtipo,
        titulo: titulo.to_string(),
        note_path: path_rel.to_string(),
        metadata,
        created_at: now_iso(),
    })
}

// ─── Serviço ─────────────────────────────────────────────────

/// Regras de negócio do quadro Kanban Semanal.
///
/// Invariantes:
/// * Sem semana explícita, a leitura devolve **a semana aberta** (nunca uma
///   semana antiga arbitrária — blindagem contra alucinação do agente).
/// * Semana `closed` rejeita toda mutação com `"semana fechada: <id>"`.
/// * Tarefas de hábito nunca têm `note_path` e não podem ser apagadas soltas.
/// * Excluir tarefa desvincula: nenhum `.md` é apagado do cofre.
pub struct KanbanService {
    /// Dono do SQLite (mesmo pool dos repositórios) — usado para criar itens
    /// de Inbox no fechamento de semana (Fase 3).
    db: Arc<Database>,
    repo: SqliteKanbanRepo,
    /// Cofres do usuário — notas canônicas de tarefas/entities vivem **apenas**
    /// no vault padrão (o cofre Obsidian permanece intocável).
    vault: Arc<VaultManager>,
    /// Índice derivado de entities (`entities_index`, sempre reconstruível).
    entity_index: SqliteVaultIndexRepo,
    /// Domínio de hábitos (Fase 4) — dono da geração de tasks diárias e da
    /// sincronia task↔métrica. Construído internamente para não mudar a
    /// assinatura de `new` (tools, scheduler e comandos acessam via `habit()`).
    habit: crate::services::habit_srv::HabitService,
}

impl KanbanService {
    pub fn new(db: Arc<Database>, vault: Arc<VaultManager>) -> Self {
        let pool = db.get_pool();
        let repo = SqliteKanbanRepo::new(pool.clone());
        let entity_index = SqliteVaultIndexRepo::new(pool);
        let habit = crate::services::habit_srv::HabitService::new(db.clone());
        Self {
            db,
            repo,
            vault,
            entity_index,
            habit,
        }
    }

    /// Serviço de hábitos (geração diária, métricas, CRUD).
    pub fn habit(&self) -> &crate::services::habit_srv::HabitService {
        &self.habit
    }

    /// Acesso ao cofre para composição de casos de uso (testes, tools da Fase 3).
    pub fn vault(&self) -> &VaultManager {
        &self.vault
    }

    /// Acesso ao repositório para composição de casos de uso (hábitos, Insights).
    pub fn repo(&self) -> &SqliteKanbanRepo {
        &self.repo
    }

    // ── Semanas ──

    /// Devolve a semana aberta atual, criando-a se ainda não existir.
    ///
    /// Se não houver semana aberta e a semana de hoje já estiver fechada, o
    /// erro tipado `semana fechada: <id>` é propagado para a camada de IPC.
    pub fn ensure_open_week(&self) -> Result<KanbanWeek, DomainError> {
        // Fecha primeiro semanas vencidas: o app pode ter ficado desligado no
        // fim de semana e uma semana passada ainda "aberta" não pode se
        // passar por atual.
        self.ensure_weeks_closed()?;
        if let Some(week) = self.repo.get_open_week()? {
            return Ok(week);
        }
        let week = self.get_or_create_week(Local::now().date_naive())?;
        self.ensure_writable(&week)?;
        Ok(week)
    }

    /// Busca a semana pelo id; se não existir, cria em estado `open`.
    pub fn get_or_create_week(&self, date: NaiveDate) -> Result<KanbanWeek, DomainError> {
        let (year, week_num) = iso_week_of(date);
        let id = week_id_for(year, week_num);
        if let Some(existing) = self.repo.get_week(&id)? {
            return Ok(existing);
        }
        let (week_start, week_end) = iso_week_bounds(year, week_num)
            .ok_or_else(|| DomainError::InvalidInput(format!("semana ISO inválida: {}", id)))?;
        let created = KanbanWeek {
            id,
            year,
            iso_week: week_num,
            week_start: date_string(week_start),
            week_end: date_string(week_end),
            status: WeekStatus::Open,
            created_at: now_iso(),
            closed_at: None,
        };
        self.repo.insert_week(&created)?;
        Ok(created)
    }

    fn ensure_writable(&self, week: &KanbanWeek) -> Result<(), DomainError> {
        if week.status == WeekStatus::Closed {
            // `Other` exibe a mensagem crua (sem prefixo): o contrato do erro
            // tipado é exatamente `"semana fechada: <id>"`.
            return Err(DomainError::Other(format!("semana fechada: {}", week.id)));
        }
        Ok(())
    }

    /// Semana alvo de uma mutação: a aberta, ou a semana de hoje se ainda não criada.
    fn writable_week(&self) -> Result<KanbanWeek, DomainError> {
        // Stale primeiro (ver `ensure_open_week`): escrita nunca pode cair
        // numa semana passada que o scheduler ainda não fechou.
        self.ensure_weeks_closed()?;
        let week = match self.repo.get_open_week()? {
            Some(week) => week,
            None => self.get_or_create_week(Local::now().date_naive())?,
        };
        self.ensure_writable(&week)?;
        Ok(week)
    }

    // ── Leitura ──

    /// Lê o quadro.
    ///
    /// * `semana == None` → **a semana aberta** (fallback: semana de hoje).
    /// * `semana == Some("2026-W38")` → aquela semana exata, se existir.
    pub fn list_board(&self, semana: Option<&str>) -> Result<KanbanBoard, DomainError> {
        let week = match semana.map(str::trim) {
            None | Some("") => {
                // Escopo padrão = semana aberta atual; stale encerrada primeiro.
                self.ensure_weeks_closed()?;
                match self.repo.get_open_week()? {
                    Some(week) => week,
                    None => self.get_or_create_week(Local::now().date_naive())?,
                }
            }
            Some(raw) => {
                let (year, week_num) = parse_week_id(raw).ok_or_else(|| {
                    DomainError::InvalidInput(format!(
                        "semana inválida: '{}' (use o formato 2026-W39)",
                        raw
                    ))
                })?;
                if !is_valid_iso_week(year, week_num) {
                    return Err(DomainError::InvalidInput(format!(
                        "semana ISO inexistente: {}",
                        week_id_for(year, week_num)
                    )));
                }
                let id = week_id_for(year, week_num);
                self.repo.get_week(&id)?.ok_or_else(|| {
                    DomainError::NotFound(format!("semana não encontrada: {}", id))
                })?
            }
        };
        let tasks: Vec<KanbanTask> = self
            .repo
            .list_tasks(&week.id)?
            .into_iter()
            .filter(|task| task.status == TaskStatus::Active)
            .collect();
        // Vínculos por tarefa (notas relacionadas + entities resolvidas) —
        // evita N+1 de IPC no render dos chips dos cards.
        let mut links = Vec::with_capacity(tasks.len());
        for task in &tasks {
            links.push(self.task_links(&task.id)?);
        }
        // Hábitos (cor + id) para colorir os cards de hábito sem N+1 de IPC —
        // derivado do repositório; `streak_atual` só importa no modal.
        let habits = self.habit.list_habits_basic()?;
        Ok(KanbanBoard {
            week,
            tasks,
            links,
            habits,
        })
    }

    /// Agregados prontos da aba Insights (Fase 5) — SQL só no repositório e
    /// regras aqui; o frontend apenas desenha (nunca calcula agregado).
    ///
    /// * `periodo`: `"semana"` (padrão) ou `"mes"` — granularidade das linhas
    ///   "estimado vs realizado".
    /// * Fecha semanas vencidas antes de ler (mesmo caminho do quadro).
    pub fn insights(&self, periodo: Option<&str>) -> Result<Insights, DomainError> {
        let periodo = normalize_periodo(periodo)?;
        self.ensure_weeks_closed()?;

        let today = Local::now().date_naive();
        let today_str = date_string(today);
        let (ty, tm, td) = (today.year(), today.month(), today.day());
        let weekday = today.weekday().num_days_from_sunday();

        // ── Streaks + placar de hoje ──
        let habits = self.habit.list_habits()?;
        let mut streaks = Vec::with_capacity(habits.len());
        let mut hoje_total = 0u64;
        let mut hoje_feitos = 0u64;
        for h in &habits {
            let dates = self.repo.habit_metric_dates(&h.id)?;
            let streak_atual = rules::compute_streak(&dates, &today_str);
            let maior_streak = rules::longest_streak(&dates);
            let feito_hoje = dates.first().is_some_and(|d| d.as_str() == today_str);
            if h.ativo && rules::matches_date(&h.cron_expr, ty, tm, td, weekday).unwrap_or(false) {
                hoje_total += 1;
                if feito_hoje {
                    hoje_feitos += 1;
                }
            }
            streaks.push(StreakCard {
                habit: h.clone(),
                streak_atual,
                maior_streak,
                feito_hoje,
            });
        }

        // ── Séries semanais (DESC do repo; guarda até 26 p/ agregação mensal) ──
        let week_counts = self.repo.task_counts_by_week(26)?;
        let recent: Vec<&WeekTaskCount> = week_counts.iter().take(8).collect(); // DESC
        let recent_asc: Vec<&WeekTaskCount> = recent.iter().rev().copied().collect(); // ASC

        // ── % da semana aberta (0.0 quando não há semana aberta) ──
        let pct_semana = match self.repo.get_open_week()? {
            Some(week) => week_counts
                .iter()
                .find(|w| w.week_id == week.id)
                .map(|w| pct(w.done, w.created))
                .unwrap_or(0.0),
            None => 0.0,
        };

        // ── Barras: últimos 14 dias (série densa — dia sem dado = zeros) ──
        let from = today - Duration::days(13);
        let from_str = date_string(from);
        let day_tasks = self.repo.task_counts_by_day(&from_str, &today_str)?;
        let day_metrics = self.repo.habit_metrics_by_day(&from_str, &today_str)?;
        let task_by_day: HashMap<&str, &DayTaskCount> =
            day_tasks.iter().map(|d| (d.date.as_str(), d)).collect();
        let metric_by_day: HashMap<&str, u64> = day_metrics
            .iter()
            .map(|d| (d.date.as_str(), d.habitos))
            .collect();
        let mut bars = Vec::with_capacity(14);
        for offset in 0..14i64 {
            let key = date_string(from + Duration::days(offset));
            let t = task_by_day.get(key.as_str()).copied();
            let total = t.map(|x| x.total).unwrap_or(0);
            let done = t.map(|x| x.done).unwrap_or(0);
            bars.push(DayBarPoint {
                pct_tarefas: pct(done, total),
                habitos_registrados: metric_by_day.get(key.as_str()).copied().unwrap_or(0),
                date: key,
                tarefas_feitas: done,
                tarefas_total: total,
            });
        }

        // ── Tendência: últimas 8 semanas em ordem cronológica ──
        let trend = recent_asc
            .iter()
            .map(|w| WeekTrendPoint {
                week_id: w.week_id.clone(),
                pct_conclusao: pct(w.done, w.created),
                taxa_habitos: pct(w.habit_done, w.habit_created),
            })
            .collect();

        // ── Linhas estimado vs realizado ──
        let active: Vec<Habit> = habits.iter().filter(|h| h.ativo).cloned().collect();
        let lines = if periodo == "semana" {
            let mut out = Vec::with_capacity(recent_asc.len());
            for w in &recent_asc {
                let estimado_habitos = rules::iso_days(&w.week_start)
                    .map(|start| {
                        active
                            .iter()
                            .map(|h| {
                                rules::expected_occurrences(&h.cron_expr, start, start + 6)
                                    .unwrap_or(0)
                            })
                            .sum()
                    })
                    .unwrap_or(0);
                out.push(LineSeriesPoint {
                    periodo: w.week_id.clone(),
                    estimado_tarefas: w.created,
                    realizado_tarefas: w.done,
                    estimado_habitos,
                    realizado_habitos: w.habit_done,
                });
            }
            out
        } else {
            // Mês: agrega as 26 semanas pela semana inicial (`AAAA-MM`).
            let mut order: Vec<String> = Vec::new();
            let mut acc: HashMap<String, (u64, u64, u64)> = HashMap::new();
            for w in &week_counts {
                let key = w
                    .week_start
                    .get(..7)
                    .map(str::to_string)
                    .unwrap_or_else(|| w.week_start.clone());
                let entry = acc.entry(key.clone()).or_insert((0, 0, 0));
                entry.0 += w.created;
                entry.1 += w.done;
                entry.2 += w.habit_done;
                if !order.contains(&key) {
                    order.push(key);
                }
            }
            order.reverse(); // ASC
            order.truncate(6); // últimos 6 meses com dado
            order
                .into_iter()
                .map(|key| {
                    let (created, done, habit_done) = acc.get(&key).copied().unwrap_or((0, 0, 0));
                    let estimado_habitos = month_bounds(&key)
                        .map(|(start, end)| {
                            active
                                .iter()
                                .map(|h| {
                                    rules::expected_occurrences(&h.cron_expr, start, end)
                                        .unwrap_or(0)
                                })
                                .sum()
                        })
                        .unwrap_or(0);
                    LineSeriesPoint {
                        periodo: key,
                        estimado_tarefas: created,
                        realizado_tarefas: done,
                        estimado_habitos,
                        realizado_habitos: habit_done,
                    }
                })
                .collect()
        };

        Ok(Insights {
            periodo: periodo.to_string(),
            streaks,
            habitos_hoje_total: hoje_total,
            habitos_hoje_feitos: hoje_feitos,
            pct_semana,
            bars,
            trend,
            lines,
        })
    }

    pub fn get_task(&self, task_id: &str) -> Result<KanbanTask, DomainError> {
        self.repo
            .get_task(task_id)?
            .ok_or_else(|| DomainError::NotFound(format!("tarefa não encontrada: {}", task_id)))
    }

    /// Semana dona de uma tarefa (com validação de estado).
    fn week_of_task(&self, task: &KanbanTask) -> Result<KanbanWeek, DomainError> {
        self.repo.get_week(&task.week_id).and_then(|found| {
            found.ok_or_else(|| {
                DomainError::NotFound(format!("semana não encontrada: {}", task.week_id))
            })
        })
    }

    // ── Mutações ──

    pub fn create_task(
        &self,
        titulo: &str,
        column: TaskColumn,
        due_date: Option<&str>,
    ) -> Result<KanbanTask, DomainError> {
        let titulo = titulo.trim();
        if titulo.is_empty() {
            return Err(DomainError::InvalidInput(
                "título da tarefa é obrigatório".to_string(),
            ));
        }
        let due = normalize_due_date(due_date)?;
        let week = self.writable_week()?;
        let position = self.repo.max_position(&week.id)? + POSITION_GAP;
        let now = now_iso();
        let task = KanbanTask {
            id: Uuid::new_v4().to_string(),
            week_id: week.id,
            titulo: titulo.to_string(),
            note_path: None,
            task_column: column,
            status: TaskStatus::Active,
            carried_to: None,
            position,
            task_kind: TaskKind::Normal,
            habit_id: None,
            due_date: due,
            created_at: now.clone(),
            updated_at: now,
        };
        self.repo.insert_task(&task)?;
        Ok(task)
    }

    /// Move a tarefa para `column`, reancorando-a na posição fracionária `index`
    /// (índice visual 0-based na coluna de destino, após a remoção do próprio card).
    pub fn move_task(
        &self,
        task_id: &str,
        column: TaskColumn,
        index: usize,
    ) -> Result<KanbanTask, DomainError> {
        let mut task = self.get_task(task_id)?;
        let week = self.week_of_task(&task)?;
        self.ensure_writable(&week)?;

        let siblings: Vec<KanbanTask> = self
            .repo
            .list_tasks(&week.id)?
            .into_iter()
            .filter(|t| {
                t.id != task.id && t.task_column == column && t.status == TaskStatus::Active
            })
            .collect();

        task.position = target_position(&siblings, index);
        task.task_column = column;
        task.updated_at = now_iso();
        self.repo.update_task_layout(
            &task.id,
            task.task_column.as_db(),
            task.position,
            &task.updated_at,
        )?;
        // Fase 4: a task de hábito é a fonte única da métrica — mover para/
        // de `done` cria/remove a linha do dia em `user_tabular_data`.
        self.habit.on_habit_task_moved(&task)?;
        Ok(task)
    }

    /// Atualiza conteúdo da tarefa (título + prazo). O corpo rico vive na nota
    /// `note_path` e é salvo pelo editor (Fase 2), não aqui.
    pub fn update_task(
        &self,
        task_id: &str,
        titulo: &str,
        due_date: Option<&str>,
    ) -> Result<KanbanTask, DomainError> {
        let mut task = self.get_task(task_id)?;
        let week = self.week_of_task(&task)?;
        self.ensure_writable(&week)?;

        let titulo = titulo.trim();
        if titulo.is_empty() {
            return Err(DomainError::InvalidInput(
                "título da tarefa é obrigatório".to_string(),
            ));
        }
        task.titulo = titulo.to_string();
        task.due_date = normalize_due_date(due_date)?;
        task.updated_at = now_iso();
        self.repo.update_task_content(
            &task.id,
            &task.titulo,
            task.due_date.as_deref(),
            &task.updated_at,
        )?;
        Ok(task)
    }

    /// Desvincula e apaga a tarefa do SQLite.
    ///
    /// **Nunca** apaga arquivo `.md` — `note_path` é apenas referência; a nota
    /// pertence ao cofre do usuário e ali permanece.
    pub fn delete_task(&self, task_id: &str) -> Result<(), DomainError> {
        let task = self.get_task(task_id)?;
        if task.task_kind == TaskKind::Habit {
            return Err(DomainError::InvalidInput(
                "tarefa gerada por hábito: desative o próprio hábito para removê-la".to_string(),
            ));
        }
        let week = self.week_of_task(&task)?;
        self.ensure_writable(&week)?;
        self.repo.delete_task(&task.id)?;
        Ok(())
    }

    // ── Nota principal da tarefa (Fase 2) ──

    /// Converte caminho absoluto em caminho relativo ao vault padrão
    /// (separador `/`, portável entre Windows e Linux).
    fn relative_to_vault(&self, abs: &Path) -> Result<String, DomainError> {
        abs.strip_prefix(&self.vault.default_vault)
            .map(|rel| rel.to_string_lossy().replace('\\', "/"))
            .map_err(|_| {
                DomainError::InvalidInput(format!(
                    "caminho fora do cofre padrão: {}",
                    abs.display()
                ))
            })
    }

    /// Resolve um caminho relativo do vault padrão com defesa contra
    /// traversal (`..`).
    fn vault_path(&self, rel: &str) -> Result<PathBuf, DomainError> {
        let cleaned = rel.trim().trim_start_matches(['/', '\\']);
        if cleaned.is_empty() || cleaned.split(['/', '\\']).any(|part| part == "..") {
            return Err(DomainError::InvalidInput(format!(
                "caminho de nota inválido: '{}'",
                rel
            )));
        }
        Ok(self.vault.default_vault.join(cleaned))
    }

    /// Normaliza um identificador de nota para caminho relativo do vault
    /// padrão, validando que o arquivo existe nele (nada do cofre Obsidian).
    fn resolve_vault_note(&self, identifier: &str) -> Result<String, DomainError> {
        let trimmed = identifier.trim();
        if trimmed.is_empty() {
            return Err(DomainError::InvalidInput(
                "caminho da nota vazio".to_string(),
            ));
        }
        match self.vault.resolve_path(trimmed, Some("default")) {
            Some((abs, vault_name)) if vault_name == "default" => self.relative_to_vault(&abs),
            _ => Err(DomainError::NotFound(format!(
                "nota não encontrada no cofre padrão: '{}'",
                trimmed
            ))),
        }
    }

    /// Cria a `.md` canônica da tarefa no vault padrão (frontmatter
    /// `tipo: tarefa` + `kanban_id` + `semana`) e grava `note_path`.
    ///
    /// Idempotente (se já existe nota, devolve como está). Hábitos **nunca**
    /// recebem nota; semana fechada rejeita com `"semana fechada: <id>"`.
    pub fn create_task_note(&self, task_id: &str) -> Result<KanbanTask, DomainError> {
        let mut task = self.get_task(task_id)?;
        let week = self.week_of_task(&task)?;
        self.ensure_writable(&week)?;
        if task.task_kind == TaskKind::Habit {
            return Err(DomainError::InvalidInput(
                "tarefa de hábito não recebe nota".to_string(),
            ));
        }
        if task
            .note_path
            .as_deref()
            .map(|p| !p.trim().is_empty())
            .unwrap_or(false)
        {
            return Ok(task);
        }

        let mut extra = HashMap::new();
        extra.insert(
            "kanban_id".to_string(),
            serde_yaml::Value::String(task.id.clone()),
        );
        extra.insert(
            "semana".to_string(),
            serde_yaml::Value::String(task.week_id.clone()),
        );
        let patch = NoteFrontmatter {
            tipo: Some("tarefa".to_string()),
            id: Some(task.id.clone()),
            extra,
            ..Default::default()
        };
        let abs = self
            .vault
            .create_note_with_patch(&task.titulo, "", None, None, patch)
            .map_err(|e| DomainError::Other(format!("falha ao criar a nota da tarefa: {}", e)))?;
        let rel = self.relative_to_vault(&abs)?;
        self.repo
            .set_task_note_path(&task.id, Some(&rel), &now_iso())?;
        task.note_path = Some(rel);
        Ok(task)
    }

    /// Lê o corpo da nota da tarefa (sem frontmatter). `None` quando não há
    /// nota ou o arquivo não existe mais — nunca falha o editor por isso.
    pub fn get_task_note(&self, task_id: &str) -> Result<Option<String>, DomainError> {
        let task = self.get_task(task_id)?;
        let rel = match task
            .note_path
            .as_deref()
            .map(str::trim)
            .filter(|p| !p.is_empty())
        {
            Some(rel) => rel.to_string(),
            None => return Ok(None),
        };
        let abs = self.vault_path(&rel)?;
        if !abs.exists() {
            return Ok(None);
        }
        let (_fm, body) = VaultManager::parse_note_file(&abs)
            .map_err(|e| DomainError::Other(format!("falha ao ler a nota da tarefa: {}", e)))?;
        Ok(Some(body))
    }

    /// Substituição atômica do corpo da nota (frontmatter preservado).
    /// Na primeira gravação cria a nota automaticamente (editor por debounce).
    /// Devolve o caminho relativo da nota salva.
    pub fn save_task_note(&self, task_id: &str, content: &str) -> Result<String, DomainError> {
        let task = self.get_task(task_id)?;
        let week = self.week_of_task(&task)?;
        self.ensure_writable(&week)?;
        if task.task_kind == TaskKind::Habit {
            return Err(DomainError::InvalidInput(
                "tarefa de hábito não recebe nota".to_string(),
            ));
        }
        let mut rel = match task
            .note_path
            .as_deref()
            .map(str::trim)
            .filter(|p| !p.is_empty())
        {
            Some(rel) => rel.to_string(),
            None => match self.create_task_note(&task.id)?.note_path {
                Some(rel) => rel,
                None => {
                    return Err(DomainError::Other(
                        "nota da tarefa não pôde ser criada".to_string(),
                    ))
                }
            },
        };
        // A nota pode ter sido apagada fora do app: recria a canônica antes
        // de gravar, para o editor nunca falhar em silêncio.
        if !self.vault_path(&rel)?.exists() {
            self.repo.set_task_note_path(&task.id, None, &now_iso())?;
            rel = self.create_task_note(&task.id)?.note_path.ok_or_else(|| {
                DomainError::Other("nota da tarefa não pôde ser recriada".to_string())
            })?;
        }
        self.vault
            .update_note(&rel, content, "replace")
            .map_err(|e| DomainError::Other(format!("falha ao salvar a nota da tarefa: {}", e)))?;
        Ok(rel)
    }

    // ── Vínculos: notas relacionadas + entities (Fase 2) ──

    /// Vincula uma nota existente do vault padrão à tarefa (chip no card).
    /// Apenas o vínculo muda — nenhum arquivo é criado, movido ou apagado.
    pub fn link_task_note(&self, task_id: &str, note_path: &str) -> Result<TaskLinks, DomainError> {
        let task = self.get_task(task_id)?;
        let week = self.week_of_task(&task)?;
        self.ensure_writable(&week)?;
        let rel = self.resolve_vault_note(note_path)?;
        if task.note_path.as_deref() == Some(rel.as_str()) {
            return self.task_links(task_id);
        }
        self.repo.link_task_note(task_id, &rel)?;
        self.task_links(task_id)
    }

    /// Desvincula a nota (o `.md` permanece no cofre).
    pub fn unlink_task_note(
        &self,
        task_id: &str,
        note_path: &str,
    ) -> Result<TaskLinks, DomainError> {
        let task = self.get_task(task_id)?;
        let week = self.week_of_task(&task)?;
        self.ensure_writable(&week)?;
        let rel = note_path.trim().replace('\\', "/");
        self.repo.unlink_task_note(task_id, &rel)?;
        self.task_links(task_id)
    }

    /// Lista o índice derivado de entities (filtro opcional por subtipo/título).
    pub fn list_entities(
        &self,
        subtipo: Option<&str>,
        query: Option<&str>,
    ) -> Result<Vec<EntityIndexEntry>, DomainError> {
        self.entity_index.list_entities(subtipo, query)
    }

    /// Cria a `.md` canônica da entity (`tipo: entidade`) no vault padrão e
    /// faz upsert imediato no índice derivado.
    pub fn create_entity(
        &self,
        titulo: &str,
        subtipo: EntitySubtipo,
    ) -> Result<EntityIndexEntry, DomainError> {
        let titulo = titulo.trim();
        if titulo.is_empty() {
            return Err(DomainError::InvalidInput(
                "título da entity é obrigatório".to_string(),
            ));
        }
        let id = Uuid::new_v4().to_string();
        let mut extra = HashMap::new();
        extra.insert(
            "subtipo".to_string(),
            serde_yaml::Value::String(subtipo.as_db().to_string()),
        );
        let patch = NoteFrontmatter {
            tipo: Some("entidade".to_string()),
            id: Some(id.clone()),
            extra,
            ..Default::default()
        };
        let abs = self
            .vault
            .create_note_with_patch(titulo, "", None, None, patch)
            .map_err(|e| DomainError::Other(format!("falha ao criar a entity: {}", e)))?;
        let rel = self.relative_to_vault(&abs)?;
        let entry = EntityIndexEntry {
            id,
            subtipo,
            titulo: titulo.to_string(),
            note_path: rel,
            metadata: None,
            created_at: now_iso(),
        };
        self.entity_index.upsert_entity(&entry)?;
        Ok(entry)
    }

    /// Vincula uma entity existente (validada no índice) à tarefa.
    pub fn link_task_entity(
        &self,
        task_id: &str,
        entity_id: &str,
    ) -> Result<TaskLinks, DomainError> {
        let task = self.get_task(task_id)?;
        let week = self.week_of_task(&task)?;
        self.ensure_writable(&week)?;
        let entity_id = entity_id.trim();
        if self.entity_index.get_entity(entity_id)?.is_none() {
            return Err(DomainError::NotFound(format!(
                "entity não encontrada: '{}'",
                entity_id
            )));
        }
        self.repo.link_task_entity(task_id, entity_id)?;
        self.task_links(task_id)
    }

    /// Desvincula a entity da tarefa — a `.md` canônica permanece no cofre.
    pub fn unlink_task_entity(
        &self,
        task_id: &str,
        entity_id: &str,
    ) -> Result<TaskLinks, DomainError> {
        let task = self.get_task(task_id)?;
        let week = self.week_of_task(&task)?;
        self.ensure_writable(&week)?;
        self.repo.unlink_task_entity(task_id, entity_id.trim())?;
        self.task_links(task_id)
    }

    /// Vínculos completos de uma tarefa (notas + entities resolvidas do índice).
    pub fn task_links(&self, task_id: &str) -> Result<TaskLinks, DomainError> {
        let notes = self.repo.list_task_notes(task_id)?;
        let mut entities = Vec::new();
        for entity_id in self.repo.list_task_entity_ids(task_id)? {
            if let Some(entry) = self.entity_index.get_entity(&entity_id)? {
                entities.push(entry);
            }
        }
        Ok(TaskLinks {
            task_id: task_id.to_string(),
            notes,
            entities,
        })
    }

    /// Reconstrói `entities_index` a partir das notas `tipo: entidade` do
    /// vault padrão e poda entradas órfãs. O índice é 100% derivado: sumiu a
    /// nota, some a linha (o `.md` em si nunca é apagado pelo app).
    pub fn rebuild_entities_index(&self) -> Result<usize, DomainError> {
        let mut count = 0usize;
        for file in self.vault.list_md_files(&self.vault.default_vault) {
            let Ok((fm, body)) = VaultManager::parse_note_file(&file) else {
                continue;
            };
            let Ok(rel) = self.relative_to_vault(&file) else {
                continue;
            };
            let titulo = VaultManager::extract_obsidian_title(&file, &body, &fm);
            if let Some(entry) = entity_entry_from(&fm, &titulo, &rel) {
                self.entity_index.upsert_entity(&entry)?;
                count += 1;
            }
        }
        let root = self.vault.default_vault.clone();
        self.entity_index
            .prune_missing_entities(|rel| root.join(rel).exists())?;
        Ok(count)
    }

    // ── Fase 3 — fechamento de semana → Inbox (rollover) ─────

    /// Payload JSON canônico de um item `kanban_rollover` (guardado em
    /// `content` para sobreviver a restart — o app pode estar fechado no
    /// domingo 23h).
    pub fn rollover_content(task: &KanbanTask) -> String {
        serde_json::json!({
            "task_id": task.id,
            "week_id": task.week_id,
            "titulo": task.titulo
        })
        .to_string()
    }

    /// Extrai `(task_id, week_id)` do `content` de um item `kanban_rollover`.
    pub fn parse_rollover_content(content: &str) -> Result<(String, String), DomainError> {
        let value: serde_json::Value = serde_json::from_str(content).map_err(|_| {
            DomainError::InvalidInput("conteúdo de kanban_rollover inválido".to_string())
        })?;
        let task_id = value
            .get("task_id")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| DomainError::InvalidInput("kanban_rollover sem task_id".to_string()))?;
        let week_id = value
            .get("week_id")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| DomainError::InvalidInput("kanban_rollover sem week_id".to_string()))?;
        Ok((task_id.to_string(), week_id.to_string()))
    }

    /// Fecha a semana (`status='closed'`, read-only) e devolve cada task
    /// `active` ≠ `done` como `InboxItem` (`kanban_rollover`,
    /// `requires_decision: true`).
    ///
    /// * Idempotente: semana já fechada ⇒ `Ok(vec![])`.
    /// * Tarefas de hábito ficam **fora** do rollover (a Fase 4 as recria
    ///   pelo sync). Concluídas também não viram item.
    pub fn close_week(&self, week_id: &str) -> Result<Vec<String>, DomainError> {
        let week = self
            .repo
            .get_week(week_id)?
            .ok_or_else(|| DomainError::NotFound(format!("semana não encontrada: {}", week_id)))?;
        if week.status == WeekStatus::Closed {
            return Ok(Vec::new());
        }
        let now = now_iso();
        self.repo
            .set_week_status(&week.id, WeekStatus::Closed, Some(&now))?;
        let mut item_ids = Vec::new();
        for task in self.repo.list_tasks(&week.id)? {
            if task.status != TaskStatus::Active
                || task.task_column == TaskColumn::Done
                || task.task_kind == TaskKind::Habit
            {
                continue;
            }
            let summary = format!(
                "Pendência da semana {} — escolha carregar para a semana nova ou cancelar.",
                week.id
            );
            let item = self
                .db
                .create_inbox_item(
                    None,
                    &task.titulo,
                    Some(&summary),
                    &Self::rollover_content(&task),
                    "kanban_rollover",
                    true,
                )
                .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
            item_ids.push(item.id);
        }
        Ok(item_ids)
    }

    /// Fecha toda semana aberta cujo prazo (domingo, 23h) já passou — mesmo
    /// com o app parado no fim de semana. Devolve os ids fechados.
    /// Id da semana aberta atual (criando-a se preciso) — usado pelos emits
    /// de `kanban-changed` fora do fluxo de tarefa (`habits_synced`, etc.).
    pub fn current_week_id(&self) -> Result<String, DomainError> {
        Ok(self.ensure_open_week()?.id)
    }

    pub fn ensure_weeks_closed(&self) -> Result<Vec<String>, DomainError> {
        let now = Local::now().naive_local();
        let mut closed = Vec::new();
        for week in self.repo.list_open_weeks()? {
            let end = parse_iso_date(&week.week_end)?;
            let Some(deadline) = end.and_hms_opt(23, 0, 0) else {
                continue;
            };
            if now >= deadline {
                self.close_week(&week.id)?;
                closed.push(week.id);
            }
        }
        Ok(closed)
    }

    /// Aceite do rollover: cria a tarefa na **semana aberta** e marca a
    /// antiga como `carried` (`carried_to` = semana nova).
    ///
    /// Idempotente: já `carried`/`cancelled` ⇒ `Ok(None)` (nenhuma duplicata).
    /// Só opera em tarefa de semana fechada (é decisão do pós-rollover).
    pub fn carry_task(&self, task_id: &str) -> Result<Option<KanbanTask>, DomainError> {
        let task = self.get_task(task_id)?;
        if task.task_kind == TaskKind::Habit {
            return Err(DomainError::InvalidInput(
                "tarefas de hábito não entram no rollover".to_string(),
            ));
        }
        if task.status != TaskStatus::Active {
            return Ok(None);
        }
        let week = self.week_of_task(&task)?;
        if week.status != WeekStatus::Closed {
            return Err(DomainError::InvalidInput(format!(
                "carregamento só se aplica a tarefa de semana fechada: {}",
                week.id
            )));
        }
        let open = self.ensure_open_week()?;
        let now = now_iso();
        let new_task = KanbanTask {
            id: Uuid::new_v4().to_string(),
            week_id: open.id.clone(),
            titulo: task.titulo.clone(),
            note_path: None,
            task_column: TaskColumn::Todo,
            status: TaskStatus::Active,
            carried_to: None,
            position: self.repo.max_position(&open.id)? + POSITION_GAP,
            task_kind: TaskKind::Normal,
            habit_id: None,
            due_date: task.due_date.clone(),
            created_at: now.clone(),
            updated_at: now.clone(),
        };
        self.repo.insert_task(&new_task)?;
        self.repo
            .set_task_status(&task.id, TaskStatus::Carried.as_db(), Some(&open.id), &now)?;
        Ok(Some(new_task))
    }

    /// Recusa do rollover: marca a pendência como `cancelled` (idempotente —
    /// `Ok(false)` quando já decidida).
    pub fn cancel_task(&self, task_id: &str) -> Result<bool, DomainError> {
        let task = self.get_task(task_id)?;
        if task.status != TaskStatus::Active {
            return Ok(false);
        }
        let week = self.week_of_task(&task)?;
        if week.status != WeekStatus::Closed {
            return Err(DomainError::InvalidInput(format!(
                "cancelamento só se aplica a tarefa de semana fechada: {}",
                week.id
            )));
        }
        self.repo
            .set_task_status(&task.id, TaskStatus::Cancelled.as_db(), None, &now_iso())?;
        Ok(true)
    }
}
