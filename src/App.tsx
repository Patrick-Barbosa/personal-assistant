import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import type { Board, Session } from "./types";
import BoardView from "./components/BoardView";
import ChatView from "./components/ChatView";
import HojeView from "./components/HojeView";

type View = "hoje" | "chat" | "board";

const EMPTY_BOARD: Board = { todo: [], doing: [], done: [] };

export default function App() {
  const [view, setView] = useState<View>("hoje");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [board, setBoard] = useState<Board>(EMPTY_BOARD);

  const refreshSessions = useCallback(async () => {
    const list = await api.listSessions();
    setSessions(list);
    return list;
  }, []);

  const refreshBoard = useCallback(async () => {
    setBoard(await api.getBoard());
  }, []);

  useEffect(() => {
    refreshSessions()
      .then((list) => {
        if (list.length > 0) setActiveId(list[0].id);
      })
      .catch(() => {});
    refreshBoard().catch(() => {});
  }, [refreshSessions, refreshBoard]);

  async function newSession() {
    const s = await api.createSession("Nova Conversa");
    const list = await refreshSessions();
    setSessions(list);
    setActiveId(s.id);
  }

  async function removeSession(id: string) {
    await api.deleteSession(id);
    const list = await refreshSessions();
    setSessions(list);
    if (activeId === id) setActiveId(list.length > 0 ? list[0].id : null);
  }

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100">
      <aside className="flex w-60 flex-col border-r border-zinc-800">
        <div className="flex gap-2 p-3">
          <button
            onClick={() => setView("hoje")}
            className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-semibold ${
              view === "hoje" ? "bg-blue-600 text-white" : "bg-zinc-800 text-zinc-400"
            }`}
          >
            Hoje
          </button>
          <button
            onClick={() => setView("chat")}
            className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-semibold ${
              view === "chat" ? "bg-blue-600 text-white" : "bg-zinc-800 text-zinc-400"
            }`}
          >
            Chat
          </button>
          <button
            onClick={() => setView("board")}
            className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-semibold ${
              view === "board" ? "bg-blue-600 text-white" : "bg-zinc-800 text-zinc-400"
            }`}
          >
            Semana
          </button>
        </div>

        {view === "chat" && (
          <>
            <button
              onClick={newSession}
              className="mx-3 mb-2 rounded-lg bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-700"
            >
              + Nova conversa
            </button>
            <div className="flex-1 space-y-1 overflow-y-auto px-3 pb-3">
              {sessions.map((s) => (
                <div
                  key={s.id}
                  onClick={() => setActiveId(s.id)}
                  className={`group flex cursor-pointer items-center gap-1 rounded-lg px-3 py-2 text-sm ${
                    s.id === activeId ? "bg-zinc-800 text-white" : "text-zinc-400 hover:bg-zinc-900"
                  }`}
                >
                  <span className="flex-1 truncate">{s.title}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeSession(s.id);
                    }}
                    className="hidden text-zinc-600 hover:text-red-400 group-hover:block"
                    title="Excluir conversa"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </aside>

      <main className="flex-1 overflow-hidden">
        {view === "hoje" ? (
          <HojeView onTasksChanged={refreshBoard} />
        ) : view === "chat" ? (
          activeId ? (
            <ChatView key={activeId} sessionId={activeId} />
          ) : (
            <div className="flex h-full items-center justify-center">
              <button onClick={newSession} className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white">
                Criar primeira conversa
              </button>
            </div>
          )
        ) : (
          <BoardView board={board} refresh={refreshBoard} />
        )}
      </main>
    </div>
  );
}
