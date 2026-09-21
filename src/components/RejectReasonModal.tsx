import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { XCircle, Trash2, X } from "lucide-react";

interface RejectReasonModalProps {
  isOpen: boolean;
  itemTitle: string;
  mode: "dismiss" | "delete";
  isLoading?: boolean;
  onConfirm: (reason: string | null) => void;
  onCancel: () => void;
}

const MAX_REASON = 140;

export const RejectReasonModal: React.FC<RejectReasonModalProps> = ({
  isOpen,
  itemTitle,
  mode,
  isLoading = false,
  onConfirm,
  onCancel,
}) => {
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (isOpen) {
      setReason("");
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onCancel]);

  const isDelete = mode === "delete";
  const clean = reason.trim();
  const confirmLabel = isDelete ? "Excluir e registrar" : "Rejeitar e registrar";

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm select-none">
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 8 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="w-full max-w-sm rounded-2xl bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-2xl p-5 text-[var(--text-primary)] flex flex-col gap-4"
          >
            <div className="flex items-start justify-between">
              <div
                className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${
                  isDelete
                    ? "bg-rose-500/20 border-rose-500/30 text-rose-500"
                    : "bg-amber-500/15 border-amber-500/30 text-amber-400"
                }`}
              >
                {isDelete ? <Trash2 size={20} /> : <XCircle size={20} />}
              </div>
              <button
                onClick={onCancel}
                className="p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-app)] transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                {isDelete ? "Excluir proposta?" : "Rejeitar proposta?"}
              </h3>
              <p className="mt-1 text-xs text-[var(--text-muted)] leading-relaxed">
                {isDelete ? (
                  <>
                    Você está prestes a excluir{" "}
                    <span className="text-[var(--text-primary)] font-medium">"{itemTitle}"</span>.
                    A decisão vai para o chat da sessão para o agente saber que nada foi criado.
                  </>
                ) : (
                  <>
                    Você está prestes a rejeitar{" "}
                    <span className="text-[var(--text-primary)] font-medium">"{itemTitle}"</span>.
                    Ela ficará visível por 3 dias e o agente saberá que{" "}
                    <span className="text-[var(--text-primary)] font-medium">nada foi criado</span>.
                  </>
                )}
              </p>
            </div>

            <div>
              <label
                htmlFor="reject-reason"
                className="block text-[11px] font-semibold text-[var(--text-muted)] mb-1.5"
              >
                Motivo <span className="font-normal">(opcional — elucida a decisão no chat)</span>
              </label>
              <textarea
                id="reject-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value.slice(0, MAX_REASON))}
                placeholder="Ex: duplicada, já anotei em outro lugar, não é prioridade agora..."
                rows={3}
                autoFocus
                className="w-full bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-amber-500/50 rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none resize-none"
              />
              <div className="mt-1 text-right text-[10px] font-mono text-[var(--text-muted)]">
                {clean.length}/{MAX_REASON}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border-subtle)]">
              <button
                type="button"
                onClick={onCancel}
                disabled={isLoading}
                className="px-3 py-1.5 rounded-xl text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-app)] transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => onConfirm(clean.length > 0 ? clean : null)}
                disabled={isLoading}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-medium text-white shadow-md transition-all disabled:opacity-50 ${
                  isDelete
                    ? "bg-rose-600 hover:bg-rose-500 shadow-rose-900/40"
                    : "bg-amber-500 hover:bg-amber-400 text-neutral-950 shadow-amber-900/40"
                }`}
              >
                {isDelete ? <Trash2 size={13} /> : <XCircle size={13} />}
                <span>{isLoading ? "Registrando..." : confirmLabel}</span>
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
