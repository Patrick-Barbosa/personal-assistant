import React, { useState } from "react";
import { Wrench, ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { Message } from "../types";

interface ToolCallAccordionProps {
  message: Message;
  timestamp?: string;
  onDelete?: (messageId: string | number) => void;
}

export const ToolCallAccordion: React.FC<ToolCallAccordionProps> = ({
  message,
  timestamp,
  onDelete,
}) => {
  const [isOpen, setIsOpen] = useState(false);

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
    <div className="w-full flex flex-col items-start px-2 py-1 select-none">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs transition-all border cursor-pointer ${
            isError
              ? "bg-rose-950/30 border-rose-800/40 text-rose-300 hover:bg-rose-950/50"
              : "bg-amber-500/10 border-amber-500/25 text-amber-400 hover:bg-amber-500/20"
          }`}
        >
          <Wrench
            size={12}
            className={isError ? "text-rose-400" : "text-amber-400"}
          />
          <span className="font-medium text-[11px]">{summary}</span>
          {isOpen ? (
            <ChevronDown size={12} className="opacity-60" />
          ) : (
            <ChevronRight size={12} className="opacity-60" />
          )}
        </button>

        {timestamp && (
          <span className="text-[10px] text-[var(--text-muted)] font-mono">
            {timestamp}
          </span>
        )}

        {onDelete && (
          <button
            type="button"
            onClick={() => onDelete(message.id)}
            className="text-[var(--text-muted)] hover:text-rose-400 p-1 rounded transition-colors cursor-pointer"
            title="Deletar log"
          >
            <Trash2 size={11} />
          </button>
        )}
      </div>

      {isOpen && (
        <div className="mt-1.5 p-2.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[10px] text-[var(--text-muted)] font-mono overflow-x-auto max-w-full whitespace-pre-wrap max-h-48 select-text">
          {message.content}
        </div>
      )}
    </div>
  );
};
