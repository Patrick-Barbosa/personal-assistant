import React from "react";
import { Settings, Mic, Volume2, Cpu, PhoneCall } from "lucide-react";
import { useUiStore } from "../stores/ui-store";
import { useSessionStore } from "../stores/session-store";
import { useVoiceStore } from "../stores/voice-store";
import type { Session } from "../types";
import { Tooltip } from "./ui/tooltip";

export const AppHeader: React.FC = () => {
  const currentView = useUiStore((s) => s.currentView);
  const setSettingsModalOpen = useUiStore((s) => s.setSettingsModalOpen);
  const setVoiceSessionOpen = useUiStore((s) => s.setVoiceSessionOpen);
  const wakeStatus = useVoiceStore((s) => s.wakeStatus);
  const sessions = useSessionStore((s) => s.sessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  const title =
    currentView === "graph"
      ? "Grafo de Conhecimento"
      : currentView === "inbox"
      ? "Inbox do Agente & Tarefas"
      : currentView === "kanban"
      ? "Copernico"
      : activeSession?.title || (activeSession as Session & { titulo?: string } | undefined)?.titulo || "Nova Conversa";

  const renderVoiceBadge = () => {
    const isIdle = wakeStatus === "idle";

    let bgClass = "bg-amber-500/15 border-amber-500/30 text-[var(--text-accent)]";
    let dotClass = "bg-amber-400";
    let text = "Ouvindo...";
    let Icon = Mic;

    if (wakeStatus === "listening") {
      bgClass = "bg-sky-500/15 border-sky-500/30 text-[var(--text-info)]";
      dotClass = "bg-sky-400";
      text = "Sua vez...";
    } else if (wakeStatus === "processing") {
      bgClass = "bg-cyan-500/15 border-cyan-500/30 text-[var(--text-info)]";
      dotClass = "bg-cyan-400";
      text = "Pensando...";
      Icon = Cpu;
    } else if (wakeStatus === "speaking") {
      bgClass = "bg-emerald-500/15 border-emerald-500/30 text-[var(--text-success)]";
      dotClass = "bg-emerald-400";
      text = "Falando...";
      Icon = Volume2;
    }

    return (
      <div
        className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-xs font-medium backdrop-blur-md transition-opacity duration-150 ${isIdle ? "opacity-0" : "opacity-100"} ${bgClass}`}
        aria-hidden={isIdle}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />
        <Icon size={12} className="shrink-0" />
        <span>{text}</span>
      </div>
    );
  };

  return (
    <header className="h-12 border-b border-[var(--border-subtle)]/80 px-4 flex items-center justify-between bg-[var(--bg-card)]/40 shrink-0 z-20 select-none">
      {/* Left side: Voice badge or spacer */}
      <div className="w-36 flex items-center justify-start">
        {renderVoiceBadge()}
      </div>

      {/* Centered Title */}
      <div className="flex-1 flex justify-center items-center px-4">
        <h1 className="text-sm font-semibold text-[var(--text-primary)] truncate text-center max-w-md tracking-tight">
          {title}
        </h1>
      </div>

      {/* Right Actions */}
      <div className="w-36 flex items-center justify-end gap-1">
        <Tooltip content="Sessão de voz (conversar falando)">
          <button
            type="button"
            aria-label="Iniciar sessão de voz"
            onClick={() => setVoiceSessionOpen(true)}
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-emerald-300 hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
          >
            <PhoneCall size={15} />
          </button>
        </Tooltip>
        <Tooltip content="Configurações">
          <button
            type="button"
            aria-label="Abrir configurações"
            onClick={() => setSettingsModalOpen(true)}
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
          >
            <Settings size={15} />
          </button>
        </Tooltip>
      </div>
    </header>
  );
};
