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
  created_at: string;
  updated_at: string;
}

export type Board = Record<Column, Task[]>;
