import React, { useState, useEffect } from "react";
import { GitCompare, CheckCircle2, RefreshCw, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../api";
import { InboxItem } from "../types";

interface DiffModalProps {
  item: InboxItem;
  onClose: () => void;
  onEvolve: (id: string) => Promise<void>;
  isLoading: boolean;
}

export const DiffSideBySideModal: React.FC<DiffModalProps> = ({
  item,
  onClose,
  onEvolve,
  isLoading,
}) => {
  const [originalContent, setOriginalContent] = useState<string>("");
  const [isLoadingOriginal, setIsLoadingOriginal] = useState<boolean>(true);

  useEffect(() => {
    const fetchOriginal = async () => {
      if (item.proposed_content && item.content) {
        setOriginalContent(item.content);
        setIsLoadingOriginal(false);
        return;
      }

      if (item.target_base_note_slug) {
        try {
          const note = await api.readNote(item.target_base_note_slug);
          setOriginalContent(note.content || (note as any).corpo || "");
        } catch {
          setOriginalContent(
            typeof item.diff_data === "object" && item.diff_data?.original_snippet
              ? item.diff_data.original_snippet
              : item.content || "*Nota base original ainda não indexada no cofre.*"
          );
        } finally {
          setIsLoadingOriginal(false);
        }
      } else {
        setOriginalContent(
          typeof item.diff_data === "object" && item.diff_data?.original_snippet
            ? item.diff_data.original_snippet
            : item.content || "*Esta proposta é inédita ou não possui nota ancestral no Obsidian.*"
        );
        setIsLoadingOriginal(false);
      }
    };
    fetchOriginal();
  }, [item]);

  const proposed = item.proposed_content || item.content;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-150 select-none">
      <div className="bg-[var(--bg-app)] border border-[var(--border-subtle)] rounded-3xl w-full max-w-5xl h-[88vh] flex flex-col shadow-2xl overflow-hidden text-[var(--text-primary)] animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-5 border-b border-[var(--border-subtle)] flex items-center justify-between gap-4 shrink-0 bg-[var(--bg-card)]/40">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2.5 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-400">
              <GitCompare size={18} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-[var(--text-primary)] truncate">
                  Diff: {item.title}
                </h3>
                <span className="px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 font-mono text-[10px] font-bold">
                  Evolução In-Place
                </span>
              </div>
              <p className="text-xs text-[var(--text-muted)] truncate">
                Nota Canônica Original ➔ Versão Proposta com Histórico
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onEvolve(item.id)}
              disabled={isLoading}
              className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-semibold flex items-center gap-2 transition-all shadow-md shadow-amber-500/20 disabled:opacity-50 cursor-pointer"
            >
              {isLoading ? (
                <RefreshCw size={13} className="animate-spin" />
              ) : (
                <CheckCircle2 size={14} />
              )}
              <span>Aprovar e Gravar</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-all"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Split View */}
        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-zinc-800 overflow-hidden">
          {/* Left: Original */}
          <div className="flex flex-col h-full overflow-hidden bg-[var(--bg-app)]/80">
            <div className="p-3 px-5 border-b border-[var(--border-subtle)] flex items-center justify-between bg-[var(--bg-card)]/40">
              <div className="flex items-center gap-2 text-xs font-semibold text-cyan-400">
                <span className="w-2 h-2 rounded-full bg-cyan-400" />
                <span>Base Original (Canônica)</span>
              </div>
              {item.target_base_note_slug && (
                <span className="text-[10px] font-mono text-[var(--text-muted)]">
                  [[{item.target_base_note_slug}]]
                </span>
              )}
            </div>
            <div className="flex-1 p-5 overflow-y-auto select-text font-mono text-xs leading-relaxed text-[var(--text-muted)]">
              {isLoadingOriginal ? (
                <div className="flex items-center gap-2 text-xs py-4 text-[var(--text-muted)]">
                  <RefreshCw size={13} className="animate-spin" />
                  <span>Carregando nota ancestral...</span>
                </div>
              ) : (
                <pre className="whitespace-pre-wrap font-sans text-xs">{originalContent}</pre>
              )}
            </div>
          </div>

          {/* Right: Proposed */}
          <div className="flex flex-col h-full overflow-hidden bg-amber-500/[0.02]">
            <div className="p-3 px-5 border-b border-[var(--border-subtle)] flex items-center justify-between bg-amber-500/5">
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-400">
                <span className="w-2 h-2 rounded-full bg-amber-400" />
                <span>Versão Proposta</span>
              </div>
              <span className="text-[10px] font-mono text-amber-400/80">
                {item.target_base_note_slug ? `cofres/default/${item.target_base_note_slug}.md` : "Evolução"}
              </span>
            </div>
            <div className="flex-1 p-5 overflow-y-auto select-text font-mono text-xs leading-relaxed text-[var(--text-secondary)]">
              <div className="markdown-body text-xs">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {proposed}
                </ReactMarkdown>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 px-5 border-t border-[var(--border-subtle)] bg-[var(--bg-app)] flex items-center justify-between text-xs text-[var(--text-muted)]">
          <span>
            Ao aprovar, a nota canônica será atualizada diretamente no cofre padrão.
          </span>
          <span className="font-mono text-[10px] text-amber-400/80">
            Regra R/O Obsidian: Preservada
          </span>
        </div>
      </div>
    </div>
  );
};
