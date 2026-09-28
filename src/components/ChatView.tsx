import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { Message } from "../types";

interface Props {
  sessionId: string;
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

  async function send() {
    const content = draft.trim();
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
    <div className="flex h-full flex-col">
      <p className="flim-nav px-4 pt-3 text-[#141414]/50">Com contexto: tarefas, hábitos de hoje e notas.</p>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="text-sm text-[#141414]/50">Nenhuma mensagem ainda. Diga olá.</p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[75%] whitespace-pre-wrap rounded-[16px] border px-4 py-2 text-sm ${
                m.role === "user" ? "border-[#141414] bg-[#141414] text-[#ffffff]" : "border-[#d9d9d9] bg-[#ffffff] text-[#141414]"
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      {error && <p className="px-4 pb-1 text-sm text-red-600">{error}</p>}
      <div className="flex gap-2 border-t border-[#d9d9d9] bg-[#ffffff] p-3">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="ESCREVA SUA MENSAGEM…"
          className="flim-nav flex-1 rounded-[160px] border border-[#d9d9d9] bg-[#f5f5f5] px-5 py-2.5 text-[#141414] outline-none placeholder:text-[#141414]/40"
        />
        <button
          onClick={send}
          disabled={sending || !draft.trim()}
          className="flim-nav rounded-[8px] bg-[#141414] px-4 py-2 text-[#ffffff] disabled:opacity-40"
        >
          {sending ? "…" : "Enviar"}
        </button>
      </div>
    </div>
  );
}
