import React, { useEffect, useRef } from "react";
import { motion, useAnimationControls } from "framer-motion";
import { AlertTriangle, X } from "lucide-react";
import { CopernicoSun } from "./components/icons/CopernicoSun";
import { AppHeader } from "./components/AppHeader";
import { EmptyChatState } from "./components/EmptyChatState";
import { Sidebar } from "./components/Sidebar";
import { MessageItem } from "./components/MessageItem";
import { InputBar } from "./components/InputBar";
import { NoteSearchModal } from "./components/NoteSearchModal";
import { GraphView } from "./components/GraphView";
import { InboxView } from "./components/InboxView";
import { KanbanView } from "./components/KanbanView";
import { VoiceSessionView } from "./components/VoiceSessionView";
import { SettingsModal } from "./components/SettingsModal";
import { OnboardingModal } from "./components/OnboardingModal";
import { SkillsModal } from "./components/SkillsModal";
import { RoutinesModal } from "./components/RoutinesModal";
import { ThemeEngine } from "./utils/themeEngine";
import { useUiStore } from "./stores/ui-store";
import { useSessionStore } from "./stores/session-store";
import { useVoiceStore } from "./stores/voice-store";
import { useTauriEvents } from "./hooks/useTauriEvents";
import { useChatController } from "./hooks/useChatController";
import { api } from "./api";

