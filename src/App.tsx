import { useCallback, useEffect, useState } from "react";
import { Settings } from "lucide-react";
import { api } from "./api";
import type { Board, Session } from "./types";
import AgentConfig from "./components/AgentConfig";
import BoardView from "./components/BoardView";
import ChatView from "./components/ChatView";
import HojeView from "./components/HojeView";
import MetricasView from "./components/MetricasView";
import NotasView from "./components/NotasView";

type View = "hoje" | "chat" | "board" | "metricas" | "notas";

const EMPTY_BOARD: Board = { todo: [], doing: [], done: [] };

const TABS: { id: View; label: string }[] = [
  { id: "hoje", label: "Hoje" },
  { id: "chat", label: "Chat" },
  { id: "board", label: "Semana" },
  { id: "notas", label: "Notas" },
  { id: "metricas", label: "Métricas" },
];

export default function App() {
  const [view, setView] = useState<View>("hoje");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [board, setBoard] = useState<Board>(EMPTY_BOARD);
  const [creating, setCreating] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);

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

  function newSession() {
    setActiveId(null);
    setView("chat");
  }

  async function handleChatCreated(id: string) {
    const list = await refreshSessions();
    setSessions(list);
    setActiveId(id);
  }

  async function planWithAI() {
    const s = await api.createSession("Plano da semana");
    const list = await refreshSessions();
    setSessions(list);
    setActiveId(s.id);
    setView("chat");
  }

  async function removeSession(id: string) {
    await api.deleteSession(id);
    const list = await refreshSessions();
    setSessions(list);
    if (activeId === id) setActiveId(list.length > 0 ? list[0].id : null);
  }

  return (
    <div className="flex h-screen text-[#141414]">
      <aside className="flex w-60 flex-col border-r border-[#d9d9d9] bg-[#ffffff]">
        <div className="flex items-center gap-2 border-b border-[#d9d9d9] p-3">
          <img src="/logo.png" alt="Tiba" width={28} height={28} className="h-7 w-7" />
          <span className="flim-nav font-bold">Tiba</span>
          <span className="ml-auto h-2 w-2 rounded-full bg-[#141414]" title="online" />
        </div>
        <nav className="flex flex-col gap-1 p-3">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setView(t.id)}
              className={`flim-nav rounded-[8px] px-3 py-2 text-left transition-colors ${
                view === t.id ? "bg-[#141414] text-[#ffffff]" : "text-[#141414] hover:bg-[#e9e9e9]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {view === "chat" && (
          <>
            <button
              onClick={newSession}
              className="flim-nav mx-3 mb-2 rounded-[8px] bg-[#141414] px-3 py-2 text-[#ffffff] transition-colors hover:bg-[#2a2a2a]"
            >
              + Nova conversa
            </button>
            <div className="flex-1 space-y-1 overflow-y-auto px-3 pb-3">
              {sessions.map((s) => (
                <div
                  key={s.id}
                  onClick={() => setActiveId(s.id)}
                  className={`group flex cursor-pointer items-center gap-1 rounded-[8px] border px-3 py-2 text-sm ${
                    s.id === activeId
                      ? "border-[#141414] bg-[#f5f5f5] text-[#141414]"
                      : "border-transparent text-[#141414] hover:bg-[#e9e9e9]"
                  }`}
                >
                  <span className="flex-1 truncate">{s.title}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeSession(s.id);
                    }}
                    aria-label={`Excluir conversa ${s.title}`}
                    className="hidden text-[#141414]/40 transition-colors hover:text-red-600 group-hover:block"
                    title="Excluir conversa"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
        <div className="mt-auto border-t border-[#d9d9d9] p-3">
          <button
            onClick={() => setAgentOpen(true)}
            className="flim-nav flex w-full items-center gap-2 rounded-[8px] px-3 py-2 text-left text-[#141414] transition-colors hover:bg-[#e9e9e9]"
          >
            <Settings size={16} />
            Configurar IA
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-hidden">
        {view === "hoje" ? (
          <HojeView onTasksChanged={refreshBoard} />
        ) : view === "metricas" ? (
          <MetricasView />
        ) : view === "notas" ? (
          <NotasView board={board} refresh={refreshBoard} />
        ) : view === "chat" ? (
          <ChatView sessionId={activeId} onCreated={handleChatCreated} onChanged={() => { refreshBoard().catch(() => {}); }} />
        ) : (
          <BoardView board={board} refresh={refreshBoard} onPlanWithAI={planWithAI} />
        )}
      </main>
      <AgentConfig open={agentOpen} onClose={() => setAgentOpen(false)} />
    </div>
  );
}
