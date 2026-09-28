import React, { useRef, useEffect, useState, useMemo } from "react";
import { Send, Mic, Loader2, Trash2, Sparkles, Clock, Check } from "lucide-react";
import { AttachedNote, NoteTitleItem, SkillInfo } from "../types";
import { api } from "../api";
import { toNoteSlug } from "../utils/transcriptCleaner";
import { useVoiceRecorder } from "../hooks/useVoiceRecorder";
import { AttachedNotesChips } from "./AttachedNotesChips";
import { MentionPopover } from "./MentionPopover";
import { SlashCommandPopover, SlashItem } from "./SlashCommandPopover";
import { Tooltip } from "./ui/tooltip";

export { toNoteSlug };

interface InputBarProps {
  value: string;
  onChange: (val: string) => void;
  onSubmit: (origin: "text" | "voice", textOverride?: string) => void;
  isLoading: boolean;
  origin: "text" | "voice";
  onToggleOrigin: () => void;
  onSetOrigin?: (origin: "text" | "voice") => void;
  attachedNotes: AttachedNote[];
  onRemoveAttachedNote: (slug: string) => void;
  onAttachNote: (note: AttachedNote) => void;
  isWakeRecording?: boolean;
  onDiscardWakeRecording?: () => void;
  onOpenSkills?: () => void;
  onOpenRoutines?: () => void;
  onMicStart?: () => void;
}