export default function App() {
  const animControls = useAnimationControls();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const wakeDiscardedRef = useRef(false);

  // Zustand stores
  const {
    sidebarOpen,
    setSidebarOpen,
    currentView,
    setCurrentView,
    searchModalOpen,
    setSearchModalOpen,
    settingsModalOpen,
    setSettingsModalOpen,
    skillsModalOpen,
    setSkillsModalOpen,
    routinesModalOpen,
    setRoutinesModalOpen,
    onboardingOpen,
    setOnboardingOpen,
    shortcutConflict,
    setShortcutConflict,
    unreadInboxCount,
    setUnreadInboxCount,
    voiceSessionOpen,
  } = useUiStore();

  const {
    sessions,
    setSessions,
    activeSessionId,
    setActiveSessionId,
    messages,
    setMessages,
    inputText,
    setInputText,
    isLoading,
    attachedNotes,
    origin,
    setOrigin,
  } = useSessionStore();

  const {
    wakeStatus,
    setWakeStatus,
    speakingMessageId,
  } = useVoiceStore();

  // Mount Tauri backend event listeners
  useTauriEvents();

  // Chat action controller
  const chat = useChatController();

  // Initial animation & theme initialization
  useEffect(() => {
    // Apply saved theme class to <html> so CSS vars respond correctly
    const savedTheme = localStorage.getItem("copernico-theme") || "dark";
    document.documentElement.classList.toggle("dark", savedTheme === "dark");
    document.documentElement.classList.toggle("light", savedTheme === "light");

    ThemeEngine.init();
    animControls.start({
      opacity: [0, 1],
      scale: [0.98, 1],
      transition: { duration: 0.2, ease: "easeOut" },
    });
  }, [animControls]);

  // Sync active session with backend for wake word routing
  useEffect(() => {
    const openChatId = currentView === "chat" ? activeSessionId : null;
    api.syncActiveSession(openChatId);
  }, [activeSessionId, currentView]);

  // Initial data loading
  useEffect(() => {
    async function loadInitialData() {
      try {
        const loadedSessions = await api.listSessions();
        setSessions(loadedSessions);

        if (loadedSessions.length > 0) {
          const first = loadedSessions[0];
          setActiveSessionId(first.id);
          const msgs = await api.getMessages(first.id);
          setMessages(msgs);
        }

        const unreadCount = await api.getUnreadInboxCount().catch(() => 0);
        setUnreadInboxCount(unreadCount);

        const profile = await api.getUserProfile().catch(() => null);
        if (profile && !profile.onboarding_completed) {
          setOnboardingOpen(true);
        }
      } catch (err) {
        console.error("Initialization error:", err);
      }
    }
    loadInitialData();
  }, [setSessions, setActiveSessionId, setMessages, setUnreadInboxCount, setOnboardingOpen]);

  // Global escape and hotkey handling (modals only — Esc never hides
  // the main window; voice keeps running in background with audio cues).
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
        if (skillsModalOpen) {
          setSkillsModalOpen(false);
          return;
        }
        if (routinesModalOpen) {
          setRoutinesModalOpen(false);
          return;
        }
        // Onboarding forces completion or step back; otherwise Esc is a no-op.
      }
    };

    const handleFocus = () => {
      if (useVoiceStore.getState().wakeStatus === "speaking") {
        api.fadeOutTts(300).catch(() => {});
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("focus", handleFocus);
    };
  }, [
    searchModalOpen,
    settingsModalOpen,
    skillsModalOpen,
    routinesModalOpen,
    setSettingsModalOpen,
    setSearchModalOpen,
    setSkillsModalOpen,
    setRoutinesModalOpen,
  ]);

  // Auto-scroll messages
  useEffect(() => {
    if (currentView === "chat") {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isLoading, currentView]);

  return (
    <div className="w-screen h-screen flex bg-[var(--bg-app)] overflow-hidden">
      {/* Consolidated Dashboard Window with clean Zinc theme */}
      <motion.div
        animate={animControls}
        initial={{ opacity: 0, scale: 0.98 }}
        className="w-full h-full flex bg-[var(--bg-app)] text-[var(--text-primary)] relative"
      >
        {/* Left: Collapsible Sidebar */}
        <Sidebar
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelectSession={chat.selectSession}
          onNewSession={chat.newSession}
          onRenameSession={chat.renameSession}
          onDeleteSession={chat.deleteSession}
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
        <div className="flex-1 flex flex-col overflow-hidden relative bg-[var(--bg-app)]/70">
          <AppHeader />

          {/* Shortcut Conflict Warning Banner */}
          {shortcutConflict && (
            <div className="bg-amber-500/10 border-b border-amber-500/25 px-4 py-2 flex items-center justify-between text-xs text-amber-200 z-30 shrink-0 backdrop-blur-md">
              <div className="flex items-center gap-2">
                <AlertTriangle size={14} className="text-amber-400 shrink-0" />
                <span>{shortcutConflict} Redefina o atalho nas configurações.</span>
              </div>
              <button
                type="button"
                onClick={() => setShortcutConflict(null)}
                className="p-1 hover:bg-white/10 rounded-lg text-amber-400 hover:text-amber-200 transition-colors cursor-pointer"
              >
                <X size={13} />
              </button>
            </div>
          )}

          {/* Body: Voice Session OR Graph View OR Inbox View OR Chat View */}
          <div className="flex-1 flex flex-col overflow-hidden relative">
            {voiceSessionOpen ? (
              <VoiceSessionView chat={chat} />
            ) : currentView === "graph" ? (
              <GraphView onOpenInChat={chat.openNoteInChat} />
            ) : currentView === "inbox" ? (
              <InboxView
                onOpenSession={(sessionId) => {
                  chat.selectSession(sessionId);
                }}
                onRefreshUnreadCount={() => {
                  api.getUnreadInboxCount().then(setUnreadInboxCount).catch(() => {});
                }}
              />
            ) : currentView === "kanban" ? (
              <KanbanView />
            ) : (
              <>
                {/* Chat Messages Area */}
                <div className="flex-1 flex flex-col overflow-y-auto p-4 sm:p-6 space-y-4">
                  {messages.length === 0 ? (
                    <EmptyChatState />
                  ) : (
                    <>
                      {messages.map((msg) => (
                        <MessageItem
                          key={msg.id}
                          message={msg}
                          onEdit={chat.timeTravelEdit}
                          onDelete={chat.deleteMessage}
                          isSpeaking={speakingMessageId === msg.id}
                          onSpeak={chat.speakMessage}
                          onStopSpeak={chat.stopSpeak}
                          onOpenNote={chat.openNoteInChat}
                        />
                      ))}

                      {isLoading && (
                        <div className="flex items-center gap-3 px-4 py-2.5 bg-[var(--bg-card)]/80 rounded-xl border border-[var(--border-subtle)] w-fit">
                          <div className="w-6 h-6 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
                            <CopernicoSun size={15} className="animate-spin" />
                          </div>
                          <div className="flex items-center gap-1.5 text-xs text-zinc-300">
                            <span>Consultando cofres e raciocinando</span>
                            <span className="inline-flex space-x-1">
                              <span className="w-1 h-1 bg-amber-400 rounded-full animate-pulse [animation-delay:-0.3s]" />
                              <span className="w-1 h-1 bg-amber-400 rounded-full animate-pulse [animation-delay:-0.15s]" />
                              <span className="w-1 h-1 bg-amber-400 rounded-full animate-pulse" />
                            </span>
                          </div>
                        </div>
                      )}
                      <div ref={messagesEndRef} />
                    </>
                  )}
                </div>

                {/* Input Bar */}
                <InputBar
                  value={inputText}
                  onChange={setInputText}
                  onSubmit={chat.sendMessage}
                  isLoading={isLoading}
                  origin={origin}
                  onToggleOrigin={() =>
                    setOrigin(origin === "text" ? "voice" : "text")
                  }
                  onSetOrigin={setOrigin}
                  attachedNotes={attachedNotes}
                  onRemoveAttachedNote={chat.removeAttachedNote}
                  onAttachNote={chat.attachNote}
                  isWakeRecording={wakeStatus === "recording"}
                  onDiscardWakeRecording={() => {
                    wakeDiscardedRef.current = true;
                    setWakeStatus("idle");
                    api.cancelWakeRecording().catch(() => {});
                  }}
                  onOpenSkills={() => setSkillsModalOpen(true)}
                  onOpenRoutines={() => setRoutinesModalOpen(true)}
                  onMicStart={() => {
                    // TTS fade is handled once inside useVoiceRecorder.startRecording.
                  }}
                />
              </>
            )}
          </div>
        </div>

        {/* Modals */}
        <NoteSearchModal
          isOpen={searchModalOpen}
          onClose={() => setSearchModalOpen(false)}
          onInsertNoteContext={chat.openNoteInChat}
        />

        <SettingsModal
          isOpen={settingsModalOpen}
          onClose={() => setSettingsModalOpen(false)}
          onOpenSession={(sid) => {
            chat.selectSession(sid);
            setSettingsModalOpen(false);
            setCurrentView("chat");
          }}
          onOpenSkills={() => setSkillsModalOpen(true)}
          onOpenRoutines={() => setRoutinesModalOpen(true)}
        />

        <SkillsModal
          isOpen={skillsModalOpen}
          onClose={() => setSkillsModalOpen(false)}
        />

        <RoutinesModal
          isOpen={routinesModalOpen}
          onClose={() => setRoutinesModalOpen(false)}
          onOpenInbox={() => setCurrentView("inbox")}
        />

        <OnboardingModal
          isOpen={onboardingOpen}
          onComplete={() => setOnboardingOpen(false)}
        />
      </motion.div>
    </div>
  );
}
