import React from "react";
import { Search, Layers } from "lucide-react";
import { CopernicoSquircle } from "./icons/CopernicoSquircle";
import { useSessionStore } from "../stores/session-store";

export const EmptyChatState: React.FC = () => {
  const setInputText = useSessionStore((s) => s.setInputText);

  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center p-6 space-y-5 max-w-md mx-auto my-auto select-none">
      {/* Brand Centerpiece */}
      <div className="p-1 rounded-2xl bg-[var(--bg-card)]/80 border border-[var(--border-subtle)] shadow-xl shadow-black/30">
        <CopernicoSquircle size={56} />
      </div>

      <div>
        <h2 className="text-base font-semibold text-[var(--text-primary)] tracking-tight">
          Copernico — Second Brain
        </h2>
        <p className="text-xs text-[var(--text-muted)] mt-1 leading-relaxed">
          Assistente cognitivo local com busca semântica em cofres Markdown e
          ferramentas com IA.
        </p>
      </div>

      {/* Suggested Quick Prompts */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full pt-1">
        <button
          type="button"
          onClick={() => {
            setInputText("Quais anotações eu tenho sobre arquitetura?");
          }}
          className="p-3 rounded-xl bg-[var(--bg-card)]/60 hover:bg-[var(--bg-card)] border border-[var(--border-subtle)]/80 hover:border-amber-500/30 text-left transition-all group cursor-pointer"
        >
          <div className="flex items-center gap-2 font-medium text-xs text-[var(--text-secondary)] group-hover:text-amber-400">
            <Search size={13} className="text-amber-400 shrink-0" />
            <span>Buscar no cofre</span>
          </div>
          <span className="text-[11px] text-[var(--text-muted)] block mt-1 truncate">
            "Quais anotações tenho sobre..."
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            setInputText(
              "Crie uma nota sobre a reunião de hoje com decisões e próximos passos."
            );
          }}
          className="p-3 rounded-xl bg-[var(--bg-card)]/60 hover:bg-[var(--bg-card)] border border-[var(--border-subtle)]/80 hover:border-emerald-500/30 text-left transition-all group cursor-pointer"
        >
          <div className="flex items-center gap-2 font-medium text-xs text-[var(--text-secondary)] group-hover:text-emerald-400">
            <Layers size={13} className="text-emerald-400 shrink-0" />
            <span>Criar nota atômica</span>
          </div>
          <span className="text-[11px] text-[var(--text-muted)] block mt-1 truncate">
            "Crie uma nota sobre..."
          </span>
        </button>
      </div>
    </div>
  );
};