export const InputBar: React.FC<InputBarProps> = ({
  value,
  onChange,
  onSubmit,
  isLoading,
  origin,
  onSetOrigin,
  attachedNotes,
  onRemoveAttachedNote,
  onAttachNote,
  isWakeRecording,
  onDiscardWakeRecording,
  onOpenSkills,
  onOpenRoutines,
  onMicStart,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // @mention state
  const [allNotes, setAllNotes] = useState<NoteTitleItem[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);

  // Slash commands state
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");
  const [slashIndex, setSlashIndex] = useState(0);
  const [availableSkills, setAvailableSkills] = useState<SkillInfo[]>([]);

  // Voice recording hook (manual bar vs passive wake bar)
  const {
    isManualRecording,
    isTranscribing,
    recordingSeconds,
    sttError,
    startRecording,
    sendRecording,
    discardRecording,
  } = useVoiceRecorder({
    value,
    onChange,
    onSubmit,
    onSetOrigin,
    onMicStart,
    isWakeRecording,
    onDiscardWakeRecording,
  });

  // Load data on mount
  useEffect(() => {
    api.listNoteTitles().then(setAllNotes).catch(() => {});
    api.listSkills().then((s) => setAvailableSkills(s.filter((sk) => sk.is_enabled))).catch(() => {});
  }, []);

  // Filtered slash items
  const filteredSlashItems = useMemo(() => {
    if (!slashOpen) return [];
    const q = slashQuery.toLowerCase().trim();
    const items: SlashItem[] = [];

    for (const s of availableSkills) {
      if (!q || s.id.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)) {
        items.push({
          id: s.id,
          command: `/skill ${s.id} `,
          label: `/skill ${s.id}`,
          desc: s.description || s.name,
          icon: s.has_scripts ? "⚡" : "🧠",
          hasScripts: s.has_scripts,
        });
      }
    }

    if (!q || "skills".includes(q) || "hub".includes(q)) {
      items.push({
        id: "sys-skills",
        command: "/skills",
        label: "/skills",
        desc: "Abrir Hub de Skills do Copernico",
        icon: "✨",
        hasScripts: false,
        isSystem: true,
      });
    }

    if (!q || "rotinas".includes(q) || "cron".includes(q) || "agenda".includes(q)) {
      items.push({
        id: "sys-rotinas",
        command: "/rotinas",
        label: "/rotinas",
        desc: "Abrir Agendador de Rotinas (Cron)",
        icon: "⏱️",
        hasScripts: false,
        isSystem: true,
      });
    }

    return items.slice(0, 8);
  }, [slashOpen, slashQuery, availableSkills]);

  // Filtered mention notes
  const filteredNotes = useMemo(() => {
    if (!mentionOpen) return [];
    const q = mentionQuery.toLowerCase().trim();
    if (!q) return allNotes.slice(0, 8);
    return allNotes.filter((n) => n.title.toLowerCase().includes(q)).slice(0, 8);
  }, [mentionOpen, mentionQuery, allNotes]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [value]);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    onChange(text);

    const cursor = e.target.selectionStart || text.length;
    const textBefore = text.slice(0, cursor);

    const atMatch = textBefore.match(/@([a-zA-Z0-9à-ú_ -]*)$/);
    const slashMatch = textBefore.match(/(?:^|\s)\/([a-zA-Z0-9_-]*)$/);

    if (slashMatch) {
      setSlashOpen(true);
      setSlashQuery(slashMatch[1]);
      setMentionOpen(false);
    } else if (atMatch) {
      setMentionOpen(true);
      setMentionQuery(atMatch[1]);
      setSlashOpen(false);
    } else {
      setMentionOpen(false);
      setSlashOpen(false);
    }
  };

  const handleSelectSlash = (item: SlashItem) => {
    if (item.isSystem) {
      setSlashOpen(false);
      onChange("");
      if (item.id === "sys-skills" && onOpenSkills) onOpenSkills();
      if (item.id === "sys-rotinas" && onOpenRoutines) onOpenRoutines();
      return;
    }
    onChange(item.command);
    setSlashOpen(false);
    textareaRef.current?.focus();
  };

  const handleSelectNote = async (item: NoteTitleItem) => {
    try {
      const noteData = await api.readNote(item.path);
      const slug = toNoteSlug(item.title);
      onAttachNote({
        title: item.title,
        content: noteData.content || (noteData as any).corpo || "",
        slug,
      });

      if (textareaRef.current) {
        const cursor = textareaRef.current.selectionStart || value.length;
        const textBefore = value.slice(0, cursor);
        const textAfter = value.slice(cursor);
        const newBefore = textBefore.replace(/@([a-zA-Z0-9à-ú_ -]*)$/, `@${slug} `);
        onChange(newBefore + textAfter);
      } else {
        onChange(value ? `${value} @${slug} ` : `@${slug} `);
      }
    } catch (err) {
      console.error("Failed to attach note:", err);
    } finally {
      setMentionOpen(false);
      textareaRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashOpen && filteredSlashItems.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIndex((prev) => (prev + 1) % filteredSlashItems.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIndex((prev) => (prev - 1 + filteredSlashItems.length) % filteredSlashItems.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        handleSelectSlash(filteredSlashItems[slashIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlashOpen(false);
        return;
      }
    }

    if (mentionOpen && filteredNotes.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((prev) => (prev + 1) % filteredNotes.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((prev) => (prev - 1 + filteredNotes.length) % filteredNotes.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        handleSelectNote(filteredNotes[mentionIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionOpen(false);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!isLoading && value.trim()) {
        onSubmit(origin);
      }
    }
  };

  return (
    <div className="p-3 sm:p-4 bg-[var(--bg-app)]/80 border-t border-[var(--border-subtle)]/80 relative">
      {/* Popovers */}
      <MentionPopover
        isOpen={mentionOpen}
        notes={filteredNotes}
        selectedIndex={mentionIndex}
        onSelect={handleSelectNote}
      />
      <SlashCommandPopover
        isOpen={slashOpen}
        items={filteredSlashItems}
        selectedIndex={slashIndex}
        onSelect={handleSelectSlash}
      />

      {/* Main Input Card */}
      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)]/90 shadow-xl overflow-hidden focus-within:border-amber-500/40 focus-within:ring-1 focus-within:ring-amber-500/20 transition-all">
        {/* Attached Notes Preview */}
        <AttachedNotesChips notes={attachedNotes} onRemove={onRemoveAttachedNote} />

        {/* Text Input, Manual Recording Bar, or passive Wake-listening Bar */}
        {isManualRecording ? (
          <div className="px-4 py-3 flex items-center justify-between gap-3 bg-amber-500/10 animate-pulse">
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping" />
              <span className="text-xs font-medium text-amber-300">
                Ouvindo... ({recordingSeconds}s)
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={discardRecording}
                className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-rose-400 hover:bg-[var(--bg-elevated)] transition-colors"
                title="Descartar gravação"
              >
                <Trash2 size={15} />
              </button>
              <button
                type="button"
                onClick={sendRecording}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-zinc-950 shadow-md transition-all cursor-pointer"
              >
                <Check size={14} />
                <span>Enviar</span>
              </button>
            </div>
          </div>
        ) : isWakeRecording ? (
          <div className="px-4 py-3 flex items-center justify-between gap-3 bg-sky-500/10">
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full bg-sky-400" />
              <span className="text-xs font-medium text-sky-300">
                Ouvindo via wake-word... ({recordingSeconds}s)
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={onDiscardWakeRecording}
                className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-rose-400 hover:bg-[var(--bg-elevated)] transition-colors"
                title="Cancelar escuta"
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-end gap-2 p-2.5 sm:p-3">
            <textarea
              ref={textareaRef}
              rows={1}
              value={value}
              onChange={handleTextChange}
              onKeyDown={handleKeyDown}
              placeholder="Pergunte algo, use @ para vincular notas, ou / para skills..."
              className="flex-1 bg-transparent text-xs sm:text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none resize-none max-h-32 min-h-[24px] leading-relaxed"
            />

            <div className="flex items-center gap-1 shrink-0">
              {/* Mic button */}
              <Tooltip content="Falar por voz (Whisper)">
                <button
                  type="button"
                  onClick={startRecording}
                  disabled={isLoading || isTranscribing}
                  className="p-2 rounded-xl text-[var(--text-muted)] hover:text-amber-400 hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-40 cursor-pointer"
                >
                  {isTranscribing ? (
                    <Loader2 size={16} className="animate-spin text-amber-400" />
                  ) : (
                    <Mic size={16} />
                  )}
                </button>
              </Tooltip>

              {/* Send button */}
              <Tooltip content="Enviar (Enter)">
                <button
                  type="button"
                  onClick={() => onSubmit(origin)}
                  disabled={isLoading || !value.trim()}
                  className="p-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-medium transition-all shadow-sm shadow-amber-500/20 disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                >
                  <Send size={15} />
                </button>
              </Tooltip>
            </div>
          </div>
        )}
      </div>

      {/* Sub-bar Shortcuts & Error message */}
      <div className="mt-1.5 px-1 flex items-center justify-between text-[11px] text-[var(--text-muted)] select-none">
        <div className="flex items-center gap-3">
          <span><kbd className="px-1 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[10px] text-[var(--text-muted)]">@</kbd> Notas</span>
          <span><kbd className="px-1 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[10px] text-[var(--text-muted)]">/</kbd> Skills</span>
          <span><kbd className="px-1 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[10px] text-[var(--text-muted)]">Esc</kbd> Minimizar</span>
        </div>
        {sttError && (
          <span className="text-rose-400 font-medium truncate max-w-xs">{sttError}</span>
        )}
      </div>
    </div>
  );
};
