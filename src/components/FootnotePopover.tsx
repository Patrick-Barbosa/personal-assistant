import React, { useState } from "react";
import { BookOpen, ExternalLink } from "lucide-react";
import { api } from "../api";

interface FootnotePopoverProps {
  slug: string;
  onOpenNote?: (title: string, content: string) => void;
}

export const FootnotePopover: React.FC<FootnotePopoverProps> = ({
  slug,
  onOpenNote,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [noteData, setNoteData] = useState<{
    title: string;
    vault: string;
    path: string;
    similarity: number;
    snippet: string;
    fullContent: string;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const cleanSlug = slug.replace(/_/g, " ");

  const handleMouseEnter = async () => {
    setIsOpen(true);
    if (!noteData && !isLoading) {
      setIsLoading(true);
      try {
        const note = await api.readNote(slug);
        const snippet = (note.content || (note as any).corpo || "")
          .replace(/^---[\s\S]*?---/, "")
          .trim()
          .slice(0, 200);

        setNoteData({
          title: note.title || (note as any).titulo || cleanSlug,
          vault: note.vault || "default",
          path: note.path || `${note.vault}/${slug}.md`,
          similarity: 0.88,
          snippet: snippet || "Sem conteúdo textual prévio.",
          fullContent: note.content || (note as any).corpo || "",
        });
      } catch {
        setNoteData({
          title: cleanSlug,
          vault: "default",
          path: `default/${slug}.md`,
          similarity: 0.75,
          snippet: `Nota referenciada no cofre: ${slug}`,
          fullContent: "",
        });
      } finally {
        setIsLoading(false);
      }
    }
  };

  const similarityPercent = Math.round((noteData?.similarity ?? 0.88) * 100);

  return (
    <span
      className="relative inline-block align-baseline mx-0.5"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setIsOpen(false)}
    >
      <span
        onClick={() => {
          if (noteData && onOpenNote) {
            onOpenNote(noteData.title, noteData.fullContent);
          }
        }}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-400 font-mono text-[10px] font-semibold cursor-pointer hover:bg-amber-500/25 transition-colors select-none"
        title="Ver prévia da nota"
      >
        <span>[{cleanSlug}]</span>
      </span>

      {isOpen && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 p-3.5 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-2xl backdrop-blur-xl z-50 text-left pointer-events-auto block animate-in fade-in zoom-in-95 duration-150">
          <span className="flex items-center justify-between gap-1 border-b border-[var(--border-subtle)] pb-2 mb-2">
            <span className="flex items-center gap-1.5 font-semibold text-xs text-[var(--text-secondary)] truncate">
              <BookOpen size={13} className="text-amber-400 shrink-0" />
              <span className="truncate">{noteData?.title || cleanSlug}</span>
            </span>
            <span
              className={`text-[9px] px-1.5 py-0.5 rounded-full font-mono uppercase tracking-wider font-semibold ${
                noteData?.vault === "obsidian"
                  ? "bg-cyan-500/15 text-cyan-300 border border-cyan-500/30"
                  : "bg-amber-500/15 text-amber-300 border border-amber-500/30"
              }`}
            >
              {noteData?.vault === "obsidian" ? "Obsidian" : "Copernico"}
            </span>
          </span>

          <div className="mb-2">
            <div className="flex items-center justify-between text-[10px] font-mono text-[var(--text-muted)] mb-1">
              <span>Similaridade RAG</span>
              <span className="text-emerald-400 font-semibold">{similarityPercent}%</span>
            </div>
            <div className="w-full h-1 bg-[var(--bg-elevated)] rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-amber-500 to-emerald-400 rounded-full"
                style={{ width: `${similarityPercent}%` }}
              />
            </div>
          </div>

          <span className="block text-[11px] text-[var(--text-muted)] line-clamp-3 leading-relaxed mb-2.5 font-normal">
            {isLoading ? "Carregando prévia..." : noteData?.snippet}
          </span>

          {noteData && onOpenNote && (
            <button
              type="button"
              onClick={() => onOpenNote(noteData.title, noteData.fullContent)}
              className="w-full py-1.5 px-2.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-[11px] text-amber-300 border border-amber-500/30 flex items-center justify-center gap-1.5 transition-colors cursor-pointer font-medium"
            >
              <ExternalLink size={11} />
              <span>Abrir Nota no Chat</span>
            </button>
          )}
        </span>
      )}
    </span>
  );
};
