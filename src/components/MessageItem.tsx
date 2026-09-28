import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Copy,
  Check,
  SquarePen,
  Trash2,
  Send,
  Volume2,
  VolumeX,
  ChevronLeft,
  ChevronRight,
  Zap,
} from "lucide-react";
import { Message } from "../types";
import { FootnotePopover } from "./FootnotePopover";
import { ToolCallAccordion } from "./ToolCallAccordion";

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
    const hours = String(d.getHours()).padStart(2, "0");
    const minutes = String(d.getMinutes()).padStart(2, "0");
    return `${hours}:${minutes}`;
  } catch {
    return "";
  }
}

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
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(message.content);

  const isUser = message.role === "user";
  const isTool = message.role === "tool";
  const isSystem = message.role === "system";
  const timestamp = formatTimestamp(message.created_at);

  // Filter empty messages / system messages
  const rawContent = (message.content || "").trim();
  const hasToolCalls = !!(message as any).tool_calls;
  if (!isUser && !isTool && !isSystem && rawContent === "" && hasToolCalls) {
    return null;
  }
  if (isSystem || (isTool && rawContent === "" && !(message as any).tool_call_id)) {
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

  // Render tool execution result
  if (isTool) {
    return (
      <ToolCallAccordion
        message={message}
        timestamp={timestamp}
        onDelete={onDelete}
      />
    );
  }

  return (
    <div
      className={`group flex w-full select-text ${
        isUser ? "justify-end" : "justify-start"
      }`}
    >
      <div
        className={`relative max-w-[85%] text-xs leading-relaxed ${
          isUser
            ? "bg-amber-500 text-zinc-950 px-4 py-2.5 rounded-2xl rounded-tr-sm shadow-md shadow-amber-500/10 font-medium"
            : "bg-[var(--bg-card)]/90 border border-[var(--border-subtle)]/80 rounded-2xl p-4 text-[var(--text-primary)] flex-1 min-w-0 shadow-sm"
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
                  className="w-full bg-[var(--bg-card)] text-[var(--text-primary)] rounded-xl p-2.5 text-xs resize-none focus:outline-none border border-[var(--border-subtle)] leading-relaxed"
                  rows={Math.min(6, Math.max(2, editText.split("\n").length))}
                  autoFocus
                />
                <div className="flex items-center justify-between gap-2 text-[10px] text-zinc-800 select-none pt-0.5">
                  <span>Ctrl+Enter salva • Esc cancela</span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={handleCancelEdit}
                      className="px-2 py-1 rounded-lg bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] transition-colors"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveEdit}
                      disabled={!editText.trim()}
                      className="px-2.5 py-1 rounded-lg bg-[var(--bg-app)] text-amber-400 font-semibold hover:bg-[var(--bg-card)] transition-all flex items-center gap-1"
                    >
                      <Send size={10} />
                      <span>Salvar</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <p className="whitespace-pre-wrap">{message.content}</p>
                <div className="mt-1.5 flex items-center justify-between gap-3 text-[10px] text-zinc-900/75 font-mono select-none">
                  {/* Action buttons on hover */}
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 font-sans">
                    {onEdit && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditText(message.content);
                          setIsEditing(true);
                        }}
                        className="p-1 rounded hover:bg-black/10 text-zinc-900 transition-colors"
                        title="Editar mensagem"
                      >
                        <SquarePen size={11} />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleCopy}
                      className="p-1 rounded hover:bg-black/10 text-zinc-900 transition-colors"
                      title="Copiar"
                    >
                      {copied ? <Check size={11} /> : <Copy size={11} />}
                    </button>
                    {onDelete && (
                      <button
                        type="button"
                        onClick={() => onDelete(message.id)}
                        className="p-1 rounded hover:bg-black/10 text-zinc-900 hover:text-rose-900 transition-colors"
                        title="Deletar"
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-2 ml-auto">
                    {timestamp && <span>{timestamp}</span>}
                  </div>
                </div>
              </>
            )}
          </>
        ) : (
          <>
            {/* Assistant Markdown Body */}
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
                        className="text-amber-400 underline hover:text-amber-300 transition-colors"
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

            {/* Bottom Bar */}
            <div className="mt-2.5 flex items-center justify-between border-t border-[var(--border-subtle)]/80 pt-1.5 select-none">
              <div className="flex items-center gap-2">
                {timestamp && (
                  <span className="text-[10px] text-[var(--text-muted)] font-mono">
                    {timestamp}
                  </span>
                )}

                {message.tokens ? (
                  <span
                    className="inline-flex items-center gap-1 text-[10px] text-[var(--text-muted)] font-mono px-1.5 py-0.5 rounded-md bg-[var(--bg-elevated)]/40 border border-[var(--border-subtle)]"
                    title="Tokens consumidos"
                  >
                    <Zap size={9} className="text-amber-400" />
                    <span>{message.tokens}t</span>
                  </span>
                ) : null}

                {/* Variant Pagination */}
                {variants && variants.length > 1 && (
                  <div className="flex items-center gap-1 text-[10px] text-[var(--text-muted)] font-mono">
                    <button
                      type="button"
                      disabled={(currentVariantIndex ?? 0) <= 0}
                      onClick={() => onSelectVariant && onSelectVariant((currentVariantIndex ?? 0) - 1)}
                      className="p-0.5 rounded hover:bg-[var(--bg-elevated)] disabled:opacity-30"
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
                      className="p-0.5 rounded hover:bg-[var(--bg-elevated)] disabled:opacity-30"
                    >
                      <ChevronRight size={11} />
                    </button>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-1">
                {isSpeaking ? (
                  onStopSpeak && (
                    <button
                      type="button"
                      onClick={onStopSpeak}
                      className="flex items-center gap-1 text-[11px] text-rose-400 hover:text-rose-300 px-2 py-0.5 rounded bg-rose-500/15 border border-rose-500/30 animate-pulse transition-all cursor-pointer font-medium"
                      title="Parar áudio"
                    >
                      <VolumeX size={11} />
                      <span>Parar</span>
                    </button>
                  )
                ) : (
                  onSpeak && (
                    <button
                      type="button"
                      onClick={() => onSpeak(message)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-amber-400 px-2 py-0.5 rounded hover:bg-[var(--bg-hover)] border border-transparent hover:border-[var(--border-subtle)] cursor-pointer"
                      title="Ouvir áudio"
                    >
                      <Volume2 size={11} />
                      <span>Ouvir</span>
                    </button>
                  )
                )}

                <button
                  type="button"
                  onClick={handleCopy}
                  className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] px-2 py-0.5 rounded hover:bg-[var(--bg-hover)] border border-transparent hover:border-[var(--border-subtle)] cursor-pointer"
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
                    type="button"
                    onClick={() => onDelete(message.id)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-[var(--text-muted)] hover:text-rose-400 hover:bg-rose-950/20 transition-all cursor-pointer"
                    title="Deletar"
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
