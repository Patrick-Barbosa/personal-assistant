//! Insights — agregações **prontas** da aba Dashboard (Fase 5).
//!
//! Structs puras (`std` + `serde`): o SQL fica em `infra/sqlite/`, as regras
//! de composição em `services/kanban_srv.rs::insights()` e o frontend só
//! desenha (nunca calcula agregado aqui — invariante de produto).
use crate::domain::models::Habit;
use serde::{Deserialize, Serialize};

// ─── Payload de resposta (IPC) ──────────────────────────────

/// Placar de um hábito no topo da aba Insights.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StreakCard {
    pub habit: Habit,
    /// Sequência viva até hoje (pode estar "pendente" de hoje).
    pub streak_atual: u64,
    /// Maior sequência já registrada.
    pub maior_streak: u64,
    /// Já há métrica registrada hoje?
    pub feito_hoje: bool,
}

/// Barra de um dia: conclusão de tarefas + hábitos registrados.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DayBarPoint {
    pub date: String,
    /// Percentual 0–100 (arredondado a 1 casa).
    pub pct_tarefas: f64,
    pub habitos_registrados: u64,
    /// Contagens brutas para o rótulo do gráfico (ex.: "3/5").
    #[serde(default)]
    pub tarefas_feitas: u64,
    #[serde(default)]
    pub tarefas_total: u64,
}

/// Ponto da tendência entre semanas (fechadas + atual).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WeekTrendPoint {
    pub week_id: String,
    /// % de tarefas concluídas na semana (0–100).
    pub pct_conclusao: f64,
    /// % de tarefas de hábito concluídas na semana (0–100).
    pub taxa_habitos: f64,
}

/// Ponto da linha "estimado vs realizado" (semana ou mês).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LineSeriesPoint {
    /// `"2026-W39"` (semana) ou `"2026-09"` (mês).
    pub periodo: String,
    /// Tasks normais criadas no período (base do "estimado" de tarefas).
    pub estimado_tarefas: u64,
    /// Tasks normais concluídas no período.
    pub realizado_tarefas: u64,
    /// Ocorrências esperadas dos crons dos hábitos ativos no período.
    pub estimado_habitos: u64,
    /// Tarefas de hábito concluídas no período.
    pub realizado_habitos: u64,
}

/// Relatório completo da aba Insights — tudo agregado no backend.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Insights {
    /// Granularidade das linhas: `"semana"` ou `"mes"`.
    pub periodo: String,
    pub streaks: Vec<StreakCard>,
    /// Hábitos agendados para hoje (cron casa) e quantos já concluídos.
    pub habitos_hoje_total: u64,
    pub habitos_hoje_feitos: u64,
    /// % de conclusão da semana aberta (0–100; 0 quando não há semana).
    pub pct_semana: f64,
    /// Últimos 14 dias (ordem cronológica).
    pub bars: Vec<DayBarPoint>,
    /// Últimas 8 semanas (ordem cronológica).
    pub trend: Vec<WeekTrendPoint>,
    /// Estimado vs realizado — granularidade de `periodo`.
    pub lines: Vec<LineSeriesPoint>,
}

impl Insights {
    /// Relatório vazio (fallback de UI/browser sem backend).
    pub fn empty(periodo: &str) -> Self {
        Self {
            periodo: periodo.to_string(),
            streaks: Vec::new(),
            habitos_hoje_total: 0,
            habitos_hoje_feitos: 0,
            pct_semana: 0.0,
            bars: Vec::new(),
            trend: Vec::new(),
            lines: Vec::new(),
        }
    }
}

// ─── Linhas cruas do repositório (não vão ao IPC) ──────────

/// Contagem de tasks por dia no intervalo (bucket: `due_date` ou dia de
/// criação; exclui `carried`/`cancelled`).
#[derive(Debug, Clone, PartialEq)]
pub struct DayTaskCount {
    pub date: String,
    pub total: u64,
    pub done: u64,
}

/// Métricas de hábito por dia (`category='habito'`, distintas).
#[derive(Debug, Clone, PartialEq)]
pub struct DayHabitMetric {
    pub date: String,
    pub habitos: u64,
}

/// Contagem de tasks por semana ISO (inclui a semana aberta atual).
#[derive(Debug, Clone, PartialEq)]
pub struct WeekTaskCount {
    pub week_id: String,
    pub week_start: String,
    pub created: u64,
    pub done: u64,
    pub habit_created: u64,
    pub habit_done: u64,
}

// ─── Funções puras de apoio ─────────────────────────────────

/// Percentual 0–100 com uma casa decimal (`0/0` ⇒ 0.0 — sem divisão por zero).
pub fn pct(done: u64, total: u64) -> f64 {
    if total == 0 {
        return 0.0;
    }
    ((done as f64 * 100.0 / total as f64) * 10.0).round() / 10.0
}

/// Valida e normaliza o parâmetro `periodo` do `list_insights`.
pub fn normalize_periodo(
    raw: Option<&str>,
) -> Result<&'static str, crate::domain::errors::DomainError> {
    match raw.map(str::trim).unwrap_or_default() {
        "" | "semana" | "semanal" => Ok("semana"),
        "mes" | "mensal" => Ok("mes"),
        other => Err(crate::domain::errors::DomainError::InvalidInput(format!(
            "período inválido: '{}' (use 'semana' ou 'mes')",
            other
        ))),
    }
}

/// Limites em dias-since-epoch de um mês `"AAAA-MM"` (inclusive).
/// `None` quando a chave é malformada — o chamador decide o fallback.
pub fn month_bounds(key: &str) -> Option<(i64, i64)> {
    let (ys, ms) = key.split_once('-')?;
    let y: i32 = ys.parse().ok()?;
    let m: u32 = ms.parse().ok()?;
    if !(1..=12).contains(&m) {
        return None;
    }
    let (ny, nm) = if m == 12 { (y + 1, 1) } else { (y, m + 1) };
    let start = crate::domain::models::habit::days_from_civil(y, m, 1);
    let end = crate::domain::models::habit::days_from_civil(ny, nm, 1) - 1;
    Some((start, end))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::models::habit::days_from_civil;

    #[test]
    fn pct_handles_zero_and_rounding() {
        assert_eq!(pct(0, 0), 0.0);
        assert_eq!(pct(1, 3), 33.3);
        assert_eq!(pct(2, 3), 66.7);
        assert_eq!(pct(5, 5), 100.0);
    }

    #[test]
    fn normalize_periodo_accepts_aliases_only() {
        assert_eq!(normalize_periodo(None).unwrap(), "semana");
        assert_eq!(normalize_periodo(Some("")).unwrap(), "semana");
        assert_eq!(normalize_periodo(Some(" mes ")).unwrap(), "mes");
        assert_eq!(normalize_periodo(Some("mensal")).unwrap(), "mes");
        assert!(normalize_periodo(Some("ano")).is_err());
    }

    #[test]
    fn month_bounds_cover_full_month_and_rollover() {
        // Fevereiro 2026 (28 dias): dias 31..58 desde a epoch.
        let (start, end) = month_bounds("2026-02").unwrap();
        assert_eq!(start, days_from_civil(2026, 2, 1));
        assert_eq!(end, days_from_civil(2026, 3, 1) - 1);
        assert_eq!(end - start + 1, 28);
        // Virada de ano: dezembro tem 31 dias.
        let (start, end) = month_bounds("2026-12").unwrap();
        assert_eq!(end - start + 1, 31);
        assert_eq!(start, days_from_civil(2026, 12, 1));
        // Malformado não panica.
        assert!(month_bounds("2026-13").is_none());
        assert!(month_bounds("abc").is_none());
    }
}
