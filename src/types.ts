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
  created_at: string;
  updated_at: string;
}

export type Board = Record<Column, Task[]>;

export const DAY_LABELS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sab", "Dom"] as const;
export type DayLabel = (typeof DAY_LABELS)[number];

export interface Habit {
  id: string;
  nome: string;
  tipo: "binary" | "numeric";
  unidade: string;
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
