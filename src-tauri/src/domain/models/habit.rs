//! Domínio de Hábitos — entidade + regras **puras** de cron em nível de dia.
//!
//! Sem I/O e sem `chrono` (regra da camada `domain/`): datas entram como
//! campos inteiros ou dias-since-epoch (`days_from_civil`), e o weekday vem
//! do chamador (serviços calculam com `chrono::Local`).
//!
//! Os campos minuto/hora do cron são ignorados na decisão de dia: o scheduler
//! gera **uma task por dia** quando o cron casa com a data — o horário só
//! serve para leitura humana ("06:00 de terças").
use crate::domain::errors::DomainError;
use serde::{Deserialize, Serialize};

/// Hábito definido uma vez pelo usuário (título + cron + cor) e sincronizado
/// automaticamente no board da semana aberta.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Habit {
    pub id: String,
    pub titulo: String,
    /// Cron de 5 campos (`min hora dom mês dow`).
    pub cron_expr: String,
    /// Cor CSS hex (`#rrggbb`) usada nos cards.
    pub cor: String,
    pub ativo: bool,
    pub created_at: String,
    pub updated_at: String,
    /// Sequência atual de dias consecutivos com métrica — **derivada** na
    /// listagem (não é coluna da tabela `habits`; `serde(default)` para
    /// compatibilidade).
    #[serde(default)]
    pub streak_atual: u64,
}

impl Habit {
    /// Linha nova vinda do repositório (streak é preenchido depois pelo serviço).
    pub fn new(id: String, titulo: String, cron_expr: String, cor: String, now: String) -> Self {
        Self {
            id,
            titulo,
            cron_expr,
            cor,
            ativo: true,
            created_at: now.clone(),
            updated_at: now,
            streak_atual: 0,
        }
    }
}

// ─── Aritmética de data pura (Howard Hinnant, dias desde 1970-01-01) ───

/// Data civil → dias desde a epoch (`1970-01-01` = 0).
pub fn days_from_civil(year: i32, month: u32, day: u32) -> i64 {
    let y = year as i64 - i64::from(month <= 2);
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = (y - era * 400) as u64;
    let mp = if month > 2 { month - 3 } else { month + 9 } as u64;
    let doy = (153 * mp + 2) / 5 + u64::from(day) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe as i64 - 719_468
}

/// Dias desde a epoch → data civil `(ano, mês, dia)`.
pub fn civil_from_days(days: i64) -> (i32, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = (y + i64::from(m <= 2)) as i32;
    (year, m as u32, d as u32)
}

/// Dias desde a epoch → weekday `0=Dom … 6=Sáb` (mesma convenção do cron).
pub fn weekday_from_days(days: i64) -> u32 {
    (days + 4).rem_euclid(7) as u32
}

/// O cron é sintaticamente válido (5 campos bem formados)?
pub fn validate_cron(cron: &str) -> Result<(), DomainError> {
    split_cron(cron).map(|_| ())
}

/// `"YYYY-MM-DD"` → dias desde a epoch (`None` se malformado).
pub fn iso_days(date: &str) -> Option<i64> {
    let mut it = date.trim().split('-');
    let y: i32 = it.next()?.parse().ok()?;
    let m: u32 = it.next()?.parse().ok()?;
    let d: u32 = it.next()?.parse().ok()?;
    if it.next().is_some() || !(1..=12).contains(&m) || d == 0 || d > 31 {
        return None;
    }
    Some(days_from_civil(y, m, d))
}

// ─── Cron puro (5 campos, semântica Vixie para dom/dow) ─────

fn split_cron(cron: &str) -> Result<Vec<&str>, DomainError> {
    let parts: Vec<&str> = cron.split_whitespace().collect();
    if parts.len() != 5 {
        return Err(DomainError::InvalidInput(format!(
            "cron inválido (5 campos esperados: min hora dom mês dow): '{}'",
            cron.trim()
        )));
    }
    for (i, part) in parts.iter().enumerate() {
        if !field_is_valid(part, i == 4) {
            return Err(DomainError::InvalidInput(format!(
                "cron inválido (campo {} malformado): '{}'",
                i + 1,
                cron.trim()
            )));
        }
    }
    Ok(parts)
}

/// Syntactic check de um campo cron (lista, range, passo, literal, `*`).
fn field_is_valid(field: &str, weekday_field: bool) -> bool {
    let field = field.trim();
    if field.is_empty() {
        return false;
    }
    if field == "*" {
        return true;
    }
    if field.contains(',') {
        return field
            .split(',')
            .all(|p| field_is_valid(p.trim(), weekday_field));
    }
    let (base, step) = match field.split_once('/') {
        Some((b, s)) => {
            let step_ok = s.trim().parse::<u32>().map(|v| v > 0).unwrap_or(false);
            if !step_ok {
                return false;
            }
            (b, true)
        }
        None => (field, false),
    };
    if base == "*" {
        return true;
    }
    let _ = step;
    let (lo, hi) = match base.split_once('-') {
        Some((a, b)) => (a.trim(), Some(b.trim())),
        None => (base, None),
    };
    let parse = |s: &str| s.parse::<u32>().ok();
    let Some(lo_v) = parse(lo) else { return false };
    if weekday_field && lo_v > 7 {
        return false;
    }
    match hi {
        None => true,
        Some(hi) => parse(hi).is_some(),
    }
}

