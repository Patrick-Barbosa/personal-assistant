import { isValidWeekId, parseWeekId, weekIdFor } from "./isoWeek";
import type { KanbanTask, TaskLinks } from "../types";

/** Filtros locais da semana carregada; não alteram o estado persistido do backend. */
export type KanbanStatusFilter = "all" | "open" | "completed";

export interface KanbanFilters {
  query: string;
  today: boolean;
  overdue: boolean;
  habits: boolean;
  notes: boolean;
  entities: boolean;
  status: KanbanStatusFilter;
}

export const DEFAULT_KANBAN_FILTERS: KanbanFilters = {
  query: "",
  today: false,
  overdue: false,
  habits: false,
  notes: false,
  entities: false,
  status: "all",
};

export interface KanbanFilterChip {
  key: keyof KanbanFilters;
  label: string;
}

const BOOLEAN_FILTER_KEYS = ["today", "overdue", "habits", "notes", "entities"] as const;
type BooleanFilterKey = (typeof BOOLEAN_FILTER_KEYS)[number];

/** Normaliza dados de localStorage sem confiar no formato persistido. */
export function normalizeKanbanFilters(value: unknown): KanbanFilters {
  if (typeof value !== "object" || value === null) return { ...DEFAULT_KANBAN_FILTERS };
  const raw = value as Record<string, unknown>;
  const status =
    raw.status === "open" || raw.status === "completed" || raw.status === "all"
      ? raw.status
      : "all";
  const normalized: KanbanFilters = {
    query: typeof raw.query === "string" ? raw.query.slice(0, 200) : "",
    today: raw.today === true,
    overdue: raw.overdue === true,
    habits: raw.habits === true,
    notes: raw.notes === true,
    entities: raw.entities === true,
    status,
  };
  return normalized;
}

export function normalizeKanbanContext(value: unknown): {
  semana: string | null;
  tab: "board" | "insights";
  periodo: "semana" | "mes";
  filters: KanbanFilters;
} {
  if (typeof value !== "object" || value === null) {
    return {
      semana: null,
      tab: "board",
      periodo: "semana",
      filters: { ...DEFAULT_KANBAN_FILTERS },
    };
  }
  const raw = value as Record<string, unknown>;
  const rawWeek = raw.semana;
  const parsedWeek = typeof rawWeek === "string" ? parseWeekId(rawWeek) : null;
  return {
    semana: typeof rawWeek === "string" && parsedWeek && isValidWeekId(rawWeek) ? weekIdFor(parsedWeek[0], parsedWeek[1]) : null,
    tab: raw.tab === "insights" ? "insights" : "board",
    periodo: raw.periodo === "mes" ? "mes" : "semana",
    filters: normalizeKanbanFilters(raw.filters),
  };
}

export function hasActiveKanbanFilters(filters: KanbanFilters): boolean {
  return (
    filters.query.trim().length > 0 ||
    BOOLEAN_FILTER_KEYS.some((key) => filters[key]) ||
    filters.status !== "all"
  );
}

export function activeKanbanFilterChips(filters: KanbanFilters): KanbanFilterChip[] {
  const chips: KanbanFilterChip[] = [];
  if (filters.query.trim()) chips.push({ key: "query", label: `Busca: ${filters.query.trim()}` });
  if (filters.today) chips.push({ key: "today", label: "Vence hoje" });
  if (filters.overdue) chips.push({ key: "overdue", label: "Atrasadas" });
  if (filters.habits) chips.push({ key: "habits", label: "Hábitos" });
  if (filters.notes) chips.push({ key: "notes", label: "Com nota" });
  if (filters.entities) chips.push({ key: "entities", label: "Com entity" });
  if (filters.status === "open") chips.push({ key: "status", label: "Abertas" });
  if (filters.status === "completed") chips.push({ key: "status", label: "Concluídas" });
  return chips;
}

export function removeKanbanFilter(filters: KanbanFilters, key: KanbanFilterChip["key"]): KanbanFilters {
  if (key === "status") return { ...filters, status: "all" };
  if (key === "query") return { ...filters, query: "" };
  return { ...filters, [key]: false };
}

export function taskHasLinkedNote(task: KanbanTask, links?: TaskLinks): boolean {
  return Boolean(task.note_path || (links?.notes?.length ?? 0) > 0);
}

export function taskHasLinkedEntity(links?: TaskLinks): boolean {
  return (links?.entities?.length ?? 0) > 0;
}

export function localDateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

export function isTaskOverdue(task: KanbanTask, today: string): boolean {
  return task.task_column !== "done" && Boolean(task.due_date) && (task.due_date ?? "") < today;
}

export function isTaskDueToday(task: KanbanTask, today: string): boolean {
  return task.task_column !== "done" && task.due_date === today;
}

/** Aplica busca e filtros somente à semana atualmente carregada. */
export function filterKanbanTasks(
  tasks: KanbanTask[],
  linksByTask: ReadonlyMap<string, TaskLinks | undefined>,
  filters: KanbanFilters,
  today: string
): KanbanTask[] {
  const query = filters.query.trim().toLocaleLowerCase("pt-BR");
  return tasks.filter((task) => {
    if (query && !task.titulo.toLocaleLowerCase("pt-BR").includes(query)) return false;
    if (filters.today && !isTaskDueToday(task, today)) return false;
    if (filters.overdue && !isTaskOverdue(task, today)) return false;
    if (filters.habits && task.task_kind !== "habit") return false;
    const links = linksByTask.get(task.id);
    if (filters.notes && !taskHasLinkedNote(task, links)) return false;
    if (filters.entities && !taskHasLinkedEntity(links)) return false;
    if (filters.status === "open" && task.task_column === "done") return false;
    if (filters.status === "completed" && task.task_column !== "done") return false;
    return true;
  });
}

/**
 * Converte a posição visual de uma lista filtrada para o índice da lista
 * completa usada pelo backend. Cards ocultos por filtros não são removidos.
 */
export function backendDropIndex(
  fullColumn: KanbanTask[],
  visibleColumn: KanbanTask[],
  visualIndex: number,
  draggingId: string
): number {
  const others = fullColumn.filter((task) => task.id !== draggingId);
  const visibleOthers = visibleColumn.filter((task) => task.id !== draggingId);
  if (visibleOthers.length === 0) return others.length;
  const index = Math.max(0, Math.min(visualIndex, visibleOthers.length));
  const nextTask = visibleOthers[index];
  if (!nextTask) return others.length;
  const fullIndex = others.findIndex((task) => task.id === nextTask.id);
  return fullIndex >= 0 ? fullIndex : others.length;
}

/** Alterna um booleano de filtro sem tocar nos demais. */
export function toggleKanbanFilter(
  filters: KanbanFilters,
  key: BooleanFilterKey
): KanbanFilters {
  return { ...filters, [key]: !filters[key] };
}
