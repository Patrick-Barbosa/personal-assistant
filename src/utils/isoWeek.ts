/**
 * Semana ISO (segunda → domingo) — espelho civil puro do cálculo do backend.
 *
 * Sem dependências e sem `Date` fora da fronteira de parse/format, para que os
 * testes cubram a virada de ano ISO (ex.: 2020-12-28 → 2020-W53).
 */

const MS_PER_DAY = 86_400_000;

/** `2026-W39` → `[2026, 39]`; `null` se o formato for inválido. */
export function parseWeekId(id: string): [number, number] | null {
  const match = /^(\d{4})-W(\d{1,2})$/i.exec(id.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const week = Number(match[2]);
  if (!Number.isInteger(year) || week < 1 || week > 53) return null;
  return [year, week];
}

/** `(2026, 9)` → `"2026-W09"`. */
export function weekIdFor(year: number, week: number): string {
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** Datas em `YYYY-MM-DD` são interpretadas em fuso local (meia-noite local). */
function toLocalDate(isoDate: string): Date {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** Segunda-feira (0-based) do mesmo calendário. */
function mondayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

/** Id da semana ISO que contém `date`. */
export function isoWeekIdOf(date: Date): string {
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  // Quinta-feira da semana ISO — pertence sempre à semana correta.
  day.setDate(day.getDate() - mondayIndex(day) + 3);

  const isoYear = day.getFullYear();
  const jan4 = new Date(isoYear, 0, 4);
  const week1Monday = new Date(isoYear, 0, 4 - mondayIndex(jan4));
  const week =
    Math.round((day.getTime() - week1Monday.getTime()) / MS_PER_DAY / 7) + 1;
  return weekIdFor(isoYear, week);
}

/** Id da semana ISO que contém `YYYY-MM-DD`. */
export function isoWeekIdOfDate(isoDate: string): string {
  return isoWeekIdOf(toLocalDate(isoDate));
}

/** Desloca `2026-W39` em `delta` semanas (aceita virada de ano). */
export function shiftWeekId(id: string, delta: number): string {
  const parsed = parseWeekId(id);
  if (!parsed) return id;
  const [year, week] = parsed;
  const jan4 = new Date(year, 0, 4);
  const week1Monday = new Date(year, 0, 4 - mondayIndex(jan4));
  const target = new Date(week1Monday);
  target.setDate(week1Monday.getDate() + (week - 1) * 7 + delta * 7);
  return isoWeekIdOf(target);
}

/** Verifica se o id representa uma semana ISO existente, não apenas o formato. */
export function isValidWeekId(id: string): boolean {
  const parsed = parseWeekId(id);
  if (!parsed) return false;
  const [year, week] = parsed;
  const jan4 = new Date(year, 0, 4);
  const week1Monday = new Date(year, 0, 4 - mondayIndex(jan4));
  const start = new Date(week1Monday);
  start.setDate(week1Monday.getDate() + (week - 1) * 7);
  return isoWeekIdOf(start) === weekIdFor(year, week);
}

/** `2026-W39` → `39`. */
export function isoWeekNumber(id: string): number | null {
  return parseWeekId(id)?.[1] ?? null;
}

/** `YYYY-MM-DD` → `24 set` (pt-BR, sem depender de `Intl` do runtime). */
export function formatShortDate(isoDate: string): string {
  const months = [
    "jan",
    "fev",
    "mar",
    "abr",
    "mai",
    "jun",
    "jul",
    "ago",
    "set",
    "out",
    "nov",
    "dez",
  ];
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  return `${String(d).padStart(2, "0")} ${months[m - 1]}`;
}
