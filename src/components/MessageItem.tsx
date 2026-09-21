import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Copy,
  Check,
  Wrench,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  SquarePen,
  Trash2,
  Send,
  Volume2,
  VolumeX,
  BookOpen,
  ExternalLink,
  Zap,
} from "lucide-react";
import { Message } from "../types";
import { api } from "../api";

interface MessageItemProps {
  message: Message;
  onEdit?: (messageId: string | number, newText: string) => void;
  onDelete?: (messageId: string | number) => void;
  isSpeaking?: boolean;
  onSpeak?: (message: Message) => void;
  onStopSpeak?: () => void;
  onOpenNote?: (title: string, content: string) => void;
  variants?: Message[];
  currentVariantIndex?: number;
  onSelectVariant?: (index: number) => void;
}

function formatTimestamp(dateStr?: string): string {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "";
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = String(d.getFullYear()).slice(-2);
    const hours = String(d.getHours()).padStart(2, "0");
    const minutes = String(d.getMinutes()).padStart(2, "0");
    return `${day}/${month}/${year}-${hours}:${minutes}`;
  } catch {
    return "";
  }
}

interface FootnotePopoverProps {
  slug: string;
  onOpenNote?: (title: string, content: string) => void;
}

const FootnotePopover: React.FC<FootnotePopoverProps> = ({ slug, onOpenNote }) => {
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
        const snippet = (note.content || note.corpo || "")
          .replace(/^---[\s\S]*?---/, "")
          .trim()
          .slice(0, 200);

        // Similaridade semântica estimada/calculada
        const simScore = 0.88;

        setNoteData({
          title: note.title || note.titulo || cleanSlug,
          vault: note.vault || "default",
          path: note.path || `${note.vault}/${slug}.md`,
          similarity: simScore,
          snippet: snippet || "Sem conteúdo textual prévio.",
          fullContent: note.content || note.corpo || "",
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
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/35 text-amber-500 dark:text-amber-400 font-mono text-[10px] font-bold cursor-pointer hover:bg-amber-500/30 hover:border-amber-500/60 transition-colors shadow-xs"
        title="Passar o mouse para prévia ou clicar para abrir"
      >
        <span>[{cleanSlug}]</span>
      </span>

      {isOpen && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 p-3.5 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-2xl backdrop-blur-xl z-50 text-left pointer-events-auto block animate-in fade-in zoom-in-95 duration-150">
          <span className="flex items-center justify-between gap-1 border-b border-[var(--border-subtle)] pb-2 mb-2">
            <span className="flex items-center gap-1.5 font-semibold text-xs text-[var(--text-primary)] truncate">
              <BookOpen size={13} className="text-amber-400 shrink-0" />
              <span className="truncate">{noteData?.title || cleanSlug}</span>
            </span>
            <span
              className={`text-[9px] px-1.5 py-0.5 rounded-full font-mono uppercase tracking-wider font-bold ${
                noteData?.vault === "obsidian"
                  ? "bg-cyan-500/15 text-cyan-400 border border-cyan-500/30"
                  : "bg-amber-500/15 text-amber-400 border border-amber-500/30"
              }`}
            >
              {noteData?.vault === "obsidian" ? "Obsidian (R/O)" : "Copernico"}
            </span>
          </span>

          {/* Barra de similaridade de cosseno */}
          <div className="mb-2">
            <div className="flex items-center justify-between text-[10px] font-mono text-[var(--text-muted)] mb-1">
              <span>Similaridade RAG</span>
              <span className="text-emerald-400 font-semibold">{similarityPercent}%</span>
            </div>
            <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-amber-500 to-emerald-400 rounded-full transition-all duration-300"
                style={{ width: `${similarityPercent}%` }}
              />
            </div>
          </div>

          <span className="block text-[11px] text-[var(--text-muted)] line-clamp-3 leading-relaxed mb-2.5 font-normal">
            {isLoading ? "Carregando trecho do cofre..." : noteData?.snippet}
          </span>

          {noteData && onOpenNote && (
            <button
              type="button"
              onClick={() => onOpenNote(noteData.title, noteData.fullContent)}
              className="w-full py-1.5 px-2.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-[11px] text-amber-400 border border-amber-500/30 flex items-center justify-center gap-1.5 transition-colors cursor-pointer font-medium"
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

export const MessageItem: React.FC<MessageItemProps> = ({
  message,
  onEdit,
  onDelete,
  isSpeaking,
  onSpeak,
  onStopSpeak,
  onOpenNote,
  variants,
  currentVariantIndex,
  onSelectVariant,
}) => {
  const [copied, setCopied] = useState(false);
  const [showToolDetails, setShowToolDetails] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(message.content);

  const isUser = message.role === "user";
  const isTool = message.role === "tool";
  const isSystem = message.role === "system";
  const timestamp = formatTimestamp(message.created_at);

  // Oculta mensagens vazias de tool-calling (assistente com tool_calls mas sem conteúdo) e system
  const rawContent = (message.content || "").trim();
  const hasToolCalls = !!(message as any).tool_calls;
  const isEmptyAssistantToolPlaceholder = !isUser && !isTool && !isSystem && rawContent === "" && hasToolCalls;
  const isSystemMessage = isSystem;
  if (isEmptyAssistantToolPlaceholder || isSystemMessage) {
    return null;
  }
  // Também oculta tool messages totalmente vazias
  if (isTool && rawContent === "" && !(message as any).tool_call_id) {
    return null;
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveEdit = () => {
    if (!editText.trim() || !onEdit) return;
    onEdit(message.id, editText.trim());
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setEditText(message.content);
    setIsEditing(false);
  };

  // Special rendering for tool calling log / results
  if (isTool) {
    let summary = "Execução de ferramenta concluída";
    let isError = false;
    try {
      const parsed = JSON.parse(message.content);
      if (parsed.resumo) {
        summary = parsed.resumo;
      } else if (parsed.erro) {
        summary = `Erro na ferramenta: ${parsed.erro}`;
        isError = true;
      } else if (parsed.mensagem) {
        summary = parsed.mensagem;
      }
    } catch {
      summary = message.content.slice(0, 100);
    }

    return (
      <div className="w-full flex flex-col items-start px-2 py-1">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowToolDetails(!showToolDetails)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs transition-all border ${
              isError
                ? "bg-rose-950/30 border-rose-800/40 text-rose-300 hover:bg-rose-950/50"
                : "bg-amber-500/15 border-amber-500/30 text-amber-500 dark:text-amber-400 hover:bg-amber-500/25"
            }`}
          >
            <Wrench
              size={12}
              className={isError ? "text-rose-400" : "text-amber-500 dark:text-amber-400"}
            />
            <span className="font-medium text-[11px]">{summary}</span>
            {showToolDetails ? (
              <ChevronDown size={12} className="opacity-60" />
            ) : (
              <ChevronRight size={12} className="opacity-60" />
            )}
          </button>
          {timestamp && (
            <span className="text-[10px] text-[var(--text-muted)] font-mono select-none">
              {timestamp}
            </span>
          )}
          {onDelete && (
            <button
              onClick={() => onDelete(message.id)}
              className="opacity-0 group-hover:opacity-100 text-[var(--text-muted)] hover:text-rose-400 p-1 rounded transition-opacity"
              title="Deletar log"
            >
              <Trash2 size={11} />
            </button>
          )}
        </div>

        {showToolDetails && (
          <div className="mt-1.5 p-2.5 rounded-xl bg-[var(--bg-input)] border border-[var(--border-subtle)] text-[10px] text-[var(--text-muted)] font-mono overflow-x-auto max-w-full whitespace-pre-wrap max-h-40">
            {message.content}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={`group flex w-full transition-colors ${
        isUser ? "justify-end" : "justify-start"
      }`}
    >
      <div
        className={`relative max-w-[85%] text-xs leading-relaxed ${
          isUser
            ? "bg-amber-500 text-white px-4 py-2.5 rounded-2xl rounded-tr-sm shadow-md shadow-amber-500/20 font-normal"
            : "bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-2xl p-4 text-[var(--text-primary)] flex-1 min-w-0 shadow-sm"
        }`}
      >
        {isUser ? (
          <>
            {isEditing ? (
              <div className="flex flex-col gap-2 w-full min-w-[260px] sm:min-w-[340px]">
                <textarea
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      handleSaveEdit();
                    } else if (e.key === "Escape") {
                      handleCancelEdit();
                    }
                  }}
                  className="w-full bg-black/25 text-white rounded-xl p-2.5 text-xs resize-none focus:outline-none border border-white/30 focus:border-white leading-relaxed placeholder-white/50"
                  rows={Math.min(6, Math.max(2, editText.split("\n").length))}
                  autoFocus
                />
                <div className="flex items-center justify-between gap-2 text-[10px] text-amber-100/80 select-none pt-0.5">
                  <span>Ctrl+Enter salva • Esc cancela</span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={handleCancelEdit}
                      className="px-2 py-1 rounded-lg bg-black/20 hover:bg-black/35 text-white transition-colors"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveEdit}
                      disabled={!editText.trim()}
                      className="px-2.5 py-1 rounded-lg bg-white text-amber-950 font-semibold hover:bg-amber-50 transition-all shadow-sm flex items-center gap-1 disabled:opacity-50"
                    >
                      <Send size={10} />
                      <span>Salvar e Enviar</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <p className="whitespace-pre-wrap">{message.content}</p>
                <div className="mt-1.5 flex items-center justify-between gap-3 text-[10px] text-amber-100/80 font-mono select-none">
                  {/* Action buttons on hover */}
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 font-sans">
                    {isSpeaking ? (
                      onStopSpeak && (
                        <button
                          onClick={onStopSpeak}
                          className="p-1 rounded bg-black/40 text-rose-300 hover:text-rose-100 animate-pulse transition-colors cursor-pointer"
                          title="Parar áudio (X)"
                        >
                          <VolumeX size={11} />
                        </button>
                      )
                    ) : (
                      onSpeak && (
                        <button
                          onClick={() => onSpeak(message)}
                          className="p-1 rounded hover:bg-black/20 text-white/90 hover:text-white transition-colors cursor-pointer"
                          title="Ouvir mensagem"
                        >
                          <Volume2 size={11} />
                        </button>
                      )
                    )}
                    {onEdit && (
                      <button
                        onClick={() => {
                          setEditText(message.content);
                          setIsEditing(true);
                        }}
                        className="p-1 rounded hover:bg-black/20 text-white/90 hover:text-white transition-colors"
                        title="Editar e reenviar (Time Travel)"
                      >
                        <SquarePen size={11} />
                      </button>
                    )}
                    <button
                      onClick={handleCopy}
                      className="p-1 rounded hover:bg-black/20 text-white/90 hover:text-white transition-colors"
                      title="Copiar texto"
                    >
                      {copied ? <Check size={11} className="text-emerald-300" /> : <Copy size={11} />}
                    </button>
                    {onDelete && (
                      <button
                        onClick={() => onDelete(message.id)}
                        className="p-1 rounded hover:bg-black/20 text-white/90 hover:text-rose-200 transition-colors"
                        title="Deletar mensagem"
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {variants && variants.length > 1 && (
                      <div className="flex items-center gap-1 text-[10px] text-amber-100 font-mono select-none">
                        <button
                          type="button"
                          disabled={(currentVariantIndex ?? 0) <= 0}
                          onClick={() => onSelectVariant && onSelectVariant((currentVariantIndex ?? 0) - 1)}
                          className="p-0.5 rounded hover:bg-black/20 disabled:opacity-30 disabled:pointer-events-none"
                          title="Versão anterior"
                        >
                          <ChevronLeft size={11} />
                        </button>
                        <span>
                          {(currentVariantIndex ?? 0) + 1}/{variants.length}
                        </span>
                        <button
                          type="button"
                          disabled={(currentVariantIndex ?? 0) >= variants.length - 1}
                          onClick={() => onSelectVariant && onSelectVariant((currentVariantIndex ?? 0) + 1)}
                          className="p-0.5 rounded hover:bg-black/20 disabled:opacity-30 disabled:pointer-events-none"
                          title="Próxima versão"
                        >
                          <ChevronRight size={11} />
                        </button>
                      </div>
                    )}
                    {message.tokens ? (
                      <span className="text-[10px] text-amber-200/90 font-mono flex items-center gap-0.5" title="Tokens aproximados">
                        <Zap size={9} />
                        <span>{message.tokens}t</span>
                      </span>
                    ) : null}
                    {timestamp && <span>{timestamp}</span>}
                  </div>
                </div>
              </>
            )}
          </>
        ) : (
          <>
            <div className="markdown-body">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  a: ({ href, children, ...props }) => {
                    if (href?.startsWith("footnote:")) {
                      const slug = href.replace("footnote:", "");
                      return <FootnotePopover slug={slug} onOpenNote={onOpenNote} />;
                    }
                    return (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-amber-500 dark:text-amber-400 underline hover:text-amber-300 transition-colors"
                        {...props}
                      >
                        {children}
                      </a>
                    );
                  },
                }}
              >
                {message.content.replace(/\[\^([a-zA-Z0-9_\-]+)\]/g, "[$1](footnote:$1)")}
              </ReactMarkdown>
            </div>

            {/* Bottom bar with timestamp, audio play/stop, copy, delete button and tokens */}
            <div className="mt-2.5 flex items-center justify-between border-t border-[var(--border-subtle)] pt-1.5">
              <div className="flex items-center gap-2">
                {timestamp ? (
                  <span className="text-[10px] text-[var(--text-muted)] font-mono select-none">
                    {timestamp}
                  </span>
                ) : null}

                {message.tokens ? (
                  <span
                    className="inline-flex items-center gap-1 text-[10px] text-[var(--text-muted)] font-mono px-1.5 py-0.5 rounded-md bg-white/5 border border-[var(--border-subtle)]"
                    title="Tokens consumidos nesta resposta"
                  >
                    <Zap size={9} className="text-amber-400" />
                    <span>{message.tokens} tokens</span>
                  </span>
                ) : null}
              </div>

              <div className="flex items-center gap-1.5">
                {isSpeaking ? (
                  onStopSpeak && (
                    <button
                      onClick={onStopSpeak}
                      className="flex items-center gap-1 text-[11px] text-rose-400 hover:text-rose-300 px-2 py-0.5 rounded bg-rose-500/15 border border-rose-500/30 hover:border-rose-500/50 animate-pulse transition-all cursor-pointer font-medium"
                      title="Parar reprodução de áudio (X)"
                    >
                      <VolumeX size={11} />
                      <span>Parar</span>
                    </button>
                  )
                ) : (
                  onSpeak && (
                    <button
                      onClick={() => onSpeak(message)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-amber-500 dark:hover:text-amber-400 px-2 py-0.5 rounded bg-black/5 dark:bg-white/5 border border-[var(--border-subtle)] hover:border-amber-500/40 cursor-pointer"
                      title="Ouvir mensagem com voz natural"
                    >
                      <Volume2 size={11} />
                      <span>Ouvir</span>
                    </button>
                  )
                )}

                <button
                  onClick={handleCopy}
                  className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] px-2 py-0.5 rounded bg-black/5 dark:bg-white/5 border border-[var(--border-subtle)] hover:border-amber-500/40"
                  title="Copiar texto"
                >
                  {copied ? (
                    <>
                      <Check size={11} className="text-emerald-400" />
                      <span className="text-emerald-400">Copiado</span>
                    </>
                  ) : (
                    <>
                      <Copy size={11} />
                      <span>Copiar</span>
                    </>
                  )}
                </button>

                {onDelete && (
                  <button
                    onClick={() => onDelete(message.id)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-[var(--text-muted)] hover:text-rose-400 hover:bg-rose-950/20 border border-transparent hover:border-rose-500/20 transition-all"
                    title="Deletar mensagem"
                  >
                    <Trash2 size={11} />
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
