import React, { useState, useEffect } from "react";
import { KeyRound, Eye, EyeOff, Check, ExternalLink, ShieldCheck, Cpu, Mic } from "lucide-react";
import { api } from "../../api";

export const SettingsApiKeysTab: React.FC = () => {
  const [deepseekKey, setDeepseekKey] = useState("");
  const [groqKey, setGroqKey] = useState("");
  const [showDeepseek, setShowDeepseek] = useState(false);
  const [showGroq, setShowGroq] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    api.getApiKeys().then((keys) => {
      if (keys) {
        setDeepseekKey(keys.deepseek_api_key || "");
        setGroqKey(keys.groq_api_key || "");
      }
    }).catch(() => {});
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    setFeedback(null);
    try {
      await api.saveApiKeys(deepseekKey.trim(), groqKey.trim());
      setFeedback("Chaves de API salvas com sucesso!");
      setTimeout(() => setFeedback(null), 3000);
    } catch {
      setFeedback("Erro ao salvar chaves de API.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6 select-none animate-in fade-in duration-150">
      {/* Header Info */}
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-xs font-semibold text-amber-400 uppercase tracking-wider">
          <KeyRound size={14} />
          <span>Configuração de Provedores de Inteligência</span>
        </div>
        <h3 className="text-base font-bold text-[var(--text-primary)]">
          Chaves de API Locais (DeepSeek & Groq)
        </h3>
        <p className="text-xs text-[var(--text-muted)] leading-relaxed">
          Forneça suas chaves de API pessoais. Elas são salvas localmente no seu banco de dados SQLite criptografado/protegido no dispositivo e têm precedência sobre o arquivo <code className="font-mono text-amber-300 bg-amber-500/10 px-1 py-0.5 rounded">.env</code>.
        </p>
      </div>

      {/* Security Note */}
      <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/25 flex items-start gap-3">
        <ShieldCheck size={18} className="text-amber-400 shrink-0 mt-0.5" />
        <div className="text-xs text-amber-200/90 leading-relaxed">
          <span className="font-bold text-amber-300">Privacidade em Primeiro Lugar:</span> Suas chaves nunca saem da sua máquina para servidores terceiros. Elas são usadas exclusivamente para requisições diretas de HTTPS TLS para a API da DeepSeek (agente) e da Groq (transcrição Whisper).
        </div>
      </div>

      {/* DeepSeek API Key Input */}
      <div className="space-y-2 p-4 rounded-2xl bg-white/[0.02] border border-[var(--border-subtle)]">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-2">
            <Cpu size={15} className="text-amber-400" />
            <span>DeepSeek API Key (Agente Raciocinador)</span>
          </label>
          <a
            href="https://platform.deepseek.com/api_keys"
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-amber-400 hover:text-amber-300 flex items-center gap-1 font-medium transition-colors"
          >
            <span>Obter Chave na DeepSeek</span>
            <ExternalLink size={12} />
          </a>
        </div>
        <p className="text-[11px] text-[var(--text-muted)]">
          Necessária para o raciocinador ReAct, busca em notas, skills e conversação geral.
        </p>

        <div className="relative pt-1">
          <input
            type={showDeepseek ? "text" : "password"}
            value={deepseekKey}
            onChange={(e) => setDeepseekKey(e.target.value)}
            placeholder="sk-..."
            className="w-full pl-3.5 pr-10 py-2.5 rounded-xl bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-amber-500/60 text-xs font-mono text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none transition-all"
          />
          <button
            type="button"
            onClick={() => setShowDeepseek(!showDeepseek)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors p-1 cursor-pointer"
            title={showDeepseek ? "Ocultar Chave" : "Mostrar Chave"}
          >
            {showDeepseek ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      </div>

      {/* Groq API Key Input */}
      <div className="space-y-2 p-4 rounded-2xl bg-white/[0.02] border border-[var(--border-subtle)]">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-2">
            <Mic size={15} className="text-cyan-400" />
            <span>Groq API Key (Voz & Whisper STT)</span>
          </label>
          <a
            href="https://console.groq.com/keys"
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-medium transition-colors"
          >
            <span>Obter Chave no Groq Console</span>
            <ExternalLink size={12} />
          </a>
        </div>
        <p className="text-[11px] text-[var(--text-muted)]">
          Necessária para a transcrição ultra-rápida de voz via modelo Whisper Large v3.
        </p>

        <div className="relative pt-1">
          <input
            type={showGroq ? "text" : "password"}
            value={groqKey}
            onChange={(e) => setGroqKey(e.target.value)}
            placeholder="gsk_..."
            className="w-full pl-3.5 pr-10 py-2.5 rounded-xl bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-cyan-500/60 text-xs font-mono text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none transition-all"
          />
          <button
            type="button"
            onClick={() => setShowGroq(!showGroq)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors p-1 cursor-pointer"
            title={showGroq ? "Ocultar Chave" : "Mostrar Chave"}
          >
            {showGroq ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      </div>

      {/* Action Bar */}
      <div className="pt-3 border-t border-[var(--border-subtle)] flex items-center justify-between">
        {feedback ? (
          <span className="text-xs text-emerald-400 font-medium flex items-center gap-1.5 animate-fade-in">
            <Check size={14} />
            <span>{feedback}</span>
          </span>
        ) : (
          <span className="text-[11px] text-[var(--text-muted)]">
            Deixar em branco usará o valor do arquivo <code className="font-mono text-[var(--text-secondary)]">.env</code> como fallback.
          </span>
        )}

        <button
          type="button"
          disabled={isSaving}
          onClick={handleSave}
          className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-neutral-950 text-xs font-bold transition-all shadow-md shadow-amber-500/20 disabled:opacity-40 cursor-pointer"
        >
          {isSaving ? "Salvando..." : "Salvar Chaves"}
        </button>
      </div>
    </div>
  );
};
