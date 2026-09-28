import React, { useEffect, useRef, useState } from "react";
import { MessageSquare, Edit2, Trash2, Check, X } from "lucide-react";
import { Session } from "../types";

interface SidebarSessionItemProps {
  session: Session;
  isActive: boolean;
  onSelect: (id: string) => void;
  onRename: (id: string, newTitle: string) => void;
  onRequestDelete: (session: Session) => void;
}

export const SidebarSessionItem: React.FC<SidebarSessionItemProps> = ({
  session,
  isActive,
  onSelect,
  onRename,
  onRequestDelete,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const sessionTitle = session.title || session.titulo || "Conversa";
  const [titleInput, setTitleInput] = useState(sessionTitle);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  const handleSave = (event: React.FormEvent) => {
    event.stopPropagation();
    event.preventDefault();
    const clean = titleInput.trim();
    if (clean && clean !== sessionTitle) onRename(session.id, clean);
    setIsEditing(false);
  };

  const handleCancel = (event: React.MouseEvent | React.KeyboardEvent) => {
    event.stopPropagation();
    setTitleInput(sessionTitle);
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <form
        onSubmit={handleSave}
        className="flex items-center gap-1.5 rounded-xl border border-amber-500/40 bg-[var(--bg-input)] px-2.5 py-1.5 text-xs"
        onClick={(event) => event.stopPropagation()}
      >
        <input
          ref={inputRef}
          type="text"
          value={titleInput}
          onChange={(event) => setTitleInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") handleCancel(event);
          }}
          aria-label="Renomear conversa"
          className="flex-1 bg-transparent text-xs text-[var(--text-primary)] outline-none"
        />
        <button
          type="submit"
          aria-label="Salvar nome da conversa"
          className="rounded p-1 text-[var(--text-muted)] transition-colors hover:text-[var(--text-success)]"
          title="Salvar"
        >
          <Check size={13} />
        </button>
        <button
          type="button"
          onClick={handleCancel}
          aria-label="Cancelar renomeação"
          className="rounded p-1 text-[var(--text-muted)] transition-colors hover:text-[var(--text-danger)]"
          title="Cancelar"
        >
          <X size={13} />
        </button>
      </form>
    );
  }

  return (
    <div
      role="group"
      tabIndex={0}
      aria-current={isActive ? "page" : undefined}
      aria-label={`Abrir conversa ${sessionTitle}`}
      onClick={() => onSelect(session.id)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(session.id);
        }
      }}
      className={`group relative flex cursor-pointer select-none items-center justify-between rounded-xl border px-2.5 py-1.5 text-xs transition-all ${
        isActive
          ? "border-[var(--border-subtle)]/60 bg-[var(--bg-elevated)] font-medium text-[var(--text-primary)]"
          : "border-transparent text-[var(--text-muted)] hover:bg-[var(--bg-card)] hover:text-[var(--text-secondary)]"
      }`}
    >
      <div className="flex min-w-0 items-center gap-2 truncate pr-2">
        <MessageSquare
          size={13}
          aria-hidden="true"
          className={`shrink-0 ${isActive ? "text-[var(--text-accent)]" : "text-[var(--text-muted)]"}`}
        />
        <span className="truncate">{sessionTitle}</span>
      </div>

      <div className="flex shrink-0 items-center gap-0.5 opacity-70 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setIsEditing(true);
          }}
          aria-label={`Renomear ${sessionTitle}`}
          className="rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)]/50 hover:text-[var(--text-secondary)]"
          title="Renomear"
        >
          <Edit2 size={12} />
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onRequestDelete(session);
          }}
          aria-label={`Excluir ${sessionTitle}`}
          className="rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)]/50 hover:text-[var(--text-danger)]"
          title="Excluir"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
};
