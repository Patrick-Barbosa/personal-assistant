import React, { useState, useEffect } from "react";
import { Search, FileText, X, BookOpen, Sparkles, MessageSquare } from "lucide-react";
import { NoteResponse, SearchResult } from "../types";
import { api } from "../api";

interface NoteSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInsertNoteContext?: (title: string, content: string) => void;
}

export const NoteSearchModal: React.FC<NoteSearchModalProps> = ({
  isOpen,
  onClose,
  onInsertNoteContext,
}) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedNote, setSelectedNote] = useState<NoteResponse | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingNote, setIsLoadingNote] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setQuery("");
      setResults([]);
      setSelectedNote(null);
      setReadError(null);
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await api.searchNotes(query.trim(), 8);
        setResults(res);
      } catch (err) {
        console.error("Search error:", err);
      } finally {
        setIsSearching(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [query]);

  const handleSelectNote = async (item: SearchResult) => {
    setIsLoadingNote(true);
    setReadError(null);
    try {
      const identifier = item.path || item.file_path || item.title || (item as any).titulo;
      const note = await api.readNote(identifier);
      setSelectedNote(note);
    } catch (err) {
      console.error("Read note error:", err);
      setReadError(`Não foi possível carregar a nota: ${String(err)}`);
    } finally {
      setIsLoadingNote(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-150 select-none">
      <div className="w-full max-w-3xl bg-[var(--bg-app)] border border-[var(--border-subtle)] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] text-[var(--text-primary)] animate-in zoom-in-95 duration-150">
        {/* Search header */}
        <div className="p-3.5 border-b border-[var(--border-subtle)] flex items-center gap-3 bg-[var(--bg-card)]/40">
          <Search size={16} className="text-amber-400 shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar notas por similaridade semântica nos cofres..."
            autoFocus
            className="flex-1 bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="p-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            >
              <X size={14} />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Modal content body */}
        <div className="flex-1 overflow-y-auto flex divide-x divide-zinc-800 min-h-[350px]">
          {/* Results list */}
          <div className={`${selectedNote ? "w-1/2" : "w-full"} overflow-y-auto p-3 space-y-1.5`}>
            {isSearching && (
              <div className="p-8 text-center text-xs text-[var(--text-muted)] flex items-center justify-center gap-2">
                <Sparkles size={15} className="animate-spin text-amber-400" />
                <span>Consultando índice vetorial dos cofres...</span>
              </div>
            )}

            {!isSearching && results.length === 0 && query && (
              <div className="p-8 text-center text-xs text-[var(--text-muted)]">
                Nenhuma nota encontrada para "{query}".
              </div>
            )}

            {!isSearching && results.length === 0 && !query && (
              <div className="p-12 text-center text-xs text-[var(--text-muted)] flex flex-col items-center gap-2">
                <BookOpen size={26} className="text-amber-400/50" />
                <span className="text-[var(--text-muted)] font-medium">Digite termos para buscar notas nos cofres.</span>
                <span className="text-[11px] text-[var(--text-muted)]">Busca semântica vetorial local com FastEmbed</span>
              </div>
            )}

            {results.map((res) => {
              const resId = res.path || res.file_path || res.title;
              const selectedId = selectedNote ? (selectedNote.title || (selectedNote as any).titulo) : null;
              const isSelected = selectedId === res.title || selectedId === (res as any).titulo;

              return (
                <div
                  key={resId}
                  onClick={() => handleSelectNote(res)}
                  className={`p-3 rounded-xl cursor-pointer transition-all border ${
                    isSelected
                      ? "bg-amber-500/15 border-amber-500/40 text-[var(--text-primary)]"
                      : "bg-[var(--bg-card)]/60 border-[var(--border-subtle)]/80 hover:bg-[var(--bg-card)] hover:border-[var(--border-subtle)] text-[var(--text-secondary)]"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText size={14} className={`shrink-0 ${isSelected ? "text-amber-400" : "text-[var(--text-muted)]"}`} />
                      <span className="text-xs font-medium truncate">{res.title || (res as any).titulo}</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span
                        className={`text-[9px] px-1.5 py-0.5 rounded-md font-medium uppercase font-mono ${
                          res.vault === "obsidian"
                            ? "bg-cyan-500/15 text-cyan-300 border border-cyan-500/30"
                            : "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                        }`}
                      >
                        {res.vault}
                      </span>
                      <span className="text-[10px] text-[var(--text-muted)] font-mono">
                        {(res.score * 100).toFixed(0)}%
                      </span>
                    </div>
                  </div>
                  {res.preview && (
                    <p className="mt-1.5 text-[11px] text-[var(--text-muted)] line-clamp-2 leading-relaxed">
                      {res.preview}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {/* Note detail preview */}
          {selectedNote && (
            <div className="w-1/2 p-4 flex flex-col overflow-hidden bg-[var(--bg-app)]/70">
              <div className="flex items-center justify-between pb-3 border-b border-[var(--border-subtle)] mb-3">
                <div className="min-w-0 pr-2">
                  <h4 className="text-xs font-semibold text-[var(--text-primary)] truncate">
                    {selectedNote.title || (selectedNote as any).titulo}
                  </h4>
                  <span className="text-[10px] text-[var(--text-muted)] uppercase font-mono tracking-wider">
                    Cofre: {selectedNote.vault}
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {onInsertNoteContext && (
                    <button
                      type="button"
                      onClick={() => {
                        onInsertNoteContext(
                          selectedNote.title || (selectedNote as any).titulo || "",
                          selectedNote.content || (selectedNote as any).corpo || ""
                        );
                        onClose();
                      }}
                      className="text-xs px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                      title="Inserir contexto da nota no chat"
                    >
                      <MessageSquare size={12} />
                      <span>Inserir</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setSelectedNote(null)}
                    className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] rounded-lg"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>

              {isLoadingNote ? (
                <div className="flex-1 flex items-center justify-center text-xs text-[var(--text-muted)] gap-2">
                  <Sparkles size={14} className="animate-spin text-amber-400" />
                  <span>Carregando nota...</span>
                </div>
              ) : readError ? (
                <div className="flex-1 p-3 text-xs text-rose-400 bg-rose-950/20 rounded-xl border border-rose-800/30">
                  {readError}
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto text-xs text-[var(--text-secondary)] font-mono whitespace-pre-wrap leading-relaxed pr-1 select-text">
                  {selectedNote.content || (selectedNote as any).corpo}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal footer */}
        <div className="p-2.5 bg-[var(--bg-app)] border-t border-[var(--border-subtle)] px-4 flex items-center justify-between text-[11px] text-[var(--text-muted)]">
          <span>Pressione <kbd className="px-1 py-0.5 bg-[var(--bg-card)] text-[var(--text-secondary)] border border-[var(--border-subtle)] rounded text-[10px]">Esc</kbd> para fechar</span>
          <span>Indexação semântica FastEmbed ONNX</span>
        </div>
      </div>
    </div>
  );
};
