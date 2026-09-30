import type { Board, Category, Column, DailyNote, Habit, Hoje, Message, Metricas, Notas, Session, Task } from "./types";

const BASE = "http://127.0.0.1:8000";

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const err = await res.json();
      if (err && typeof err.error === "string") detail = err.error;
    } catch {
      /* mantém detail padrão */
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

export const api = {
  listSessions: () => request<Session[]>("GET", "/api/sessions"),
  createSession: (title: string) => request<Session>("POST", "/api/sessions", { title }),
  deleteSession: (id: string) => request<{ ok: boolean }>("DELETE", `/api/sessions/${id}`),
  getMessages: (sessionId: string) => request<Message[]>("GET", `/api/sessions/${sessionId}/messages`),

  sendChat: (sessionId: string, content: string, refs?: { kind: string; id: string }[]) =>
    request<{ user_message: Message; assistant_message: Message; updated_session_title: string | null }>(
      "POST",
      "/api/chat",
      { session_id: sessionId, content, refs },
    ),

  transcribe: (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
      reader.onerror = () => reject(new Error("Falha ao ler áudio"));
      reader.readAsDataURL(blob);
    }).then((audio_b64) =>
      request<{ text: string }>("POST", "/api/stt", { audio_b64, mime: blob.type }).then((r) => r.text),
    ),

  getBoard: () => request<Board>("GET", "/api/board"),
  createTask: (titulo: string, column: Column = "todo") => request<Task>("POST", "/api/tasks", { titulo, column }),
  moveTask: (id: string, column: Column, index: number) =>
    request<Task>("POST", `/api/tasks/${id}/move`, { column, index }),
  placeTask: (id: string, dest: string, index: number) =>
    request<Task>("POST", `/api/tasks/${id}/place`, { dest, index }),
  updateTask: (id: string, patch: { titulo?: string; day_label?: string | null; note_md?: string; habit_id?: string | null; categoria?: string }) =>
    request<Task>("PATCH", `/api/tasks/${id}`, patch),
  deleteTask: (id: string) => request<{ ok: boolean }>("DELETE", `/api/tasks/${id}`),

  listHabits: (data?: string) => request<Habit[]>("GET", data ? `/api/habits?data=${data}` : "/api/habits"),
  createHabit: (nome: string, tipo: "binary" | "numeric" = "binary", unidade = "", meta = 0, dias = "") =>
    request<Habit>("POST", "/api/habits", { nome, tipo, unidade, meta, dias }),
  deleteHabit: (id: string) => request<{ ok: boolean }>("DELETE", `/api/habits/${id}`),
  checkHabit: (id: string, patch: { valor?: number; feito?: number }, data?: string) =>
    request<Habit>("POST", `/api/habits/${id}/check`, { ...patch, data }),
  updateHabit: (id: string, patch: { nome?: string; unidade?: string; meta?: number; dias?: string }) =>
    request<Habit>("PATCH", `/api/habits/${id}`, patch),
  listCategorias: () => request<Category[]>("GET", "/api/categorias"),
  createCategoria: (nome: string, cor = "#141414") =>
    request<Category>("POST", "/api/categorias", { nome, cor }),
  deleteCategoria: (id: string) => request<{ ok: boolean }>("DELETE", `/api/categorias/${id}`),
  organizarNotas: () => request<{ sugestoes: { id: string; categoria: string }[] }>("POST", "/api/notas/organizar", {}),
  getHoje: (data?: string) => request<Hoje>("GET", data ? `/api/hoje?data=${data}` : "/api/hoje"),
  saveNota: (conteudo: string, data?: string) =>
    request<DailyNote>("POST", "/api/hoje/nota", { conteudo, data }),
  getMetricas: (data?: string) => request<Metricas>("GET", data ? `/api/metricas?data=${data}` : "/api/metricas"),
  resumoSemana: (data?: string) => request<{ resumo: string }>("POST", "/api/metricas/resumo", { data }),
  getNotas: () => request<Notas>("GET", "/api/notas"),

  getAgent: () => request<{ persona: string; behavior: string; about_me: string; temperature: number }>("GET", "/api/agent"),
  saveAgent: (cfg: { persona: string; behavior: string; about_me: string; temperature: number }) =>
    request<{ persona: string; behavior: string; about_me: string; temperature: number }>("PATCH", "/api/agent", cfg),
};
