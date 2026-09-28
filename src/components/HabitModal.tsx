import React, { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  X,
  Plus,
  Pencil,
  Flame,
  Power,
  Trash2,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { api } from "../api";
import { Habit } from "../types";
import { describeCron, parseHabitCron } from "../utils/cronDescription";
import { DeleteConfirmModal } from "./DeleteConfirmModal";

interface HabitModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Hábito a editar ao abrir (atalho "Editar hábito" vindo de um card). */
  initialHabitId?: string | null;
}

/** Dias da semana do seletor (0=Dom … 6=Sáb — convenção do cron). */
const DAY_TOGGLES: { value: number; label: string }[] = [
  { value: 1, label: "Seg" },
  { value: 2, label: "Ter" },
  { value: 3, label: "Qua" },
  { value: 4, label: "Qui" },
  { value: 5, label: "Sex" },
  { value: 6, label: "Sáb" },
  { value: 0, label: "Dom" },
];

/** Paleta fixa de cores dos cards (hex completo, sem dependências). */
const COLOR_SWATCHES: string[] = [
  "#22c55e",
  "#3b82f6",
  "#f59e0b",
  "#ef4444",
  "#a855f7",
  "#06b6d4",
  "#ec4899",
  "#84cc16",
];

/**
 * Modal de Hábitos (Fase 4): cria (`dias + hora → cron` com preview),
 * ativa/desativa e remove. O backend gera as tasks coloridas sozinho.
 */
