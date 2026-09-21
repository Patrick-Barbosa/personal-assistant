import React, { useState, useEffect } from "react";
import {
  X,
  Clock,
  Plus,
  Trash2,
  Play,
  Check,
  AlertCircle,
  Loader2,
  Sparkles,
  Calendar,
  Layers,
  Inbox,
} from "lucide-react";
import { api } from "../api";
import { ScheduledRoutine, SkillInfo } from "../types";
import { describeCron } from "../utils/cronDescription";
import { DeleteConfirmModal } from "./DeleteConfirmModal";

interface RoutinesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenInbox?: () => void;
}

const CRON_PRESETS = [
  { label: "Diariamente às 09:00", cron: "0 9 * * *" },
  { label: "A cada 6 horas", cron: "0 */6 * * *" },
  { label: "2x ao dia (09:00 e 18:00)", cron: "0 9,18 * * *" },
  { label: "Semanalmente (Segunda às 09:00)", cron: "0 9 * * 1" },
  { label: "A cada 1 hora", cron: "0 * * * *" },
  { label: "Personalizado (Expressão Cron)", cron: "custom" },
];

export const RoutinesModal: React.FC<RoutinesModalProps> = ({
  isOpen,
  onClose,
  onOpenInbox,
}) => {
  const [routines, setRoutines] = useState<ScheduledRoutine[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);

  // Form state
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [skillId, setSkillId] = useState<string>("");
  const [selectedPreset, setSelectedPreset] = useState("0 9 * * *");
  const [customCron, setCustomCron] = useState("0 9 * * *");
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Feedback on trigger
  const [triggeringId, setTriggeringId] = useState<string | null>(null);
  const [triggerFeedback, setTriggerFeedback] = useState<string | null>(null);
  const [routineToDelete, setRoutineToDelete] = useState<ScheduledRoutine | null>(null);
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [rList, sList] = await Promise.all([
        api.listScheduledRoutines(),
        api.listSkills(),
      ]);
      setRoutines(rList);
      setSkills(sList.filter((s) => s.is_enabled));
    } catch (err) {
      console.error("Falha ao carregar rotinas:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadData();
      setIsFormOpen(false);
      setTriggerFeedback(null);
    }
  }, [isOpen]);

  const effectiveCron = selectedPreset === "custom" ? customCron : selectedPreset;

  const handleToggle = async (routine: ScheduledRoutine) => {
    if (togglingIds.has(routine.id)) return;
    setTogglingIds((prev) => new Set(prev).add(routine.id));
    const newStatus = !routine.ativo;
    setRoutines((prev) =>
      prev.map((r) => (r.id === routine.id ? { ...r, ativo: newStatus } : r))
    );
    try {
      await api.toggleScheduledRoutine(routine.id, newStatus);
    } catch (err) {
      console.error("Falha ao alternar rotina:", err);
      setRoutines((prev) =>
        prev.map((r) => (r.id === routine.id ? { ...r, ativo: !newStatus } : r))
      );
    } finally {
      setTogglingIds((prev) => {
        const ns = new Set(prev);
        ns.delete(routine.id);
        return ns;
      });
    }
  };

  const handleDelete = (routine: ScheduledRoutine) => {
    setRoutineToDelete(routine);
  };

  const handleConfirmDelete = async () => {
    if (!routineToDelete) return;
    try {
      await api.deleteScheduledRoutine(routineToDelete.id);
      setRoutines((prev) => prev.filter((r) => r.id !== routineToDelete.id));
      setRoutineToDelete(null);
    } catch (err) {
      alert(`Falha ao excluir rotina: ${String(err)}`);
    }
  };

  const handleTriggerNow = async (routineId: string) => {
    setTriggeringId(routineId);
    setTriggerFeedback(null);
    try {
      const result: any = await api.triggerRoutineNow(routineId);
      let feedbackText: string;
      if (typeof result === "string") {
        feedbackText = result;
      } else if (result && typeof result === "object") {
        feedbackText = result.resposta || result.message || result.titulo || result.title || `Rotina executada! Sessão ${result.session_id || ""} criada.`;
        if (feedbackText.length > 180) feedbackText = feedbackText.slice(0, 180) + "…";
        if (!feedbackText || feedbackText === "[object Object]") feedbackText = "Rotina executada com sucesso! Verifique a Inbox.";
      } else {
        feedbackText = "Rotina executada com sucesso!";
      }
      setTriggerFeedback(feedbackText);
      await loadData();
      setTimeout(() => setTriggerFeedback(null), 5000);
    } catch (err) {
      alert(`Falha ao executar rotina: ${String(err)}`);
    } finally {
      setTriggeringId(null);
    }
  };

  const handleSaveRoutine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !prompt.trim()) {
      setFormError("Título e prompt são obrigatórios.");
      return;
    }

    setIsSaving(true);
    setFormError(null);
    // Gera ID com UUID para evitar colisão de Date.now
    const genId = () => {
      try {
        // @ts-ignore
        if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
          return `routine_${globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
        }
      } catch {}
      return `routine_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    };
    try {
      const routine: ScheduledRoutine = {
        id: genId(),
        titulo: title.trim(),
        cron_expr: effectiveCron.trim(),
        prompt: prompt.trim(),
        skill_id: skillId || undefined,
        ativo: true,
        created_at: new Date().toISOString(),
      };

      await api.saveScheduledRoutine(routine);
      await loadData();
      setIsFormOpen(false);
      setTitle("");
      setPrompt("");
      setSkillId("");
      setSelectedPreset("0 9 * * *");
    } catch (err) {
      setFormError(`Erro ao salvar rotina: ${String(err)}`);
    } finally {
      setIsSaving(false);
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
              <Clock size={18} />
            </div>
            <div>
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <span>Agendador de Rotinas & Prompts</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400 font-mono font-medium">
                  Cron em Segundo Plano
                </span>
              </h2>
              <p className="text-[11px] text-[var(--text-muted)]">
                Agende tarefas autônomas periódicas (curadoria, resumos, pesquisas). Os resultados são salvos diretamente na sua Inbox.
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

        {/* Action Bar */}
        <div className="px-5 py-2.5 border-b border-[var(--border-subtle)] flex items-center justify-between shrink-0 bg-[var(--bg-card)]">
          <span className="text-xs font-medium text-[var(--text-muted)]">
            {routines.length} rotina(s) agendada(s)
          </span>
          <button
            type="button"
            onClick={() => setIsFormOpen(!isFormOpen)}
            className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-neutral-950 font-medium text-xs transition-colors shadow-sm flex items-center gap-1.5"
          >
            {isFormOpen ? <X size={13} /> : <Plus size={13} />}
            <span>{isFormOpen ? "Cancelar" : "Nova Rotina"}</span>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {triggerFeedback && (
            <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-xs flex items-center gap-2 animate-in fade-in duration-150">
              <Check size={14} className="text-emerald-500 shrink-0" />
              <span className="flex-1">{triggerFeedback}</span>
              {onOpenInbox && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenInbox();
                  }}
                  className="px-2 py-0.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-800 dark:text-emerald-200 font-medium text-[11px] transition-colors flex items-center gap-1"
                >
                  <Inbox size={11} />
                  <span>Ver Inbox</span>
                </button>
              )}
            </div>
          )}

          {/* New Routine Drawer Form */}
          {isFormOpen && (
            <form
              onSubmit={handleSaveRoutine}
              className="p-4 rounded-2xl bg-[var(--bg-input)] border border-amber-500/30 space-y-3 animate-in fade-in duration-150"
            >
              <h3 className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                <Sparkles size={13} className="text-amber-500" />
                <span>Configurar Nova Rotina Autônoma</span>
              </h3>

              <div className="space-y-1">
                <label className="text-[11px] font-medium text-[var(--text-primary)]">
                  Título da Rotina
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="ex: Curadoria Matinal de Notas"
                  className="w-full px-3 py-1.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-amber-500/60"
                  required
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Frequency Selector */}
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-[var(--text-primary)]">
                    Frequência de Execução
                  </label>
                  <select
                    value={selectedPreset}
                    onChange={(e) => setSelectedPreset(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-amber-500/60"
                  >
                    {CRON_PRESETS.map((p) => (
                      <option key={p.cron} value={p.cron}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Optional Skill Link */}
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-[var(--text-primary)]">
                    Skill Vinculada (Opcional)
                  </label>
                  <select
                    value={skillId}
                    onChange={(e) => setSkillId(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-amber-500/60"
                  >
                    <option value="">Nenhuma (Prompt Livre)</option>
                    {skills.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.has_scripts ? "⚡" : "🧠"} {s.name} (/{s.id})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Custom Cron Input */}
              {selectedPreset === "custom" && (
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-[var(--text-primary)]">
                    Expressão Cron (5 campos: min hora dia mês dia-da-semana)
                  </label>
                  <input
                    type="text"
                    value={customCron}
                    onChange={(e) => setCustomCron(e.target.value)}
                    placeholder="0 9 * * *"
                    className="w-full px-3 py-1.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:border-amber-500/60"
                  />
                </div>
              )}

              {/* Cron Description Preview */}
              <div className="p-2 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[11px] text-[var(--text-muted)] flex items-center gap-1.5">
                <Calendar size={12} className="text-amber-500 shrink-0" />
                <span>Programação: <strong>{describeCron(effectiveCron)}</strong></span>
              </div>

              {/* Prompt Textarea */}
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-[var(--text-primary)]">
                  Prompt / Instrução para o Agente
                </label>
                <textarea
                  rows={3}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="ex: Busque no cofre todas as notas adicionadas nos últimos dias e elabore um resumo com 3 conexões temáticas não óbvias."
                  className="w-full px-3 py-2 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-amber-500/60 resize-none leading-relaxed"
                  required
                />
              </div>

              {formError && (
                <div className="p-2 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs flex items-center gap-1.5">
                  <AlertCircle size={13} />
                  <span>{formError}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  className="px-3 py-1.5 rounded-xl text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-4 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-neutral-950 text-xs font-medium transition-colors shadow-sm flex items-center gap-1.5 disabled:opacity-50"
                >
                  {isSaving ? (
                    <>
                      <Loader2 size={13} className="animate-spin" />
                      <span>Salvando...</span>
                    </>
                  ) : (
                    <>
                      <Check size={13} />
                      <span>Salvar Rotina</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}

          {/* Routines List */}
          {isLoading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-2 text-xs text-[var(--text-muted)]">
              <Loader2 size={20} className="animate-spin text-amber-500" />
              <span>Carregando rotinas agendadas...</span>
            </div>
          ) : routines.length === 0 ? (
            <div className="py-12 text-center space-y-2 border border-dashed border-[var(--border-subtle)] rounded-2xl p-6">
              <Clock size={28} className="mx-auto text-amber-500/50" />
              <p className="text-xs font-medium text-[var(--text-primary)]">
                Nenhuma rotina agendada ativa.
              </p>
              <p className="text-[11px] text-[var(--text-muted)] max-w-sm mx-auto">
                Crie rotinas para que o assistente analise seu cofre, realize curadoria autônoma ou resumos diários mesmo com o aplicativo em segundo plano.
              </p>
              <button
                type="button"
                onClick={() => setIsFormOpen(true)}
                className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-neutral-950 text-xs font-medium transition-colors shadow-sm"
              >
                <Plus size={13} />
                <span>Criar Primeira Rotina</span>
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {routines.map((routine) => (
                <div
                  key={routine.id}
                  className={`p-4 rounded-2xl bg-[var(--bg-input)] border transition-all ${
                    routine.ativo
                      ? "border-[var(--border-subtle)] hover:border-amber-500/40"
                      : "border-[var(--border-subtle)] opacity-60"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1.5 min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-xs text-[var(--text-primary)]">
                          {routine.titulo}
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-mono bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 flex items-center gap-1">
                          <Calendar size={10} />
                          <span>{describeCron(routine.cron_expr)}</span>
                        </span>
                        {routine.skill_id && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-mono bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border border-cyan-500/30 flex items-center gap-1">
                            <Sparkles size={10} />
                            <span>/{routine.skill_id}</span>
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-[var(--text-muted)] line-clamp-2 leading-relaxed bg-[var(--bg-card)] p-2 rounded-xl border border-[var(--border-subtle)] font-sans">
                        "{routine.prompt}"
                      </p>

                      <div className="text-[10px] text-[var(--text-muted)] flex items-center gap-3 pt-0.5">
                        <span>
                          Última execução:{" "}
                          <strong>
                            {routine.ultima_execucao
                              ? new Date(routine.ultima_execucao).toLocaleString("pt-BR", {
                                  dateStyle: "short",
                                  timeStyle: "short",
                                })
                              : "Nunca executada"}
                          </strong>
                        </span>
                      </div>
                    </div>

                    {/* Controls */}
                    <div className="flex items-center gap-2 shrink-0 pt-0.5">
                      <button
                        type="button"
                        onClick={() => handleTriggerNow(routine.id)}
                        disabled={triggeringId === routine.id}
                        className="px-2.5 py-1 rounded-lg bg-[var(--bg-card)] hover:bg-amber-500/15 border border-[var(--border-subtle)] hover:border-amber-500/30 text-[11px] text-amber-600 dark:text-amber-400 font-medium transition-colors flex items-center gap-1.5 disabled:opacity-50"
                        title="Executar rotina agora e salvar resultado na Inbox"
                      >
                        {triggeringId === routine.id ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <Play size={12} />
                        )}
                        <span>Executar</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleToggle(routine)}
                        disabled={togglingIds.has(routine.id)}
                        className={`w-9 h-5 rounded-full transition-colors relative p-0.5 focus:outline-none disabled:opacity-50 ${
                          routine.ativo ? "bg-amber-500" : "bg-neutral-600 dark:bg-neutral-700"
                        }`}
                        title={routine.ativo ? "Desativar rotina" : "Ativar rotina"}
                      >
                        <span
                          className={`block w-4 h-4 rounded-full bg-white transition-transform ${
                            routine.ativo ? "translate-x-4" : "translate-x-0"
                          }`}
                        />
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDelete(routine)}
                        className="p-1 text-[var(--text-muted)] hover:text-rose-500 rounded-lg hover:bg-rose-500/10 transition-colors"
                        title="Excluir rotina"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[var(--border-subtle)] flex items-center justify-between bg-[var(--bg-input)] text-[11px] text-[var(--text-muted)] shrink-0">
          <span>O serviço em segundo plano roda silenciosamente mesmo com a janela fechada.</span>
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
        isOpen={routineToDelete !== null}
        sessionTitle={routineToDelete ? routineToDelete.titulo : ""}
        title="Excluir rotina?"
        description={
          routineToDelete
            ? `Você está prestes a excluir a rotina "${routineToDelete.titulo}" (${describeCron(routineToDelete.cron_expr)}). Esta ação removerá o agendamento permanente e não pode ser desfeita.`
            : undefined
        }
        onConfirm={handleConfirmDelete}
        onCancel={() => setRoutineToDelete(null)}
      />
    </div>
  );
};
