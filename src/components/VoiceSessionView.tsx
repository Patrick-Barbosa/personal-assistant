import React, { useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { motion } from "framer-motion";
import { PhoneOff, Loader2, AlertTriangle, Ear, Mic } from "lucide-react";
import { VoiceOrb } from "./VoiceOrb";
import { useVoiceSession } from "../hooks/useVoiceSession";
import type { VoicePhase } from "../hooks/useVoiceSession";
import type { useChatController } from "../hooks/useChatController";
import { useSessionStore } from "../stores/session-store";
import { useVoiceStore } from "../stores/voice-store";
import { useUiStore } from "../stores/ui-store";
import { MessageItem } from "./MessageItem";
import { CopernicoSun } from "./icons/CopernicoSun";

type Chat = ReturnType<typeof useChatController>;

const AURORA_TOKEN: Record<VoicePhase, string> = {
  listening: "--accent",
  processing: "--text-info",
  speaking: "--text-success",
  idle: "--text-muted",
};

/** Live input meter: transform-only bar, proves the mic is alive. */
const MicMeter: React.FC<{ levelRef: MutableRefObject<number>; active: boolean }> = ({
  levelRef,
  active,
}) => {
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      if (barRef.current) {
        const v = active ? Math.min(1, levelRef.current) : 0;
        barRef.current.style.transform = `scaleX(${v.toFixed(3)})`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [levelRef, active]);
  return (
    <div className="w-44 h-1 rounded-full bg-white/10 overflow-hidden">
      <div
        ref={barRef}
        className="h-full w-full origin-left rounded-full"
        style={{ transform: "scaleX(0)", background: "var(--text-accent)" }}
      />
    </div>
  );
};
const PHASE_LABEL: Record<VoicePhase, string> = {
  listening: "Sua vez — fale naturalmente",
  processing: "Pensando",
  speaking: "Copernico falando",
  idle: "Encerrada",
};

/**
 * Voice session: left = live intensity circle (user mic + AI voice),
 * right = full chat transcript (text, notes, tool calls). The agent runs
 * the same `/api/chat` pipeline, so tools work exactly like text chat.
 */
export const VoiceSessionView: React.FC<{ chat: Chat }> = ({ chat }) => {
  const messages = useSessionStore((s) => s.messages);
  const isLoading = useSessionStore((s) => s.isLoading);
  const speakingMessageId = useVoiceStore((s) => s.speakingMessageId);
  const setVoiceSessionOpen = useUiStore((s) => s.setVoiceSessionOpen);

  const scrollRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef(chat);
  chatRef.current = chat;

  const [turns, setTurns] = useState(0);
  const [caption, setCaption] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [dbg, setDbg] = useState("");
  const [orbSize, setOrbSize] = useState(280);
  const orbWrapRef = useRef<HTMLDivElement>(null);

  const truncate = (s: string) => (s.length > 140 ? `${s.slice(0, 140)}…` : s);

  const engine = useVoiceSession({
    onUserTurn: async (text) => {
      setTurns((t) => t + 1);
      setCaption(`Você: ${truncate(text)}`);
      await chatRef.current.sendMessage("voice", text);
      const all = useSessionStore.getState().messages;
      const lastAssistant = [...all].reverse().find((m) => m.role === "assistant");
      const reply = lastAssistant?.content?.trim() || null;
      if (reply) setCaption(`Copernico: ${truncate(reply.replace(/\s+/g, " "))}`);
      return reply;
    },
    onSpeakStart: () => {
      const all = useSessionStore.getState().messages;
      const lastAssistant = [...all].reverse().find((m) => m.role === "assistant");
      if (lastAssistant) useVoiceStore.getState().setSpeakingMessageId(lastAssistant.id);
    },
    onSpeakEnd: () => useVoiceStore.getState().setSpeakingMessageId(null),
  });
  const engineRef = useRef(engine);
  engineRef.current = engine;

  // Live diagnostic snapshot (4 Hz, cheap): shows exactly where a turn sticks.
  useEffect(() => {
    const id = window.setInterval(() => {
      try {
        setDbg(engineRef.current.getDebug());
      } catch {
        /* noop */
      }
    }, 250);
    return () => window.clearInterval(id);
  }, []);

  // Session clock.
  useEffect(() => {
    const id = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Spacebar = hold-to-talk (the view has no text inputs to conflict with).
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat) {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === "TEXTAREA" || tag === "INPUT") return;
        e.preventDefault();
        engineRef.current.holdStart();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") engineRef.current.holdEnd();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // Boot once per mount; full teardown on unmount.
  useEffect(() => {
    void engineRef.current.start();
    return () => engineRef.current.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Size the orb to its container with an explicit halo margin; fail safe.
  useEffect(() => {
    const el = orbWrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      const avail = Math.min(r.width, r.height);
      const next =
        avail < 176 ? 160 : Math.max(160, Math.min(340, Math.floor(avail - 16)));
      setOrbSize((prev) => (Math.abs(prev - next) > 4 ? next : prev));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Follow the transcript.
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isLoading]);

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  const wash = `var(${AURORA_TOKEN[engine.phase] ?? AURORA_TOKEN.idle})`;

  const handleExit = () => {
    engine.stop();
    setVoiceSessionOpen(false);
  };

  return (
    <div className="flex-1 flex flex-col min-[900px]:flex-row overflow-hidden">
      {/* Left: living stage */}
      <div className="w-full min-h-[300px] min-[900px]:w-[42%] min-[900px]:min-w-[320px] min-[900px]:min-h-0 flex flex-col overflow-hidden border-b min-[900px]:border-b-0 min-[900px]:border-r border-[var(--border-subtle)]/70 relative bg-[var(--bg-app)]">
        {/* Aurora field, tinted by phase */}
        <div aria-hidden className="absolute inset-0 pointer-events-none">
          <div
            className="absolute -top-28 -left-28 w-[26rem] h-[26rem] rounded-full blur-3xl transition-[background-color] duration-700"
            style={{ background: wash, opacity: 0.1 }}
          />
          <div
            className="absolute -bottom-36 -right-28 w-[30rem] h-[30rem] rounded-full blur-3xl transition-[background-color] duration-700"
            style={{ background: wash, opacity: 0.08 }}
          />
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                "linear-gradient(to bottom, transparent, transparent, color-mix(in srgb, var(--bg-app) 60%, transparent))",
            }}
          />
        </div>

        {/* Top row: session clock + turns + exit */}
        <div className="relative z-10 flex items-center justify-between px-5 pt-4">
          <div className="flex items-center gap-3 text-xs text-[var(--text-muted)] tabular-nums">
            <span className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10">{mm}:{ss}</span>
            <span>{turns === 1 ? "1 turno" : `${turns} turnos`}</span>
          </div>
          <button
            type="button"
            onClick={handleExit}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium text-rose-300 bg-rose-500/10 border border-rose-500/30 hover:bg-rose-500/20 transition-colors duration-200 cursor-pointer active:scale-95"
          >
            <PhoneOff size={14} />
            Encerrar
          </button>
        </div>

        {/* Orb — sized to available space so it never crops */}
        <div ref={orbWrapRef} className="relative z-10 flex-1 min-h-0 min-w-0 overflow-visible flex items-center justify-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.35, ease: [0.23, 1, 0.32, 1] }}
            className="w-full h-full flex items-center justify-center"
          >
            <VoiceOrb
              levelRef={engine.level}
              waveRef={engine.vizWave}
              phase={engine.phase}
              onTap={() => engineRef.current.forceSend()}
              size={orbSize}
            />
          </motion.div>
        </div>

        {/* Phase title with blur crossfade */}
        <div className="relative z-10 text-center px-6 min-h-[3.5rem]">
          <motion.p
            key={engine.phase}
            initial={{ opacity: 0, y: 8, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}
            className="text-lg font-semibold tracking-tight text-[var(--text-primary)]"
          >
            {PHASE_LABEL[engine.phase] ?? PHASE_LABEL.idle}
            {engine.phase === "listening" && engine.heard && (
              <span
                className="ml-2 inline-flex items-center gap-1 text-xs font-normal align-middle"
                style={{ color: "var(--text-accent)" }}
              >
                <Ear size={12} />
                ouvindo você
              </span>
            )}
          </motion.p>
          <motion.p
            key={`cap-${caption ?? "none"}`}
            aria-live="polite"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="text-xs text-[var(--text-muted)] truncate max-w-full mt-1"
          >
            {caption ?? engine.statusText}
          </motion.p>
          {engine.fatalError && (
            <p className="flex items-center justify-center gap-1.5 text-xs text-rose-400 pt-1">
              <AlertTriangle size={13} />
              {engine.fatalError}
            </p>
          )}
        </div>

        {/* Mic meter + hold-to-talk */}
        <div className="relative z-10 flex flex-col items-center gap-3 px-6 pb-6 pt-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">mic</span>
            <MicMeter levelRef={engine.level} active={engine.phase === "listening"} />
          </div>
          <p aria-hidden className="font-mono text-[10px] text-[var(--text-muted)]/70 tabular-nums">{dbg || "…"}</p>
          <button
            type="button"
            onPointerDown={(e) => {
              e.preventDefault();
              engineRef.current.holdStart();
            }}
            onPointerUp={() => engineRef.current.holdEnd()}
            onPointerLeave={() => engineRef.current.holdEnd()}
            onPointerCancel={() => engineRef.current.holdEnd()}
            onContextMenu={(e) => e.preventDefault()}
            className="flex items-center gap-2 px-5 py-2.5 rounded-2xl text-sm font-medium text-zinc-950 bg-[var(--accent)] hover:brightness-110 transition-all duration-150 cursor-pointer active:scale-95 select-none touch-none shadow-lg"
          >
            <Mic size={16} />
            Segure para falar
          </button>
          <p className="text-[11px] text-[var(--text-muted)] text-center">
            Solte para enviar • Espaço também funciona • Toque no orbe para enviar na hora
          </p>
        </div>
      </div>

      {/* Right: live transcript */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          {messages.length === 0 && !isLoading ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-center">
              <Loader2 size={20} className="animate-spin" style={{ color: "var(--text-accent)" }} />
              <p className="text-sm text-[var(--text-muted)]">Aguardando sua primeira fala…</p>
            </div>
          ) : (
            messages.map((msg) => (
              <MessageItem
                key={msg.id}
                message={msg}
                onEdit={chat.timeTravelEdit}
                onDelete={chat.deleteMessage}
                isSpeaking={speakingMessageId === msg.id}
                onSpeak={chat.speakMessage}
                onStopSpeak={chat.stopSpeak}
                onOpenNote={chat.openNoteInChat}
              />
            ))
          )}
          {isLoading && (
            <div className="flex items-center gap-3 px-4 py-2.5 bg-[var(--bg-card)]/80 rounded-xl border border-[var(--border-subtle)] w-fit">
              <div
                className="w-6 h-6 rounded-lg border flex items-center justify-center shrink-0"
                style={{
                  background: "color-mix(in srgb, var(--accent) 15%, transparent)",
                  borderColor: "color-mix(in srgb, var(--accent) 30%, transparent)",
                  color: "var(--text-accent)",
                }}
              >
                <CopernicoSun size={15} className="animate-spin" />
              </div>
              <span className="text-xs text-zinc-300">Consultando cofres e raciocinando…</span>
            </div>
          )}
          <div ref={scrollRef} />
        </div>
      </div>
    </div>
  );
};
