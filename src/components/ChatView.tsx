import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { Message } from "../types";

interface Props {
  sessionId: string;
}

const SUGGESTIONS = [
  "O que está pendente esta semana?",
  "Resuma minhas notas recentes",
  "Planeje minha semana no backlog",
];

function timeOf(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export default function ChatView({ sessionId }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const typeTimer = useRef<number | null>(null);
  const [typingId, setTypingId] = useState<number | null>(null);

  function stopTyping() {
    if (typeTimer.current !== null) {
      window.clearTimeout(typeTimer.current);
      typeTimer.current = null;
    }
    setTypingId(null);
  }

  function typewriter(id: number, full: string) {
    stopTyping();
    setTypingId(id);
    let i = 0;
    const tick = () => {
      i += 1 + (Math.random() < 0.25 ? 1 : 0);
      if (i > full.length) i = full.length;
      const shown = full.slice(0, i);
      setMessages((m) => m.map((x) => (x.id === id ? { ...x, content: shown } : x)));
      if (i >= full.length) {
        stopTyping();
        return;
      }
      const last = full[i - 1] ?? "";
      let d = 18 + Math.random() * 46;
      if (".?!…\n".includes(last)) d += 260 + Math.random() * 220;
      else if (",;:—–".includes(last)) d += 100 + Math.random() * 120;
      else if (last === " ") d += Math.random() * 30;
      typeTimer.current = window.setTimeout(tick, d);
    };
    typeTimer.current = window.setTimeout(tick, 150);
  }

  useEffect(() => {
    stopTyping();
    setMessages([]);
    setError("");
    api
      .getMessages(sessionId)
      .then(setMessages)
      .catch((e) => setError(String(e.message ?? e)));
    return stopTyping;
  }, [sessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send(text?: string) {
    const content = (text ?? draft).trim();
    if (!content || sending) return;
    setDraft("");
    setSending(true);
    setError("");
    const tempId = -Date.now();
    setMessages((m) => [...m, { id: tempId, session_id: sessionId, role: "user", content, created_at: new Date().toISOString() }]);
    try {
      const res = await api.sendChat(sessionId, content);
      const full = res.assistant_message.content;
      setMessages((m) => [
        ...m.filter((x) => x.id !== tempId),
        res.user_message,
        { ...res.assistant_message, content: "" },
      ]);
      setSending(false);
      typewriter(res.assistant_message.id, full);
    } catch (e) {
      setMessages((m) => m.filter((x) => x.id !== tempId));
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      className="flex h-full flex-col"
      style={{ background: "radial-gradient(ellipse 90% 75% at 50% 42%, rgba(20,20,20,0) 35%, rgba(20,20,20,0.30) 100%)" }}
    >
      <p className="flim-nav border-b border-[#d9d9d9] bg-[#ffffff]/85 px-4 py-2 text-[#141414]/50">
        Com contexto: tarefas, hábitos de hoje e notas.
      </p>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl space-y-4 p-4">
          {messages.length === 0 && (
            <div className="py-10 text-center">
              <span className="mx-auto mb-4 inline-block rounded-full border border-[#d9d9d9] bg-[#ffffff] p-2">
                <img src="/logo.png" alt="" className="h-10 w-10" />
              </span>
              <h2 className="text-[27px] font-bold leading-tight text-[#141414]">Converse com suas notas</h2>
              <p className="mx-auto mt-2 max-w-md text-[15px] leading-relaxed text-[#141414]/60">
                Pergunte sobre tarefas, hábitos e notas. A IA responde com o contexto da sua semana.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="rounded-[160px] border border-[#d9d9d9] bg-[#ffffff] px-4 py-1.5 text-sm text-[#141414] hover:border-[#141414]"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}>
              <div
                className={`whitespace-pre-wrap rounded-[16px] border px-4 py-3 text-[15px] leading-relaxed ${
                  m.role === "user"
                    ? "max-w-[80%] border-[#141414] bg-[#141414] text-[#ffffff]"
                    : "w-full border-[#141414]/25 bg-[#ffffff] text-[#141414]"
                }`}
              >
                {m.content}
                {typingId === m.id && <span className="typing-caret">▍</span>}
              </div>
              {m.created_at && <span className="mt-1 text-[11px] text-[#141414]/50">{timeOf(m.created_at)}</span>}
            </div>
          ))}
          {sending && (
            <div className="flex flex-col items-start">
              <div className="flex items-center gap-1.5 rounded-[16px] border border-[#141414]/25 bg-[#ffffff] px-4 py-3.5">
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span className="typing-dot" />
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>
      {error && <p className="bg-[#ffffff]/85 px-4 pb-1 text-sm text-red-600">{error}</p>}
      <div className="border-t border-[#d9d9d9] bg-[#ffffff]/85 p-3">
        <div className="mx-auto flex max-w-2xl gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="PERGUNTE SOBRE SUA SEMANA…"
            className="flim-nav flex-1 rounded-[160px] border border-[#141414]/25 bg-[#ffffff] px-5 py-3 text-[#141414] outline-none transition-colors placeholder:text-[#141414]/40 focus:border-[#141414]"
          />
          <button
            onClick={() => send()}
            disabled={sending || !draft.trim()}
            className="flim-nav rounded-[8px] bg-[#141414] px-5 py-2 text-[#ffffff] transition-colors hover:bg-[#2a2a2a] disabled:opacity-40 disabled:hover:bg-[#141414]"
          >
            {sending ? "…" : "Enviar"}
          </button>
        </div>
      </div>
    </div>
  );
}
