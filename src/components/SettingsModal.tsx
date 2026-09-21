import React, { useState, useEffect } from "react";
import {
  X,
  Settings,
  FolderOpen,
  RefreshCw,
  RotateCcw,
  Check,
  Sparkles,
  Bot,
  Database,
  ExternalLink,
  Mic,
  Sliders,
  Activity,
  Radio,
  Volume2,
  Play,
  Square,
  Boxes,
  Palette,
  Zap,
  Layers,
  Power,
  Calendar,
  Clock,
  ChevronLeft,
  ChevronRight,
  Eye,
  HelpCircle,
  Wrench,
  SlidersHorizontal,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { api } from "../api";
import {
  McpServerStatus,
  PluginItem,
  SkillConfigData,
  SkillManifest,
  ThemeItem,
  VoiceInfo,
} from "../types";
import { ThemeEngine } from "../utils/themeEngine";
import { describeCron, optionsToCron, FriendlyCronOptions } from "../utils/cronDescription";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenSession?: (sessionId: string) => void;
  onOpenSkills?: () => void;
  onOpenRoutines?: () => void;
}

interface DebugScores {
  copernico: number;
  zefiro?: number;
  lich?: number;
  rms: number;
  threshold: number;
}

export const SECTIONS = [
  {
    id: "wakeword" as const,
    title: "Wake Word",
    label: "Detecção e Calibração",
    icon: Radio,
    badge: "Microfone & Scores",
  },
  {
    id: "tts" as const,
    title: "Voz & TTS",
    label: "Síntese de Fala Neural",
    icon: Volume2,
    badge: "Microsoft Edge",
  },
  {
    id: "prompts" as const,
    title: "System Prompts",
    label: "Diretrizes e Persona",
    icon: Bot,
    badge: "Visual & Voz",
  },
  {
    id: "brain" as const,
    title: "Cofres & Vetores",
    label: "Base de Conhecimento",
    icon: FolderOpen,
    badge: "FastEmbed & Obsidian",
  },
  {
    id: "plugins" as const,
    title: "Plugins & Extensões",
    label: "Skills, MCP & Temas",
    icon: Boxes,
    badge: "Modularidade",
  },
];

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  onOpenSession,
  onOpenSkills,
  onOpenRoutines,
}) => {
  const [activeSection, setActiveSection] = useState<"wakeword" | "tts" | "prompts" | "brain" | "plugins">("wakeword");

  // --- Plugins & Extensões State ---
  const [plugins, setPlugins] = useState<PluginItem[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServerStatus[]>([]);
  const [skills, setSkills] = useState<SkillManifest[]>([]);
  const [themes, setThemes] = useState<ThemeItem[]>([]);
  const [activeTheme, setActiveThemeState] = useState<string | null>(null);
  const [isLoadingPlugins, setIsLoadingPlugins] = useState(false);

  // --- MCP Sob Demanda State ---
  const [mcpConfigText, setMcpConfigText] = useState("");
  const [isLoadingMcpConfig, setIsLoadingMcpConfig] = useState(false);
  const [isSavingMcpConfig, setIsSavingMcpConfig] = useState(false);
  const [mcpConfigFeedback, setMcpConfigFeedback] = useState<{
    type: "success" | "error";
    msg: string;
  } | null>(null);
  const [runningSkillId, setRunningSkillId] = useState<string | null>(null);
  const [skillFeedback, setSkillFeedback] = useState<string | null>(null);
  const [lastExecutedSessionId, setLastExecutedSessionId] = useState<string | null>(null);
  const [skillProgress, setSkillProgress] = useState<{
    skillId: string;
    sessionId?: string;
    iteration: number;
    maxIterations: number;
    toolName: string;
  } | null>(null);

  // --- Skill Config Drawer State ---
  const [configuringSkillId, setConfiguringSkillId] = useState<string | null>(null);
  const [editingSkillConfig, setEditingSkillConfig] = useState<SkillConfigData | null>(null);
  const [isSavingSkillConfig, setIsSavingSkillConfig] = useState(false);
  const [skillConfigFeedback, setSkillConfigFeedback] = useState<{
    id: string;
    msg: string;
    isError?: boolean;
  } | null>(null);

  // --- Skill Cron Override State ---
  const [skillCrons, setSkillCrons] = useState<Record<string, string>>({});
  const [editingCronSkillId, setEditingCronSkillId] = useState<string | null>(null);
  const [cronInputValue, setCronInputValue] = useState<string>("");
  const [isAdvancedCron, setIsAdvancedCron] = useState<boolean>(false);
  const [friendlyFreq, setFriendlyFreq] = useState<FriendlyCronOptions["frequency"]>("every_6h");
  const [friendlyTime, setFriendlyTime] = useState<string>("09:00");
  const [friendlyDays, setFriendlyDays] = useState<number[]>([1]);
  const [isSavingCron, setIsSavingCron] = useState(false);
  const [cronFeedback, setCronFeedback] = useState<{ id: string; msg: string } | null>(null);

  // --- TTS / Voice State ---
  const [ttsVoices, setTtsVoices] = useState<VoiceInfo[]>([]);
  const [selectedVoice, setSelectedVoice] = useState<string>("pt-BR-ThalitaNeural");
  const [isTestingVoice, setIsTestingVoice] = useState(false);
  const [voiceFeedback, setVoiceFeedback] = useState<string | null>(null);
  const [isLoadingVoices, setIsLoadingVoices] = useState(false);

  // --- Prompts State ---
  const [promptTab, setPromptTab] = useState<"visual" | "voice" | "perfil">("visual");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [initialPrompt, setInitialPrompt] = useState("");
  const [isLoadingPrompt, setIsLoadingPrompt] = useState(false);
  const [isSavingPrompt, setIsSavingPrompt] = useState(false);
  const [promptFeedback, setPromptFeedback] = useState<string | null>(null);

  const [voicePrompt, setVoicePrompt] = useState("");
  const [initialVoicePrompt, setInitialVoicePrompt] = useState("");
  const [isSavingVoicePrompt, setIsSavingVoicePrompt] = useState(false);
  const [voicePromptFeedback, setVoicePromptFeedback] = useState<string | null>(null);

  // --- Profile & Autoaprendizado State ---
  const [userName, setUserName] = useState("");
  const [userStyle, setUserStyle] = useState("direto_conciso");
  const [userHotkey, setUserHotkey] = useState("Ctrl+Space");
  const [customInstructions, setCustomInstructions] = useState("");
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileFeedback, setProfileFeedback] = useState<string | null>(null);

  // --- Brain / Vaults State ---
  const [isReindexing, setIsReindexing] = useState(false);
  const [reindexFeedback, setReindexFeedback] = useState<string | null>(null);
  const [folderFeedback, setFolderFeedback] = useState<string | null>(null);

  // --- Wake Word Debug State ---
  const [debugScores, setDebugScores] = useState<DebugScores>({
    copernico: 0,
    zefiro: 0,
    lich: 0,
    rms: 0,
    threshold: 0.50,
  });
  const [copernicoPeak, setCopernicoPeak] = useState(0);
  const [zefiroPeak, setZefiroPeak] = useState(0);
  const [threshold, setThreshold] = useState(0.50);
  const [thresholdFeedback, setThresholdFeedback] = useState<string | null>(null);
  const [isListeningDebug, setIsListeningDebug] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    // Pausa a ativação automática do assistente enquanto o usuário está configurando/calibrando
    api.setWakeDetectionActive(false);

    // 1. Carrega prompts
    const loadPrompts = async () => {
      setIsLoadingPrompt(true);
      setPromptFeedback(null);
      setVoicePromptFeedback(null);
      setReindexFeedback(null);
      setFolderFeedback(null);
      try {
        const [visualP, voiceP] = await Promise.all([
          api.getSystemPrompt(),
          api.getVoiceSystemPrompt(),
        ]);
        setSystemPrompt(visualP);
        setInitialPrompt(visualP);
        setVoicePrompt(voiceP);
        setInitialVoicePrompt(voiceP);
      } catch (err) {
        console.error("Failed to load system prompts:", err);
      } finally {
        setIsLoadingPrompt(false);
      }
    };

    // 2. Carrega threshold salvo e perfil do usuário
    api.getWakeWordThreshold().then((th) => {
      if (th && th > 0) {
        setThreshold(th);
      }
    });

    api.getUserProfile().then((p) => {
      if (p) {
        setUserName(p.name || "");
        setUserStyle(p.communication_style || "direto_conciso");
        setUserHotkey(p.hotkey || "Ctrl+Space");
        setCustomInstructions(p.custom_instructions || "");
      }
    });

    loadPrompts();

    // 3. Carrega vozes de TTS e voz ativa
    const loadTtsSettings = async () => {
      setIsLoadingVoices(true);
      try {
        const [voices, currentVoice] = await Promise.all([
          api.getTtsVoices(),
          api.getCurrentTtsVoice(),
        ]);
        if (voices && voices.length > 0) {
          setTtsVoices(voices);
        }
        if (currentVoice) {
          setSelectedVoice(currentVoice);
        }
      } catch (err) {
        console.error("Failed to load TTS voices:", err);
      } finally {
        setIsLoadingVoices(false);
      }
    };
    loadTtsSettings();

    // 4. Carrega dados de plugins, MCP, skills e temas
    loadPluginsData();

    // 5. Listener de eventos em tempo real do sidecar e progresso de skills
    let unlisten: (() => void) | undefined;
    let unlistenProgress: (() => void) | undefined;

    const setupDebugListener = async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen<DebugScores>("wake-debug-scores", (event) => {
          setIsListeningDebug(true);
          const p = event.payload;
          const zScore = p.zefiro ?? p.lich ?? 0;
          setDebugScores({ ...p, zefiro: zScore, lich: zScore });
          setCopernicoPeak((prev) => Math.max(prev, p.copernico));
          setZefiroPeak((prev) => Math.max(prev, zScore));
        });

        unlistenProgress = await listen<{
          session_id: string;
          iteration: number;
          max_iterations: number;
          tool_name: string;
        }>("skill-progress", (event) => {
          setSkillProgress({
            skillId: "",
            sessionId: event.payload.session_id,
            iteration: event.payload.iteration,
            maxIterations: event.payload.max_iterations,
            toolName: event.payload.tool_name,
          });
          setLastExecutedSessionId(event.payload.session_id);
        });
      } catch (e) {
        console.warn("Event listener not available in preview:", e);
      }
    };

    setupDebugListener();

    // Decay suave para retenção de pico (Peak Hold)
    const decayTimer = setInterval(() => {
      setCopernicoPeak((prev) => Math.max(0, +(prev * 0.94).toFixed(3)));
      setZefiroPeak((prev) => Math.max(0, +(prev * 0.94).toFixed(3)));
    }, 200);

    return () => {
      // Interrompe qualquer áudio de teste e reativa a detecção normal
      api.stopTts();
      api.setWakeDetectionActive(true);
      if (unlisten) unlisten();
      if (unlistenProgress) unlistenProgress();
      clearInterval(decayTimer);
    };
  }, [isOpen]);

  const loadMcpConfig = async () => {
    setIsLoadingMcpConfig(true);
    try {
      const cfg = await api.getMcpConfig();
      setMcpConfigText(cfg);
    } catch (err) {
      console.warn("Failed to load MCP config:", err);
    } finally {
      setIsLoadingMcpConfig(false);
    }
  };

  const handleSaveMcpConfig = async () => {
    setIsSavingMcpConfig(true);
    setMcpConfigFeedback(null);
    try {
      await api.saveMcpConfig(mcpConfigText);
      setMcpConfigFeedback({
        type: "success",
        msg: "Configuração MCP salva com sucesso! Servidores serão acionados sob demanda.",
      });
      setTimeout(() => setMcpConfigFeedback(null), 4000);
    } catch (err) {
      setMcpConfigFeedback({ type: "error", msg: `Erro ao salvar: ${String(err)}` });
    } finally {
      setIsSavingMcpConfig(false);
    }
  };

  const loadPluginsData = async () => {
    setIsLoadingPlugins(true);
    try {
      const [plugs, mcps, thms, currentThm] = await Promise.all([
        api.reloadPlugins(),
        api.getMcpServersStatus(),
        api.listThemes(),
        api.getActiveTheme(),
      ]);
      setPlugins(plugs);
      setMcpServers(mcps);
      setThemes(thms);
      setActiveThemeState(currentThm || "default");
      loadMcpConfig();
    } catch (err) {
      console.error("Failed to load plugins data:", err);
    } finally {
      setIsLoadingPlugins(false);
    }
  };

  const handleOpenCronEditor = (sk: SkillManifest) => {
    if (editingCronSkillId === sk.plugin.id) {
      setEditingCronSkillId(null);
      return;
    }
    const currentExpr = skillCrons[sk.plugin.id] || sk.skill?.trigger.cron || "0 */6 * * *";
    setCronInputValue(currentExpr);
    setIsAdvancedCron(false);
    setFriendlyFreq("every_6h");
    setFriendlyTime("09:00");
    setFriendlyDays([1]);
    setEditingCronSkillId(sk.plugin.id);
  };

  const handleSaveSkillCron = async (skillId: string) => {
    setIsSavingCron(true);
    setCronFeedback(null);

    let exprToSave = cronInputValue.trim();
    if (!isAdvancedCron) {
      exprToSave = optionsToCron({
        frequency: friendlyFreq,
        time: friendlyTime,
        daysOfWeek: friendlyDays,
      });
    }

    try {
      await api.setSkillCron(skillId, exprToSave);
      setSkillCrons((prev) => ({ ...prev, [skillId]: exprToSave }));
      setCronFeedback({ id: skillId, msg: "Agendamento salvo com sucesso!" });
      setTimeout(() => setCronFeedback(null), 3500);
      setEditingCronSkillId(null);
    } catch (err: any) {
      setCronFeedback({ id: skillId, msg: `Erro ao salvar: ${err?.message || err}` });
    } finally {
      setIsSavingCron(false);
    }
  };

  const handleResetSkillCron = async (sk: SkillManifest) => {
    setIsSavingCron(true);
    setCronFeedback(null);
    try {
      await api.resetSkillCron(sk.plugin.id);
      const defaultCron = sk.skill?.trigger.cron || "0 */6 * * *";
      setSkillCrons((prev) => ({ ...prev, [sk.plugin.id]: defaultCron }));
      setCronInputValue(defaultCron);
      setCronFeedback({ id: sk.plugin.id, msg: "Restaurado para o padrão original do plugin!" });
      setTimeout(() => setCronFeedback(null), 3500);
      setEditingCronSkillId(null);
    } catch (err: any) {
      setCronFeedback({ id: sk.plugin.id, msg: `Erro ao restaurar: ${err?.message || err}` });
    } finally {
      setIsSavingCron(false);
    }
  };

  const handleTogglePlugin = async (pluginId: string, currentEnabled: boolean) => {
    try {
      await api.togglePlugin(pluginId, !currentEnabled);
      setPlugins((prev) =>
        prev.map((p) => (p.id === pluginId ? { ...p, enabled: !currentEnabled } : p))
      );
    } catch (err) {
      console.error("Erro ao alternar plugin:", err);
    }
  };

  const handleApplyTheme = async (theme: ThemeItem | null) => {
    try {
      if (!theme || theme.id === "default") {
        ThemeEngine.clearTheme();
        await api.setActiveTheme("default");
        setActiveThemeState("default");
      } else {
        ThemeEngine.applyTheme(theme.id, theme.css);
        await api.setActiveTheme(theme.id);
        setActiveThemeState(theme.id);
      }
    } catch (err) {
      console.error("Erro ao aplicar tema:", err);
    }
  };

  const handleRunSkill = async (skillId: string) => {
    setRunningSkillId(skillId);
    setSkillProgress(null);
    setSkillFeedback(null);
    try {
      const res = await api.runSkillNow(skillId);
      if (res?.session_id) {
        setLastExecutedSessionId(res.session_id);
      }
      setSkillFeedback(
        `Skill executada com sucesso! Relatório gerado na Inbox e registrado na sessão.`
      );
      setTimeout(() => setSkillFeedback(null), 8000);
    } catch (err: any) {
      setSkillFeedback(`Erro ao executar skill: ${err?.message || err}`);
    } finally {
      setRunningSkillId(null);
      setSkillProgress(null);
    }
  };

  const handleOpenSkillConfig = async (sk: SkillManifest) => {
    if (configuringSkillId === sk.plugin.id) {
      setConfiguringSkillId(null);
      setEditingSkillConfig(null);
      return;
    }
    setConfiguringSkillId(sk.plugin.id);
    setSkillConfigFeedback(null);
    try {
      const cfg = await api.getSkillConfig(sk.plugin.id);
      setEditingSkillConfig(cfg);
    } catch (e) {
      console.error("Erro ao carregar configurações da skill:", e);
    }
  };

  const handleSaveSkillConfig = async () => {
    if (!editingSkillConfig) return;
    setIsSavingSkillConfig(true);
    setSkillConfigFeedback(null);
    try {
      await api.saveSkillConfig(editingSkillConfig.skill_id, editingSkillConfig);
      setSkillConfigFeedback({
        id: editingSkillConfig.skill_id,
        msg: "Configurações da rotina salvas com sucesso!",
      });
      setTimeout(() => setSkillConfigFeedback(null), 3500);
    } catch (err: any) {
      setSkillConfigFeedback({
        id: editingSkillConfig.skill_id,
        msg: `Erro ao salvar: ${err?.message || err}`,
        isError: true,
      });
    } finally {
      setIsSavingSkillConfig(false);
    }
  };

  const handleResetSkillConfig = async (skillId: string) => {
    try {
      const def = await api.resetSkillConfig(skillId);
      setEditingSkillConfig(def);
      setSkillConfigFeedback({
        id: skillId,
        msg: "Configurações restauradas para o padrão do manifesto!",
      });
      setTimeout(() => setSkillConfigFeedback(null), 3000);
    } catch (err: any) {
      setSkillConfigFeedback({
        id: skillId,
        msg: `Erro ao resetar: ${err?.message || err}`,
        isError: true,
      });
    }
  };

  const currentIndex = Math.max(0, SECTIONS.findIndex((s) => s.id === activeSection));
  const handlePrevSection = () => {
    const nextIdx = (currentIndex - 1 + SECTIONS.length) % SECTIONS.length;
    setActiveSection(SECTIONS[nextIdx].id);
  };
  const handleNextSection = () => {
    const nextIdx = (currentIndex + 1) % SECTIONS.length;
    setActiveSection(SECTIONS[nextIdx].id);
  };

  const handleSelectVoice = async (voiceShortName: string) => {
    setSelectedVoice(voiceShortName);
    try {
      await api.setTtsVoice(voiceShortName);
      setVoiceFeedback("Voz padrão atualizada com sucesso!");
      setTimeout(() => setVoiceFeedback(null), 3500);
    } catch (err) {
      console.error("Erro ao salvar voz padrão:", err);
    }
  };

  const handleTestVoice = async () => {
    if (isTestingVoice) {
      await api.stopTts();
      setIsTestingVoice(false);
      return;
    }
    setIsTestingVoice(true);
    try {
      await api.testTtsVoice(selectedVoice);
    } catch (err) {
      console.error("Erro ao testar voz:", err);
    } finally {
      setIsTestingVoice(false);
    }
  };

  const handleSavePrompt = async () => {
    setIsSavingPrompt(true);
    setPromptFeedback(null);
    try {
      await api.setSystemPrompt(systemPrompt);
      setInitialPrompt(systemPrompt);
      setPromptFeedback("Prompt visual salvo com sucesso!");
      setTimeout(() => setPromptFeedback(null), 3000);
    } catch (err) {
      console.error("Failed to save system prompt:", err);
      setPromptFeedback("Erro ao salvar prompt visual.");
    } finally {
      setIsSavingPrompt(false);
    }
  };

  const handleResetPrompt = async () => {
    setIsSavingPrompt(true);
    setPromptFeedback(null);
    try {
      const defaultP = await api.resetSystemPrompt();
      setSystemPrompt(defaultP);
      setInitialPrompt(defaultP);
      setPromptFeedback("Prompt visual restaurado para o padrão!");
      setTimeout(() => setPromptFeedback(null), 3000);
    } catch (err) {
      console.error("Failed to reset system prompt:", err);
      setPromptFeedback("Erro ao restaurar padrão.");
    } finally {
      setIsSavingPrompt(false);
    }
  };

  const handleSaveVoicePrompt = async () => {
    setIsSavingVoicePrompt(true);
    setVoicePromptFeedback(null);
    try {
      await api.setVoiceSystemPrompt(voicePrompt);
      setInitialVoicePrompt(voicePrompt);
      setVoicePromptFeedback("Prompt de voz salvo com sucesso!");
      setTimeout(() => setVoicePromptFeedback(null), 3000);
    } catch (err) {
      console.error("Failed to save voice prompt:", err);
      setVoicePromptFeedback("Erro ao salvar prompt de voz.");
    } finally {
      setIsSavingVoicePrompt(false);
    }
  };

  const handleResetVoicePrompt = async () => {
    setIsSavingVoicePrompt(true);
    setVoicePromptFeedback(null);
    try {
      const defaultP = await api.resetVoiceSystemPrompt();
      setVoicePrompt(defaultP);
      setInitialVoicePrompt(defaultP);
      setVoicePromptFeedback("Prompt de voz restaurado para o padrão!");
      setTimeout(() => setVoicePromptFeedback(null), 3000);
    } catch (err) {
      console.error("Failed to reset voice prompt:", err);
      setVoicePromptFeedback("Erro ao restaurar padrão de voz.");
    } finally {
      setIsSavingVoicePrompt(false);
    }
  };

  const handleSaveProfile = async () => {
    setIsSavingProfile(true);
    setProfileFeedback(null);
    try {
      await api.saveUserProfile(userName, userStyle, userHotkey, customInstructions);
      setProfileFeedback("Perfil e diretrizes salvas com sucesso!");
      setTimeout(() => setProfileFeedback(null), 3500);
    } catch (err) {
      console.error("Erro ao salvar perfil:", err);
      setProfileFeedback("Erro ao salvar perfil.");
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleReindex = async () => {
    setIsReindexing(true);
    setReindexFeedback(null);
    try {
      await api.reindexVaults();
      setReindexFeedback("Base vetorial e notas reindexadas com sucesso!");
      setTimeout(() => setReindexFeedback(null), 4000);
    } catch (err) {
      console.error("Failed to reindex vaults:", err);
      setReindexFeedback("Erro ao reindexar cofres.");
    } finally {
      setIsReindexing(false);
    }
  };

  const handleOpenFolder = async () => {
    setFolderFeedback(null);
    try {
      await api.openBrainFolder();
      setFolderFeedback("Pasta aberta no Explorador de Arquivos!");
      setTimeout(() => setFolderFeedback(null), 3000);
    } catch (err) {
      console.error("Failed to open brain folder:", err);
      setFolderFeedback("Erro ao abrir pasta dos cofres.");
    }
  };

  const handleThresholdChange = async (val: number) => {
    const clamped = Math.max(0.1, Math.min(0.95, +val.toFixed(2)));
    setThreshold(clamped);
    await api.setWakeWordThreshold(clamped);
    setThresholdFeedback(`Sensibilidade definida para ${(clamped * 100).toFixed(0)}%`);
    setTimeout(() => setThresholdFeedback(null), 2500);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 overflow-hidden animate-in fade-in duration-200">
      <div className="w-full max-w-3xl bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-2xl shadow-2xl overflow-hidden flex flex-col h-[580px] max-h-[92vh]">
        {/* Header com Navegação Principal */}
        <div className="px-5 py-3.5 border-b border-[var(--border-subtle)] flex items-center justify-between bg-transparent shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-amber-500/20 border border-amber-500/30 text-amber-500 dark:text-amber-400">
              <Settings size={18} />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Configurações do Copernico</h3>
              <p className="text-[11px] text-[var(--text-muted)]">Calibração de voz, personalidades da IA, cofres e rotinas</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-black/5 dark:hover:bg-white/10 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Barra de Navegação Centralizada com Setas Laterais */}
        <div className="flex flex-col items-center justify-center px-4 py-2.5 border-b border-[var(--border-subtle)] bg-[var(--bg-input)] shrink-0 select-none">
          <div className="flex items-center justify-between w-full max-w-lg gap-3">
            <button
              type="button"
              onClick={handlePrevSection}
              className="p-2 rounded-xl bg-black/5 dark:bg-white/[0.04] hover:bg-amber-500/15 border border-[var(--border-subtle)] hover:border-amber-500/40 text-[var(--text-muted)] hover:text-amber-400 transition-all flex items-center justify-center shadow-sm"
              title="Categoria anterior (Seta para a esquerda)"
            >
              <ChevronLeft size={18} />
            </button>

            {/* Cartão Central Ativo */}
            <div className="flex-1 flex flex-col items-center justify-center text-center px-4 py-1.5 rounded-xl bg-black/10 dark:bg-white/[0.03] border border-amber-500/30 shadow-inner">
              <div className="flex items-center gap-2">
                {React.createElement(SECTIONS[currentIndex].icon, {
                  size: 15,
                  className: "text-amber-500 dark:text-amber-400 shrink-0",
                })}
                <span className="text-xs font-bold text-[var(--text-primary)] tracking-wide">
                  {SECTIONS[currentIndex].title}
                </span>
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-amber-500/20 text-amber-500 dark:text-amber-300 font-mono font-bold">
                  {currentIndex + 1} de {SECTIONS.length}
                </span>
              </div>
              <span className="text-[10px] text-[var(--text-muted)] mt-0.5 font-medium">
                {SECTIONS[currentIndex].label}
              </span>
            </div>

            <button
              type="button"
              onClick={handleNextSection}
              className="p-2 rounded-xl bg-black/5 dark:bg-white/[0.04] hover:bg-amber-500/15 border border-[var(--border-subtle)] hover:border-amber-500/40 text-[var(--text-muted)] hover:text-amber-400 transition-all flex items-center justify-center shadow-sm"
              title="Próxima categoria (Seta para a direita)"
            >
              <ChevronRight size={18} />
            </button>
          </div>

          {/* Micro-pills Clicáveis */}
          <div className="flex items-center gap-1.5 mt-2">
            {SECTIONS.map((sec, idx) => (
              <button
                key={sec.id}
                type="button"
                onClick={() => setActiveSection(sec.id)}
                className={`h-1.5 rounded-full transition-all ${
                  idx === currentIndex
                    ? "w-6 bg-amber-500"
                    : "w-2 bg-[var(--border-subtle)] hover:bg-[var(--text-muted)]"
                }`}
                title={sec.title}
              />
            ))}
          </div>
        </div>

        {/* Body com Conteúdo da Seção Ativa */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 custom-scrollbar">
          {/* ==================== SEÇÃO 1: DEBUG DE WAKE WORD ==================== */}
          {activeSection === "wakeword" && (
            <div className="space-y-5 animate-in fade-in duration-150">
              {/* Status Header */}
              <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Activity size={16} className="text-amber-500 dark:text-amber-400 animate-pulse" />
                  <div>
                    <h4 className="text-xs font-semibold text-amber-500 dark:text-amber-300">
                      Diagnóstico de Wake Word em Tempo Real
                    </h4>
                    <p className="text-[11px] text-[var(--text-muted)]">
                      Fale no microfone e observe a acurácia dos modelos subindo em tempo real.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-[10px] text-emerald-300 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span>{isListeningDebug ? "Captura Ativa" : "Ouvindo"}</span>
                </div>
              </div>

              {/* Medidor RMS do Microfone (VU Meter) */}
              <div className="p-4 rounded-xl bg-[#0d0d10] border border-white/5 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-neutral-300 flex items-center gap-1.5">
                    <Volume2 size={14} className="text-emerald-400" />
                    Entrada do Microfone (Volume / RMS)
                  </span>
                  <span className="font-mono text-neutral-400 text-[11px]">
                    {(debugScores.rms * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="w-full h-2.5 bg-neutral-800/80 rounded-full overflow-hidden p-0.5">
                  <div
                    className="h-full rounded-full transition-all duration-75 bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-400"
                    style={{ width: `${Math.min(100, Math.max(2, debugScores.rms * 100 * 2.5))}%` }}
                  />
                </div>
                <p className="text-[10px] text-neutral-500">
                  A barra deve reagir à sua voz normal. Se não se mover, verifique o volume do microfone no Windows.
                </p>
              </div>

              {/* Grid dos Dois Modelos */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {/* Modelo 1: Copernico */}
                <div
                  className={`p-4 rounded-xl border transition-all space-y-3 ${
                    debugScores.copernico >= threshold
                      ? "bg-amber-500/20 border-amber-500 shadow-lg shadow-amber-500/20"
                      : "bg-[var(--bg-input)] border-[var(--border-subtle)]"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-[var(--text-primary)] tracking-wide">"Copernico"</span>
                        <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-500 dark:text-amber-400 text-[9px] font-semibold">
                          INÍCIO
                        </span>
                      </div>
                      <p className="text-[10px] text-[var(--text-muted)] mt-0.5">Inicia a gravação de fala</p>
                    </div>
                    {debugScores.copernico >= threshold && (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[10px] font-bold animate-bounce">
                        ✓ DISPARADO!
                      </span>
                    )}
                  </div>

                  {/* Barra de Score */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-[var(--text-muted)]">
                        Score Atual:{" "}
                        <strong className="text-amber-500 dark:text-amber-300 font-mono">
                          {(debugScores.copernico * 100).toFixed(0)}%
                        </strong>
                      </span>
                      <span className="text-[var(--text-muted)] text-[10px]">
                        Pico recente:{" "}
                        <strong className="text-[var(--text-primary)] font-mono">
                          {(copernicoPeak * 100).toFixed(0)}%
                        </strong>
                      </span>
                    </div>

                    <div className="relative w-full h-4 bg-black/20 dark:bg-neutral-800/80 rounded-lg overflow-hidden">
                      {/* Linha vertical do Threshold */}
                      <div
                        className="absolute top-0 bottom-0 w-0.5 bg-amber-400 z-10 shadow-[0_0_6px_rgba(251,191,36,0.9)]"
                        style={{ left: `${threshold * 100}%` }}
                        title={`Limiar necessário: ${(threshold * 100).toFixed(0)}%`}
                      />

                      {/* Barra de Progresso */}
                      <div
                        className={`h-full rounded-lg transition-all duration-75 ${
                          debugScores.copernico >= threshold
                            ? "bg-gradient-to-r from-amber-500 to-emerald-400"
                            : "bg-gradient-to-r from-amber-600 to-amber-400"
                        }`}
                        style={{ width: `${Math.min(100, debugScores.copernico * 100)}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* Modelo 2: Zefiro */}
                <div
                  className={`p-4 rounded-xl border transition-all space-y-3 ${
                    (debugScores.zefiro ?? debugScores.lich ?? 0) >= threshold
                      ? "bg-rose-950/40 border-rose-500 shadow-lg shadow-rose-950/50"
                      : "bg-[var(--bg-input)] border-[var(--border-subtle)]"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-[var(--text-primary)] tracking-wide">"Zefiro"</span>
                        <span className="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 text-[9px] font-semibold">
                          FINALIZAÇÃO
                        </span>
                      </div>
                      <p className="text-[10px] text-[var(--text-muted)] mt-0.5">Finaliza e envia a pergunta</p>
                    </div>
                    {(debugScores.zefiro ?? debugScores.lich ?? 0) >= threshold && (
                      <span className="px-2 py-0.5 rounded-full bg-rose-500/20 border border-rose-500/40 text-rose-300 text-[10px] font-bold animate-bounce">
                        ✓ ENVIADO!
                      </span>
                    )}
                  </div>

                  {/* Barra de Score */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-[var(--text-muted)]">
                        Score Atual:{" "}
                        <strong className="text-rose-300 font-mono">
                          {(((debugScores.zefiro ?? debugScores.lich ?? 0)) * 100).toFixed(0)}%
                        </strong>
                      </span>
                      <span className="text-[var(--text-muted)] text-[10px]">
                        Pico recente:{" "}
                        <strong className="text-[var(--text-primary)] font-mono">
                          {(zefiroPeak * 100).toFixed(0)}%
                        </strong>
                      </span>
                    </div>

                    <div className="relative w-full h-4 bg-black/20 dark:bg-neutral-800/80 rounded-lg overflow-hidden">
                      {/* Linha vertical do Threshold */}
                      <div
                        className="absolute top-0 bottom-0 w-0.5 bg-amber-400 z-10 shadow-[0_0_6px_rgba(251,191,36,0.9)]"
                        style={{ left: `${threshold * 100}%` }}
                        title={`Limiar necessário: ${(threshold * 100).toFixed(0)}%`}
                      />

                      {/* Barra de Progresso */}
                      <div
                        className={`h-full rounded-lg transition-all duration-75 ${
                          (debugScores.zefiro ?? debugScores.lich ?? 0) >= threshold
                            ? "bg-gradient-to-r from-rose-500 to-amber-400"
                            : "bg-gradient-to-r from-rose-600 to-pink-500"
                        }`}
                        style={{ width: `${Math.min(100, (debugScores.zefiro ?? debugScores.lich ?? 0) * 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Slider de Sensibilidade / Threshold */}
              <div className="p-4 rounded-xl bg-[var(--bg-input)] border border-[var(--border-subtle)] space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sliders size={15} className="text-amber-400" />
                    <div>
                      <h4 className="text-xs font-semibold text-[var(--text-primary)]">
                        Limiar de Ativação (Sensibilidade)
                      </h4>
                      <p className="text-[10px] text-[var(--text-muted)]">
                        Ajuste o valor que a pontuação precisa ultrapassar para acionar a gravação.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold text-amber-500 dark:text-amber-300 bg-amber-500/10 px-2 py-1 rounded-lg border border-amber-500/20">
                      {(threshold * 100).toFixed(0)}% ({threshold.toFixed(2)})
                    </span>
                  </div>
                </div>

                <input
                  type="range"
                  min="0.15"
                  max="0.80"
                  step="0.01"
                  value={threshold}
                  onChange={(e) => handleThresholdChange(parseFloat(e.target.value))}
                  className="w-full accent-amber-500 cursor-pointer h-2 bg-black/20 dark:bg-neutral-800 rounded-lg appearance-none"
                />

                {/* Botões de Predefinições Rápidas */}
                <div className="flex items-center justify-between pt-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-[var(--text-muted)]">Predefinições:</span>
                    <button
                      type="button"
                      onClick={() => handleThresholdChange(0.30)}
                      className="px-2 py-1 rounded-lg bg-black/5 dark:bg-white/[0.04] hover:bg-black/10 dark:hover:bg-white/[0.08] text-[10px] text-[var(--text-muted)] transition-colors"
                    >
                      Sensível (30%)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleThresholdChange(0.40)}
                      className="px-2 py-1 rounded-lg bg-black/5 dark:bg-white/[0.04] hover:bg-black/10 dark:hover:bg-white/[0.08] text-[10px] text-amber-500 dark:text-amber-400 font-semibold transition-colors"
                    >
                      Balanceado (40%)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleThresholdChange(0.50)}
                      className="px-2 py-1 rounded-lg bg-black/5 dark:bg-white/[0.04] hover:bg-black/10 dark:hover:bg-white/[0.08] text-[10px] text-[var(--text-muted)] transition-colors"
                    >
                      Estrito (50%)
                    </button>
                  </div>

                  {thresholdFeedback && (
                    <span className="text-[10px] text-emerald-400 font-medium animate-in fade-in">
                      ✓ {thresholdFeedback}
                    </span>
                  )}
                </div>
              </div>

              {/* Dicas de Pronúncia */}
              <div className="p-3.5 rounded-xl bg-black/5 dark:bg-white/[0.02] border border-[var(--border-subtle)] text-[11px] text-[var(--text-muted)] space-y-1">
                <div className="font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                  <Mic size={13} className="text-amber-500 dark:text-amber-400" />
                  Dicas para máxima precisão de disparo:
                </div>
                <ul className="list-disc list-inside space-y-0.5 text-[var(--text-muted)] pl-1">
                  <li>
                    <strong>"Copérnico"</strong>: Enfatize a sílaba tônica <em>PÉR</em> (ex: <em>co-PÉR-ni-co</em>).
                  </li>
                  <li>
                    <strong>"Zefiro"</strong>: Pronuncie de forma clara (ex: <em>ZÉ-fi-ro</em>).
                  </li>
                  <li>
                    Se o seu score de pico chega a 35% ao falar, defina o limiar para <strong>30%</strong>.
                  </li>
                </ul>
              </div>
            </div>
          )}

          {/* ==================== SEÇÃO 2: VOZ E TTS ==================== */}
          {activeSection === "tts" && (
            <div className="space-y-5 animate-in fade-in duration-150">
              {/* Header do TTS */}
              <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Volume2 size={16} className="text-amber-500 dark:text-amber-400" />
                  <div>
                    <h4 className="text-xs font-semibold text-amber-500 dark:text-amber-300">
                      Síntese de Voz Neural (Microsoft Edge TTS)
                    </h4>
                    <p className="text-[11px] text-[var(--text-muted)]">
                      Respostas por voz ativadas unicamente quando o Copernico for chamado pela Wake Word.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-[10px] text-emerald-300 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  <span>Custo Zero / Neural</span>
                </div>
              </div>

              {/* Informação sobre as Regras do TTS */}
              <div className="p-3.5 rounded-xl bg-black/5 dark:bg-white/[0.02] border border-[var(--border-subtle)] text-[11px] text-[var(--text-muted)] space-y-1.5">
                <div className="font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                  <Sparkles size={13} className="text-amber-500 dark:text-amber-400" />
                  Regras de Execução Vocal:
                </div>
                <ul className="list-disc list-inside space-y-1 text-[var(--text-muted)] pl-1 text-[11px]">
                  <li>
                    <strong>Exclusivo para Wake Word:</strong> O assistente fala apenas quando ativado pelo comando de voz (<kbd className="px-1 py-0.5 rounded bg-black/20 dark:bg-white/10 font-mono text-[10px]">"Copérnico"</kbd> ... <kbd className="px-1 py-0.5 rounded bg-black/20 dark:bg-white/10 font-mono text-[10px]">"Lich"</kbd>). Interações manuais por texto permanecem 100% em silêncio.
                  </li>
                  <li>
                    <strong>Apenas Resposta Final:</strong> Ferramentas (*tool calls*), buscas semânticas em cofres e pensamentos rodam silenciosamente nos bastidores.
                  </li>
                  <li>
                    <strong>Interrupção Dinâmica (Barge-in):</strong> Falar "Copérnico" enquanto o assistente fala silencia o áudio imediatamente para ouvi-lo.
                  </li>
                </ul>
              </div>

              {/* Seletor de Voz & Teste de Áudio */}
              <div className="p-4 rounded-xl bg-[var(--bg-input)] border border-[var(--border-subtle)] space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-xs font-bold text-[var(--text-primary)] block">
                      Voz Neural do Assistente
                    </label>
                    <span className="text-[11px] text-[var(--text-muted)]">
                      Selecione o timbre desejado para as respostas faladas do Copernico
                    </span>
                  </div>

                  {voiceFeedback && (
                    <span className="text-[11px] text-emerald-400 font-semibold animate-in fade-in">
                      ✓ {voiceFeedback}
                    </span>
                  )}
                </div>

                {/* Grid de Seleção de Vozes */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-60 overflow-y-auto pr-1">
                  {ttsVoices.map((v) => {
                    const isSelected = selectedVoice === v.short_name;
                    return (
                      <div
                        key={v.short_name}
                        onClick={() => handleSelectVoice(v.short_name)}
                        className={`p-3 rounded-xl border cursor-pointer transition-all flex flex-col justify-between ${
                          isSelected
                            ? "bg-amber-500/10 border-amber-500/60 shadow-sm shadow-amber-500/10"
                            : "bg-black/10 dark:bg-white/[0.02] border-[var(--border-subtle)] hover:border-white/20 hover:bg-black/15"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <span className="text-xs font-semibold text-[var(--text-primary)] block truncate">
                              {v.friendly_name || v.name}
                            </span>
                            <span className="text-[10px] text-[var(--text-muted)] font-mono">
                              {v.short_name}
                            </span>
                          </div>
                          <span
                            className={`text-[9px] px-1.5 py-0.5 rounded font-semibold shrink-0 ${
                              v.gender === "Female"
                                ? "bg-purple-500/20 text-purple-300"
                                : "bg-blue-500/20 text-blue-300"
                            }`}
                          >
                            {v.gender === "Female" ? "Feminina" : "Masculina"}
                          </span>
                        </div>

                        {v.short_name === "pt-BR-ThalitaNeural" && (
                          <div className="mt-2 text-[10px] text-amber-500 dark:text-amber-400 font-semibold flex items-center gap-1">
                            ★ Padrão do Copernico
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Painel Inferior com Botão para Testar Amostra */}
                <div className="flex items-center justify-between pt-3 border-t border-[var(--border-subtle)]">
                  <div className="text-[11px] text-[var(--text-muted)]">
                    Voz em uso: <strong className="text-[var(--text-primary)] font-mono">{selectedVoice}</strong>
                  </div>

                  <button
                    type="button"
                    onClick={handleTestVoice}
                    disabled={isLoadingVoices}
                    className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all shadow-md ${
                      isTestingVoice
                        ? "bg-rose-500 hover:bg-rose-600 text-white shadow-rose-500/20"
                        : "bg-amber-500 hover:bg-amber-400 text-neutral-950 shadow-amber-500/20"
                    }`}
                  >
                    {isTestingVoice ? (
                      <>
                        <Square size={13} fill="currentColor" />
                        <span>Parar Demonstração</span>
                      </>
                    ) : (
                      <>
                        <Play size={13} fill="currentColor" />
                        <span>Ouvir Exemplo</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ==================== SEÇÃO 3: SYSTEM PROMPTS ==================== */}
          {activeSection === "prompts" && (
            <div className="space-y-4 animate-in fade-in duration-150">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-semibold text-neutral-200">
                    Instruções e Personas do Assistente
                  </h4>
                  <p className="text-[11px] text-neutral-400 mt-0.5">
                    Defina comportamentos distintos para tela aberta vs interação por voz.
                  </p>
                </div>

                {/* Botões de Ação para a aba ativa de prompts */}
                <div className="flex items-center gap-2 shrink-0 ml-3">
                  {promptTab === "visual" ? (
                    <>
                      <button
                        type="button"
                        onClick={handleResetPrompt}
                        disabled={isSavingPrompt}
                        className="px-2.5 py-1.5 rounded-xl bg-white/[0.03] hover:bg-white/[0.08] border border-white/5 text-[11px] text-neutral-400 hover:text-neutral-200 flex items-center gap-1 transition-all"
                        title="Restaurar padrão original do prompt visual"
                      >
                        <RotateCcw size={12} />
                        <span>Restaurar</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleSavePrompt}
                        disabled={isSavingPrompt || systemPrompt === initialPrompt}
                        className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-xs font-semibold text-neutral-950 flex items-center gap-1.5 transition-all shadow-md shadow-amber-500/20"
                      >
                        <Check size={13} />
                        <span>{isSavingPrompt ? "Salvando..." : "Salvar Visual"}</span>
                      </button>
                    </>
                  ) : promptTab === "voice" ? (
                    <>
                      <button
                        type="button"
                        onClick={handleResetVoicePrompt}
                        disabled={isSavingVoicePrompt}
                        className="px-2.5 py-1.5 rounded-xl bg-white/[0.03] hover:bg-white/[0.08] border border-white/5 text-[11px] text-neutral-400 hover:text-neutral-200 flex items-center gap-1 transition-all"
                        title="Restaurar padrão original do prompt de voz"
                      >
                        <RotateCcw size={12} />
                        <span>Restaurar</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveVoicePrompt}
                        disabled={isSavingVoicePrompt || voicePrompt === initialVoicePrompt}
                        className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-xs font-semibold text-neutral-950 flex items-center gap-1.5 transition-all shadow-md shadow-amber-500/20"
                      >
                        <Check size={13} />
                        <span>{isSavingVoicePrompt ? "Salvando..." : "Salvar Voz"}</span>
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={handleSaveProfile}
                      disabled={isSavingProfile}
                      className="px-3 py-1.5 rounded-xl bg-purple-500 hover:bg-purple-400 disabled:opacity-50 text-xs font-semibold text-white flex items-center gap-1.5 transition-all shadow-md shadow-purple-500/20"
                    >
                      <Check size={13} />
                      <span>{isSavingProfile ? "Salvando..." : "Salvar Perfil"}</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Sub-Abas Visual vs Voz vs Perfil */}
              <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] pb-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => setPromptTab("visual")}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-all ${
                    promptTab === "visual"
                      ? "bg-amber-500/20 border border-amber-500/40 text-amber-300 shadow-sm"
                      : "bg-white/[0.02] border border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/[0.05]"
                  }`}
                >
                  <span>💻 Overlay Aberto (Visual)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPromptTab("voice")}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-all ${
                    promptTab === "voice"
                      ? "bg-amber-500/20 border border-amber-500/40 text-amber-300 shadow-sm"
                      : "bg-white/[0.02] border border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/[0.05]"
                  }`}
                >
                  <span>🎙️ Overlay Fechado (Voz)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPromptTab("perfil")}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-all ${
                    promptTab === "perfil"
                      ? "bg-purple-500/20 border border-purple-500/40 text-purple-300 shadow-sm"
                      : "bg-white/[0.02] border border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/[0.05]"
                  }`}
                >
                  <span>👤 Perfil & Autoaprendizado</span>
                </button>
              </div>

              {isLoadingPrompt ? (
                <div className="h-48 flex items-center justify-center text-xs text-[var(--text-muted)] gap-2">
                  <Sparkles size={14} className="animate-spin text-amber-400" />
                  <span>Carregando prompts atuais...</span>
                </div>
              ) : promptTab === "visual" ? (
                <div className="space-y-2 animate-in fade-in duration-150">
                  <p className="text-[11px] text-[var(--text-muted)]">
                    Usado quando a janela do Copernico está aberta na tela. Formatação rica em Markdown, tópicos e links de notas [[wikilinks]].
                  </p>
                  <textarea
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    rows={9}
                    placeholder="Digite as instruções do System Prompt Visual..."
                    className="w-full bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded-xl p-3 text-xs text-[var(--text-primary)] font-mono leading-relaxed placeholder-[var(--text-muted)] focus:outline-none focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/20 transition-colors resize-y select-text"
                  />
                  {promptFeedback && (
                    <p className="text-[11px] text-emerald-400 font-medium animate-in fade-in">
                      ✓ {promptFeedback}
                    </p>
                  )}
                </div>
              ) : promptTab === "voice" ? (
                <div className="space-y-2 animate-in fade-in duration-150">
                  <p className="text-[11px] text-[var(--text-muted)]">
                    Usado quando o Copernico responde por voz em segundo plano (overlay fechado). Respostas curtas, fluidas e sem nenhum markdown.
                  </p>
                  <textarea
                    value={voicePrompt}
                    onChange={(e) => setVoicePrompt(e.target.value)}
                    rows={9}
                    placeholder="Digite as instruções do System Prompt de Voz..."
                    className="w-full bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded-xl p-3 text-xs text-[var(--text-primary)] font-mono leading-relaxed placeholder-[var(--text-muted)] focus:outline-none focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/20 transition-colors resize-y select-text"
                  />
                  {voicePromptFeedback && (
                    <p className="text-[11px] text-emerald-400 font-medium animate-in fade-in">
                      ✓ {voicePromptFeedback}
                    </p>
                  )}
                </div>
              ) : (
                /* Aba Perfil & Autoaprendizado */
                <div className="space-y-4 animate-in fade-in duration-150">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold text-[var(--text-secondary)]">
                        Nome do Usuário
                      </label>
                      <input
                        type="text"
                        value={userName}
                        onChange={(e) => setUserName(e.target.value)}
                        placeholder="Como o Copernico deve te chamar..."
                        className="w-full bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-purple-500/50 rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] outline-none"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold text-[var(--text-secondary)]">
                        Atalho Global (Hotkey)
                      </label>
                      <input
                        type="text"
                        value={userHotkey}
                        onChange={(e) => setUserHotkey(e.target.value)}
                        placeholder="Ex: Ctrl+Space"
                        className="w-full bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-purple-500/50 rounded-xl px-3 py-2 text-xs font-mono text-[var(--text-primary)] outline-none"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold text-[var(--text-secondary)]">
                      Estilo de Comunicação
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {[
                        { id: "direto_conciso", label: "Direto & Sintético", desc: "Objetivo e sem rodeios" },
                        { id: "tecnico_analitico", label: "Técnico & Analítico", desc: "Profundo e estruturado" },
                        { id: "amigavel_conversacional", label: "Amigável & Empático", desc: "Caloroso e consultivo" },
                      ].map((st) => (
                        <button
                          key={st.id}
                          type="button"
                          onClick={() => setUserStyle(st.id)}
                          className={`p-2.5 rounded-xl border text-left transition-all ${
                            userStyle === st.id
                              ? "bg-purple-500/15 border-purple-500/50 text-purple-300 font-bold"
                              : "bg-white/[0.02] border-[var(--border-subtle)] text-[var(--text-muted)] hover:bg-white/[0.05]"
                          }`}
                        >
                          <div className="text-xs">{st.label}</div>
                          <div className="text-[10px] text-[var(--text-muted)] font-normal">{st.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1.5 pt-1">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-semibold text-[var(--text-secondary)]">
                        Diretrizes & Regras Aprendidas (Autoaprendizado)
                      </label>
                      <span className="text-[10px] text-[var(--text-muted)] font-mono">
                        agent_custom_instructions
                      </span>
                    </div>
                    <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                      Regras que o Copernico aprendeu a partir de atritos, correções de busca ou preferências aprovadas na Inbox. Você pode editar ou adicionar novas regras livremente aqui:
                    </p>
                    <textarea
                      value={customInstructions}
                      onChange={(e) => setCustomInstructions(e.target.value)}
                      rows={5}
                      placeholder="- Ao buscar notas por data, sempre utilize também o formato numérico YYYY-MM-DD..."
                      className="w-full bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded-xl p-3 text-xs text-[var(--text-primary)] font-mono leading-relaxed placeholder-[var(--text-muted)] focus:outline-none focus:border-purple-500/60 focus:ring-1 focus:ring-purple-500/20 transition-colors resize-y select-text"
                    />
                  </div>

                  {profileFeedback && (
                    <p className="text-[11px] text-emerald-400 font-medium animate-in fade-in">
                      ✓ {profileFeedback}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ==================== SEÇÃO 3: COFRES & VETORES ==================== */}
          {activeSection === "brain" && (
            <div className="space-y-6 animate-in fade-in duration-150">
              {/* Pasta dos Cofres */}
              <div className="space-y-3 pb-5 border-b border-[var(--border-subtle)]">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-2">
                      <FolderOpen size={15} className="text-amber-400" />
                      Cérebro do Agente (Cofres de Notas)
                    </h4>
                    <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                      Abra o diretório local no Explorador de Arquivos para inspecionar ou gerenciar notas manualmente.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleOpenFolder}
                    className="px-3 py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-[var(--border-subtle)] hover:border-amber-500/40 text-xs font-medium text-[var(--text-primary)] hover:text-amber-300 flex items-center gap-1.5 transition-all shrink-0 ml-3"
                  >
                    <ExternalLink size={13} className="text-amber-400" />
                    <span>Abrir Pasta</span>
                  </button>
                </div>
                {folderFeedback && (
                  <p className="text-[11px] text-emerald-400 font-medium animate-in fade-in">
                    ✓ {folderFeedback}
                  </p>
                )}
              </div>

              {/* Reindexação Vetorial */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-2">
                      <Database size={15} className="text-amber-400" />
                      Reindexar Banco de Dados Vetorial
                    </h4>
                    <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                      Gera embeddings locais (FastEmbed) para novas notas e atualizações nos cofres Default e Obsidian.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleReindex}
                    disabled={isReindexing}
                    className="px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-xs font-semibold text-amber-300 hover:text-amber-200 flex items-center gap-1.5 transition-all shrink-0 ml-3 disabled:opacity-50"
                  >
                    <RefreshCw size={13} className={isReindexing ? "animate-spin text-amber-400" : ""} />
                    <span>{isReindexing ? "Indexando..." : "Reindexar Agora"}</span>
                  </button>
                </div>
                {reindexFeedback && (
                  <p className="text-[11px] text-emerald-400 font-medium animate-in fade-in">
                    ✓ {reindexFeedback}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* ==================== SEÇÃO 5: PLUGINS, MCP, SKILLS & TEMAS ==================== */}
          {activeSection === "plugins" && (
            <div className="space-y-6 animate-in fade-in duration-150">
              {/* Header com Descrição e Botão Recarregar */}
              <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/25 flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <h4 className="text-xs font-bold text-amber-500 dark:text-amber-400 flex items-center gap-2">
                    <Boxes size={16} />
                    Ecossistema Modular Copernico
                  </h4>
                  <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                    Arquitetura aberta para desenvolvedores. Adicione ferramentas em <strong>Python, Node ou Rust</strong> via protocolo <strong>MCP</strong>, agende <strong>Skills autônomas</strong>, e altere estilos com <strong>CSS livre</strong>.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={loadPluginsData}
                  disabled={isLoadingPlugins}
                  className="px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-xs font-semibold text-amber-400 hover:text-amber-300 flex items-center gap-1.5 transition-all shrink-0 disabled:opacity-50"
                >
                  <RefreshCw size={12} className={isLoadingPlugins ? "animate-spin text-amber-400" : ""} />
                  <span>Recarregar</span>
                </button>
              </div>

              {skillFeedback && (
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-400 flex items-center justify-between gap-3 animate-in fade-in">
                  <div className="flex items-center gap-2">
                    <Check size={14} className="text-emerald-400 shrink-0" />
                    <span>{skillFeedback}</span>
                  </div>
                  {lastExecutedSessionId && onOpenSession && (
                    <button
                      type="button"
                      onClick={() => onOpenSession(lastExecutedSessionId)}
                      className="px-2.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-[11px] font-bold text-emerald-300 flex items-center gap-1 transition-all shrink-0"
                    >
                      <Eye size={12} />
                      <span>Abrir Sessão no Chat</span>
                    </button>
                  )}
                </div>
              )}

              {/* 1. Módulos & Plugins Instalados */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-2">
                    <Layers size={14} className="text-amber-400" />
                    Plugins Instalados ({plugins.length})
                  </h4>
                  <span className="text-[10px] text-[var(--text-muted)] font-mono">diretório: plugins/</span>
                </div>

                {plugins.length === 0 ? (
                  <div className="p-4 rounded-xl border border-dashed border-[var(--border-subtle)] text-center text-xs text-[var(--text-muted)]">
                    Nenhum plugin encontrado em <code>plugins/</code>. Crie subpastas com <code>copernico-plugin.yaml</code>.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {plugins.map((plug) => (
                      <div
                        key={plug.id}
                        className="p-3 rounded-xl bg-[var(--bg-input)] border border-[var(--border-subtle)] flex items-center justify-between gap-3 hover:border-amber-500/30 transition-colors"
                      >
                        <div className="space-y-0.5 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-xs text-[var(--text-primary)] truncate">
                              {plug.name}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30 uppercase font-mono font-bold">
                              {plug.type}
                            </span>
                            <span className="text-[10px] text-[var(--text-muted)] font-mono">
                              v{plug.version}
                            </span>
                          </div>
                          {plug.description && (
                            <p className="text-[11px] text-[var(--text-muted)] truncate">
                              {plug.description}
                            </p>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => handleTogglePlugin(plug.id, plug.enabled)}
                          className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all shrink-0 ${
                            plug.enabled
                              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 hover:bg-emerald-500/30"
                              : "bg-black/20 dark:bg-white/5 text-[var(--text-muted)] border border-[var(--border-subtle)] hover:text-[var(--text-primary)]"
                          }`}
                        >
                          <Power size={11} className={plug.enabled ? "text-emerald-400" : "text-[var(--text-muted)]"} />
                          <span>{plug.enabled ? "Ativo" : "Desativado"}</span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 2. Servidores MCP (Sob Demanda) */}
              <div className="space-y-3 pt-3 border-t border-[var(--border-subtle)]">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-2">
                    <Zap size={14} className="text-amber-400" />
                    Servidores MCP (Sob Demanda)
                  </h4>
                  <span className="text-[10px] text-[var(--text-muted)] font-mono">0 MB RAM em Repouso</span>
                </div>

                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-[var(--text-muted)] leading-relaxed space-y-1">
                  <span className="font-semibold text-amber-700 dark:text-amber-300 block">
                    Zero consumo de memória em segundo plano:
                  </span>
                  <p>
                    Diferente de abordagens tradicionais que mantêm processos MCP rodando permanentemente consumindo RAM, o Copernico inicializa servidores MCP exclusivamente sob demanda quando uma ferramenta correspondente for solicitada.
                  </p>
                </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold text-[var(--text-primary)]">
                          Configuração JSON (<code>plugins/mcp-servers.json</code>)
                        </label>
                        <button
                          type="button"
                          onClick={() => {
                            setMcpConfigText(
                              JSON.stringify(
                                {
                                  mcpServers: {
                                    "google-calendar": {
                                      command: "npx",
                                      args: ["-y", "@modelcontextprotocol/server-google-calendar"],
                                      env: {},
                                    },
                                  },
                                },
                                null,
                                2
                              )
                            );
                          }}
                          className="text-[10px] text-amber-600 dark:text-amber-400 hover:underline"
                        >
                          Inserir Modelo de Exemplo
                        </button>
                      </div>

                      <textarea
                        rows={7}
                        value={mcpConfigText}
                        onChange={(e) => setMcpConfigText(e.target.value)}
                        placeholder='{\n  "mcpServers": {}\n}'
                        className="w-full px-3 py-2 rounded-xl bg-[var(--bg-input)] border border-[var(--border-subtle)] text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:border-amber-500/60 resize-none leading-relaxed"
                        spellCheck={false}
                      />

                      {mcpConfigFeedback && (
                        <div
                          className={`p-2.5 rounded-xl text-xs flex items-center gap-2 ${
                            mcpConfigFeedback.type === "success"
                              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30"
                              : "bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30"
                          }`}
                        >
                          {mcpConfigFeedback.type === "success" ? (
                            <Check size={14} className="text-emerald-500 shrink-0" />
                          ) : (
                            <AlertCircle size={14} className="text-rose-500 shrink-0" />
                          )}
                          <span>{mcpConfigFeedback.msg}</span>
                        </div>
                      )}

                      <div className="flex items-center justify-end">
                        <button
                          type="button"
                          onClick={handleSaveMcpConfig}
                          disabled={isSavingMcpConfig}
                          className="px-4 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-neutral-950 font-medium text-xs transition-colors shadow-sm flex items-center gap-1.5 disabled:opacity-50"
                        >
                          {isSavingMcpConfig ? (
                            <>
                              <Loader2 size={13} className="animate-spin" />
                              <span>Salvando...</span>
                            </>
                          ) : (
                            <>
                              <Check size={13} />
                              <span>Salvar Configuração MCP</span>
                            </>
                          )}
                        </button>
                      </div>

                      {/* Status dos Servidores MCP */}
                      {mcpServers.length > 0 && (
                        <div className="mt-3 p-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-[var(--text-primary)]">Status dos Servidores ({mcpServers.length})</span>
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  const s = await api.getMcpServersStatus();
                                  setMcpServers(s);
                                } catch {}
                              }}
                              className="text-[11px] text-amber-600 dark:text-amber-400 hover:underline flex items-center gap-1"
                            >
                              <RefreshCw size={11} />
                              Atualizar
                            </button>
                          </div>
                          <div className="space-y-1.5">
                            {mcpServers.map((srv) => (
                              <div key={srv.id} className={`p-2.5 rounded-xl border flex items-center justify-between text-xs ${srv.status === "ready" ? "bg-emerald-500/10 border-emerald-500/30" : srv.status === "error" ? "bg-rose-500/10 border-rose-500/30" : srv.status === "starting" ? "bg-amber-500/10 border-amber-500/30" : "bg-[var(--bg-input)] border-[var(--border-subtle)]"}`}>
                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                  <span className={`w-2 h-2 rounded-full shrink-0 ${srv.status === "ready" ? "bg-emerald-500" : srv.status === "error" ? "bg-rose-500" : srv.status === "starting" ? "bg-amber-500 animate-pulse" : "bg-neutral-500"}`} />
                                  <span className="font-mono font-medium text-[var(--text-primary)] truncate">{srv.id}</span>
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono uppercase ${srv.status === "ready" ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300" : srv.status === "error" ? "bg-rose-500/20 text-rose-700 dark:text-rose-300" : "bg-black/5 dark:bg-white/5 text-[var(--text-muted)]"}`}>{srv.status}</span>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <span className="text-[11px] text-[var(--text-muted)]">{srv.tool_count} tool(s)</span>
                                  {srv.error && <span className="text-[11px] text-rose-600 dark:text-rose-400 truncate max-w-[160px]" title={srv.error}>{srv.error}</span>}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {mcpServers.length === 0 && (
                        <div className="mt-3 p-2.5 rounded-xl bg-[var(--bg-input)] border border-[var(--border-subtle)] text-[11px] text-[var(--text-muted)] text-center">
                          Nenhum servidor MCP ativo. Cole a configuração acima e salve para inicializar.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 3. Skills & Rotinas Autônomas (Modais Dedicados) */}
                  <div className="space-y-3 pt-3 border-t border-[var(--border-subtle)]">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-2">
                        <Bot size={14} className="text-amber-400" />
                        Skills & Rotinas Autônomas
                      </h4>
                      <span className="text-[10px] text-[var(--text-muted)]">Padrão Aberto skills.sh</span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="p-3.5 rounded-2xl bg-[var(--bg-input)] border border-[var(--border-subtle)] flex flex-col justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Sparkles size={16} className="text-amber-500" />
                            <span className="font-semibold text-xs text-[var(--text-primary)]">Hub de Skills</span>
                          </div>
                          <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                            Gerencie skills baseadas no padrão aberto <strong>skills.sh</strong> com suporte a scripts Python locais e diretrizes cognitivas.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            if (onOpenSkills) onOpenSkills();
                          }}
                          className="w-full py-1.5 px-3 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-xs font-medium text-amber-700 dark:text-amber-300 transition-colors flex items-center justify-center gap-1.5"
                        >
                          <Sparkles size={13} />
                          <span>Abrir Hub de Skills</span>
                        </button>
                      </div>

                      <div className="p-3.5 rounded-2xl bg-[var(--bg-input)] border border-[var(--border-subtle)] flex flex-col justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Clock size={16} className="text-amber-500" />
                            <span className="font-semibold text-xs text-[var(--text-primary)]">Agendador de Rotinas</span>
                          </div>
                          <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                            Programe tarefas periódicas (curadoria de notas, reflexões e resumos) com entrega direta na Inbox do Copernico.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            if (onOpenRoutines) onOpenRoutines();
                          }}
                          className="w-full py-1.5 px-3 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-xs font-medium text-amber-700 dark:text-amber-300 transition-colors flex items-center justify-center gap-1.5"
                        >
                          <Clock size={13} />
                          <span>Abrir Agendador de Rotinas</span>
                        </button>
                      </div>
                    </div>
                  </div>

              {/* 4. Temas Visuais (CSS Livre) */}
              <div className="space-y-3 pt-3 border-t border-[var(--border-subtle)]">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-2">
                    <Palette size={14} className="text-amber-400" />
                    Temas Visuais (CSS Livre)
                  </h4>
                  <span className="text-[10px] text-[var(--text-muted)]">Personalização Visual</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                  {/* Tema Padrão do Copernico */}
                  <div
                    onClick={() => handleApplyTheme(null)}
                    className={`p-3 rounded-xl border cursor-pointer transition-all ${
                      activeTheme === "default" || !activeTheme
                        ? "bg-amber-500/15 border-amber-500/60 shadow-sm shadow-amber-500/10"
                        : "bg-[var(--bg-input)] border-[var(--border-subtle)] hover:border-amber-500/30"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-xs text-[var(--text-primary)]">Solar Dourado (Padrão)</span>
                      {(activeTheme === "default" || !activeTheme) && (
                        <Check size={13} className="text-amber-400" />
                      )}
                    </div>
                    <p className="text-[10px] text-[var(--text-muted)] line-clamp-2">
                      Visual oficial do Copernico com acentos em âmbar solar e vidro espelhado.
                    </p>
                  </div>

                  {/* Temas customizados de plugins/themes/ */}
                  {themes.map((thm) => {
                    const isSelected = activeTheme === thm.id;
                    return (
                      <div
                        key={thm.id}
                        onClick={() => handleApplyTheme(thm)}
                        className={`p-3 rounded-xl border cursor-pointer transition-all ${
                          isSelected
                            ? "bg-amber-500/15 border-amber-500/60 shadow-sm shadow-amber-500/10"
                            : "bg-[var(--bg-input)] border-[var(--border-subtle)] hover:border-amber-500/30"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-bold text-xs text-[var(--text-primary)]">{thm.name}</span>
                          {isSelected && <Check size={13} className="text-amber-400" />}
                        </div>
                        <p className="text-[10px] text-[var(--text-muted)] line-clamp-2">
                          {thm.description || "Tema CSS customizado"}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 bg-[var(--bg-card)] border-t border-[var(--border-subtle)] px-4 flex items-center justify-between text-[11px] text-[var(--text-muted)]">
          <span>Pressione <kbd className="px-1.5 py-0.5 bg-[var(--bg-input)] border border-[var(--border-subtle)] text-[var(--text-muted)] rounded text-[10px]">Esc</kbd> para fechar</span>
          <span>Copernico AI • Second Brain</span>
        </div>
      </div>
    </div>
  );
};

