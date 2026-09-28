import type { Board, Column, Message, Session, Task } from "./types";

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

  sendChat: (sessionId: string, content: string) =>
    request<{ user_message: Message; assistant_message: Message; updated_session_title: string | null }>(
      "POST",
      "/api/chat",
      { session_id: sessionId, content },
    ),

  getBoard: () => request<Board>("GET", "/api/board"),
  createTask: (titulo: string, column: Column = "todo") => request<Task>("POST", "/api/tasks", { titulo, column }),
  moveTask: (id: string, column: Column, index: number) =>
    request<Task>("POST", `/api/tasks/${id}/move`, { column, index }),
  updateTask: (id: string, titulo: string) => request<Task>("PATCH", `/api/tasks/${id}`, { titulo }),
  deleteTask: (id: string) => request<{ ok: boolean }>("DELETE", `/api/tasks/${id}`),
};
