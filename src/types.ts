export interface Session {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: number;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export type Column = "todo" | "doing" | "done";

export const COLUMNS: Column[] = ["todo", "doing", "done"];

export const COLUMN_LABELS: Record<Column, string> = {
  todo: "A fazer",
  doing: "Fazendo",
  done: "Feito",
};

export interface Task {
  id: string;
  titulo: string;
  column: Column;
  position: number;
  day_label: string | null;
  note_md: string;
  habit_id: string | null;
  categoria: string;
  created_at: string;
  updated_at: string;
}

export type Board = Record<Column, Task[]>;

export const DAY_LABELS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sab", "Dom"] as const;
export type DayLabel = (typeof DAY_LABELS)[number];

export const WEEK_PLACES = ["backlog", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab", "Dom", "done"] as const;
export type WeekPlace = (typeof WEEK_PLACES)[number];
export const TRAY = "agendar";
export type Place = WeekPlace | typeof TRAY;

export const CATEGORIES = [
  { id: "trabalho", label: "Trabalho", color: "#141414" },
  { id: "estudo", label: "Estudo", color: "#30a81d" },
  { id: "pessoal", label: "Pessoal", color: "#ff8400" },
  { id: "saude", label: "Saúde", color: "#21935b" },
  { id: "ideia", label: "Ideia", color: "#fecc33" },
] as const;

export function categoryColor(cat: string): string {
  return CATEGORIES.find((c) => c.id === cat)?.color ?? "#d9d9d9";
}

export function categoryLabel(cat: string): string {
  return CATEGORIES.find((c) => c.id === cat)?.label ?? cat;
}

export interface Habit {
  id: string;
  nome: string;
  tipo: "binary" | "numeric";
  unidade: string;
  meta: number;
  valor: number;
  created_at: string;
}

export interface DailyNote {
  data: string;
  conteudo: string;
  updated_at: string;
}

export interface Hoje {
  data: string;
  habits: Habit[];
  doing: Task[];
  nota: DailyNote | null;
}

export interface MetricaHabito {
  id: string;
  nome: string;
  tipo: string;
  unidade: string;
  meta: number;
  pct: number;
  streak: number;
  done_days: number;
}

export interface Metricas {
  semana: { inicio: string; fim: string };
  habitos: MetricaHabito[];
  serie: { data: string; feitos: number }[];
  geral: { media_pct: number; cheios: number };
  tarefas: { criadas: number; concluidas: number; carregadas: number; pct: number };
  notas: { total: number; diarias: number; tarefas: number };
  resumo: string | null;
}

export interface NotaTarefa {
  id: string;
  titulo: string;
  note_md: string;
  categoria: string;
  day_label: string | null;
  column: Column;
  updated_at: string;
}

export interface NotaDiaria {
  data: string;
  conteudo: string;
  updated_at: string;
}

export interface Notas {
  tarefas: NotaTarefa[];
  diarias: NotaDiaria[];
}
