import React, { useCallback, useEffect, useId, useRef } from "react";
import { Trash2, AlertTriangle, Loader2, X } from "lucide-react";

interface DeleteConfirmModalProps {
  isOpen: boolean;
  sessionTitle: string;
  onConfirm: () => void;
  onCancel: () => void;
  title?: string;
  description?: string;
  busy?: boolean;
}

export const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({
  isOpen,
  sessionTitle,
  onConfirm,
  onCancel,
  title,
  description,
  busy = false,
}) => {
  const titleId = useId();
  const openerRef = useRef<HTMLElement | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);

  const dialogRef = useRef<HTMLDivElement | null>(null);

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      )
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const close = useCallback(() => {
    if (busy) return;
    onCancel();
    window.requestAnimationFrame(() => openerRef.current?.focus());
  }, [busy, onCancel]);

  useEffect(() => {
    if (!isOpen) return;
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => cancelButtonRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [close, isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div
        ref={dialogRef}
        onKeyDown={handleDialogKeyDown}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-app)] p-5 text-[var(--text-primary)] shadow-2xl"
      >
        <div className="flex items-start justify-between">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-rose-500/30 bg-rose-500/15 text-[var(--text-danger)]">
            <AlertTriangle size={20} />
          </div>
          <button
            type="button"
            onClick={close}
            disabled={busy}
            aria-label="Fechar confirmação"
            className="rounded-lg p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <X size={16} />
          </button>
        </div>

        <div>
          <h3 id={titleId} className="text-sm font-semibold text-[var(--text-primary)]">
            {title || "Excluir conversa?"}
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">
            {description || (
              <>
                Você está prestes a excluir{" "}
                <span className="font-mono font-medium text-[var(--text-secondary)]">"{sessionTitle}"</span>. Esta ação removerá permanentemente todo o histórico de mensagens desta sessão.
              </>
            )}
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] pt-2">
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={close}
            disabled={busy}
            className="rounded-xl border border-[var(--border-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-xl bg-rose-600 px-3 py-1.5 text-xs font-medium text-white shadow-md shadow-rose-900/30 transition-colors hover:bg-rose-500 disabled:cursor-wait disabled:opacity-60"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
            <span>{busy ? "Excluindo…" : "Excluir"}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
