import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  User,
  Zap,
  Cpu,
  Heart,
  Keyboard,
  Calendar,
  ArrowRight,
  Check,
  Sparkles,
  RotateCcw,
  KeyRound,
  FileText,
  ExternalLink,
  Eye,
  EyeOff,
  Mic,
} from "lucide-react";
import { CopernicoSquircle } from "./icons/CopernicoSquircle";
import { api } from "../api";
import { UserProfile } from "../types";

interface OnboardingModalProps {
  isOpen: boolean;
  onComplete: (profile: UserProfile) => void;
}

const STYLES = [
  {
    id: "direto_conciso",
    label: "Direto & Sintético",
    icon: Zap,
    color: "amber",
    description: "Respostas rápidas, sem rodeios ou floreios. Foco em velocidade e produtividade.",
  },
  {
    id: "tecnico_analitico",
    label: "Técnico & Analítico",
    icon: Cpu,
    color: "cyan",
    description: "Raciocínio estruturado, fundamentação lógica, precisão técnica e métricas detalhadas.",
  },
  {
    id: "amigavel_conversacional",
    label: "Amigável & Conversacional",
    icon: Heart,
    color: "emerald",
    description: "Tom caloroso, empático, consultivo e encorajador. Excelente para parcerias e ideação.",
  },
];

const HOTKEY_OPTIONS = [
  { value: "Ctrl+Space", label: "Ctrl + Espaço (Padrão Recomendado)" },
  { value: "Alt+Space", label: "Alt + Espaço" },
  { value: "Ctrl+Shift+Space", label: "Ctrl + Shift + Espaço" },
  { value: "Win+Shift+C", label: "Win + Shift + C" },
];

const DATE_FORMAT_OPTIONS = [
  {
    value: "DD-MM-YY",
    label: "DD-MM-YY (Padrão Copernico)",
    example: "16-09-26",
    description: "Formato oficial compacto para notas diárias, títulos e linhagem de evolução.",
  },
  {
    value: "YYYY-MM-DD",
    label: "YYYY-MM-DD (Padrão ISO / Obsidian Daily)",
    example: "2026-09-16",
    description: "Compatível com Obsidian Daily Notes e ordenação cronológica internacional.",
  },
  {
    value: "DD-MM-YYYY",
    label: "DD-MM-YYYY (Padrão brasileiro longo)",
    example: "16-09-2026",
    description: "Padrão brasileiro tradicional com ano completo de 4 dígitos.",
  },
];

