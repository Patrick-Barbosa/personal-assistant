import React from "react";
import { Terminal, Zap } from "lucide-react";

export interface SlashItem {
  id: string;
  command: string;
  label: string;
  desc: string;
  icon: string;
  hasScripts: boolean;
  isSystem?: boolean;
}

interface SlashCommandPopoverProps {
  isOpen: boolean;
  items: SlashItem[];
  selectedIndex: number;
  onSelect: (item: SlashItem) => void;
}

export const SlashCommandPopover: React.FC<SlashCommandPopoverProps> = ({
  isOpen,
  items,
  selectedIndex,
  onSelect,
}) => {
  if (!isOpen || items.length === 0) return null;

  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-2xl overflow-hidden z-50 select-none">
      <div className="px-3 py-1.5 border-b border-[var(--border-subtle)] text-[10px] font-semibold tracking-wider text-[var(--text-muted)] uppercase flex items-center gap-1.5">
        <Terminal size={11} className="text-amber-400" />
        <span>Comandos e Skills (/)</span>
      </div>
      <div className="max-h-56 overflow-y-auto p-1 space-y-0.5">
        {items.map((item, idx) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item)}
            className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs text-left transition-colors cursor-pointer ${
              idx === selectedIndex
                ? "bg-amber-500/15 text-amber-200 border border-amber-500/30"
                : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
            }`}
          >
            <div className="flex items-center gap-2 truncate pr-2">
              <span className="text-sm shrink-0">{item.icon}</span>
              <div className="truncate">
                <span className="font-semibold text-[var(--text-primary)]">{item.label}</span>
                <span className="text-[var(--text-muted)] text-[11px] ml-2 truncate">
                  {item.desc}
                </span>
              </div>
            </div>
            {item.hasScripts && (
              <span className="flex items-center gap-0.5 text-[10px] text-amber-400 bg-amber-500/15 px-1.5 py-0.5 rounded font-mono shrink-0">
                <Zap size={10} />
                <span>Script</span>
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
};
