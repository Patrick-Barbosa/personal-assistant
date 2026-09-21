import React, { useState, useEffect } from "react";
import { Search, FileText, X, ExternalLink, BookOpen, Sparkles, MessageSquare } from "lucide-react";
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
  }, [isOpen]);

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
      const identifier = item.path || item.file_path || item.title || item.titulo;
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
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in duration-200">
      <div className="w-full max-w-3xl bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Search header */}
        <div className="p-4 border-b border-[var(--border-subtle)] flex items-center gap-3 bg-transparent">
          <Search size={18} className="text-amber-500 dark:text-amber-400 shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar notas por similaridade semântica nos cofres..."
            autoFocus
            className="flex-1 bg-transparent text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              <X size={16} />
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-black/5 dark:hover:bg-white/10 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal content body */}
        <div className="flex-1 overflow-y-auto flex divide-x divide-[var(--border-subtle)] min-h-[350px]">
          {/* Results list */}
          <div className={`${selectedNote ? "w-1/2" : "w-full"} overflow-y-auto p-3 space-y-1.5`}>
            {isSearching && (
              <div className="p-8 text-center text-xs text-[var(--text-muted)] flex items-center justify-center gap-2">
                <Sparkles size={16} className="animate-spin text-amber-500 dark:text-amber-400" />
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
                <BookOpen size={28} className="opacity-40 text-amber-500 dark:text-amber-400" />
                <span>Digite termos para buscar notas nos cofres Default e Obsidian.</span>
                <span className="text-[11px] opacity-75">Busca semântica vetorial com FastEmbed</span>
              </div>
            )}

            {results.map((res) => {
              const resId = res.path || res.file_path || res.title;
              const selectedId = selectedNote ? (selectedNote.title || selectedNote.titulo) : null;
              const isSelected = selectedId === res.title || selectedId === res.titulo;

              return (
                <div
                  key={resId}
                  onClick={() => handleSelectNote(res)}
                  className={`p-3 rounded-xl cursor-pointer transition-all border ${
                    isSelected
                      ? "bg-amber-500/15 border-amber-500/50 text-[var(--text-primary)]"
                      : "bg-black/5 dark:bg-white/[0.02] border-[var(--border-subtle)] hover:bg-black/10 dark:hover:bg-white/[0.06] hover:border-amber-500/30 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <FileText size={15} className={`shrink-0 ${isSelected ? "text-amber-500 dark:text-amber-400" : "text-[var(--text-muted)]"}`} />
                      <span className="text-xs font-medium truncate">{res.title || res.titulo}</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                          res.vault === "obsidian"
                            ? "bg-cyan-950/60 text-cyan-300 border border-cyan-800/40"
                            : "bg-amber-500/20 text-amber-500 dark:text-amber-400 border border-amber-500/30"
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
            <div className="w-1/2 p-4 flex flex-col overflow-hidden bg-black/10 dark:bg-black/30">
              <div className="flex items-center justify-between pb-3 border-b border-[var(--border-subtle)] mb-3">
                <div className="min-w-0 pr-2">
                  <h4 className="text-sm font-semibold text-[var(--text-primary)] truncate">
                    {selectedNote.title || selectedNote.titulo}
                  </h4>
                  <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">
                    Cofre: {selectedNote.vault}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {onInsertNoteContext && (
                    <button
                      onClick={() => {
                        onInsertNoteContext(selectedNote.title || selectedNote.titulo || "", selectedNote.content || selectedNote.corpo || "");
                        onClose();
                      }}
                      className="text-xs px-2.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-medium flex items-center gap-1.5 transition-colors shadow-lg shadow-amber-500/30"
                      title="Enviar contexto desta nota para o chat atual"
                    >
                      <MessageSquare size={13} />
                      <span>Inserir no Chat</span>
                    </button>
                  )}
                  <button
                    onClick={() => setSelectedNote(null)}
                    className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/5 rounded-lg"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>

              {isLoadingNote ? (
                <div className="flex-1 flex items-center justify-center text-xs text-[var(--text-muted)] gap-2">
                  <Sparkles size={14} className="animate-spin text-amber-500 dark:text-amber-400" />
                  <span>Carregando nota...</span>
                </div>
              ) : readError ? (
                <div className="flex-1 p-3 text-xs text-rose-400 bg-rose-950/30 rounded-lg border border-rose-800/40">
                  {readError}
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto text-xs text-[var(--text-primary)] font-mono whitespace-pre-wrap leading-relaxed pr-2 select-text">
                  {selectedNote.content || selectedNote.corpo}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal footer */}
        <div className="p-3 bg-[var(--bg-app)] border-t border-[var(--border-subtle)] px-4 flex items-center justify-between text-[11px] text-[var(--text-muted)]">
          <span>Pressione <kbd className="px-1.5 py-0.5 bg-[var(--bg-card)] text-[var(--text-primary)] border border-[var(--border-subtle)] rounded text-[10px]">Esc</kbd> para fechar</span>
          <span>Indexação semântica FastEmbed local</span>
        </div>
      </div>
    </div>
  );
};
