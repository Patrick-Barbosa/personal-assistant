import React, { useState, useEffect, useRef } from "react";
import { motion, useAnimationControls } from "framer-motion";
import {
  Settings,
  Minus,
  Search,
  Layers,
  AlertTriangle,
  X,
} from "lucide-react";
import { CopernicoSquircle } from "./components/icons/CopernicoSquircle";
import { CopernicoSun } from "./components/icons/CopernicoSun";
import { Message, Session, AttachedNote } from "./types";
import { api } from "./api";
import { Sidebar } from "./components/Sidebar";
import { MessageItem } from "./components/MessageItem";
import { InputBar, toNoteSlug } from "./components/InputBar";
import { NoteSearchModal } from "./components/NoteSearchModal";
import { GraphView } from "./components/GraphView";
import { InboxView } from "./components/InboxView";
import { SettingsModal } from "./components/SettingsModal";
import { OnboardingModal } from "./components/OnboardingModal";
import { SkillsModal } from "./components/SkillsModal";
import { RoutinesModal } from "./components/RoutinesModal";
import { ThemeEngine } from "./utils/themeEngine";

export default function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [skillsModalOpen, setSkillsModalOpen] = useState(false);
  const [routinesModalOpen, setRoutinesModalOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [origin, setOrigin] = useState<"text" | "voice">("text");
  const [currentView, setCurrentView] = useState<"chat" | "graph" | "inbox">("chat");
  const [unreadInboxCount, setUnreadInboxCount] = useState<number>(0);
  const [shortcutConflict, setShortcutConflict] = useState<string | null>(null);

  // Attached notes for clean @mentions visual reference
  const [attachedNotes, setAttachedNotes] = useState<AttachedNote[]>([]);
  const [wakeStatus, setWakeStatus] = useState<"idle" | "recording" | "processing">("idle");
  const [isOverlayOpen, setIsOverlayOpen] = useState(true);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | number | null>(null);
  const wakeDiscardedRef = useRef(false);
  const prevWakeStatusRef = useRef<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const animControls = useAnimationControls();

  // Smooth entrance animation without remounting the tree (prevents 2x flash)
  useEffect(() => {
    ThemeEngine.init();
    animControls.start({
      opacity: [0, 1],
      scale: [0.98, 1],
      transition: { duration: 0.2, ease: "easeOut" },
    });
  }, [animControls]);

  // Sync active session with backend for wake word routing (only when chat view is active)
  useEffect(() => {
    const openChatId = currentView === "chat" ? activeSessionId : null;
    api.syncActiveSession(openChatId);
  }, [activeSessionId, currentView]);

  const refreshUnreadCount = async () => {
    try {
      const count = await api.getUnreadInboxCount();
      setUnreadInboxCount(count);
    } catch {
      // Ignora erro
    }
  };

  useEffect(() => {
    refreshUnreadCount();
  }, []);

  // Listen for wake word events and overlay toggle
  useEffect(() => {
    let unlistenToggle: (() => void) | undefined;
    let unlistenStatus: (() => void) | undefined;
    let unlistenMsg: (() => void) | undefined;
    let unlistenInbox: (() => void) | undefined;
    let unlistenRenamed: (() => void) | undefined;
    let unlistenShortcut: (() => void) | undefined;
    let unlistenSessionCreated: (() => void) | undefined;
    let unlistenSessionActive: (() => void) | undefined;

    const setupListener = async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlistenInbox = await listen<{ unread_count: number }>("inbox-updated", (event) => {
          if (typeof event.payload?.unread_count === "number") {
            setUnreadInboxCount(event.payload.unread_count);
          } else {
            refreshUnreadCount();
          }
        });
        unlistenToggle = await listen<boolean>("overlay-toggled", (event) => {
          setIsOverlayOpen(event.payload);
          // Sempre que o overlay muda de estado (abrir ou fechar) enquanto há voz, faz fade out suave
          // Requisito explícito: ao abrir overlay durante fala, a voz deve abaixar e sumir
          api.fadeOutTts(300).catch(() => {});
          setSpeakingMessageId(null);
          if (event.payload) {
            animControls.start({
              opacity: [0, 1],
              scale: [0.98, 1],
              transition: { duration: 0.2, ease: "easeOut" },
            });
          }
        });

        unlistenStatus = await listen<{ status: "idle" | "recording" | "processing" | "speaking" | "listening"; prompt?: string }>(
          "wake-status-changed",
          (event) => {
            const st = event.payload.status;
            setWakeStatus(st as any);
            prevWakeStatusRef.current = st;
            if (st === "recording") {
              wakeDiscardedRef.current = false;
              api.fadeOutTts(300).catch(() => {});
              // Chimes pertencem SÓ ao overlay do Sol (VoiceIndicatorOverlay):
              // recording/listening/processing tocam lá. Tocar aqui duplicava o áudio.
              // O fadeOut acima é seguro: a saudação usa rodio (play_file_blocking),
              // não o tts_client, então não é cortada.
            }
          }
        );

        unlistenSessionCreated = await listen<{
          session: Session;
          sessionId: string;
        }>("wake-session-created", (event) => {
          const { session, sessionId } = event.payload;
          setSessions((prev) => {
            if (prev.some((s) => s.id === sessionId)) return prev;
            return [session, ...prev];
          });
          setActiveSessionId(sessionId);
          setMessages([]);
          setCurrentView("chat");
          setAttachedNotes([]);
        });

        unlistenSessionActive = await listen<{
          sessionId: string;
        }>("wake-session-active", (event) => {
          const { sessionId } = event.payload;
          setActiveSessionId(sessionId);
          setCurrentView("chat");
        });

        unlistenMsg = await listen<{
          sessionId: string;
          userMessage: Message;
          assistantMessage: Message;
          updatedSessionTitle?: string;
        }>("wake-message-result", async (event) => {
          if (wakeDiscardedRef.current) {
            wakeDiscardedRef.current = false;
            return;
          }
          const payload = event.payload;
          setActiveSessionId(payload.sessionId);
          setCurrentView("chat");

          try {
            // Sincroniza diretamente com o SQLite para garantir integridade e eliminar qualquer duplicação
            const msgs = await api.getMessages(payload.sessionId);
            setMessages(msgs);
          } catch {
            // Fallback seguro: adiciona com desduplicação por ID
            setMessages((prev) => {
              const existingIds = new Set(prev.map((m) => m.id));
              const toAdd: Message[] = [];
              if (!existingIds.has(payload.userMessage.id)) toAdd.push(payload.userMessage);
              if (!existingIds.has(payload.assistantMessage.id)) toAdd.push(payload.assistantMessage);
              return toAdd.length > 0 ? [...prev, ...toAdd] : prev;
            });
          }

          const loaded = await api.listSessions();
          setSessions(loaded);
        });

        unlistenRenamed = await listen<{ id: string; title: string }>(
          "session-renamed",
          (event) => {
            const { id, title } = event.payload;
            setSessions((prev) =>
              prev.map((s) => (s.id === id ? { ...s, title } : s))
            );
          }
        );

        unlistenShortcut = await listen<string>("shortcut-conflict", (event) => {
          if (event.payload) {
            setShortcutConflict(event.payload);
          }
        });
      } catch {
        // Fallback for non-tauri dev environment
      }
    };
    setupListener();
    return () => {
      if (unlistenToggle) unlistenToggle();
      if (unlistenStatus) unlistenStatus();
      if (unlistenMsg) unlistenMsg();
      if (unlistenInbox) unlistenInbox();
      if (unlistenRenamed) unlistenRenamed();
      if (unlistenShortcut) unlistenShortcut();
      if (unlistenSessionCreated) unlistenSessionCreated();
      if (unlistenSessionActive) unlistenSessionActive();
    };
  }, [animControls]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    if (currentView === "chat") {
      scrollToBottom();
    }
  }, [messages, isLoading, currentView]);

  // Initial load
  useEffect(() => {
    async function loadData() {
      try {
        const loadedSessions = await api.listSessions();
        setSessions(loadedSessions);

        if (loadedSessions.length > 0) {
          const first = loadedSessions[0];
          setActiveSessionId(first.id);
          const msgs = await api.getMessages(first.id);
          setMessages(msgs);
        } else {
          // Lazy session: do not persist empty session to DB on startup
          setActiveSessionId(null);
          setMessages([]);
        }

        try {
          const profile = await api.getUserProfile();
          if (!profile.onboarding_completed) {
            setOnboardingOpen(true);
          }
        } catch {
          // Ignora fallback
        }
      } catch (err) {
        console.error("Initialization error:", err);
      }
    }
    loadData();
  }, []);

  // Global escape and hotkey handling
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (settingsModalOpen) {
          setSettingsModalOpen(false);
          return;
        }
        if (searchModalOpen) {
          setSearchModalOpen(false);
          return;
        }
        // Hide overlay window
        setIsOverlayOpen(false);
        api.toggleOverlay(false);
      } else if (e.ctrlKey && (e.code === "Space" || e.key === " ")) {
        e.preventDefault();
        setIsOverlayOpen(false);
        api.toggleOverlay(false);
      }
    };

    const handleFocus = () => {
      setIsOverlayOpen(true);
      // Ao focar/ abrir overlay durante fala, garante fade out (requisito explícito)
      api.fadeOutTts(300).catch(() => {});
      setSpeakingMessageId(null);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("focus", handleFocus);
    };
  }, [searchModalOpen, settingsModalOpen]);

  // Session switching
  const handleSelectSession = async (id: string) => {
    setActiveSessionId(id);
    setCurrentView("chat");
    try {
      const msgs = await api.getMessages(id);
      setMessages(msgs);
    } catch (err) {
      console.error("Load session messages error:", err);
    }
  };

  // Lazy new session: only resets local state, persisted only when first message is sent
  const handleNewSession = () => {
    setActiveSessionId(null);
    setMessages([]);
    setCurrentView("chat");
    setAttachedNotes([]);
  };

  // Rename session
  const handleRenameSession = async (id: string, newTitle: string) => {
    try {
      await api.renameSession(id, newTitle);
      setSessions((prev) =>
        prev.map((s) =>
          s.id === id ? { ...s, title: newTitle, titulo: newTitle } : s
        )
      );
    } catch (err) {
      console.error("Rename session error:", err);
    }
  };

  // Delete session
  const handleDeleteSession = async (id: string) => {
    try {
      await api.deleteSession(id);
      const remaining = sessions.filter((s) => s.id !== id);
      setSessions(remaining);
      if (activeSessionId === id) {
        if (remaining.length > 0) {
          handleSelectSession(remaining[0].id);
        } else {
          handleNewSession();
        }
      }
    } catch (err) {
      console.error("Delete session error:", err);
    }
  };

  // Attach note for visual reference
  const handleAttachNote = (note: AttachedNote) => {
    setAttachedNotes((prev) => {
      if (prev.some((n) => n.slug === note.slug)) return prev;
      return [...prev, note];
    });
  };

  const handleRemoveAttachedNote = (slug: string) => {
    setAttachedNotes((prev) => prev.filter((n) => n.slug !== slug));
  };

  const handleOpenNoteInChat = (title: string, content: string) => {
    const slug = toNoteSlug(title) || "nota";
    handleAttachNote({ title, content, slug });
    setCurrentView("chat");
    setInputText((prev) => {
      const mention = `@${slug}`;
      if (prev.includes(mention)) return prev;
      return prev ? `${prev} ${mention} ` : `${mention} `;
    });
  };

  // Send message
  const handleSendMessage = async (msgOrigin: "text" | "voice", textOverride?: string) => {
    const rawText = textOverride !== undefined ? textOverride : inputText;
    if (!rawText.trim() || isLoading) return;

    const userText = rawText.trim();
    setInputText("");

    let currentSessionId = activeSessionId;
    if (!currentSessionId) {
      // Create and persist session in SQLite on first message
      const newS = await api.newSession();
      setSessions((prev) => [newS, ...prev]);
      currentSessionId = newS.id;
      setActiveSessionId(newS.id);
    }

    // Build payload: if notes are attached, inject full context for AI
    let promptPayload = userText;
    if (attachedNotes.length > 0) {
      const contextSection = attachedNotes
        .map((n) => `### Nota Anexada: "${n.title}"\n\`\`\`markdown\n${n.content}\n\`\`\``)
        .join("\n\n");
      promptPayload = `[Contexto de Notas Fornecido pelo Usuário]:\n${contextSection}\n\n---\n\nPergunta ou Instrução:\n${userText}`;
    }

    // Visual optimistic message: user only sees their text with @nota reference
    const tempUserMsg: Message = {
      id: `temp-${Date.now()}`,
      session_id: currentSessionId,
      role: "user",
      content: userText,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);
    setIsLoading(true);

    // Clear attached notes after sending
    setAttachedNotes([]);

    try {
      const res = await api.sendMessage(currentSessionId, promptPayload, msgOrigin);
      // Carrega histórico completo para incluir trace de ferramentas (sem mensagens vazias - filtradas em MessageItem)
      try {
        const full = await api.getMessages(currentSessionId);
        // Preserva representação limpa da mensagem do usuário (sem injeção de contexto de notas)
        const cleaned = full.map((m) =>
          String(m.id) === String(res.user_message.id) ? { ...m, content: userText } : m
        );
        setMessages(cleaned);
      } catch {
        // Fallback: Replace optimistic message and append assistant message
        setMessages((prev) => [
          ...prev.filter(
            (m) =>
              m.id !== tempUserMsg.id &&
              m.id !== res.user_message.id &&
              m.id !== res.assistant_message.id
          ),
          // Preserve clean user message representation
          { ...res.user_message, content: userText },
          res.assistant_message,
        ]);
      }

      if (res.updated_session_title) {
        setSessions((prev) =>
          prev.map((s) =>
            s.id === currentSessionId
              ? { ...s, title: res.updated_session_title! }
              : s
          )
        );
      }
    } catch (err) {
      console.error("Send message error:", err);
      const errorMsg: Message = {
        id: `err-${Date.now()}`,
        session_id: currentSessionId,
        role: "assistant",
        content: `⚠️ Erro ao processar mensagem: ${String(err)}`,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  // Delete a message from SQLite and UI
  const handleDeleteMessage = async (messageId: string | number) => {
    try {
      await api.deleteMessage(messageId);
      setMessages((prev) => prev.filter((m) => String(m.id) !== String(messageId)));
    } catch (err) {
      console.error("Delete message error:", err);
    }
  };

  // Time Travel: Edit a prior message and regenerate from that turn forward
  const handleTimeTravelEdit = async (messageId: string | number, newText: string) => {
    if (!activeSessionId || !newText.trim() || isLoading) return;
    const trimmed = newText.trim();
    setIsLoading(true);

    const targetIdx = messages.findIndex((m) => String(m.id) === String(messageId));
    const priorMessages = targetIdx >= 0 ? messages.slice(0, targetIdx) : messages;

    const tempUserMsg: Message = {
      id: `temp-${Date.now()}`,
      session_id: activeSessionId,
      role: "user",
      content: trimmed,
      created_at: new Date().toISOString(),
    };

    setMessages([...priorMessages, tempUserMsg]);

    try {
      const res = await api.timeTravelEdit(activeSessionId, messageId, trimmed, origin);
      // Carrega histórico completo para incluir trace de ferramentas
      try {
        const full = await api.getMessages(activeSessionId);
        const cleaned = full.map((m) =>
          String(m.id) === String(res.user_message.id) ? { ...m, content: trimmed } : m
        );
        setMessages(cleaned);
      } catch {
        setMessages([
          ...priorMessages,
          {
            ...res.user_message,
            content: trimmed,
          },
          res.assistant_message,
        ]);
      }

      if (res.updated_session_title) {
        setSessions((prev) =>
          prev.map((s) =>
            s.id === activeSessionId
              ? { ...s, title: res.updated_session_title!, titulo: res.updated_session_title! }
              : s
          )
        );
      }
    } catch (err) {
      console.error("Time travel edit error:", err);
      if (activeSessionId) {
        const msgs = await api.getMessages(activeSessionId);
        setMessages(msgs);
      }
    } finally {
      setIsLoading(false);
    }
  };

  // TTS audio playback for individual chat messages
  const handleSpeakMessage = async (msg: Message) => {
    try {
      await api.stopTts();
      setSpeakingMessageId(msg.id);
      await api.speakText(msg.content);
    } catch (err) {
      console.error("Erro ao reproduzir áudio da mensagem:", err);
    } finally {
      setSpeakingMessageId((curr) => (curr === msg.id ? null : curr));
    }
  };

  const handleStopSpeak = async () => {
    try {
      await api.fadeOutTts(250);
    } catch (err) {
      console.error("Erro ao interromper áudio:", err);
    } finally {
      setSpeakingMessageId(null);
    }
  };

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  return (
    <div className="w-screen h-screen flex items-center justify-center p-4 sm:p-6 bg-transparent select-none">
      {/* Floating Raycast-Style Modal Window with smooth entrance */}
      <motion.div
        animate={animControls}
        initial={{ opacity: 0, scale: 0.98 }}
        className="w-full h-full max-w-5xl max-h-[92vh] flex rounded-3xl bg-[var(--bg-app)] backdrop-blur-2xl border border-[var(--border-subtle)] shadow-2xl shadow-black/50 overflow-hidden text-[var(--text-primary)] relative"
      >
        {/* Left: ChatGPT-style collapsible left sidebar (Deduplicated navigation) */}
        <Sidebar
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelectSession={handleSelectSession}
          onNewSession={handleNewSession}
          onRenameSession={handleRenameSession}
          onDeleteSession={handleDeleteSession}
          isOpen={sidebarOpen}
          onToggleOpen={() => setSidebarOpen(!sidebarOpen)}
          currentView={currentView}
          onChangeView={setCurrentView}
          onOpenSearch={() => setSearchModalOpen(true)}
          unreadInboxCount={unreadInboxCount}
          onOpenSkills={() => setSkillsModalOpen(true)}
          onOpenRoutines={() => setRoutinesModalOpen(true)}
        />

        {/* Right: Main Content Area */}
        <div className="flex-1 flex flex-col overflow-hidden relative bg-[var(--bg-app)]">
          {/* Streamlined Top Bar: Centered title + exactly 2 buttons on right */}
          <div className="h-12 border-b border-[var(--border-subtle)] px-4 flex items-center justify-between bg-[var(--bg-card)]/40 shrink-0 z-20">
            {/* Left: Spacer to maintain perfect center alignment with right-side action buttons */}
            <div className="w-20" />

            {/* Center: Conversation name, larger, bold and centered */}
            <div className="flex-1 flex justify-center items-center px-4">
              <h1 className="text-sm sm:text-base font-bold text-[var(--text-primary)] truncate text-center max-w-md tracking-tight">
                {currentView === "graph"
                  ? "Grafo de Conhecimento"
                  : currentView === "inbox"
                  ? "Inbox do Agente & Cartas"
                  : activeSession?.title || activeSession?.titulo || "Nova Conversa"}
              </h1>
            </div>

            {/* Right: Only two buttons in exact order: Settings, then Minimize */}
            <div className="w-20 flex items-center justify-end gap-1">
              <button
                type="button"
                onClick={() => setSettingsModalOpen(true)}
                className="p-1.5 hover:bg-white/10 rounded-xl text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                title="Configurações (System Prompt, Cofres, Reindexação)"
              >
                <Settings size={15} />
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsOverlayOpen(false);
                  api.toggleOverlay(false);
                }}
                className="p-1.5 hover:bg-white/10 rounded-xl text-[var(--text-muted)] hover:text-rose-400 transition-colors"
                title="Minimizar (Esc)"
              >
                <Minus size={15} />
              </button>
            </div>
          </div>

          {/* Shortcut Conflict Warning Banner */}
          {shortcutConflict && (
            <div className="bg-amber-500/15 border-b border-amber-500/30 px-4 py-2 flex items-center justify-between text-xs text-amber-200 z-30 shrink-0 backdrop-blur-md">
              <div className="flex items-center gap-2">
                <AlertTriangle size={14} className="text-amber-400 shrink-0" />
                <span>{shortcutConflict} Você pode redefinir o atalho nas configurações.</span>
              </div>
              <button
                type="button"
                onClick={() => setShortcutConflict(null)}
                className="p-1 hover:bg-white/10 rounded-lg text-amber-400 hover:text-amber-200 transition-colors"
                title="Fechar aviso"
              >
                <X size={13} />
              </button>
            </div>
          )}

          {/* Body: Graph View OR Inbox View OR Chat View */}
          <div className="flex-1 flex flex-col overflow-hidden relative">
            {currentView === "graph" ? (
              <GraphView onOpenInChat={handleOpenNoteInChat} />
            ) : currentView === "inbox" ? (
              <InboxView
                onOpenSession={(sessionId) => {
                  setActiveSessionId(sessionId);
                  setCurrentView("chat");
                }}
                onRefreshUnreadCount={refreshUnreadCount}
              />
            ) : (
              <>
                {/* Chat Messages Area */}
                <div className="flex-1 flex flex-col overflow-y-auto p-4 sm:p-6 space-y-4">
                  {messages.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center p-6 space-y-4 max-w-lg mx-auto my-auto">
                      {/* Brand Logo Centerpiece */}
                      <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-center shadow-inner p-2.5">
                        <CopernicoSquircle
                          size={52}
                          className="drop-shadow-[0_0_16px_rgba(245,158,11,0.45)]"
                        />
                      </div>
                      <div>
                        <h3 className="text-base font-semibold text-[var(--text-primary)]">
                          Copernico — Second Brain
                        </h3>
                        <p className="text-xs text-[var(--text-muted)] mt-1.5 leading-relaxed">
                          Assistente pessoal integrado aos seus cofres de notas
                          com RAG vetorial FastEmbed e DeepSeek.
                        </p>
                      </div>

                      {/* Quick Prompts */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full pt-2">
                        <button
                          onClick={() => {
                            setInputText("Quais anotações eu tenho sobre arquitetura?");
                          }}
                          className="p-3 rounded-2xl bg-[var(--bg-card)] hover:bg-[var(--bg-input)] border border-[var(--border-subtle)] hover:border-amber-500/40 text-left text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all group"
                        >
                          <div className="flex items-center gap-2 font-medium text-[var(--text-primary)] group-hover:text-amber-400">
                            <Search size={14} className="text-amber-400" />
                            <span>Buscar no cofre</span>
                          </div>
                          <span className="text-[11px] text-[var(--text-muted)] block mt-1">
                            "Quais anotações tenho sobre..."
                          </span>
                        </button>

                        <button
                          onClick={() => {
                            setInputText(
                              "Crie uma nota sobre a reunião de hoje com decisões e próximos passos."
                            );
                          }}
                          className="p-3 rounded-2xl bg-[var(--bg-card)] hover:bg-[var(--bg-input)] border border-[var(--border-subtle)] hover:border-amber-500/40 text-left text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all group"
                        >
                          <div className="flex items-center gap-2 font-medium text-[var(--text-primary)] group-hover:text-amber-400">
                            <Layers size={14} className="text-emerald-400" />
                            <span>Criar nota atômica</span>
                          </div>
                          <span className="text-[11px] text-[var(--text-muted)] block mt-1">
                            "Crie uma nota sobre..."
                          </span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {messages.map((msg) => (
                        <MessageItem
                          key={msg.id}
                          message={msg}
                          onEdit={handleTimeTravelEdit}
                          onDelete={handleDeleteMessage}
                          isSpeaking={speakingMessageId === msg.id}
                          onSpeak={handleSpeakMessage}
                          onStopSpeak={handleStopSpeak}
                          onOpenNote={handleOpenNoteInChat}
                        />
                      ))}

                      {isLoading && (
                        <div className="flex items-center gap-3 px-4 py-2.5 bg-[var(--bg-card)] rounded-2xl border border-[var(--border-subtle)] w-fit animate-pulse">
                          <div className="w-7 h-7 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
                            <CopernicoSun
                              size={18}
                              className="animate-spin"
                            />
                          </div>
                          <div className="flex items-center gap-1.5 text-xs text-[var(--text-primary)]">
                            <span>Consultando cofres e raciocinando</span>
                            <span className="inline-flex space-x-1">
                              <span className="w-1 h-1 bg-amber-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
                              <span className="w-1 h-1 bg-amber-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
                              <span className="w-1 h-1 bg-amber-400 rounded-full animate-bounce" />
                            </span>
                          </div>
                        </div>
                      )}
                      <div ref={messagesEndRef} />
                    </>
                  )}
                </div>

                {/* Input Bar with @mention autocomplete & attached note chips */}
                <InputBar
                  value={inputText}
                  onChange={setInputText}
                  onSubmit={handleSendMessage}
                  isLoading={isLoading}
                  origin={origin}
                  onToggleOrigin={() =>
                    setOrigin((prev) => (prev === "text" ? "voice" : "text"))
                  }
                  onSetOrigin={setOrigin}
                  attachedNotes={attachedNotes}
                  onRemoveAttachedNote={handleRemoveAttachedNote}
                  onAttachNote={handleAttachNote}
                  isWakeRecording={isOverlayOpen && wakeStatus === "recording"}
                  onDiscardWakeRecording={() => {
                    wakeDiscardedRef.current = true;
                    setWakeStatus("idle");
                    api.cancelWakeRecording().catch(() => {});
                  }}
                  onOpenSkills={() => setSkillsModalOpen(true)}
                  onOpenRoutines={() => setRoutinesModalOpen(true)}
                  onMicStart={() => {
                    // Ao ativar microfone enquanto agente fala, faz fade out suave
                    api.fadeOutTts(300).catch(() => {});
                    setSpeakingMessageId(null);
                  }}
                />
              </>
            )}
          </div>
        </div>

        {/* Note Search Modal */}
        <NoteSearchModal
          isOpen={searchModalOpen}
          onClose={() => setSearchModalOpen(false)}
          onInsertNoteContext={handleOpenNoteInChat}
        />

        {/* Settings Modal */}
        <SettingsModal
          isOpen={settingsModalOpen}
          onClose={() => setSettingsModalOpen(false)}
          onOpenSession={(sid) => {
            handleSelectSession(sid);
            setSettingsModalOpen(false);
            setCurrentView("chat");
          }}
          onOpenSkills={() => setSkillsModalOpen(true)}
          onOpenRoutines={() => setRoutinesModalOpen(true)}
        />

        {/* Skills & Hub Modal */}
        <SkillsModal
          isOpen={skillsModalOpen}
          onClose={() => setSkillsModalOpen(false)}
        />

        {/* Routines Scheduler Modal */}
        <RoutinesModal
          isOpen={routinesModalOpen}
          onClose={() => setRoutinesModalOpen(false)}
          onOpenInbox={() => setCurrentView("inbox")}
        />

        {/* Onboarding Modal */}
        <OnboardingModal
          isOpen={onboardingOpen}
          onComplete={() => setOnboardingOpen(false)}
        />
      </motion.div>
    </div>
  );
}
