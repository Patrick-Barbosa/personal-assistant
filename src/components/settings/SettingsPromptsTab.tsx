import React, { useState, useEffect } from "react";
import { Bot, RotateCcw, Check, User, Mic, Sparkles } from "lucide-react";
import { api } from "../../api";
import { useUiStore } from "../../stores/ui-store";

export const SettingsPromptsTab: React.FC = () => {
  const [promptTab, setPromptTab] = useState<"visual" | "voice" | "perfil">("visual");

  const [systemPrompt, setSystemPrompt] = useState("");
  const [voicePrompt, setVoicePrompt] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Profile state
  const [userName, setUserName] = useState("");
  const [userStyle, setUserStyle] = useState("direto_conciso");
  const [userHotkey, setUserHotkey] = useState("Ctrl+Space");
  const [customInstructions, setCustomInstructions] = useState("");

  useEffect(() => {
    api.getSystemPrompt().then(setSystemPrompt).catch(() => {});
    api.getVoiceSystemPrompt().then(setVoicePrompt).catch(() => {});
    api.getUserProfile().then((p) => {
      if (p) {
        setUserName(p.name || "");
        setUserStyle(p.communication_style || "direto_conciso");
        setUserHotkey(p.hotkey || "Ctrl+Space");
        setCustomInstructions(p.custom_instructions || "");
      }
    }).catch(() => {});
  }, []);

  const handleSavePrompt = async () => {
    setIsSaving(true);
    setFeedback(null);
    try {
      if (promptTab === "visual") {
        await api.setSystemPrompt(systemPrompt);
      } else if (promptTab === "voice") {
        await api.setVoiceSystemPrompt(voicePrompt);
      } else {
        await api.saveUserProfile(
          userName,
          userStyle,
          userHotkey,
          customInstructions
        );
      }
      setFeedback("Configurações salvas!");
      setTimeout(() => setFeedback(null), 2500);
    } catch {
      setFeedback("Erro ao salvar.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetPrompt = async () => {
    if (promptTab === "visual") {
      const def = await api.resetSystemPrompt();
      setSystemPrompt(def);
    } else if (promptTab === "voice") {
      const def = await api.resetVoiceSystemPrompt();
      setVoicePrompt(def);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <Bot size={16} className="text-amber-400" />
          <span>Diretrizes e Persona do Copernico</span>
        </h3>
        <p className="text-xs text-[var(--text-muted)] mt-1 leading-relaxed">
          Ajuste as instruções do agente DeepSeek para modo texto, modo voz ou preferências pessoais.
        </p>
      </div>

      {/* Sub-tabs switch */}
      <div className="flex items-center gap-1 p-1 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] w-fit">
        <button
          type="button"
          onClick={() => setPromptTab("visual")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            promptTab === "visual"
              ? "bg-amber-500/15 text-amber-300 border border-amber-500/30"
              : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          }`}
        >
          <Bot size={13} />
          <span>Prompt Visual (Chat)</span>
        </button>
        <button
          type="button"
          onClick={() => setPromptTab("voice")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            promptTab === "voice"
              ? "bg-amber-500/15 text-amber-300 border border-amber-500/30"
              : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          }`}
        >
          <Mic size={13} />
          <span>Prompt de Voz (TTS)</span>
        </button>
        <button
          type="button"
          onClick={() => setPromptTab("perfil")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            promptTab === "perfil"
              ? "bg-amber-500/15 text-amber-300 border border-amber-500/30"
              : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          }`}
        >
          <User size={13} />
          <span>Perfil & Aprendizado</span>
        </button>
      </div>

      {/* Content */}
      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)]/80 p-4 space-y-4">
        {promptTab === "visual" ? (
          <div className="space-y-2">
            <div className="flex justify-between items-center text-xs text-[var(--text-muted)]">
              <span>System prompt do modo texto com Markdown</span>
              <button
                type="button"
                onClick={handleResetPrompt}
                className="flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-amber-400 transition-colors"
              >
                <RotateCcw size={12} />
                <span>Restaurar padrão</span>
              </button>
            </div>
            <textarea
              rows={12}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] p-3 font-mono text-xs text-[var(--text-secondary)] leading-relaxed outline-none focus:border-amber-500/50 resize-y"
            />
          </div>
        ) : promptTab === "voice" ? (
          <div className="space-y-2">
            <div className="flex justify-between items-center text-xs text-[var(--text-muted)]">
              <span>System prompt falado (sem markdown, conciso, TTS puro)</span>
              <button
                type="button"
                onClick={handleResetPrompt}
                className="flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-amber-400 transition-colors"
              >
                <RotateCcw size={12} />
                <span>Restaurar padrão</span>
              </button>
            </div>
            <textarea
              rows={12}
              value={voicePrompt}
              onChange={(e) => setVoicePrompt(e.target.value)}
              className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] p-3 font-mono text-xs text-[var(--text-secondary)] leading-relaxed outline-none focus:border-amber-500/50 resize-y"
            />
          </div>
        ) : (
          <div className="space-y-3 text-xs">
            <div>
              <label className="block text-[var(--text-muted)] mb-1 font-medium">Seu Nome / Apelido</label>
              <input
                type="text"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                placeholder="Ex: Patrick"
                className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] px-3 py-2 text-[var(--text-primary)] outline-none focus:border-amber-500/50"
              />
            </div>

            <div>
              <label className="block text-[var(--text-muted)] mb-1 font-medium">Estilo de Comunicação</label>
              <select
                value={userStyle}
                onChange={(e) => setUserStyle(e.target.value)}
                className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] px-3 py-2 text-[var(--text-primary)] outline-none focus:border-amber-500/50 cursor-pointer"
              >
                <option value="direto_conciso">Direto & Sintético (Respostas rápidas, foco em produtividade)</option>
                <option value="tecnico_analitico">Técnico & Analítico (Raciocínio estruturado, métricas detalhadas)</option>
                <option value="amigavel_conversacional">Amigável & Conversacional (Tom empático e consultivo)</option>
              </select>
            </div>

            <div>
              <label className="block text-[var(--text-muted)] mb-1 font-medium">Instruções Customizadas Persistentes</label>
              <textarea
                rows={5}
                value={customInstructions}
                onChange={(e) => setCustomInstructions(e.target.value)}
                placeholder="Preferências que o agente deve sempre respeitar (ex: 'Sempre responda em português', 'Use formatação por tópicos')..."
                className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] p-3 text-[var(--text-secondary)] leading-relaxed outline-none focus:border-amber-500/50 resize-none font-mono text-[11px]"
              />
            </div>

            <div className="pt-3 border-t border-[var(--border-subtle)] flex items-center justify-between">
              <span className="text-[11px] text-[var(--text-muted)]">Quer refazer suas preferências e atalhos iniciais?</span>
              <button
                type="button"
                onClick={async () => {
                  await api.resetOnboarding();
                  useUiStore.getState().setSettingsModalOpen(false);
                  useUiStore.getState().setOnboardingOpen(true);
                }}
                className="px-3 py-1.5 rounded-xl border border-amber-500/40 text-amber-400 hover:bg-amber-500/10 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
              >
                <Sparkles size={13} />
                <span>Refazer Onboarding</span>
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between pt-2 border-t border-[var(--border-subtle)]">
          {feedback ? (
            <div className="flex items-center gap-1.5 text-xs text-emerald-400">
              <Check size={13} />
              <span>{feedback}</span>
            </div>
          ) : (
            <span />
          )}

          <button
            type="button"
            onClick={handleSavePrompt}
            disabled={isSaving}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-zinc-950 transition-all shadow-sm cursor-pointer disabled:opacity-50"
          >
            {isSaving ? "Salvando..." : "Salvar Alterações"}
          </button>
        </div>
      </div>
    </div>
  );
};
