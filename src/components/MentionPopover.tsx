import React from "react";
import { BookOpen } from "lucide-react";
import { NoteTitleItem } from "../types";

interface MentionPopoverProps {
  isOpen: boolean;
  notes: NoteTitleItem[];
  selectedIndex: number;
  onSelect: (note: NoteTitleItem) => void;
}

export const MentionPopover: React.FC<MentionPopoverProps> = ({
  isOpen,
  notes,
  selectedIndex,
  onSelect,
}) => {
  if (!isOpen || notes.length === 0) return null;

  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-2xl overflow-hidden z-50 select-none">
      <div className="px-3 py-1.5 border-b border-[var(--border-subtle)] text-[10px] font-semibold tracking-wider text-[var(--text-muted)] uppercase flex items-center gap-1.5">
        <BookOpen size={11} className="text-amber-400" />
        <span>Vincular nota ou entity ao contexto</span>
      </div>
      <div className="max-h-52 overflow-y-auto p-1 space-y-0.5">
        {notes.map((item, idx) => (
          <button
            key={item.path}
            type="button"
            onClick={() => onSelect(item)}
            className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs text-left transition-colors cursor-pointer ${
              idx === selectedIndex
                ? "bg-amber-500/15 text-amber-200 border border-amber-500/30"
                : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
            }`}
          >
            <span className="font-medium truncate">{item.title}</span>
            <span className="text-[10px] text-[var(--text-muted)] font-mono shrink-0 ml-2">
              {item.vault === "obsidian"
                ? "Obsidian"
                : item.vault === "entidade"
                  ? "Entity"
                  : "Padrão"}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};