export const HabitModal: React.FC<HabitModalProps> = ({
  isOpen,
  onClose,
  initialHabitId,
}) => {
  const [habits, setHabits] = useState<Habit[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [isFormOpen, setIsFormOpen] = useState(false);
  /** Hábito em edição (`null` = formulário de criação). */
  const [editing, setEditing] = useState<Habit | null>(null);
  const [titulo, setTitulo] = useState("");
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [hora, setHora] = useState("09:00");
  const [cor, setCor] = useState(COLOR_SWATCHES[0]);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());
  const [habitToDelete, setHabitToDelete] = useState<Habit | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    onClose();
    window.requestAnimationFrame(() => openerRef.current?.focus());
  }, [onClose]);

  const load = useCallback(async (): Promise<Habit[]> => {
    setIsLoading(true);
    try {
      const list = await api.listHabits();
      setHabits(list);
      setError(null);
      return list;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return [];
    } finally {
      setIsLoading(false);
    }
  }, []);

  /** Limpa o formulário e volta para a lista. */
  const resetForm = () => {
    setIsFormOpen(false);
    setEditing(null);
    setFormError(null);
    setTitulo("");
    setSelectedDays([]);
    setHora("09:00");
    setCor(COLOR_SWATCHES[0]);
  };

  /** Abre o formulário preenchido para edição do hábito. */
  const openEdit = (habit: Habit) => {
    const parsed = parseHabitCron(habit.cron_expr);
    setEditing(habit);
    setTitulo(habit.titulo);
    setSelectedDays(parsed.dias);
    setHora(parsed.hora);
    setCor(habit.cor);
    setFormError(null);
    setIsFormOpen(true);
  };

  useEffect(() => {
    if (!isOpen) return;
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current
        ?.querySelector<HTMLElement>("input:not([disabled]), button:not([disabled])")
        ?.focus();
    });
    resetForm();
    void load().then((list) => {
      if (!initialHabitId) return;
      const target = list.find((h) => h.id === initialHabitId);
      if (target) openEdit(target);
    });
    return () => window.cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, load, initialHabitId]);

  // Esc: cancela o formulário aberto antes de fechar o modal (saída em 2 níveis).
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || habitToDelete) return;
      e.stopPropagation();
      if (isFormOpen) resetForm();
      else close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [close, habitToDelete, isOpen, isFormOpen]);

  /** Dias + hora → cron de 5 campos (dias vazios = todos os dias). */
  const previewCron = (): string => {
    const [hRaw, mRaw] = hora.split(":");
    const h = Number.parseInt(hRaw || "9", 10);
    const m = Number.parseInt(mRaw || "0", 10);
    const safeH = Number.isNaN(h) ? 9 : Math.min(23, Math.max(0, h));
    const safeM = Number.isNaN(m) ? 0 : Math.min(59, Math.max(0, m));
    const sorted = [...selectedDays].sort((a, b) => a - b);
    const dow = sorted.length > 0 ? sorted.join(",") : "*";
    return `${safeM} ${safeH} * * ${dow}`;
  };

  const toggleDay = (value: number) => {
    setSelectedDays((prev) =>
      prev.includes(value) ? prev.filter((d) => d !== value) : [...prev, value]
    );
  };

  const handleSave = async () => {
    const t = titulo.trim();
    if (!t) {
      setFormError("Dê um nome ao hábito.");
      return;
    }
    setIsSaving(true);
    setFormError(null);
    try {
      if (editing) {
        await api.updateHabit(editing.id, t, previewCron(), cor);
      } else {
        await api.createHabit(t, previewCron(), cor);
      }
      resetForm();
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggle = async (habit: Habit) => {
    if (togglingIds.has(habit.id)) return;
    setTogglingIds((prev) => new Set(prev).add(habit.id));
    const next = !habit.ativo;
    setHabits((prev) =>
      prev.map((h) => (h.id === habit.id ? { ...h, ativo: next } : h))
    );
    try {
      await api.setHabitActive(habit.id, next);
      setError(null);
    } catch (err) {
      setHabits((prev) =>
        prev.map((h) => (h.id === habit.id ? { ...h, ativo: !next } : h))
      );
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTogglingIds((prev) => {
        const ns = new Set(prev);
        ns.delete(habit.id);
        return ns;
      });
    }
  };

  const handleConfirmDelete = async () => {
    if (!habitToDelete) return;
    try {
      // `false` = já gerava tasks ⇒ apenas desativado (histórico preservado).
      const hard = await api.deleteHabit(habitToDelete.id);
      setError(
        hard
          ? null
          : "Hábito desativado: já existiam tarefas geradas, histórico preservado."
      );
      setHabitToDelete(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={close}
    >
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="habit-modal-title"
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.15 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5 shadow-2xl max-h-[85vh] flex flex-col"
      >
        <div className="flex items-center justify-between mb-4 shrink-0">
          <h3 id="habit-modal-title" className="text-sm font-semibold text-[var(--text-primary)]">
            Hábitos
          </h3>
          <button
            type="button"
            onClick={close}
            aria-label="Fechar"
            className="p-1 rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        {error && (
          <div className="mb-3 px-3 py-2 flex items-start gap-2 text-xs bg-red-500/10 border border-red-500/25 text-[var(--text-danger)] rounded-lg">
            <AlertTriangle size={13} className="shrink-0 mt-0.5" />
            <span className="break-all">{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              className="ml-auto px-1.5 py-0.5 rounded hover:bg-red-500/20"
            >
              Fechar
            </button>
          </div>
        )}

        <div className="overflow-y-auto -mx-1 px-1 space-y-3 min-h-0">
          {/* ── Lista ── */}
          {isLoading && (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-[var(--text-muted)]">
              <Loader2 size={14} className="animate-spin" />
              Carregando hábitos…
            </div>
          )}

          {!isLoading && habits.length === 0 && (
            <p className="text-xs text-[var(--text-muted)] text-center py-6">
              Nenhum hábito ainda. Crie o primeiro — o quadro gera a tarefa
              sozinho no dia certo.
            </p>
          )}

          {!isLoading &&
            habits.map((habit) => (
              <div
                key={habit.id}
                className="rounded-xl border px-3 py-2.5 flex items-center gap-3"
                style={{
                  borderColor: habit.cor,
                  background: `${habit.cor}14`,
                  opacity: habit.ativo ? 1 : 0.55,
                }}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ background: habit.cor }}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-[var(--text-primary)] truncate">
                    {habit.titulo}
                  </p>
                  <p className="text-[10px] text-[var(--text-muted)]">
                    {!habit.ativo && (
                      <span className="mr-1.5 inline-flex items-center px-1.5 py-0.5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-hover)] text-[var(--text-muted)] text-[9px] font-semibold uppercase tracking-wider">
                        Pausado
                      </span>
                    )}
                    {describeCron(habit.cron_expr)}
                    {habit.streak_atual > 0 && (
                      <span className="inline-flex items-center gap-0.5 ml-2 text-[var(--text-warning)]">
                        <Flame size={10} />
                        {habit.streak_atual} dia(s)
                      </span>
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => openEdit(habit)}
                  title="Editar hábito"
                  aria-label={`Editar hábito ${habit.titulo}`}
                  className="p-1.5 rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-accent)] transition-colors"
                >
                  <Pencil size={13} />
                </button>
                <button
                  type="button"
                  disabled={togglingIds.has(habit.id)}
                  onClick={() => void handleToggle(habit)}
                  title={habit.ativo ? "Pausar hábito" : "Reativar hábito"}
                  className="p-1.5 rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-40 transition-colors"
                >
                  <Power size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => setHabitToDelete(habit)}
                  title="Remover hábito"
                  className="p-1.5 rounded-md text-[var(--text-muted)] hover:bg-red-500/10 hover:text-[var(--text-danger)] transition-colors"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}

          {/* ── Formulário de criação ── */}
          {isFormOpen && (
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] p-3 space-y-3">
              <p className="text-[12px] font-semibold text-[var(--text-primary)]">
                {editing ? "Editar hábito" : "Novo hábito"}
              </p>
              <div>
                <label className="block text-[11px] font-medium text-[var(--text-muted)] mb-1">
                  Nome
                </label>
                <input
                  autoFocus
                  value={titulo}
                  onChange={(e) => setTitulo(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleSave();
                  }}
                  placeholder="Ex.: Beber água"
                  className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-amber-500/50"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[var(--text-muted)] mb-1.5">
                  Dias
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {DAY_TOGGLES.map((day) => {
                    const active = selectedDays.includes(day.value);
                    return (
                      <button
                        key={day.value}
                        type="button"
                        onClick={() => toggleDay(day.value)}
                        className={`px-2 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
                          active
                            ? "border-amber-500/50 bg-amber-500/15 text-[var(--text-accent)]"
                            : "border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                        }`}
                      >
                        {day.label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-[var(--text-muted)] mt-1">
                  Nenhum dia marcado = todos os dias.
                </p>
              </div>

              <div className="flex items-end gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-[var(--text-muted)] mb-1">
                    Horário
                  </label>
                  <input
                    type="time"
                    value={hora}
                    onChange={(e) => setHora(e.target.value)}
                    className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-1.5 text-[13px] text-[var(--text-primary)] outline-none focus:border-amber-500/50"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-[var(--text-muted)] mb-1">
                    Cor
                  </label>
                  <div className="flex gap-1.5 pb-1">
                    {COLOR_SWATCHES.map((swatch) => (
                      <button
                        key={swatch}
                        type="button"
                        onClick={() => setCor(swatch)}
                        aria-label={`Cor ${swatch}`}
                        className={`w-5 h-5 rounded-full border-2 transition-transform ${
                          cor === swatch
                            ? "border-[var(--text-primary)] scale-110"
                            : "border-transparent hover:scale-110"
                        }`}
                        style={{ background: swatch }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <p className="text-[11px] text-[var(--text-secondary)] border-t border-[var(--border-subtle)] pt-2">
                {describeCron(previewCron())}
              </p>

              {formError && (
                <p className="text-[11px] text-[var(--text-danger)] break-all">{formError}</p>
              )}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={resetForm}
                  className="text-xs px-3 py-1.5 rounded-lg text-[var(--text-muted)] border border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => void handleSave()}
                  className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg font-medium text-[#241a05] bg-amber-500 hover:bg-amber-400 disabled:opacity-50 transition-colors"
                >
                  {isSaving && <Loader2 size={12} className="animate-spin" />}
                  {editing ? "Salvar alterações" : "Criar hábito"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── Rodapé ── */}
        {!isFormOpen && (
          <button
            type="button"
            onClick={() => {
              setEditing(null);
              setFormError(null);
              setIsFormOpen(true);
            }}
            className="mt-4 shrink-0 inline-flex items-center justify-center gap-1.5 text-xs font-medium px-3 py-2 rounded-xl border border-dashed border-amber-500/40 text-[var(--text-accent)] hover:bg-amber-500/10 transition-colors"
          >
            <Plus size={13} />
            Novo hábito
          </button>
        )}

        <DeleteConfirmModal
          isOpen={!!habitToDelete}
          sessionTitle={habitToDelete?.titulo ?? ""}
          title="Remover hábito"
          description="Se o hábito ainda nunca gerou tarefas, será apagado. Caso contrário, apenas desativamos (histórico e métricas preservados)."
          onConfirm={() => {
            void handleConfirmDelete();
          }}
          onCancel={() => setHabitToDelete(null)}
        />
      </motion.div>
    </div>
  );
};