export const OnboardingModal: React.FC<OnboardingModalProps> = ({
  isOpen,
  onComplete,
}) => {
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [name, setName] = useState("");
  const [selectedStyle, setSelectedStyle] = useState<string>("direto_conciso");
  const [selectedDateFormat, setSelectedDateFormat] = useState<string>("DD-MM-YY");
  const [selectedHotkey, setSelectedHotkey] = useState<string>("Ctrl+Space");
  const [deepseekApiKey, setDeepseekApiKey] = useState("");
  const [groqApiKey, setGroqApiKey] = useState("");
  const [showDeepseek, setShowDeepseek] = useState(false);
  const [showGroq, setShowGroq] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRecordingHotkey, setIsRecordingHotkey] = useState(false);
  const [recordingModifiers, setRecordingModifiers] = useState<string | null>(null);
  const [envRevealed, setEnvRevealed] = useState(false);

  useEffect(() => {
    api.getApiKeys().then((keys) => {
      if (keys) {
        setDeepseekApiKey(keys.deepseek_api_key || "");
        setGroqApiKey(keys.groq_api_key || "");
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!isRecordingHotkey) return;

    const onWindowKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape") {
        setIsRecordingHotkey(false);
        setRecordingModifiers(null);
        return;
      }

      if (e.key === "Tab") return;

      const modifiers: string[] = [];
      if (e.ctrlKey) modifiers.push("Ctrl");
      if (e.altKey) modifiers.push("Alt");
      if (e.shiftKey) modifiers.push("Shift");
      if (e.metaKey) modifiers.push("Win");

      if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) {
        setRecordingModifiers(modifiers.join(" + ") + " + ...");
        return;
      }

      let keyName = e.key;
      if (keyName === " " || e.code === "Space") {
        keyName = "Space";
      } else if (e.code.startsWith("Key")) {
        keyName = e.code.slice(3).toUpperCase();
      } else if (e.code.startsWith("Digit")) {
        keyName = e.code.slice(5);
      } else if (keyName.length === 1) {
        keyName = keyName.toUpperCase();
      }

      const finalCombo = [...modifiers, keyName].join("+");
      setSelectedHotkey(finalCombo);
      setIsRecordingHotkey(false);
      setRecordingModifiers(null);
    };

    window.addEventListener("keydown", onWindowKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onWindowKeyDown, true);
    };
  }, [isRecordingHotkey]);

  if (!isOpen) return null;

  const handleFinish = async () => {
    if (!name.trim()) {
      setStep(1);
      return;
    }

    setIsSaving(true);
    try {
      await api.saveOnboardingProfile(
        name.trim(),
        selectedStyle,
        selectedHotkey,
        selectedDateFormat,
        deepseekApiKey.trim(),
        groqApiKey.trim()
      );
      const profile: UserProfile = {
        name: name.trim(),
        communication_style: selectedStyle,
        hotkey: selectedHotkey,
        date_format: selectedDateFormat,
        deepseek_api_key: deepseekApiKey.trim(),
        groq_api_key: groqApiKey.trim(),
        onboarding_completed: true,
      };
      onComplete(profile);
    } catch (err) {
      console.error("Erro ao salvar perfil de onboarding:", err);
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-xl flex items-center justify-center p-4 select-none animate-in fade-in duration-200">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
        className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-3xl w-full max-w-xl shadow-2xl shadow-black/80 flex flex-col overflow-hidden relative"
      >
        {/* Glow Decorator */}
        <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-transparent via-amber-500/60 to-transparent" />

        {/* Header com Logo & Indicador de Passos */}
        <div className="p-6 border-b border-[var(--border-subtle)] flex items-center justify-between bg-white/[0.01]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-center p-1.5 shadow-inner">
              <CopernicoSquircle
                size={26}
                className="drop-shadow-[0_0_10px_rgba(245,158,11,0.5)]"
              />
            </div>
            <div>
              <h2 className="text-base font-bold text-[var(--text-primary)] tracking-tight">
                Boas-vindas ao Copernico
              </h2>
              <p className="text-xs text-[var(--text-muted)]">
                Personalização do seu segundo cérebro local
              </p>
            </div>
          </div>

          {/* Stepper Indicator */}
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-mono font-bold text-amber-400 bg-amber-500/10 border border-amber-500/30 px-2.5 py-1 rounded-full shadow-inner">
              Passo {step} de 5
            </span>
            <div className="flex items-center gap-1.5 p-1 rounded-full bg-black/40 border border-white/10">
              {[1, 2, 3, 4, 5].map((s) => {
                const isActive = step === s;
                const isPast = s < step;
                const isClickable =
                  s < step ||
                  (s === 2 && name.trim().length > 0) ||
                  (s === 3 && name.trim().length > 0) ||
                  (s === 4 && name.trim().length > 0);
                return (
                  <button
                    key={s}
                    type="button"
                    disabled={!isClickable && !isActive}
                    onClick={() => {
                      if (isClickable) setStep(s as any);
                    }}
                    className={`h-2.5 rounded-full transition-all duration-300 ${
                      isActive
                        ? "w-7 bg-amber-400 shadow-md shadow-amber-500/50"
                        : isPast
                        ? "w-3 bg-amber-500/60 hover:bg-amber-400 cursor-pointer"
                        : "w-3 bg-white/20 border border-white/30 cursor-not-allowed"
                    }`}
                    title={`Passo ${s} de 4`}
                  />
                );
              })}
            </div>
          </div>
        </div>

        {/* Body do Passo Atual */}
        <div className="p-6 sm:p-8 min-h-[330px] flex flex-col justify-between">
          <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div
                key="step1"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
                className="space-y-6 flex-1 flex flex-col justify-center"
              >
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-amber-400 uppercase tracking-wider">
                    <User size={13} />
                    <span>Passo 1 de 5 — Identidade</span>
                  </div>
                  <h3 className="text-xl font-bold text-[var(--text-primary)]">
                    Como você gostaria de ser chamado?
                  </h3>
                  <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                    Seu nome será incorporado ao prompt do assistente para que as
                    respostas sejam personalizadas e naturais tanto no modo texto quanto por voz.
                  </p>
                </div>

                <div className="space-y-2 pt-2">
                  <label className="text-xs font-medium text-[var(--text-secondary)]">
                    Seu Nome ou Apelido
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      autoFocus
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && name.trim()) {
                          setStep(2);
                        }
                      }}
                      placeholder="Ex: Patrick"
                      className="w-full px-4 py-3.5 rounded-2xl bg-white/[0.04] border border-[var(--border-subtle)] focus:border-amber-500/60 focus:bg-white/[0.06] text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none transition-all shadow-inner"
                    />
                    {name.trim() && (
                      <div className="absolute right-3.5 top-1/2 -translate-y-1/2 text-emerald-400">
                        <Check size={16} />
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            )}

            {step === 2 && (
              <motion.div
                key="step2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
                className="space-y-4 flex-1 flex flex-col justify-center"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-xs font-semibold text-amber-400 uppercase tracking-wider">
                    <Sparkles size={13} />
                    <span>Passo 2 de 5 — Tom de Voz</span>
                  </div>
                  <h3 className="text-lg font-bold text-[var(--text-primary)]">
                    Qual estilo de comunicação você prefere?
                  </h3>
                  <p className="text-xs text-[var(--text-muted)]">
                    Define a persona e o nível de profundidade das respostas do Copernico.
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-2.5 pt-1">
                  {STYLES.map((st) => {
                    const Icon = st.icon;
                    const isSelected = selectedStyle === st.id;
                    return (
                      <button
                        key={st.id}
                        type="button"
                        onClick={() => setSelectedStyle(st.id)}
                        className={`p-3.5 rounded-2xl text-left border transition-all flex items-start gap-3 cursor-pointer ${
                          isSelected
                            ? "bg-amber-500/10 border-amber-500/50 shadow-md shadow-amber-500/10"
                            : "bg-white/[0.02] border-[var(--border-subtle)] hover:bg-white/[0.05]"
                        }`}
                      >
                        <div
                          className={`p-2 rounded-xl shrink-0 mt-0.5 ${
                            isSelected
                              ? "bg-amber-500/20 text-amber-400"
                              : "bg-white/5 text-[var(--text-muted)]"
                          }`}
                        >
                          <Icon size={18} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <h4
                              className={`text-xs font-bold ${
                                isSelected
                                  ? "text-amber-300"
                                  : "text-[var(--text-primary)]"
                              }`}
                            >
                              {st.label}
                            </h4>
                            {isSelected && (
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shadow-[0_0_8px_#f59e0b]" />
                            )}
                          </div>
                          <p className="text-[11px] text-[var(--text-muted)] leading-relaxed mt-0.5">
                            {st.description}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            )}

            {step === 3 && (
              <motion.div
                key="step3"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
                className="space-y-4 flex-1 flex flex-col justify-center"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-xs font-semibold text-amber-400 uppercase tracking-wider">
                    <Calendar size={13} />
                    <span>Passo 3 de 5 — Formato de Data</span>
                  </div>
                  <h3 className="text-lg font-bold text-[var(--text-primary)]">
                    Como você prefere formatar as datas?
                  </h3>
                  <p className="text-xs text-[var(--text-muted)]">
                    Define o padrão para títulos de notas, linhagem de evolução e registros tabulares de métricas.
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-2.5 pt-1">
                  {DATE_FORMAT_OPTIONS.map((df) => {
                    const isSelected = selectedDateFormat === df.value;
                    return (
                      <button
                        key={df.value}
                        type="button"
                        onClick={() => setSelectedDateFormat(df.value)}
                        className={`p-3.5 rounded-2xl text-left border transition-all flex items-start gap-3 cursor-pointer ${
                          isSelected
                            ? "bg-amber-500/10 border-amber-500/50 shadow-md shadow-amber-500/10"
                            : "bg-white/[0.02] border-[var(--border-subtle)] hover:bg-white/[0.05]"
                        }`}
                      >
                        <div
                          className={`p-2 rounded-xl shrink-0 mt-0.5 ${
                            isSelected
                              ? "bg-amber-500/20 text-amber-400"
                              : "bg-white/5 text-[var(--text-muted)]"
                          }`}
                        >
                          <Calendar size={18} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <h4
                              className={`text-xs font-bold ${
                                isSelected
                                  ? "text-amber-300"
                                  : "text-[var(--text-primary)]"
                              }`}
                            >
                              {df.label}
                            </h4>
                            <span className="font-mono text-[11px] px-2 py-0.5 rounded-md bg-black/40 text-amber-400 border border-amber-500/30">
                              Ex: {df.example}
                            </span>
                          </div>
                          <p className="text-[11px] text-[var(--text-muted)] leading-relaxed mt-1">
                            {df.description}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            )}

            {step === 4 && (
              <motion.div
                key="step4"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
                className="space-y-4 flex-1 flex flex-col justify-center"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-xs font-semibold text-amber-400 uppercase tracking-wider">
                    <KeyRound size={13} />
                    <span>Passo 4 de 5 — Chaves de API</span>
                  </div>
                  <h3 className="text-lg font-bold text-[var(--text-primary)]">
                    Configuração de Chaves de API
                  </h3>
                  <p className="text-xs text-[var(--text-muted)]">
                    Forneça suas chaves de API para ativar o raciocínio do DeepSeek e a transcrição por voz (Groq Whisper). Se preferir, você também pode configurá-las via arquivo <code className="font-mono text-amber-300">.env</code> na raiz.
                  </p>
                </div>

                <div className="p-4 rounded-2xl bg-white/[0.03] border border-[var(--border-subtle)] space-y-4">
                  {/* DeepSeek API Key */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-[var(--text-primary)] flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <Sparkles size={13} className="text-amber-400" />
                        DeepSeek API Key
                      </span>
                      <span className="text-[10px] text-[var(--text-muted)] font-normal">Recomendado</span>
                    </label>
                    <div className="relative">
                      <input
                        type={showDeepseek ? "text" : "password"}
                        value={deepseekApiKey}
                        onChange={(e) => setDeepseekApiKey(e.target.value)}
                        placeholder="sk-..."
                        className="w-full px-3 py-2 pr-10 rounded-xl bg-black/40 border border-[var(--border-subtle)] focus:border-amber-500 text-xs text-[var(--text-primary)] focus:outline-none transition-colors font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setShowDeepseek(!showDeepseek)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors p-1"
                      >
                        {showDeepseek ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </div>

                  {/* Groq API Key */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-[var(--text-primary)] flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <Mic size={13} className="text-amber-400" />
                        Groq API Key (Whisper STT)
                      </span>
                      <span className="text-[10px] text-[var(--text-muted)] font-normal">Obrigatório p/ Voz</span>
                    </label>
                    <div className="relative">
                      <input
                        type={showGroq ? "text" : "password"}
                        value={groqApiKey}
                        onChange={(e) => setGroqApiKey(e.target.value)}
                        placeholder="gsk_..."
                        className="w-full px-3 py-2 pr-10 rounded-xl bg-black/40 border border-[var(--border-subtle)] focus:border-amber-500 text-xs text-[var(--text-primary)] focus:outline-none transition-colors font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setShowGroq(!showGroq)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors p-1"
                      >
                        {showGroq ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </div>

                  <p className="text-[11px] text-[var(--text-muted)] leading-relaxed pt-1">
                    As chaves são salvas localmente no seu banco SQLite seguro e possuem precedência total sobre o arquivo .env.
                  </p>
                </div>
              </motion.div>
            )}

            {step === 5 && (
              <motion.div
                key="step5"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
                className="space-y-4 flex-1 flex flex-col justify-center"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-xs font-semibold text-amber-400 uppercase tracking-wider">
                    <Keyboard size={13} />
                    <span>Passo 5 de 5 — Atalho de Invocação</span>
                  </div>
                  <h3 className="text-lg font-bold text-[var(--text-primary)]">
                    Como você deseja abrir o Copernico?
                  </h3>
                  <p className="text-xs text-[var(--text-muted)]">
                    Defina a combinação de teclas global para abrir ou alternar o Copernico sobre qualquer janela.
                  </p>
                </div>

                {/* Hotkey Preview Card */}
                <div className="p-4 rounded-2xl bg-white/[0.03] border border-[var(--border-subtle)] flex flex-col items-center justify-center text-center space-y-2.5 relative overflow-hidden">
                  {isRecordingHotkey && (
                    <div className="absolute inset-0 bg-neutral-950/95 backdrop-blur-md flex flex-col items-center justify-center z-10 border-2 border-amber-500 rounded-2xl shadow-xl p-3 animate-in fade-in duration-150">
                      <div className="flex items-center gap-2 text-amber-400 font-mono text-xs font-bold uppercase tracking-wider mb-1">
                        <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping" />
                        <span>Gravando Atalho do Teclado...</span>
                      </div>
                      <p className="text-sm font-mono text-[var(--text-primary)] font-bold">
                        {recordingModifiers || "Pressione a combinação de teclas..."}
                      </p>
                      <span className="text-[10px] text-[var(--text-muted)] mt-1 font-mono">
                        Pressione [Esc] para cancelar
                      </span>
                    </div>
                  )}

                  <div className="flex items-center gap-2 flex-wrap justify-center min-h-[40px]">
                    {selectedHotkey.trim() ? (
                      selectedHotkey.split("+").map((key, i) => (
                        <React.Fragment key={i}>
                          {i > 0 && <span className="text-[var(--text-muted)] text-sm">+</span>}
                          <kbd className="px-3.5 py-1.5 rounded-xl bg-black/60 border border-amber-500/30 text-sm font-mono font-bold text-amber-300 shadow-md">
                            {key.trim() === "Space"
                              ? "Espaço"
                              : key.trim() === "Super"
                              ? "Win"
                              : key.trim()}
                          </kbd>
                        </React.Fragment>
                      ))
                    ) : (
                      <span className="text-xs text-[var(--text-muted)] italic">
                        Nenhum atalho digitado
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    Pressione em qualquer tela para trazer o Copernico instantaneamente.
                  </p>
                </div>

                {/* Custom Hotkey Input & Keystroke Recorder */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-medium text-[var(--text-muted)]">
                      Digite ou grave seu atalho personalizado:
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedHotkey("Ctrl+Space");
                        setIsRecordingHotkey(false);
                        setRecordingModifiers(null);
                      }}
                      className="text-[10px] text-[var(--text-muted)] hover:text-amber-400 flex items-center gap-1 transition-colors cursor-pointer"
                      title="Restaurar atalho padrão"
                    >
                      <RotateCcw size={11} />
                      <span>Restaurar Padrão</span>
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={selectedHotkey}
                      onChange={(e) => setSelectedHotkey(e.target.value)}
                      placeholder="Ex: Ctrl+Alt+Space ou Alt+D"
                      className="flex-1 bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-amber-500/50 rounded-xl px-3 py-2 text-xs font-mono text-[var(--text-primary)] outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setIsRecordingHotkey(!isRecordingHotkey);
                        setRecordingModifiers(null);
                      }}
                      className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer border ${
                        isRecordingHotkey
                          ? "bg-amber-500 text-neutral-950 border-amber-400 font-bold shadow-md shadow-amber-500/30 animate-pulse"
                          : "bg-white/[0.04] hover:bg-white/[0.08] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)]"
                      }`}
                    >
                      <Keyboard size={13} />
                      <span>{isRecordingHotkey ? "Gravando..." : "Gravar Teclas"}</span>
                    </button>
                  </div>
                </div>

                {/* Quick Selection Pills */}
                <div className="space-y-1.5">
                  <span className="text-[11px] font-medium text-[var(--text-muted)]">
                    Alternativas rápidas:
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    {HOTKEY_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => {
                          setSelectedHotkey(opt.value);
                          setIsRecordingHotkey(false);
                          setRecordingModifiers(null);
                        }}
                        className={`p-2 px-3 rounded-xl text-left border text-xs font-mono transition-all cursor-pointer ${
                          selectedHotkey === opt.value
                            ? "bg-amber-500/15 border-amber-500/50 text-amber-300 font-bold"
                            : "bg-white/[0.02] border-[var(--border-subtle)] text-[var(--text-muted)] hover:bg-white/[0.05]"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Footer Controls */}
          <div className="pt-6 border-t border-[var(--border-subtle)] flex items-center justify-between gap-3 mt-4">
            {step > 1 ? (
              <button
                type="button"
                onClick={() => setStep((s) => (s - 1) as any)}
                className="px-4 py-2.5 rounded-xl border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/5 transition-all cursor-pointer"
              >
                Voltar
              </button>
            ) : (
              <div />
            )}

            {step < 5 ? (
              <button
                type="button"
                disabled={step === 1 && !name.trim()}
                onClick={() => setStep((s) => (s + 1) as any)}
                className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-neutral-950 text-xs font-bold flex items-center gap-2 transition-all shadow-md shadow-amber-500/20 disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
              >
                <span>Continuar</span>
                <ArrowRight size={14} />
              </button>
            ) : (
              <button
                type="button"
                disabled={isSaving || !name.trim() || !selectedHotkey.trim()}
                onClick={handleFinish}
                className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-neutral-950 text-xs font-bold flex items-center gap-2 transition-all shadow-lg shadow-amber-500/25 disabled:opacity-40 cursor-pointer"
              >
                <span>{isSaving ? "Salvando Perfil..." : "Começar a Usar"}</span>
                <Sparkles size={14} />
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
};
