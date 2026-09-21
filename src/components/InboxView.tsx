import React, { useState, useEffect } from "react";
import {
  Inbox,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Archive,
  Trash2,
  ExternalLink,
  RefreshCw,
  Clock,
  Sparkles,
  FileText,
  Save,
  Check,
  ChevronDown,
  ChevronUp,
  GitCompare,
  GitBranch,
  MessageSquare,
  Send,
  X,
  Layers,
  CornerDownRight,
  Brain,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../api";
import { InboxItem, InboxItemType } from "../types";
import { RejectReasonModal } from "./RejectReasonModal";

interface InboxViewProps {
  onOpenSession: (sessionId: string) => void;
  onRefreshUnreadCount?: () => void;
}

interface DiffModalProps {
  item: InboxItem;
  onClose: () => void;
  onEvolve: (id: string) => Promise<void>;
  isLoading: boolean;
}

const DiffSideBySideModal: React.FC<DiffModalProps> = ({
  item,
  onClose,
  onEvolve,
  isLoading,
}) => {
  const [originalContent, setOriginalContent] = useState<string>("");
  const [isLoadingOriginal, setIsLoadingOriginal] = useState<boolean>(true);

  useEffect(() => {
    const fetchOriginal = async () => {
      // Se for uma proposta com proposed_content, item.content já contém o original
      if (item.proposed_content && item.content) {
        setOriginalContent(item.content);
        setIsLoadingOriginal(false);
        return;
      }

      if (item.target_base_note_slug) {
        try {
          const note = await api.readNote(item.target_base_note_slug);
          setOriginalContent(note.content || note.corpo || "");
        } catch (e) {
          setOriginalContent(
            typeof item.diff_data === "object" && item.diff_data?.original_snippet
              ? item.diff_data.original_snippet
              : item.content || "*Nota base original ainda não indexada no cofre.*"
          );
        } finally {
          setIsLoadingOriginal(false);
        }
      } else {
        setOriginalContent(
          typeof item.diff_data === "object" && item.diff_data?.original_snippet
            ? item.diff_data.original_snippet
            : item.content || "*Esta proposta é inédita ou não possui nota ancestral no Obsidian.*"
        );
        setIsLoadingOriginal(false);
      }
    };
    fetchOriginal();
  }, [item]);

  const proposed = item.proposed_content || item.content;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-200">
      <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-3xl w-full max-w-5xl h-[88vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="p-5 border-b border-[var(--border-subtle)] flex items-center justify-between gap-4 shrink-0 bg-white/[0.02]">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2.5 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-400">
              <GitCompare size={20} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-[var(--text-primary)] truncate">
                  Diff Lado a Lado: {item.title}
                </h3>
                <span className="px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-400 font-mono text-[10px] font-bold">
                  Evolução In-Place
                </span>
              </div>
              <p className="text-xs text-[var(--text-muted)] truncate">
                Nota Canônica Original ➔ Versão Proposta com Histórico de Alterações
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onEvolve(item.id)}
              disabled={isLoading}
              className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-neutral-950 text-xs font-bold flex items-center gap-2 transition-all shadow-md shadow-amber-500/20 disabled:opacity-50 cursor-pointer"
            >
              {isLoading ? (
                <RefreshCw size={14} className="animate-spin" />
              ) : (
                <CheckCircle2 size={14} />
              )}
              <span>Aprovar e Gravar Evolução</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/5 transition-all"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Modal Split View */}
        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[var(--border-subtle)] overflow-hidden">
          {/* Lado Esquerdo: Original (Obsidian R/O ou Canonical Default) */}
          <div className="flex flex-col h-full overflow-hidden bg-black/20">
            <div className="p-3 px-5 border-b border-[var(--border-subtle)] flex items-center justify-between bg-white/[0.01]">
              <div className="flex items-center gap-2 text-xs font-semibold text-cyan-400">
                <span className="w-2 h-2 rounded-full bg-cyan-400" />
                <span>Base Original (Canônica)</span>
              </div>
              {item.target_base_note_slug && (
                <span className="text-[10px] font-mono text-[var(--text-muted)]">
                  [[{item.target_base_note_slug}]]
                </span>
              )}
            </div>
            <div className="flex-1 p-5 overflow-y-auto select-text font-mono text-xs leading-relaxed text-[var(--text-muted)]">
              {isLoadingOriginal ? (
                <div className="flex items-center gap-2 text-xs py-4 text-[var(--text-muted)]">
                  <RefreshCw size={14} className="animate-spin" />
                  <span>Carregando nota ancestral...</span>
                </div>
              ) : (
                <pre className="whitespace-pre-wrap font-sans text-xs">{originalContent}</pre>
              )}
            </div>
          </div>

          {/* Lado Direito: Proposta de Evolução (Copernico) */}
          <div className="flex flex-col h-full overflow-hidden bg-amber-500/[0.015]">
            <div className="p-3 px-5 border-b border-[var(--border-subtle)] flex items-center justify-between bg-amber-500/5">
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-400">
                <span className="w-2 h-2 rounded-full bg-amber-400" />
                <span>Versão Proposta (Evolução In-Place)</span>
              </div>
              <span className="text-[10px] font-mono text-amber-400/80">
                {item.target_base_note_slug ? `cofres/default/${item.target_base_note_slug}.md` : "Evolução"}
              </span>
            </div>
            <div className="flex-1 p-5 overflow-y-auto select-text font-mono text-xs leading-relaxed text-[var(--text-primary)]">
              <div className="prose dark:prose-invert prose-xs max-w-none text-xs leading-relaxed">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {proposed}
                </ReactMarkdown>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer Banner */}
        <div className="p-3 px-5 border-t border-[var(--border-subtle)] bg-white/[0.01] flex items-center justify-between text-xs text-[var(--text-muted)]">
          <span>
            Ao aprovar, a nota canônica será atualizada diretamente no cofre com o histórico de alterações anexado.
          </span>
          <span className="font-mono text-[10px] text-amber-400/70">
            Regra R/O Obsidian: Preservada
          </span>
        </div>
      </div>
    </div>
  );
};

