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

  useEffect(() => {
    setMessages([]);
    setError("");
    api
      .getMessages(sessionId)
      .then(setMessages)
      .catch((e) => setError(String(e.message ?? e)));
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
    try {
      const res = await api.sendChat(sessionId, content);
      setMessages((m) => [...m, res.user_message, res.assistant_message]);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-full flex-col bg-[#141414] text-[#ffffff]">
      <p className="flim-nav border-b border-[#ffffff]/10 px-4 py-2 text-[#ffffff]/50">
        Com contexto: tarefas, hábitos de hoje e notas.
      </p>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl space-y-4 p-4">
          {messages.length === 0 && (
            <div className="py-10 text-center">
              <span className="mx-auto mb-4 inline-block rounded-full bg-[#ffffff] p-2">
                <img src="/logo.png" alt="" className="h-10 w-10" />
              </span>
              <h2 className="text-[27px] font-bold leading-tight text-[#ffffff]">Converse com suas notas</h2>
              <p className="mx-auto mt-2 max-w-md text-[15px] leading-relaxed text-[#ffffff]/60">
                Pergunte sobre tarefas, hábitos e notas. A IA responde com o contexto da sua semana.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="rounded-[160px] border border-[#ffffff]/20 bg-transparent px-4 py-1.5 text-sm text-[#ffffff] hover:border-[#ffffff]/60"
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
                className={`whitespace-pre-wrap rounded-[16px] px-4 py-3 text-[15px] leading-relaxed ${
                  m.role === "user"
                    ? "max-w-[80%] bg-[#ffffff] text-[#141414]"
                    : "w-full bg-[#232323] text-[#ffffff]"
                }`}
              >
                {m.content}
              </div>
              {m.created_at && <span className="mt-1 text-[11px] text-[#ffffff]/40">{timeOf(m.created_at)}</span>}
            </div>
          ))}
          {sending && <p className="flim-nav text-[#ffffff]/40">Pensando…</p>}
          <div ref={bottomRef} />
        </div>
      </div>
      {error && <p className="px-4 pb-1 text-sm text-red-400">{error}</p>}
      <div className="border-t border-[#ffffff]/10 p-3">
        <div className="mx-auto flex max-w-2xl gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="PERGUNTE SOBRE SUA SEMANA…"
            className="flim-nav flex-1 rounded-[160px] border border-[#ffffff]/15 bg-[#232323] px-5 py-3 text-[#ffffff] outline-none placeholder:text-[#ffffff]/35"
          />
          <button
            onClick={() => send()}
            disabled={sending || !draft.trim()}
            className="flim-nav rounded-[8px] bg-[#ffffff] px-5 py-2 text-[#141414] disabled:opacity-40"
          >
            {sending ? "…" : "Enviar"}
          </button>
        </div>
      </div>
    </div>
  );
}
