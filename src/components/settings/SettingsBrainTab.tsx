import React, { useState } from "react";
import { FolderOpen, RefreshCw, Check, Loader2, Database } from "lucide-react";
import { api } from "../../api";

export const SettingsBrainTab: React.FC = () => {
  const [isReindexing, setIsReindexing] = useState(false);
  const [reindexFeedback, setReindexFeedback] = useState<string | null>(null);
  const [folderFeedback, setFolderFeedback] = useState<string | null>(null);

  const handleReindex = async () => {
    setIsReindexing(true);
    setReindexFeedback(null);
    try {
      await api.reindexVaults();
      setReindexFeedback("Reindexação concluída com sucesso!");
    } catch (err) {
      setReindexFeedback(`Erro na indexação: ${String(err)}`);
    } finally {
      setIsReindexing(false);
    }
  };

  const handleOpenFolder = async () => {
    try {
      await api.openBrainFolder();
    } catch {
      setFolderFeedback("Não foi possível abrir o diretório no explorador de arquivos.");
      setTimeout(() => setFolderFeedback(null), 3000);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <Database size={16} className="text-amber-400" />
          <span>Cofres de Notas & Busca Semântica (FastEmbed)</span>
        </h3>
        <p className="text-xs text-[var(--text-muted)] mt-1 leading-relaxed">
          O Copernico indexa notas Markdown com modelo de embedding ONNX local (384 dimensões) e SQLite WAL.
        </p>
      </div>

      {/* Vault Actions Card */}
      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)]/80 p-4 space-y-4">
        <span className="text-xs font-medium text-[var(--text-secondary)] block">Cofres Conectados</span>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[var(--text-secondary)]">Cofre Padrão</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 font-mono">
                  Leitura & Escrita
                </span>
              </div>
              <p className="text-[11px] text-[var(--text-muted)] mt-1 font-mono truncate">
                cofres/default/
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleOpenFolder()}
              className="mt-3 w-full py-1.5 rounded-lg bg-[var(--bg-card)] hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)] text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <FolderOpen size={13} />
              <span>Abrir Pasta do Cofre</span>
            </button>
          </div>

          <div className="p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[var(--text-secondary)]">Cofre Obsidian</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 font-mono">
                  Somente Leitura
                </span>
              </div>
              <p className="text-[11px] text-[var(--text-muted)] mt-1 font-mono truncate">
                cofres/obsidian/
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleOpenFolder()}
              className="mt-3 w-full py-1.5 rounded-lg bg-[var(--bg-card)] hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)] text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <FolderOpen size={13} />
              <span>Abrir Pasta do Cofre</span>
            </button>
          </div>
        </div>

        {folderFeedback && (
          <p className="text-xs text-rose-400">{folderFeedback}</p>
        )}
      </div>

      {/* Reindexing Card */}
      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)]/80 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-[var(--text-secondary)] block">Reindexação de Embeddings</span>
            <span className="text-[11px] text-[var(--text-muted)] block mt-0.5">
              Gera novamente os vetores ONNX para todas as notas dos cofres.
            </span>
          </div>

          <button
            type="button"
            onClick={handleReindex}
            disabled={isReindexing}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-zinc-950 transition-all shadow-sm cursor-pointer disabled:opacity-50"
          >
            {isReindexing ? (
              <>
                <Loader2 size={13} className="animate-spin" />
                <span>Indexando...</span>
              </>
            ) : (
              <>
                <RefreshCw size={13} />
                <span>Reindexar Tudo</span>
              </>
            )}
          </button>
        </div>

        {reindexFeedback && (
          <div className="flex items-center gap-1.5 text-xs text-emerald-400 pt-1">
            <Check size={13} />
            <span>{reindexFeedback}</span>
          </div>
        )}
      </div>
    </div>
  );
};
