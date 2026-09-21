import React, { useState, useEffect, useMemo } from "react";
import {
  X,
  Sparkles,
  Download,
  ExternalLink,
  Trash2,
  FolderOpen,
  Search,
  Check,
  Loader2,
  Brain,
  RefreshCw,
  AlertCircle,
  Code2,
  ChevronDown,
  ChevronUp,
  ArrowRight,
} from "lucide-react";
import { api } from "../api";
import { SkillInfo } from "../types";
import { DeleteConfirmModal } from "./DeleteConfirmModal";

interface SkillsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function cleanTerminalLog(text: string): string {
  if (!text) return "";
  return text
    // Remove ANSI escape sequences like \x1b[38;5;250m, \x1b[0m, etc.
    .replace(/(\x1b\[|\x9b)[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b\[[0-9;?]*[a-zA-Z]/g, "")
    // Remove terminal control codes like [1G, [Jo, [25l, [?25h
    .replace(/\[\d+[A-Za-z]/g, "")
    .replace(/\[\?25[hl]/g, "")
    .replace(/\[Jo/g, "")
    .replace(/[\u0000-\u0008\u000B-\u001A\u001C-\u001F]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    // Deduplicate consecutive progress lines
    .split("\n")
    .map((l) => l.trim())
    .filter((line, idx, arr) => line.length > 0 && (idx === 0 || line !== arr[idx - 1]))
    .join("\n")
    .trim();
}

const CURATED_SKILLS = [
  {
    repo: "browser-use/browser-use",
    name: "Browser Use",
    desc: "Navegação autônoma em páginas da web e extração de dados.",
    type: "python",
  },
  {
    repo: "anthropics/anthropic-quickstarts",
    name: "Computer Use Tools",
    desc: "Ações de desktop, automação de cliques e digitação.",
    type: "python",
  },
  {
    repo: "github/copilot-cli",
    name: "GitHub & Git Skills",
    desc: "Comandos Git, auditoria de repositórios e branches.",
    type: "cognitive",
  },
  {
    repo: "alex-o-smith/skills",
    name: "Daily Briefing & Summaries",
    desc: "Geração de resumos executivos diários e condensação de notas.",
    type: "cognitive",
  },
];

export const SkillsModal: React.FC<SkillsModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<"my-skills" | "hub">("my-skills");
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Install tab state
  const [installSource, setInstallSource] = useState("");
  const [isInstalling, setIsInstalling] = useState(false);
  const [installFeedback, setInstallFeedback] = useState<{
    type: "success" | "error";
    title: string;
    subtitle: string;
    detail?: string;
  } | null>(null);
  const [showLogDetails, setShowLogDetails] = useState(false);

  // Deleting state
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [skillToDelete, setSkillToDelete] = useState<SkillInfo | null>(null);
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());

  const loadSkills = async () => {
    setIsLoading(true);
    try {
      const res = await api.listSkills();
      setSkills(res);
    } catch (err) {
      console.error("Falha ao listar skills:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadSkills();
      setInstallFeedback(null);
    }
  }, [isOpen]);

  const filteredSkills = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return skills;
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q)
    );
  }, [skills, searchQuery]);

  const handleToggle = async (skill: SkillInfo) => {
    if (togglingIds.has(skill.id)) return;
    setTogglingIds((prev) => new Set(prev).add(skill.id));
    const newStatus = !skill.is_enabled;
    // Optimistic update
    setSkills((prev) =>
      prev.map((s) => (s.id === skill.id ? { ...s, is_enabled: newStatus } : s))
    );
    try {
      await api.toggleSkill(skill.id, newStatus);
    } catch (err) {
      console.error("Erro ao alternar skill:", err);
      // Revert on error
      setSkills((prev) =>
        prev.map((s) => (s.id === skill.id ? { ...s, is_enabled: !newStatus } : s))
      );
    } finally {
      setTogglingIds((prev) => {
        const ns = new Set(prev);
        ns.delete(skill.id);
        return ns;
      });
    }
  };

  const handleDelete = (skill: SkillInfo) => {
    setSkillToDelete(skill);
  };

  const handleConfirmDelete = async () => {
    if (!skillToDelete) return;
    const skillId = skillToDelete.id;
    setDeletingId(skillId);
    try {
      await api.deleteSkill(skillId);
      setSkills((prev) => prev.filter((s) => s.id !== skillId));
      setSkillToDelete(null);
    } catch (err) {
      alert(`Falha ao remover skill: ${String(err)}`);
    } finally {
      setDeletingId(null);
    }
  };

  const handleOpenFolder = async () => {
    try {
      await api.openSkillsFolder();
    } catch (err) {
      alert(`Não foi possível abrir a pasta de skills: ${String(err)}`);
    }
  };

  const handleInstall = async (source: string) => {
    const src = source.trim();
    if (!src) return;
    setIsInstalling(true);
    setInstallFeedback(null);
    setShowLogDetails(false);

    // Extrai nome amigável para exibição (ex: "browser-use" ou "author/skill")
    const cleanName = src
      .replace(/^https?:\/\/(www\.)?skills\.sh\//i, "")
      .replace(/\.git$/i, "")
      .split("/")
      .filter(Boolean)
      .slice(-2)
      .join("/") || src;

    try {
      const rawLog = await api.installSkillFromSource(src);
      const cleanedLog = cleanTerminalLog(rawLog);
      setInstallFeedback({
        type: "success",
        title: `Skill "${cleanName}" instalada com sucesso!`,
        subtitle: "A skill já está disponível no seu Copernico e pronta para uso no chat ou ativação.",
        detail: cleanedLog,
      });
      setInstallSource("");
      await loadSkills();
    } catch (err) {
      const errStr = String(err);
      const cleanedErr = cleanTerminalLog(errStr);
      setInstallFeedback({
        type: "error",
        title: `Não foi possível instalar "${cleanName}"`,
        subtitle: "Verifique se o repositório ou link existe e se há conexão com a internet.",
        detail: cleanedErr,
      });
    } finally {
      setIsInstalling(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-2xl max-h-[85vh] bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-[var(--text-primary)] transition-colors">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[var(--border-subtle)] flex items-center justify-between bg-[var(--bg-input)] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-amber-500/15 text-amber-500 border border-amber-500/30">
              <Sparkles size={18} />
            </div>
            <div>
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <span>Hub de Skills & Extensões</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400 font-mono font-medium">
                  Standard skills.sh
                </span>
              </h2>
              <p className="text-[11px] text-[var(--text-muted)]">
                Capacidades agênticas modulares com suporte a instruções cognitivas e execução Python local.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="px-5 pt-3 pb-0 border-b border-[var(--border-subtle)] flex items-center justify-between shrink-0 bg-[var(--bg-card)]">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab("my-skills")}
              className={`pb-2.5 px-2 text-xs font-medium border-b-2 transition-all flex items-center gap-1.5 ${
                activeTab === "my-skills"
                  ? "border-amber-500 text-amber-600 dark:text-amber-400 font-semibold"
                  : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              }`}
            >
              <span>Minhas Skills</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-black/5 dark:bg-white/5 border border-[var(--border-subtle)]">
                {skills.length}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("hub")}
              className={`pb-2.5 px-2 text-xs font-medium border-b-2 transition-all flex items-center gap-1.5 ${
                activeTab === "hub"
                  ? "border-amber-500 text-amber-600 dark:text-amber-400 font-semibold"
                  : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              }`}
            >
              <Download size={13} />
              <span>Instalar / Hub da Comunidade</span>
            </button>
          </div>

          <div className="flex items-center gap-2 pb-2">
            <button
              type="button"
              onClick={handleOpenFolder}
              className="text-[11px] px-2.5 py-1 rounded-lg bg-[var(--bg-input)] hover:bg-amber-500/15 border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-amber-600 dark:hover:text-amber-400 transition-colors flex items-center gap-1.5"
              title="Abrir pasta de skills no Windows Explorer"
            >
              <FolderOpen size={13} />
              <span>Abrir Pasta</span>
            </button>
            <button
              type="button"
              onClick={loadSkills}
              disabled={isLoading}
              className="p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/5 transition-colors disabled:opacity-50"
              title="Recarregar skills"
            >
              <RefreshCw size={13} className={isLoading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {activeTab === "my-skills" ? (
            <>
              {/* Search Bar */}
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Pesquisar skills instaladas..."
                  className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-[var(--bg-input)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-amber-500/60"
                />
              </div>

              {/* Skills List */}
              {isLoading ? (
                <div className="py-12 flex flex-col items-center justify-center gap-2 text-xs text-[var(--text-muted)]">
                  <Loader2 size={20} className="animate-spin text-amber-500" />
                  <span>Carregando skills instaladas...</span>
                </div>
              ) : filteredSkills.length === 0 ? (
                <div className="py-12 text-center space-y-2 border border-dashed border-[var(--border-subtle)] rounded-2xl p-6">
                  <Sparkles size={28} className="mx-auto text-amber-500/50" />
                  <p className="text-xs font-medium text-[var(--text-primary)]">
                    {searchQuery ? "Nenhuma skill encontrada para a busca." : "Nenhuma skill instalada ainda."}
                  </p>
                  <p className="text-[11px] text-[var(--text-muted)] max-w-sm mx-auto">
                    Você pode instalar skills pelo Hub na aba ao lado ou adicionar pastas com <code>SKILL.md</code> na pasta de skills.
                  </p>
                  {!searchQuery && (
                    <button
                      type="button"
                      onClick={() => setActiveTab("hub")}
                      className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-neutral-950 text-xs font-medium transition-colors shadow-sm"
                    >
                      <Download size={13} />
                      <span>Explorar Hub de Skills</span>
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-2.5">
                  {filteredSkills.map((skill) => (
                    <div
                      key={skill.id}
                      className={`p-3.5 rounded-2xl bg-[var(--bg-input)] border transition-all ${
                        skill.is_enabled
                          ? "border-[var(--border-subtle)] hover:border-amber-500/40"
                          : "border-[var(--border-subtle)] opacity-60"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1 min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-xs text-[var(--text-primary)]">
                              {skill.name}
                            </span>
                            <span className="text-[10px] font-mono text-[var(--text-muted)]">
                              /{skill.id}
                            </span>
                            {skill.has_scripts ? (
                              <span className="text-[9px] px-2 py-0.5 rounded-full font-mono bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                                <Code2 size={10} />
                                <span>Python Local</span>
                              </span>
                            ) : (
                              <span className="text-[9px] px-2 py-0.5 rounded-full font-mono bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border border-cyan-500/30 flex items-center gap-1">
                                <Brain size={10} />
                                <span>Cognitiva</span>
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-[var(--text-muted)] line-clamp-2 leading-relaxed">
                            {skill.description || "Sem descrição informada no SKILL.md."}
                          </p>
                        </div>

                        {/* Controls: Active Toggle & Delete */}
                        <div className="flex items-center gap-2 shrink-0 pt-0.5">
                          <button
                            type="button"
                            onClick={() => handleToggle(skill)}
                            disabled={togglingIds.has(skill.id)}
                            className={`w-9 h-5 rounded-full transition-colors relative p-0.5 focus:outline-none disabled:opacity-50 ${
                              skill.is_enabled ? "bg-amber-500" : "bg-neutral-600 dark:bg-neutral-700"
                            }`}
                            title={skill.is_enabled ? "Desativar skill" : "Ativar skill"}
                          >
                            <span
                              className={`block w-4 h-4 rounded-full bg-white transition-transform ${
                                skill.is_enabled ? "translate-x-4" : "translate-x-0"
                              }`}
                            />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(skill)}
                            disabled={deletingId === skill.id}
                            className="p-1 text-[var(--text-muted)] hover:text-rose-500 rounded-lg hover:bg-rose-500/10 transition-colors disabled:opacity-50"
                            title="Remover skill"
                          >
                            {deletingId === skill.id ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <Trash2 size={14} />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              {/* Hub & Installation View */}
              <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/25 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300 font-medium text-xs">
                    <Sparkles size={14} />
                    <span>Padrão Aberto skills.sh</span>
                  </div>
                  <a
                    href="https://www.skills.sh/"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-amber-600 dark:text-amber-400 hover:underline flex items-center gap-1 font-medium"
                  >
                    <span>Explorar catálogo completo</span>
                    <ExternalLink size={11} />
                  </a>
                </div>
                <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                  O Copernico suporta nativamente qualquer skill compatível com a comunidade <strong>skills.sh</strong>.
                  Basta colar o link da skill ou o identificador <code>owner/repo</code> abaixo para instalação automática.
                </p>
              </div>

              {/* Install by Input */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-[var(--text-primary)]">
                  Instalar via Link ou Pacote
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={installSource}
                    onChange={(e) => setInstallSource(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !isInstalling) {
                        handleInstall(installSource);
                      }
                    }}
                    placeholder="ex: owner/repo ou https://skills.sh/autor/skill"
                    className="flex-1 px-3 py-2 rounded-xl bg-[var(--bg-input)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-amber-500/60"
                  />
                  <button
                    type="button"
                    onClick={() => handleInstall(installSource)}
                    disabled={isInstalling || !installSource.trim()}
                    className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-neutral-950 font-medium text-xs transition-colors shadow-sm flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {isInstalling ? (
                      <>
                        <Loader2 size={13} className="animate-spin" />
                        <span>Instalando...</span>
                      </>
                    ) : (
                      <>
                        <Download size={13} />
                        <span>Instalar</span>
                      </>
                    )}
                  </button>
                </div>

                {installFeedback && (
                  <div
                    className={`p-3.5 rounded-2xl text-xs border transition-all ${
                      installFeedback.type === "success"
                        ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-950 dark:text-emerald-100"
                        : "bg-rose-500/10 border-rose-500/30 text-rose-950 dark:text-rose-100"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2.5 min-w-0 flex-1">
                        <div
                          className={`p-1.5 rounded-xl mt-0.5 shrink-0 ${
                            installFeedback.type === "success"
                              ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                              : "bg-rose-500/20 text-rose-600 dark:text-rose-400"
                          }`}
                        >
                          {installFeedback.type === "success" ? (
                            <Check size={16} />
                          ) : (
                            <AlertCircle size={16} />
                          )}
                        </div>

                        <div className="space-y-1 min-w-0 flex-1">
                          <h4 className="font-semibold text-xs text-[var(--text-primary)]">
                            {installFeedback.title}
                          </h4>
                          <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                            {installFeedback.subtitle}
                          </p>

                          {installFeedback.type === "success" && (
                            <div className="pt-1 flex items-center gap-3 flex-wrap">
                              <button
                                type="button"
                                onClick={() => setActiveTab("my-skills")}
                                className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer flex items-center gap-1"
                              >
                                <span>Ver em Minhas Skills</span>
                                <ArrowRight size={11} />
                              </button>

                              {installFeedback.detail && (
                                <button
                                  type="button"
                                  onClick={() => setShowLogDetails(!showLogDetails)}
                                  className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer flex items-center gap-1 transition-colors"
                                >
                                  <span>{showLogDetails ? "Ocultar detalhes técnicos" : "Ver detalhes técnicos"}</span>
                                  {showLogDetails ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                                </button>
                              )}
                            </div>
                          )}

                          {installFeedback.type === "error" && installFeedback.detail && (
                            <div className="pt-1">
                              <button
                                type="button"
                                onClick={() => setShowLogDetails(!showLogDetails)}
                                className="text-[11px] text-rose-600 dark:text-rose-400 hover:underline cursor-pointer flex items-center gap-1"
                              >
                                <span>{showLogDetails ? "Ocultar detalhes do erro" : "Ver detalhes do erro"}</span>
                                {showLogDetails ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setInstallFeedback(null);
                          setShowLogDetails(false);
                        }}
                        className="p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
                        title="Fechar aviso"
                      >
                        <X size={14} />
                      </button>
                    </div>

                    {/* Technical log (collapsible) */}
                    {showLogDetails && installFeedback.detail && (
                      <div className="mt-3 pt-2.5 border-t border-black/10 dark:border-white/10">
                        <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)] font-mono mb-1.5">
                          <span>Log de execução:</span>
                          <button
                            type="button"
                            onClick={() => navigator.clipboard.writeText(installFeedback.detail || "")}
                            className="hover:text-[var(--text-primary)] cursor-pointer"
                          >
                            Copiar log
                          </button>
                        </div>
                        <pre className="p-2.5 rounded-xl bg-black/80 text-emerald-400 font-mono text-[10px] leading-relaxed max-h-36 overflow-y-auto whitespace-pre-wrap select-text border border-white/10">
                          {installFeedback.detail}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Curated Recommendations */}
              <div className="space-y-2 pt-2 border-t border-[var(--border-subtle)]">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-[var(--text-primary)]">
                    Skills em Destaque da Comunidade
                  </h3>
                  <span className="text-[10px] text-[var(--text-muted)]">Instalação com 1 clique</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {CURATED_SKILLS.map((cs) => (
                    <div
                      key={cs.repo}
                      className="p-3 rounded-xl bg-[var(--bg-input)] border border-[var(--border-subtle)] hover:border-amber-500/40 transition-all flex flex-col justify-between gap-2"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-xs text-[var(--text-primary)]">
                            {cs.name}
                          </span>
                          <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-black/5 dark:bg-white/5 border border-[var(--border-subtle)] text-[var(--text-muted)]">
                            {cs.type}
                          </span>
                        </div>
                        <p className="text-[11px] text-[var(--text-muted)] line-clamp-2">
                          {cs.desc}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleInstall(cs.repo)}
                        disabled={isInstalling}
                        className="w-full mt-1 py-1 px-2.5 rounded-lg bg-[var(--bg-card)] hover:bg-amber-500/15 border border-[var(--border-subtle)] hover:border-amber-500/30 text-[11px] text-amber-600 dark:text-amber-400 font-medium transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
                      >
                        <Download size={11} />
                        <span>Instalar</span>
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Creator guide */}
              <div className="p-3 rounded-xl bg-[var(--bg-input)] border border-[var(--border-subtle)] text-[11px] text-[var(--text-muted)] space-y-1">
                <span className="font-semibold text-[var(--text-primary)] block">
                  Criando suas próprias skills:
                </span>
                <p>
                  Basta criar uma pasta em <code>skills/nome-da-sua-skill/</code> contendo um arquivo <code>SKILL.md</code>.
                  Se a skill precisar rodar Python, adicione os scripts na subpasta <code>scripts/</code>. O Copernico detecta tudo automaticamente sem alterar seus arquivos!
                </p>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[var(--border-subtle)] flex items-center justify-between bg-[var(--bg-input)] text-[11px] text-[var(--text-muted)] shrink-0">
          <div className="flex items-center gap-2">
            <span>Dica: Invoque qualquer skill ativa no chat digitando</span>
            <kbd className="px-1.5 py-0.5 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded text-[10px] font-mono text-amber-600 dark:text-amber-400">
              /skill &lt;id&gt;
            </kbd>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 rounded-lg bg-[var(--bg-card)] hover:bg-black/5 dark:hover:bg-white/5 border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
      <DeleteConfirmModal
        isOpen={skillToDelete !== null}
        sessionTitle={skillToDelete ? `${skillToDelete.name} (/${skillToDelete.id})` : ""}
        title="Excluir skill?"
        description={
          skillToDelete
            ? `Você está prestes a excluir permanentemente a skill "${skillToDelete.name}" (/${skillToDelete.id}). A pasta será removida do disco, incluindo clones em .agents/.qwen/.vibe e a entrada em skills-lock.json. Esta ação não pode ser desfeita.`
            : undefined
        }
        onConfirm={handleConfirmDelete}
        onCancel={() => setSkillToDelete(null)}
      />
    </div>
  );
};
