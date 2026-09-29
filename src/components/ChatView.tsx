import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Mic, MicOff, Volume2, VolumeX } from "lucide-react";
import { api } from "../api";
import type { Message, NotaDiaria, NotaTarefa, Task } from "../types";

interface Props {
  sessionId: string | null;
  onCreated: (id: string) => void;
}

interface Ref {
  kind: "task" | "daily";
  id: string;
  title: string;
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

function speechText(md: string) {
  return md.replace(/```[\s\S]*?```/g, " código ").replace(/[#>*`]/g, "").replace(/\[(.*?)\]\(.*?\)/g, "$1").slice(0, 2000);
}

export default function ChatView({ sessionId, onCreated }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const typeTimer = useRef<number | null>(null);
  const [typingId, setTypingId] = useState<number | null>(null);
  const justCreated = useRef(false);
  const [listening, setListening] = useState(false);
  const recogRef = useRef<any>(null);
  const [speakingId, setSpeakingId] = useState<number | null>(null);
  const [refs, setRefs] = useState<Ref[]>([]);
  const [mention, setMention] = useState<{ char: "@" | "#"; query: string; hi: number } | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [diarias, setDiarias] = useState<NotaDiaria[]>([]);
  const [taskNotes, setTaskNotes] = useState<NotaTarefa[]>([]);

  function stopTyping() {
    if (typeTimer.current !== null) {
      window.clearTimeout(typeTimer.current);
      typeTimer.current = null;
    }
    setTypingId(null);
  }

  function stopSpeaking() {
    window.speechSynthesis?.cancel();
    setSpeakingId(null);
  }

  function typewriter(id: number, full: string) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setMessages((m) => m.map((x) => (x.id === id ? { ...x, content: full } : x)));
      return;
    }
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
    if (justCreated.current) {
      justCreated.current = false;
      return;
    }
    stopTyping();
    stopSpeaking();
    recogRef.current?.abort?.();
    setListening(false);
    setMessages([]);
    setRefs([]);
    setMention(null);
    setError("");
    if (!sessionId) return;
    api
      .getMessages(sessionId)
      .then(setMessages)
      .catch((e) => setError(String(e.message ?? e)));
    return () => {
      stopTyping();
      stopSpeaking();
    };
  }, [sessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send(text?: string) {
    const content = (text ?? draft).trim();
    if (!content || sending) return;
    setDraft("");
    setMention(null);
    const usedRefs = refs.filter((r) => content.includes((r.kind === "task" ? "@" : "#") + r.title));
    setRefs([]);
    setSending(true);
    setError("");
    const tempId = -Date.now();
    setMessages((m) => [...m, { id: tempId, session_id: sessionId ?? "draft", role: "user", content, created_at: new Date().toISOString() }]);
    try {
      let sid = sessionId;
      if (!sid) {
        const s = await api.createSession(content.slice(0, 48) || "Nova Conversa");
        sid = s.id;
        justCreated.current = true;
        onCreated(sid);
      }
      const res = await api.sendChat(sid, content, usedRefs.map((r) => ({ kind: r.kind, id: r.id })));
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

  function toggleListen() {
    if (listening) {
      recogRef.current?.stop?.();
      return;
    }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      setError("Voz não suportada neste navegador (use Chrome ou Edge).");
      return;
    }
    const rec = new SR();
    rec.lang = "pt-BR";
    rec.interimResults = false;
    rec.onresult = (e: any) => {
      const text = e.results?.[0]?.[0]?.transcript ?? "";
      if (text) setDraft((d) => (d ? d + " " : "") + text);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recogRef.current = rec;
    setListening(true);
    rec.start();
  }

  function toggleSpeak(m: Message) {
    if (speakingId === m.id) {
      stopSpeaking();
      return;
    }
    stopSpeaking();
    const u = new SpeechSynthesisUtterance(speechText(m.content));
    u.lang = "pt-BR";
    u.onend = () => setSpeakingId(null);
    setSpeakingId(m.id);
    window.speechSynthesis.speak(u);
  }

  async function ensureMentionData(char: "@" | "#") {
    if (char === "@" && tasks.length === 0) {
      try {
        const b = await api.getBoard();
        setTasks([...b.todo, ...b.doing, ...b.done]);
      } catch {
        /* offline: lista vazia */
      }
    }
    if (char === "#" && diarias.length === 0 && taskNotes.length === 0) {
      try {
        const n = await api.getNotas();
        setDiarias(n.diarias);
        setTaskNotes(n.tarefas);
      } catch {
        /* offline: lista vazia */
      }
    }
  }

  function onDraftChange(v: string) {
    setDraft(v);
    const m = v.match(/(^|\s)([@#])([^\s@#]*)$/);
    if (m) {
      const char = m[2] as "@" | "#";
      setMention((prev) => ({ char, query: m[3], hi: prev && prev.char === char ? Math.min(prev.hi, 6) : 0 }));
      ensureMentionData(char);
    } else {
      setMention(null);
    }
  }

  const candidates: Ref[] = (() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    if (mention.char === "@") {
      return tasks
        .filter((t) => t.titulo.toLowerCase().includes(q))
        .slice(0, 7)
        .map((t) => ({ kind: "task" as const, id: t.id, title: t.titulo }));
    }
    const days: Ref[] = diarias
      .filter((d) => d.data.includes(mention.query) || d.conteudo.toLowerCase().includes(q))
      .slice(0, 4)
      .map((d) => ({ kind: "daily" as const, id: d.data, title: d.data }));
    const notes: Ref[] = taskNotes
      .filter((t) => t.titulo.toLowerCase().includes(q))
      .slice(0, 3)
      .map((t) => ({ kind: "task" as const, id: t.id, title: t.titulo }));
    return [...days, ...notes].slice(0, 7);
  })();

  function pickMention(r: Ref) {
    const prefix = r.kind === "task" ? "@" : "#";
    setDraft((d) => d.replace(/(^|\s)([@#])[^\s@#]*$/, `$1${prefix}${r.title} `));
    setRefs((prev) => (prev.some((x) => x.id === r.id) ? prev : [...prev, r]));
    setMention(null);
  }

  function onInputKey(e: React.KeyboardEvent) {
    if (mention && candidates.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMention({ ...mention, hi: (mention.hi + 1) % candidates.length });
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMention({ ...mention, hi: (mention.hi - 1 + candidates.length) % candidates.length });
        return;
      }
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        pickMention(candidates[mention.hi] ?? candidates[0]);
        return;
      }
      if (e.key === "Escape") {
        setMention(null);
        return;
      }
    }
    if (e.key === "Enter") send();
  }

  return (
    <div
      className="flex h-full flex-col"
      style={{ background: "radial-gradient(ellipse 90% 75% at 50% 42%, rgba(20,20,20,0) 35%, rgba(20,20,20,0.30) 100%)" }}
    >
      <p className="flim-nav border-b border-[#d9d9d9] bg-[#ffffff]/85 px-4 py-2 text-[#141414]/50">
        Com contexto: tarefas, hábitos de hoje e notas. @ tarefa · # nota · 🎙 voz.
      </p>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl space-y-4 p-4" aria-live="polite">
          {messages.length === 0 && (
            <div className="py-10 text-center">
              <span className="mx-auto mb-4 inline-block rounded-full border border-[#d9d9d9] bg-[#ffffff] p-2">
                <img src="/logo.png" alt="Copernico" width={40} height={40} className="h-10 w-10" />
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
                    className="rounded-[160px] border border-[#d9d9d9] bg-[#ffffff] px-4 py-1.5 text-sm text-[#141414] transition-colors hover:border-[#141414]"
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
                className={`rounded-[16px] border px-4 py-3 text-[15px] leading-relaxed ${
                  m.role === "user"
                    ? "max-w-[80%] whitespace-pre-wrap border-[#141414] bg-[#141414] text-[#ffffff]"
                    : "w-full border-[#141414]/25 bg-[#ffffff] text-[#141414]"
                }`}
              >
                {m.role === "assistant" && typingId !== m.id ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content || "(…)"}</ReactMarkdown>
                ) : (
                  <>
                    <span className="whitespace-pre-wrap">{m.content}</span>
                    {typingId === m.id && <span className="typing-caret">▍</span>}
                  </>
                )}
              </div>
              <div className="mt-1 flex items-center gap-2">
                {m.created_at && <span className="text-[11px] text-[#141414]/50">{timeOf(m.created_at)}</span>}
                {m.role === "assistant" && m.id > 0 && (
                  <button
                    onClick={() => toggleSpeak(m)}
                    aria-label={speakingId === m.id ? "Parar leitura" : "Ouvir resposta"}
                    className="rounded-full p-1 text-[#141414]/40 transition-colors hover:text-[#141414]"
                  >
                    {speakingId === m.id ? <VolumeX size={14} /> : <Volume2 size={14} />}
                  </button>
                )}
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex flex-col items-start" aria-hidden="true">
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
      <div className="relative border-t border-[#d9d9d9] bg-[#ffffff]/85 p-3">
        <div className="mx-auto max-w-2xl">
          {mention && candidates.length > 0 && (
            <div className="absolute bottom-full left-1/2 mb-1 w-[min(560px,92vw)] -translate-x-1/2 rounded-[16px] border border-[#d9d9d9] bg-[#ffffff] p-1.5">
              {candidates.map((c, i) => (
                <button
                  key={c.kind + c.id}
                  onClick={() => pickMention(c)}
                  onMouseEnter={() => setMention({ ...mention, hi: i })}
                  className={`flex w-full items-center gap-2 rounded-[8px] px-3 py-1.5 text-left text-sm ${i === mention.hi ? "bg-[#141414] text-[#ffffff]" : "text-[#141414]"}`}
                >
                  <span className="flim-nav opacity-60">{c.kind === "task" ? "@" : "#"}</span>
                  <span className="truncate">{c.title}</span>
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={toggleListen}
              aria-label={listening ? "Parar ditado" : "Ditar mensagem"}
              title="Ditar (Chrome/Edge)"
              className={`shrink-0 rounded-[160px] border px-3 transition-colors ${listening ? "animate-pulse border-red-600 bg-red-600 text-[#ffffff]" : "border-[#141414]/25 bg-[#ffffff] text-[#141414] hover:border-[#141414]"}`}
            >
              {listening ? <MicOff size={16} /> : <Mic size={16} />}
            </button>
            <input
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              onKeyDown={onInputKey}
              placeholder="PERGUNTE, @TAREFA OU #NOTA…"
              aria-label="Escreva sua mensagem"
              autoComplete="off"
              className="flim-nav min-w-0 flex-1 rounded-[160px] border border-[#141414]/25 bg-[#ffffff] px-5 py-3 text-[#141414] outline-none transition-colors placeholder:text-[#141414]/40 focus:border-[#141414]"
            />
            <button
              onClick={() => send()}
              disabled={sending || !draft.trim()}
              className="flim-nav shrink-0 rounded-[8px] bg-[#141414] px-5 py-2 text-[#ffffff] transition-colors hover:bg-[#2a2a2a] disabled:opacity-40 disabled:hover:bg-[#141414]"
            >
              {sending ? "…" : "Enviar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
