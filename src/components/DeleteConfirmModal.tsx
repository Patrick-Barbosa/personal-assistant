import React, { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Trash2, AlertTriangle, X } from "lucide-react";

interface DeleteConfirmModalProps {
  isOpen: boolean;
  sessionTitle: string;
  onConfirm: () => void;
  onCancel: () => void;
  title?: string;
  description?: string;
}

export const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({
  isOpen,
  sessionTitle,
  onConfirm,
  onCancel,
  title,
  description,
}) => {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      } else if (e.key === "Enter") {
        e.preventDefault();
        onConfirm();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onConfirm, onCancel]);

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
              <div className="w-10 h-10 rounded-xl bg-rose-500/20 border border-rose-500/30 flex items-center justify-center text-rose-500 shrink-0">
                <AlertTriangle size={20} />
              </div>
              <button
                onClick={onCancel}
                className="p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-app)] transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title || "Excluir conversa?"}</h3>
              <p className="mt-1 text-xs text-[var(--text-muted)] leading-relaxed">
                {description || (
                  <>
                    Você está prestes a excluir <span className="text-[var(--text-primary)] font-medium font-mono">"{sessionTitle}"</span>. Esta ação removerá permanentemente todo o histórico de mensagens desta sessão.
                  </>
                )}
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border-subtle)]">
              <button
                type="button"
                onClick={onCancel}
                className="px-3 py-1.5 rounded-xl text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-app)] transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={onConfirm}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-medium bg-rose-600 hover:bg-rose-500 text-white shadow-md shadow-rose-900/40 transition-all"
              >
                <Trash2 size={13} />
                <span>Excluir</span>
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
