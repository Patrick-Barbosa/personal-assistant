import React, { useRef, useEffect, useState, useMemo } from "react";
import { Send, Mic, FileText, X, BookOpen, Loader2, Trash2, Sparkles, Clock, Terminal, Zap } from "lucide-react";
import { AttachedNote, NoteTitleItem, SkillInfo } from "../types";
import { api } from "../api";

export function toNoteSlug(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

function cleanTranscript(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const hadQuestion = trimmed.includes("?");
  const words = trimmed.split(/\s+/);
  const start = Math.max(0, words.length - 4);
  const lVariants = new Set(["leach","leech","litchie","lich","liche","litch","lits","lix","lit","lite"]);
  let cutIdx: number | null = null;
  for (let i = start; i < words.length; i++) {
    const raw = words[i];
    const cleaned = raw.replace(/^[^a-zA-Z0-9\u00C0-\u024F]+|[^a-zA-Z0-9\u00C0-\u024F]+$/g, "").toLowerCase();
    if (!cleaned) continue;
    const isZ = cleaned.startsWith("z") && cleaned.length >= 2;
    const isL = lVariants.has(cleaned);
    if (isZ || isL) { cutIdx = i; break; }
  }
  let cleaned = "";
  if (cutIdx !== null) {
    if (cutIdx === 0 && words.length <= 2) {
      const allAreCut = words.every(w => {
        const c = w.replace(/^[^a-zA-Z0-9\u00C0-\u024F]+|[^a-zA-Z0-9\u00C0-\u024F]+$/g, "").toLowerCase();
        return c.startsWith("z") || lVariants.has(c);
      });
      if (allAreCut) return "";
    }
    cleaned = words.slice(0, cutIdx).join(" ");
  } else {
    cleaned = trimmed;
  }
  cleaned = cleaned.replace(/[,;:\-]+$/g, "").trim();
  if (!cleaned) return "";
  if (hadQuestion && !cleaned.endsWith("?")) cleaned += "?";
  return cleaned;
}

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
  onToggleOrigin,
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

  const loadSkillsForSlash = async () => {
    try {
      const skills = await api.listSkills();
      setAvailableSkills(skills.filter((s) => s.is_enabled));
    } catch (err) {
      console.warn("Failed to load skills for slash:", err);
    }
  };

  useEffect(() => {
    loadSkillsForSlash();
  }, []);

  const filteredSlashItems = useMemo(() => {
    if (!slashOpen) return [];
    const q = slashQuery.toLowerCase().trim();
    const items: Array<{
      id: string;
      command: string;
      label: string;
      desc: string;
      icon: string;
      hasScripts: boolean;
      isSystem?: boolean;
    }> = [];

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

  useEffect(() => {
    setSlashIndex(0);
  }, [filteredSlashItems]);

  // Audio recording & Groq Whisper STT state
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [sttError, setSttError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const discardAudioRef = useRef(false);
  const shouldAutoSubmitRef = useRef(false);

  const isCurrentlyRecording = isRecording || !!isWakeRecording;

  // Load note titles once
  useEffect(() => {
    let mounted = true;
    api.listNoteTitles().then((res) => {
      if (mounted) setAllNotes(res);
    }).catch((err) => {
      console.error("Failed to list note titles:", err);
    });
    return () => {
      mounted = false;
    };
  }, []);

  // Cleanup media recording on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  // Filter notes based on mention query
  const filteredNotes = useMemo(() => {
    if (!mentionOpen) return [];
    const q = mentionQuery.toLowerCase().trim();
    if (!q) return allNotes.slice(0, 8);
    return allNotes
      .filter((n) => n.title.toLowerCase().includes(q))
      .slice(0, 8);
  }, [mentionOpen, mentionQuery, allNotes]);

  useEffect(() => {
    setMentionIndex(0);
  }, [filteredNotes]);

  // Adjust textarea height
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
    const textBeforeCursor = text.slice(0, cursor);

    // Detect @ cursor position
    const atMatch = textBeforeCursor.match(/@([a-zA-Z0-9à-ú_ -]*)$/);
    // Detect / slash command cursor position
    const slashMatch = textBeforeCursor.match(/(?:^|\s)\/([a-zA-Z0-9_-]*)$/);

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

  const handleSelectSlash = (item: {
    id: string;
    command: string;
    label: string;
    desc: string;
    icon: string;
    hasScripts: boolean;
    isSystem?: boolean;
  }) => {
    if (item.id === "sys-skills") {
      setSlashOpen(false);
      if (onOpenSkills) onOpenSkills();
      return;
    }
    if (item.id === "sys-rotinas") {
      setSlashOpen(false);
      if (onOpenRoutines) onOpenRoutines();
      return;
    }

    if (textareaRef.current) {
      const cursor = textareaRef.current.selectionStart || value.length;
      const textBeforeCursor = value.slice(0, cursor);
      const textAfterCursor = value.slice(cursor);

      const newBefore = textBeforeCursor.replace(/(?:^|\s)\/([a-zA-Z0-9_-]*)$/, (match) => {
        const hasLeadingSpace = match.startsWith(" ") || match.startsWith("\n");
        return (hasLeadingSpace ? " " : "") + item.command;
      });
      onChange(newBefore + textAfterCursor);
    } else {
      onChange(item.command);
    }

    setSlashOpen(false);
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  };

  const handleSelectNote = async (item: NoteTitleItem) => {
    try {
      const noteData = await api.readNote(item.title);
      const slug = toNoteSlug(item.title) || "nota";

      onAttachNote({
        title: item.title,
        content: noteData.content || noteData.corpo || "",
        slug,
      });

      // Replace the @query with @slug in the text
      if (textareaRef.current) {
        const cursor = textareaRef.current.selectionStart || value.length;
        const textBeforeCursor = value.slice(0, cursor);
        const textAfterCursor = value.slice(cursor);

        const newBefore = textBeforeCursor.replace(/@([a-zA-Z0-9à-ú_ -]*)$/, `@${slug} `);
        onChange(newBefore + textAfterCursor);
      } else {
        onChange(value ? `${value} @${slug} ` : `@${slug} `);
      }
    } catch (err) {
      console.error("Failed to attach note on @ mention:", err);
    } finally {
      setMentionOpen(false);
      if (textareaRef.current) {
        textareaRef.current.focus();
      }
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
        const selected = filteredSlashItems[slashIndex];
        if (selected) {
          handleSelectSlash(selected);
        }
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
        const selected = filteredNotes[mentionIndex];
        if (selected) {
          handleSelectNote(selected);
        }
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

  // Sincroniza detecção da wake word ('copernico') quando o overlay estiver aberto
  useEffect(() => {
    if (isWakeRecording) {
      if (!isRecording && !isTranscribing) {
        startRecording();
      }
    } else {
      // Se a gravação wake word encerrou externamente (ex: palavra Lich ou timeout)
      if (isRecording && !shouldAutoSubmitRef.current && !discardAudioRef.current) {
        discardAudioRef.current = true;
        stopRecording();
      }
    }
  }, [isWakeRecording]);

  // Microphone recording with Groq Whisper Turbo
  const startRecording = async () => {
    // Interrompe qualquer áudio TTS tocando no momento com fade out suave (requisito: mic ativa → voz abaixa e some)
    api.fadeOutTts(300).catch(() => {});
    if (onMicStart) onMicStart();
    setSttError(null);
    discardAudioRef.current = false;
    shouldAutoSubmitRef.current = false;
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Microfone não suportado no ambiente atual.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeTypes = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
        "audio/wav",
      ];
      const selectedMime = mimeTypes.find((m) => MediaRecorder.isTypeSupported(m)) || "";

      const recorder = selectedMime
        ? new MediaRecorder(stream, { mimeType: selectedMime })
        : new MediaRecorder(stream);

      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        // Se a gravação foi descartada, limpa chunks e não transcreve nem envia
        if (discardAudioRef.current) {
          audioChunksRef.current = [];
          setIsTranscribing(false);
          setRecordingSeconds(0);
          discardAudioRef.current = false;
          return;
        }

        const autoSubmit = shouldAutoSubmitRef.current;
        shouldAutoSubmitRef.current = false;

        setIsTranscribing(true);
        try {
          const blob = new Blob(audioChunksRef.current, {
            type: recorder.mimeType || "audio/webm",
          });
          audioChunksRef.current = [];
          const arrayBuffer = await blob.arrayBuffer();
          const uint8 = new Uint8Array(arrayBuffer);

          const transcript = await api.transcribeAudio(uint8, blob.type);
          const cleanedTranscript = cleanTranscript(transcript || "");
          if (cleanedTranscript) {
            const trimmed = cleanedTranscript;
            const newText = value.trim() ? `${value.trim()} ${trimmed}` : trimmed;
            onChange(newText);
            if (onSetOrigin) {
              onSetOrigin("voice");
            }
            if (autoSubmit) {
              onSubmit("voice", newText);
            }
          }
        } catch (err) {
          console.error("Transcription error:", err);
          setSttError(`Erro na transcrição: ${String(err)}`);
          setTimeout(() => setSttError(null), 4000);
        } finally {
          setIsTranscribing(false);
          setRecordingSeconds(0);
          if (textareaRef.current) {
            textareaRef.current.focus();
          }
        }
      };

      recorder.start(250);
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordingSeconds(0);

      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = window.setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.error("Microphone access error:", err);
      setSttError("Acesso ao microfone negado ou não encontrado.");
      setTimeout(() => setSttError(null), 4000);
    }
  };

  const stopRecording = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setIsRecording(false);
  };

  // 1. Botão Enviar (ícone de envio/check em cor âmbar/dourado): finaliza a gravação e envia o áudio imediatamente para transcrição e processamento
  const handleSendRecording = () => {
    if (isTranscribing) return;
    discardAudioRef.current = false;
    shouldAutoSubmitRef.current = true;

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      stopRecording();
    } else {
      setIsRecording(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setRecordingSeconds(0);
    }

    if (isWakeRecording && onDiscardWakeRecording) {
      onDiscardWakeRecording();
    }
  };

  // 2. Botão Parar / Descartar (ícone de lixeira ou X em cor vermelha/cinza): interrompe a gravação e descarta completamente o áudio sem enviar nada ao modelo
  const handleDiscardRecording = () => {
    discardAudioRef.current = true;
    shouldAutoSubmitRef.current = false;

    // Cancela imediatamente a gravação no sidecar e no backend Rust
    api.cancelWakeRecording().catch((err) => {
      console.warn("Failed to cancel wake recording:", err);
    });

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setRecordingSeconds(0);

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    audioChunksRef.current = [];

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    setIsRecording(false);

    if (onDiscardWakeRecording) {
      onDiscardWakeRecording();
    }

    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  };

  const handleMicClick = () => {
    if (isTranscribing) return;
    if (isCurrentlyRecording) {
      handleSendRecording();
    } else {
      startRecording();
    }
  };

  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  return (
    <div className="p-3 bg-[var(--bg-app)] border-t border-[var(--border-subtle)] backdrop-blur-xl relative transition-colors">
      {/* Floating slash command menu */}
      {slashOpen && filteredSlashItems.length > 0 && (
        <div className="absolute bottom-full left-4 mb-2 w-84 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-2xl shadow-2xl overflow-hidden z-50 animate-in fade-in slide-in-from-bottom-2 duration-150 transition-colors">
          <div className="p-2 border-b border-[var(--border-subtle)] flex items-center justify-between text-[11px] text-[var(--text-muted)] bg-[var(--bg-input)]">
            <span className="flex items-center gap-1.5 font-medium text-amber-500 dark:text-amber-400">
              <Sparkles size={12} />
              <span>Skills & Atalhos Rápidos (/)</span>
            </span>
            <span className="text-[10px] text-[var(--text-muted)] opacity-75">↑↓ navegar • Enter seleciona</span>
          </div>

          <div className="max-h-56 overflow-y-auto p-1.5 space-y-0.5">
            {filteredSlashItems.map((item, idx) => {
              const isSelected = idx === slashIndex;
              return (
                <div
                  key={item.id}
                  onClick={() => handleSelectSlash(item)}
                  onMouseEnter={() => setSlashIndex(idx)}
                  className={`px-2.5 py-1.5 rounded-xl cursor-pointer flex items-center justify-between transition-colors ${
                    isSelected
                      ? "bg-amber-500/20 text-[var(--text-primary)] font-medium border border-amber-500/40"
                      : "text-[var(--text-primary)] hover:bg-[var(--bg-input)]"
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 pr-2">
                    <span className="text-sm shrink-0">{item.icon}</span>
                    <div className="min-w-0 text-left">
                      <div className="text-xs font-mono font-medium truncate text-amber-600 dark:text-amber-400">{item.label}</div>
                      <div className="text-[11px] text-[var(--text-muted)] truncate">{item.desc}</div>
                    </div>
                  </div>
                  {item.hasScripts && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-md font-mono bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 shrink-0">
                      Python
                    </span>
                  )}
                  {item.isSystem && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-md font-mono bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30 shrink-0">
                      Atalho
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Floating @mention autocomplete menu */}
      {mentionOpen && filteredNotes.length > 0 && (
        <div className="absolute bottom-full left-4 mb-2 w-80 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-2xl shadow-2xl overflow-hidden z-50 animate-in fade-in slide-in-from-bottom-2 duration-150 transition-colors">
          <div className="p-2 border-b border-[var(--border-subtle)] flex items-center justify-between text-[11px] text-[var(--text-muted)] bg-[var(--bg-input)]">
            <span className="flex items-center gap-1.5 font-medium text-amber-500 dark:text-amber-400">
              <BookOpen size={12} />
              <span>Notas do Cofre (contexto @)</span>
            </span>
            <span className="text-[10px] text-[var(--text-muted)] opacity-75">↑↓ navegar • Enter seleciona</span>
          </div>

          <div className="max-h-52 overflow-y-auto p-1.5 space-y-0.5">
            {filteredNotes.map((note, idx) => {
              const isSelected = idx === mentionIndex;
              return (
                <div
                  key={note.path || note.title}
                  onClick={() => handleSelectNote(note)}
                  onMouseEnter={() => setMentionIndex(idx)}
                  className={`px-2.5 py-1.5 rounded-xl cursor-pointer flex items-center justify-between transition-colors ${
                    isSelected
                      ? "bg-amber-500/20 text-[var(--text-primary)] font-medium border border-amber-500/40"
                      : "text-[var(--text-primary)] hover:bg-[var(--bg-input)]"
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0 pr-2">
                    <FileText size={13} className={isSelected ? "text-amber-500 dark:text-amber-400" : "text-[var(--text-muted)]"} />
                    <span className="text-xs truncate">{note.title}</span>
                  </div>
                  <span
                    className={`text-[9px] px-1.5 py-0.5 rounded-full font-mono uppercase tracking-wider shrink-0 ${
                      note.vault === "obsidian"
                        ? "bg-cyan-500/15 text-cyan-600 dark:text-cyan-300 border border-cyan-500/30"
                        : "bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30"
                    }`}
                  >
                    {note.vault}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Visual reference chips for attached notes */}
      {attachedNotes.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5 px-1">
          <span className="text-[10px] text-[var(--text-muted)] font-medium mr-1">Contexto anexado:</span>
          {attachedNotes.map((an) => (
            <div
              key={an.slug}
              className="px-2 py-0.5 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-800 dark:text-amber-200 text-[11px] font-medium flex items-center gap-1.5 shadow-sm group"
              title={`Contexto completo da nota "${an.title}" será enviado`}
            >
              <FileText size={11} className="text-amber-500 dark:text-amber-400" />
              <span>@{an.slug}</span>
              <button
                type="button"
                onClick={() => onRemoveAttachedNote(an.slug)}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                title="Remover anexo"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Live recording status bar */}
      {isCurrentlyRecording && (
        <div className="mb-2 flex items-center justify-between px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-200 text-xs animate-in fade-in duration-150">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
            <span className="font-medium text-amber-700 dark:text-amber-300">
              {isWakeRecording ? "Microfone ativado por voz..." : "Gravando voz..."}
            </span>
            <span className="font-mono text-[11px] px-1.5 py-0.5 bg-amber-500/20 text-amber-800 dark:text-amber-200 border border-amber-500/30 rounded-md">
              {formatTimer(recordingSeconds)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDiscardRecording}
              className="text-[11px] text-[var(--text-muted)] hover:text-rose-500 font-medium transition-colors"
            >
              Descartar
            </button>
            <span className="text-[var(--border-subtle)]">•</span>
            <button
              type="button"
              onClick={handleSendRecording}
              className="text-[11px] text-amber-600 dark:text-amber-400 hover:underline font-medium transition-colors"
            >
              Enviar áudio
            </button>
          </div>
        </div>
      )}

      {/* Live transcribing indicator */}
      {isTranscribing && (
        <div className="mb-2 flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 text-xs animate-in fade-in duration-150">
          <Loader2 size={13} className="animate-spin text-amber-500 dark:text-amber-400" />
          <span>Transcrevendo áudio com Groq Whisper Turbo...</span>
        </div>
      )}

      {/* STT Error banner */}
      {sttError && (
        <div className="mb-2 px-3 py-1.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-700 dark:text-rose-300 text-xs animate-in fade-in duration-150">
          ⚠️ {sttError}
        </div>
      )}

      {/* Main input wrapper */}
      <div className="relative flex items-end gap-2 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-2xl px-3 py-2 shadow-sm focus-within:border-amber-500/60 focus-within:ring-1 focus-within:ring-amber-500/25 transition-all">
        {/* Text input area */}
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          placeholder={
            isCurrentlyRecording
              ? "Gravando voz... fale agora e clique em Enviar ou Descartar."
              : isTranscribing
              ? "Transcrevendo fala com Groq..."
              : origin === "voice"
              ? "Modo de voz ativo... (fale no microfone ou digite)"
              : "Pergunte algo ou solicite ações no cofre... (Use @ para citar notas)"
          }
          className="flex-1 bg-transparent text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] resize-none max-h-28 focus:outline-none py-1 leading-relaxed"
          autoFocus
        />

        {/* Right side controls: Dual buttons when recording, or Mic + Send when idle */}
        <div className="flex items-center gap-1.5 shrink-0 pb-0.5">
          {isCurrentlyRecording ? (
            <>
              {/* Botão Parar / Descartar (ícone de lixeira em cor vermelha/cinza) */}
              <button
                type="button"
                onClick={handleDiscardRecording}
                title="Descartar gravação (não envia ao modelo)"
                className="p-2 rounded-xl bg-[var(--bg-app)] hover:bg-rose-500/15 text-[var(--text-muted)] hover:text-rose-500 border border-[var(--border-subtle)] hover:border-rose-500/40 shadow-sm transition-all active:scale-95 flex items-center justify-center"
              >
                <Trash2 size={15} />
              </button>

              {/* Botão Enviar (ícone de envio em cor âmbar/dourado) */}
              <button
                type="button"
                onClick={handleSendRecording}
                disabled={isTranscribing}
                title="Concluir gravação e enviar imediatamente para processamento"
                className="p-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-neutral-950 font-medium shadow-md shadow-amber-500/30 hover:shadow-amber-500/50 transition-all active:scale-95 flex items-center justify-center disabled:opacity-50"
              >
                {isTranscribing ? (
                  <Loader2 size={15} className="animate-spin text-neutral-950" />
                ) : (
                  <Send size={15} />
                )}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={handleMicClick}
                disabled={isTranscribing || isLoading}
                title={
                  isTranscribing
                    ? "Transcrevendo com Groq..."
                    : "Gravar áudio do microfone (Groq Whisper Turbo)"
                }
                className={`relative p-2 rounded-xl transition-all ${
                  isTranscribing
                    ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/40 cursor-wait"
                    : origin === "voice"
                    ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/40 shadow-sm shadow-amber-500/20"
                    : "text-[var(--text-muted)] hover:text-amber-500 hover:bg-[var(--bg-app)]"
                }`}
              >
                {isTranscribing ? (
                  <Loader2 size={15} className="animate-spin text-amber-500 dark:text-amber-400" />
                ) : (
                  <Mic size={15} />
                )}
              </button>

              <button
                type="button"
                disabled={isLoading || !value.trim() || isTranscribing}
                onClick={() => onSubmit(origin)}
                title="Enviar mensagem (Enter)"
                className={`p-2 rounded-xl transition-all ${
                  isLoading || !value.trim() || isTranscribing
                    ? "text-[var(--text-muted)] opacity-30 bg-[var(--bg-app)] cursor-not-allowed"
                    : "bg-amber-500 hover:bg-amber-400 text-neutral-950 font-medium shadow-md shadow-amber-500/25 active:scale-95"
                }`}
              >
                <Send size={15} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Footer hint */}
      <div className="mt-2 px-2 flex items-center justify-between text-[10px] text-[var(--text-muted)] select-none">
        <div className="flex items-center gap-2">
          <span>
            <kbd className="px-1 py-0.5 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded text-[9px] text-[var(--text-muted)] shadow-xs">
              Esc
            </kbd>{" "}
            Ocultar
          </span>
          <span>•</span>
          <span>
            <kbd className="px-1 py-0.5 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded text-[9px] text-[var(--text-muted)] shadow-xs">
              Ctrl+Espaço
            </kbd>{" "}
            Toggle
          </span>
          <span className="text-amber-600 dark:text-amber-400 font-medium">
            <kbd className="px-1 py-0.5 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded text-[9px] text-[var(--text-muted)] shadow-xs">@</kbd> notas
          </span>
          <span>•</span>
          <span className="text-amber-600 dark:text-amber-400 font-medium">
            <kbd className="px-1 py-0.5 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded text-[9px] text-[var(--text-muted)] shadow-xs">/</kbd> skills
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
          <span className="capitalize">{origin}</span>
          <span>•</span>
          <span>Groq Whisper Turbo</span>
        </div>
      </div>
    </div>
  );
};