/// Casa valor com um campo, normalizando o alias de domingo `7 → 0`
/// (`weekday_field` habilita a normalização — só o campo dow aceita 7).
fn field_matches(field: &str, value: u32, weekday_field: bool) -> bool {
    let field = field.trim();
    if field == "*" {
        return true;
    }
    let norm = |v: u32| if weekday_field && v == 7 { 0 } else { v };
    let cur = norm(value);

    if field.contains(',') {
        return field
            .split(',')
            .any(|part| field_matches(part.trim(), value, weekday_field));
    }

    if let Some((base, step_str)) = field.split_once('/') {
        let Ok(step) = step_str.trim().parse::<u32>() else {
            return false;
        };
        if step == 0 {
            return false;
        }
        if base == "*" || base.is_empty() {
            return cur % step == 0;
        }
        if let Some((a, b)) = base.split_once('-') {
            let (Ok(a), Ok(b)) = (a.trim().parse::<u32>(), b.trim().parse::<u32>()) else {
                return false;
            };
            let (s, e) = (norm(a), norm(b));
            if s <= e && cur >= s && cur <= e {
                return (cur - s) % step == 0;
            }
            return false;
        }
        let Ok(start) = base.trim().parse::<u32>() else {
            return false;
        };
        let s = norm(start);
        return cur >= s && (cur - s) % step == 0;
    }

    if let Some((a, b)) = field.split_once('-') {
        let (Ok(a), Ok(b)) = (a.trim().parse::<u32>(), b.trim().parse::<u32>()) else {
            return false;
        };
        let (s, e) = (norm(a), norm(b));
        return s <= e && cur >= s && cur <= e;
    }

    match field.parse::<u32>() {
        Ok(v) => cur == norm(v),
        Err(_) => false,
    }
}

/// O cron casa com o **dia** `(mes, dia, weekday)`?
///
/// Semântica Vixie para `dom`/`dow`: se um dos dois é `*`, o outro decide;
/// se ambos restringem, vale a **união** (OR). `min`/`hora` são ignorados —
/// o hábito gera uma task por dia, não por horário.
pub fn matches_date(
    cron: &str,
    year: i32,
    month: u32,
    day: u32,
    weekday: u32,
) -> Result<bool, DomainError> {
    let parts = split_cron(cron)?;
    Ok(day_fields_match(&parts, year, month, day, weekday))
}

#[allow(clippy::too_many_arguments)]
fn day_fields_match(parts: &[&str], _year: i32, month: u32, day: u32, weekday: u32) -> bool {
    if !field_matches(parts[3], month, false) {
        return false;
    }
    let dom_star = parts[2] == "*";
    let dow_star = parts[4] == "*";
    let dom_ok = field_matches(parts[2], day, false);
    let dow_ok = field_matches(parts[4], weekday, true);
    match (dom_star, dow_star) {
        (true, true) => true,
        (true, false) => dow_ok,
        (false, true) => dom_ok,
        (false, false) => dom_ok || dow_ok,
    }
}

/// Ocorrências esperadas do cron entre dois dias-inclusive
/// (`days_from_civil`) — base do gráfico "estimado vs realizado" (Fase 5).
pub fn expected_occurrences(cron: &str, from_days: i64, to_days: i64) -> Result<u64, DomainError> {
    let parts = split_cron(cron)?;
    if to_days < from_days {
        return Ok(0);
    }
    let mut count = 0u64;
    for z in from_days..=to_days {
        let (y, m, d) = civil_from_days(z);
        if day_fields_match(&parts, y, m, d, weekday_from_days(z)) {
            count += 1;
        }
    }
    Ok(count)
}

/// Sequência de dias consecutivos com métrica.
///
/// * `dates_desc`: datas `YYYY-MM-DD` em ordem decrescente, sem duplicatas
///   (combinadas pelo serviço na query).
/// * `today`: data local de hoje.
/// * Aceita ainda não registrado hoje (conta até ontem); pulou ≥1 dia ⇒ 0.
pub fn compute_streak(dates_desc: &[String], today: &str) -> u64 {
    let Some(today_days) = iso_days(today) else {
        return 0;
    };
    let Some(first) = dates_desc.first().and_then(|d| iso_days(d)) else {
        return 0;
    };
    // Início: hoje (já registrou) ou ontem (sequência viva, pendente de hoje).
    let mut expected = if first == today_days {
        today_days
    } else if first + 1 == today_days {
        today_days - 1
    } else {
        return 0;
    };
    let mut streak = 0u64;
    for date in dates_desc {
        let Some(v) = iso_days(date) else { break };
        if v == expected {
            streak += 1;
            expected -= 1;
        } else {
            break;
        }
    }
    streak
}

/// Maior sequência já registrada (não precisa tocar hoje) — "maior streak"
/// do placar de Insights. Datas em ordem decrescente; datas inválidas são
/// ignoradas e duplicatas não contam duas vezes.
pub fn longest_streak(dates_desc: &[String]) -> u64 {
    let mut best = 0u64;
    let mut cur = 0u64;
    let mut prev: Option<i64> = None;
    for date in dates_desc {
        let Some(v) = iso_days(date) else { continue };
        if prev == Some(v) {
            continue; // duplicata
        }
        if prev == Some(v + 1) {
            cur += 1;
        } else {
            cur = 1;
        }
        prev = Some(v);
        if cur > best {
            best = cur;
        }
    }
    best
}
