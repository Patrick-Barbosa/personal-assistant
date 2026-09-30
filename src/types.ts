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

export interface Category {
  id: string;
  nome: string;
  cor: string;
}

export const CATEGORIES = [
  { id: "trabalho", label: "Trabalho", color: "#141414" },
  { id: "estudo", label: "Estudo", color: "#5c5c5c" },
  { id: "pessoal", label: "Pessoal", color: "#ff8400" },
  { id: "saude", label: "Saúde", color: "#8a8a8a" },
  { id: "ideia", label: "Ideia", color: "#fecc33" },
  { id: "habitos", label: "Hábitos", color: "#141414" },
] as const;

export function categoryColor(cat: string, cats?: Category[]): string {
  const found = cats?.find((c) => c.id === cat);
  if (found) return found.cor;
  return CATEGORIES.find((c) => c.id === cat)?.color ?? "#d9d9d9";
}

export function categoryLabel(cat: string, cats?: Category[]): string {
  const found = cats?.find((c) => c.id === cat);
  if (found) return found.nome;
  return CATEGORIES.find((c) => c.id === cat)?.label ?? cat;
}

export const CATEGORY_COLORS = ["#141414", "#5c5c5c", "#8a8a8a", "#ff8400", "#fecc33", "#d9d9d9"];

export interface Habit {
  id: string;
  nome: string;
  tipo: "binary" | "numeric";
  unidade: string;
  meta: number;
  dias: string;
  valor: number;
  feito: number;
  escudo_ganho?: boolean;
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
  planned_days: number;
  dias: boolean[];
  planejados: boolean[];
  extras: string[];
  marco: number | null;
  protegidas: string[];
}

export interface Historico {
  semanas: { inicio: string; fim: string; rotulo: string }[];
  series: { id: string; nome: string; pct: (number | null)[] }[];
}

export interface Metricas {
  semana: { inicio: string; fim: string };
  habitos: MetricaHabito[];
  serie: { data: string; feitos: number }[];
  historico: Historico;
  geral: { media_pct: number; cheios: number };
  tarefas: { criadas: number; concluidas: number; carregadas: number; pct: number };
  notas: { total: number; diarias: number; tarefas: number };
  resumo: string | null;
  escudos: number;
  hoje_pendente: { id: string; nome: string; streak: number }[];
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