export const InboxView: React.FC<InboxViewProps> = ({
  onOpenSession,
  onRefreshUnreadCount,
}) => {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [filter, setFilter] = useState<"all" | "pending" | "evolutions" | "archived">("pending");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activeDiffItem, setActiveDiffItem] = useState<InboxItem | null>(null);
  const [refineId, setRefineId] = useState<string | null>(null);
  const [refinePrompt, setRefinePrompt] = useState<string>("");
  const [isRefining, setIsRefining] = useState<boolean>(false);
  const [isEvolvingId, setIsEvolvingId] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<{ id: string; msg: string } | null>(null);
  const [rejectTarget, setRejectTarget] = useState<{
    id: string;
    title: string;
    mode: "dismiss" | "delete";
  } | null>(null);
  const [isRejecting, setIsRejecting] = useState(false);

  const loadItems = async () => {
    setIsLoading(true);
    try {
      const data = await api.listInboxItems();
      setItems(data);
      if (onRefreshUnreadCount) {
        onRefreshUnreadCount();
      }
    } catch (err) {
      console.error("Erro ao carregar itens da inbox:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadItems();

    let unlisten: (() => void) | undefined;
    const setupListener = async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen("inbox-updated", () => {
          loadItems();
        });
      } catch (e) {
        // Ignora em web preview
      }
    };
    setupListener();

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const handleEvolveNote = async (id: string) => {
    setIsEvolvingId(id);
    try {
      const path = await api.evolveNote(id);
      setItems((prev) =>
        prev.map((i) => (i.id === id ? { ...i, status: "applied" } : i))
      );
      setActiveDiffItem(null);
      onRefreshUnreadCount?.();
      setActionFeedback({
        id,
        msg: `Nota evoluída gravada com sucesso: ${path.split(/[\\/]/).pop()}`,
      });
      setTimeout(() => setActionFeedback(null), 4500);
    } catch (err) {
      console.error("Erro ao evoluir nota:", err);
      setActionFeedback({ id, msg: `Erro ao evoluir nota: ${err}` });
    } finally {
      setIsEvolvingId(null);
    }
  };

  const handleRefineProposal = async (id: string) => {
    if (!refinePrompt.trim()) return;
    setIsRefining(true);
    try {
      const updated = await api.refineInboxProposal(id, refinePrompt.trim());
      setItems((prev) => prev.map((i) => (i.id === id ? updated : i)));
      setRefineId(null);
      setRefinePrompt("");
      setActionFeedback({ id, msg: "Proposta refinada com sucesso pelo assistente!" });
      setTimeout(() => setActionFeedback(null), 3500);
    } catch (err) {
      console.error("Erro ao refinar proposta:", err);
      setActionFeedback({ id, msg: "Falha ao refinar proposta." });
    } finally {
      setIsRefining(false);
    }
  };

  const handleDismiss = (id: string) => {
    const target = items.find((i) => i.id === id);
    if (!target) return;
    setRejectTarget({ id, title: target.title, mode: "dismiss" });
  };

  const handleSnooze = async (id: string) => {
    try {
      await api.snoozeInboxItem(id);
      setItems((prev) =>
        prev.map((i) => (i.id === id ? { ...i, status: "snoozed" } : i))
      );
      onRefreshUnreadCount?.();
    } catch (err) {
      console.error("Erro ao adiar item:", err);
    }
  };

  const handleDelete = (id: string) => {
    const target = items.find((i) => i.id === id);
    if (!target) return;
    setRejectTarget({ id, title: target.title, mode: "delete" });
  };

  const handleConfirmReject = async (reason: string | null) => {
    if (!rejectTarget) return;
    const { id, mode } = rejectTarget;
    setIsRejecting(true);
    try {
      if (mode === "dismiss") {
        await api.dismissInboxItem(id, reason);
        setItems((prev) =>
          prev.map((i) =>
            i.id === id
              ? { ...i, status: "dismissed", decision_reason: reason ?? i.decision_reason ?? null }
              : i
          )
        );
      } else {
        const target = items.find((i) => i.id === id);
        await api.deleteInboxItem(id, reason);
        // Com session_id o backend converte em dismissed (tombstone 72h) em vez de sumir.
        if (target?.session_id) {
          setItems((prev) =>
            prev.map((i) =>
              i.id === id
                ? { ...i, status: "dismissed", decision_reason: reason ?? i.decision_reason ?? null }
                : i
            )
          );
        } else {
          setItems((prev) => prev.filter((item) => item.id !== id));
        }
      }
      setRejectTarget(null);
      onRefreshUnreadCount?.();
    } catch (err) {
      console.error("Erro ao registrar rejeição:", err);
    } finally {
      setIsRejecting(false);
    }
  };

  const handleApplyInstruction = async (id: string) => {
    try {
      await api.applyInstructionImprovement(id);
      setItems((prev) =>
        prev.map((i) => (i.id === id ? { ...i, status: "applied" } : i))
      );
      setActionFeedback({ id, msg: "Diretriz aprovada e incorporada com sucesso!" });
      setTimeout(() => setActionFeedback(null), 3500);
      onRefreshUnreadCount?.();
    } catch (err) {
      console.error("Erro ao aplicar melhoria de instrução:", err);
      setActionFeedback({ id, msg: "Erro ao aplicar melhoria de diretriz." });
    }
  };

  const filteredItems = items.filter((item) => {
    if (filter === "pending") {
      return item.status === "unread" || item.status === "pending";
    }
    if (filter === "evolutions") {
      return (
        item.item_type === "evolution_proposal" ||
        Boolean(item.target_base_note_slug) ||
        item.status === "applied"
      );
    }
    if (filter === "archived") {
      return (
        item.status === "archived" ||
        item.status === "applied" ||
        item.status === "dismissed" ||
        item.status === "snoozed"
      );
    }
    return true;
  });

  const pendingCount = items.filter(
    (i) => i.status === "unread" || i.status === "pending"
  ).length;

  const evolutionsCount = items.filter(
    (i) =>
      (i.item_type === "evolution_proposal" || Boolean(i.target_base_note_slug)) &&
      (i.status === "pending" || i.status === "unread")
  ).length;

  const renderBadge = (type: InboxItemType) => {
    switch (type) {
      case "evolution_proposal":
        return (
          <span className="px-2 py-0.5 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-400 text-[10px] font-bold flex items-center gap-1">
            <GitBranch size={11} />
            Evolução de Nota
          </span>
        );
      case "contradiction":
        return (
          <span className="px-2 py-0.5 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-400 text-[10px] font-bold flex items-center gap-1">
            <AlertTriangle size={11} />
            Contradição Detectada
          </span>
        );
      case "pattern_synthesis":
        return (
          <span className="px-2 py-0.5 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-cyan-400 text-[10px] font-bold flex items-center gap-1">
            <Layers size={11} />
            Síntese de Padrão
          </span>
        );
      case "loose_ends":
        return (
          <span className="px-2 py-0.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[10px] font-bold flex items-center gap-1">
            <Sparkles size={11} />
            Decisão / Tarefa
          </span>
        );
      case "instruction_improvement":
        return (
          <span className="px-2 py-0.5 rounded-lg bg-purple-500/15 border border-purple-500/30 text-purple-400 text-[10px] font-bold flex items-center gap-1">
            <Brain size={11} />
            Autoaprendizado & Diretriz
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded-lg bg-white/5 border border-[var(--border-subtle)] text-[var(--text-muted)] text-[10px] font-mono uppercase tracking-wider">
            {type}
          </span>
        );
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[var(--bg-app)] select-none">
      {/* Top Header */}
      <div className="p-5 border-b border-[var(--border-subtle)] flex items-center justify-between shrink-0 bg-[var(--bg-card)]/40 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-500 dark:text-amber-400">
            <Inbox size={22} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-[var(--text-primary)]">
                Mesa de Triagem Cognitiva & Linhagem
              </h2>
              {pendingCount > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-amber-500 text-neutral-950 font-bold text-xs animate-pulse">
                  {pendingCount} pendente{pendingCount > 1 ? "s" : ""}
                </span>
              )}
            </div>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Propostas de evolução de notas, sínteses autônomas e curadoria pós-conversa prontas para triagem.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={loadItems}
          disabled={isLoading}
          className="px-3 py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-primary)] flex items-center gap-2 transition-all disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw size={13} className={isLoading ? "animate-spin text-amber-400" : ""} />
          <span>Atualizar</span>
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="px-5 pt-3 pb-2 border-b border-[var(--border-subtle)] bg-[var(--bg-card)]/20 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setFilter("pending")}
          className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
            filter === "pending"
              ? "bg-amber-500/20 text-amber-500 dark:text-amber-300 border border-amber-500/30 shadow-sm"
              : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/5"
          }`}
        >
          <span>Pendentes</span>
          {pendingCount > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-amber-500 text-neutral-950 text-[10px] font-bold">
              {pendingCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setFilter("evolutions")}
          className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
            filter === "evolutions"
              ? "bg-amber-500/20 text-amber-500 dark:text-amber-300 border border-amber-500/30 shadow-sm"
              : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/5"
          }`}
        >
          <GitBranch size={13} />
          <span>Evoluções</span>
          {evolutionsCount > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-amber-500/30 text-amber-400 text-[10px] font-bold">
              {evolutionsCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setFilter("all")}
          className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
            filter === "all"
              ? "bg-amber-500/20 text-amber-500 dark:text-amber-300 border border-amber-500/30 shadow-sm"
              : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/5"
          }`}
        >
          <span>Todas</span>
        </button>

        <button
          type="button"
          onClick={() => setFilter("archived")}
          className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ml-auto cursor-pointer ${
            filter === "archived"
              ? "bg-amber-500/20 text-amber-500 dark:text-amber-300 border border-amber-500/30 shadow-sm"
              : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/5"
          }`}
        >
          <Archive size={13} className="inline mr-1" />
          <span>Processadas</span>
        </button>
      </div>

      {/* Content Cards */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {filteredItems.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-center p-6 border border-dashed border-[var(--border-subtle)] rounded-2xl bg-black/5 dark:bg-white/[0.01]">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500 mb-3">
              <Sparkles size={22} />
            </div>
            <h3 className="text-sm font-bold text-[var(--text-primary)]">Mesa de Triagem Limpa</h3>
            <p className="text-xs text-[var(--text-muted)] max-w-sm mt-1">
              Nenhuma proposta pendente nesta categoria. Quando o motor de voz ou agente identificar atualizações de notas, novas propostas surgirão aqui.
            </p>
          </div>
        ) : (
          filteredItems.map((item) => {
            const isExpanded = expandedId === item.id;
            const isPending = item.status === "unread" || item.status === "pending";
            const isApplied = item.status === "applied";

            return (
              <div
                key={item.id}
                className={`rounded-2xl border transition-all overflow-hidden ${
                  isApplied
                    ? "bg-[var(--bg-card)]/40 border-emerald-500/30 opacity-80"
                    : isPending
                    ? "bg-[var(--bg-card)] border-amber-500/40 shadow-lg shadow-amber-500/5"
                    : "bg-[var(--bg-card)]/60 border-[var(--border-subtle)] hover:border-amber-500/20"
                }`}
              >
                {/* Card Header */}
                <div className="p-4 flex items-start justify-between gap-4">
                  <div className="space-y-1.5 min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {isPending && (
                        <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0" />
                      )}
                      {isApplied && (
                        <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                      )}
                      <h4 className="text-sm font-bold text-[var(--text-primary)] truncate">
                        {item.title}
                      </h4>
                      {renderBadge(item.item_type)}
                      {item.target_base_note_slug && (
                        <span className="text-[10px] px-2 py-0.5 rounded-md bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 font-mono shrink-0">
                          base: [[{item.target_base_note_slug}]]
                        </span>
                      )}
                      {isApplied && (
                        <span className="text-[10px] px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-bold shrink-0">
                          Evolução Aplicada
                        </span>
                      )}
                    </div>

                    {item.summary && !isExpanded && (
                      <p className="text-xs text-[var(--text-muted)] line-clamp-2 leading-relaxed">
                        {item.summary}
                      </p>
                    )}

                    <div className="flex items-center gap-3 text-[11px] text-[var(--text-muted)] pt-0.5">
                      <span className="flex items-center gap-1">
                        <Clock size={12} />
                        {new Date(item.created_at).toLocaleString("pt-BR", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </span>
                      {item.session_id && (
                        <span className="text-amber-500/80 font-mono text-[10px]">
                          origem: sessão #{item.session_id.slice(0, 8)}
                        </span>
                      )}
                      {item.decision_reason && (
                        <span className="text-[10px] text-[var(--text-muted)] italic truncate">
                          motivo: {item.decision_reason}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Toggle Expand */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : item.id)}
                      className="p-1.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all cursor-pointer"
                      title={isExpanded ? "Recolher card" : "Expandir card"}
                    >
                      {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                  </div>
                </div>

                {/* Feedback Toast Inline */}
                {actionFeedback?.id === item.id && (
                  <div className="px-4 py-2 bg-emerald-500/10 border-t border-b border-emerald-500/20 text-emerald-400 text-xs flex items-center gap-1.5 animate-in fade-in">
                    <Check size={13} />
                    <span>{actionFeedback.msg}</span>
                  </div>
                )}

                {/* Expanded Content Body */}
                {isExpanded && (
                  <div className="px-5 py-4 border-t border-[var(--border-subtle)] bg-[var(--bg-input)]/50 select-text animate-in fade-in duration-150">
                    <div className="prose dark:prose-invert prose-xs max-w-none text-xs leading-relaxed">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {item.proposed_content || item.content}
                      </ReactMarkdown>
                    </div>
                  </div>
                )}

                {/* Inline Refinement Prompt Box */}
                {refineId === item.id && (
                  <div className="p-3 px-4 border-t border-[var(--border-subtle)] bg-amber-500/5 flex items-center gap-2 animate-in fade-in">
                    <CornerDownRight size={14} className="text-amber-400 shrink-0" />
                    <input
                      type="text"
                      value={refinePrompt}
                      onChange={(e) => setRefinePrompt(e.target.value)}
                      placeholder="Instrução de refinamento (ex: 'Deixe mais conciso', 'Foque nos tópicos de projeto')..."
                      className="flex-1 bg-[var(--bg-card)] border border-[var(--border-subtle)] focus:border-amber-500/50 rounded-xl px-3 py-1.5 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleRefineProposal(item.id);
                      }}
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => handleRefineProposal(item.id)}
                      disabled={isRefining || !refinePrompt.trim()}
                      className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-neutral-950 font-bold text-xs flex items-center gap-1 transition-all disabled:opacity-50 cursor-pointer"
                    >
                      {isRefining ? <RefreshCw size={12} className="animate-spin" /> : <Send size={12} />}
                      <span>Refinar</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRefineId(null);
                        setRefinePrompt("");
                      }}
                      className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-lg"
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}

                {/* Card Actions Footer */}
                <div className="p-3 px-4 border-t border-[var(--border-subtle)] bg-black/5 dark:bg-white/[0.02] flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Ação 1: [Aprovar Diretriz] se for instruction_improvement */}
                    {item.item_type === "instruction_improvement" && !isApplied && (
                      <button
                        type="button"
                        onClick={() => handleApplyInstruction(item.id)}
                        className="px-3 py-1.5 rounded-xl bg-purple-500 hover:bg-purple-400 text-white text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm cursor-pointer"
                      >
                        <CheckCircle2 size={12} />
                        <span>Aprovar e Adotar Diretriz</span>
                      </button>
                    )}

                    {/* Ação 1.1: [Evoluir Nota] com modal de Diff Lado a Lado (para propostas de notas) */}
                    {item.item_type !== "instruction_improvement" && !isApplied && (
                      <button
                        type="button"
                        onClick={() => setActiveDiffItem(item)}
                        className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-neutral-950 text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm cursor-pointer"
                      >
                        <GitCompare size={12} />
                        <span>Evoluir Nota (Diff)</span>
                      </button>
                    )}

                    {/* Ação 2: [Refinar com Prompt] */}
                    {!isApplied && (
                      <button
                        type="button"
                        onClick={() => {
                          setRefineId(refineId === item.id ? null : item.id);
                          setRefinePrompt("");
                        }}
                        className="px-3 py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5 transition-all cursor-pointer"
                      >
                        <Sparkles size={12} className="text-amber-400" />
                        <span>Refinar com Prompt</span>
                      </button>
                    )}

                    {/* Ação 3: [Aprofundar no Chat] */}
                    {item.session_id && (
                      <button
                        type="button"
                        onClick={() => onOpenSession(item.session_id!)}
                        className="px-3 py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5 transition-all cursor-pointer"
                      >
                        <MessageSquare size={12} />
                        <span>Aprofundar no Chat</span>
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    {/* Ação 4: Soneca */}
                    {!isApplied && (
                      <button
                        type="button"
                        onClick={() => handleSnooze(item.id)}
                        className="px-2.5 py-1 rounded-xl text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/5 transition-all cursor-pointer"
                        title="Adiar triagem"
                      >
                        Soneca
                      </button>
                    )}

                    {/* Ação 5: Descartar */}
                    {!isApplied && (
                      <button
                        type="button"
                        onClick={() => handleDismiss(item.id)}
                        className="px-2.5 py-1 rounded-xl text-xs text-[var(--text-muted)] hover:text-rose-400 hover:bg-white/5 transition-all cursor-pointer"
                        title="Descartar proposta"
                      >
                        Descartar
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleDelete(item.id)}
                      className="p-1.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 text-[var(--text-muted)] hover:text-rose-400 transition-all cursor-pointer ml-1"
                      title="Excluir da Inbox"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Side by Side Diff Modal */}
      {activeDiffItem && (
        <DiffSideBySideModal
          item={activeDiffItem}
          onClose={() => setActiveDiffItem(null)}
          onEvolve={handleEvolveNote}
          isLoading={isEvolvingId === activeDiffItem.id}
        />
      )}

      {/* Reject / Delete Reason Modal */}
      {rejectTarget && (
        <RejectReasonModal
          isOpen={!!rejectTarget}
          itemTitle={rejectTarget.title}
          mode={rejectTarget.mode}
          isLoading={isRejecting}
          onConfirm={handleConfirmReject}
          onCancel={() => {
            if (!isRejecting) setRejectTarget(null);
          }}
        />
      )}
    </div>
  );
};
