import React from "react";
import { FileText, X } from "lucide-react";
import { AttachedNote } from "../types";

interface AttachedNotesChipsProps {
  notes: AttachedNote[];
  onRemove: (slug: string) => void;
  /** Versão compacta para cards e áreas de inspeção. */
  compact?: boolean;
  readOnly?: boolean;
}

export const AttachedNotesChips: React.FC<AttachedNotesChipsProps> = ({
  notes,
  onRemove,
  compact = false,
  readOnly = false,
}) => {
  if (notes.length === 0) return null;

  return (
    <div
      className={
        compact
          ? "flex flex-wrap items-center gap-1.5"
          : "flex flex-wrap items-center gap-1.5 border-b border-[var(--border-subtle)]/80 bg-[var(--bg-card)]/40 px-3 pb-1 pt-2 select-none"
      }
    >
      {notes.map((note) => (
        <span
          key={note.slug}
          className={`inline-flex items-center gap-1.5 rounded-lg border text-xs ${
            compact ? "px-1.5 py-0.5 text-[10px]" : "px-2.5 py-1"
          } border-amber-500/25 bg-amber-500/10 text-[var(--text-accent)]`}
        >
          <FileText size={compact ? 10 : 12} className="shrink-0 text-[var(--text-accent)]" />
          <span className={`truncate font-medium ${compact ? "max-w-[120px]" : "max-w-[160px]"}`}>
            {note.title}
          </span>
          {!readOnly && (
            <button
              type="button"
              onClick={() => onRemove(note.slug)}
              aria-label={`Remover vínculo ${note.title}`}
              className="rounded-sm p-0.5 text-current transition-colors hover:text-[var(--text-accent)]"
              title="Remover nota"
            >
              <X size={compact ? 10 : 11} />
            </button>
          )}
        </span>
      ))}
    </div>
  );
};
