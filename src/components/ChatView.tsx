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
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="text-sm text-zinc-500">Nenhuma mensagem ainda. Diga olá.</p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[75%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm ${
                m.role === "user" ? "bg-blue-600 text-white" : "bg-zinc-800 text-zinc-100"
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      {error && <p className="px-4 pb-1 text-sm text-red-400">{error}</p>}
      <div className="flex gap-2 border-t border-zinc-800 p-3">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Escreva sua mensagem…"
          className="flex-1 rounded-xl bg-zinc-800 px-4 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:ring-1 focus:ring-blue-600"
        />
        <button
          onClick={send}
          disabled={sending || !draft.trim()}
          className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          {sending ? "…" : "Enviar"}
        </button>
      </div>
    </div>
  );
}
