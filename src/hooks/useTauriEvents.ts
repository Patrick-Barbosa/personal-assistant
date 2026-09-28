import { useEffect } from "react";
import { useUiStore } from "../stores/ui-store";
import { useSessionStore } from "../stores/session-store";
import { useVoiceStore, type WakeStatus } from "../stores/voice-store";
import { api } from "../api";
import type { Session, Message } from "../types";

let tauriEventsSetupDone = false;

export function useTauriEvents() {
  const setUnreadInboxCount = useUiStore((s) => s.setUnreadInboxCount);
  const setCurrentView = useUiStore((s) => s.setCurrentView);
  const setShortcutConflict = useUiStore((s) => s.setShortcutConflict);
  const bumpKanbanRevision = useUiStore((s) => s.bumpKanbanRevision);

  const setSessions = useSessionStore((s) => s.setSessions);
  const setActiveSessionId = useSessionStore((s) => s.setActiveSessionId);
  const setMessages = useSessionStore((s) => s.setMessages);

  const setWakeStatus = useVoiceStore((s) => s.setWakeStatus);

  useEffect(() => {
    if (tauriEventsSetupDone) return;
    tauriEventsSetupDone = true;

    let unlistenStatus: (() => void) | undefined;
    let unlistenMsg: (() => void) | undefined;
    let unlistenInbox: (() => void) | undefined;
    let unlistenRenamed: (() => void) | undefined;
    let unlistenShortcut: (() => void) | undefined;
    let unlistenSessionCreated: (() => void) | undefined;
    let unlistenSessionActive: (() => void) | undefined;
    let unlistenSessionDeleted: (() => void) | undefined;
    let unlistenKanban: (() => void) | undefined;

    const setup = async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");

        unlistenInbox = await listen<{ unread_count: number }>(
          "inbox-updated",
          (event) => {
            if (typeof event.payload?.unread_count === "number") {
              setUnreadInboxCount(event.payload.unread_count);
            } else {
              api.getUnreadInboxCount().then(setUnreadInboxCount).catch(() => {});
            }
          }
        );

        unlistenStatus = await listen<{
          status: WakeStatus;
        }>("wake-status-changed", (event) => {
          const st = event.payload.status;
          setWakeStatus(st);
        });

        unlistenSessionCreated = await listen<{
          session: Session;
          sessionId: string;
        }>("wake-session-created", (event) => {
          const { session, sessionId } = event.payload;
          // Silent sidebar prepend only. The active session + message view
          // switch happens on wake-message-result (first real content), so a
          // wake turn never wipes the visible conversation mid-greeting.
          setSessions([session, ...useSessionStore.getState().sessions.filter(s => s.id !== sessionId)]);
        });

        unlistenSessionActive = await listen<{ sessionId: string }>(
          "wake-session-active",
          (event) => {
            setActiveSessionId(event.payload.sessionId);
            if (useUiStore.getState().currentView === "chat") {
              setCurrentView("chat");
            }
          }
        );

        unlistenSessionDeleted = await listen<{ sessionId: string }>(
          "wake-session-deleted",
          async (event) => {
            const sid = event.payload.sessionId;
            const state = useSessionStore.getState();
            const filtered = state.sessions.filter((s) => s.id !== sid);
            if (filtered.length !== state.sessions.length) {
              setSessions(filtered);
            }
            if (state.activeSessionId === sid) {
              if (filtered.length > 0) {
                const nextId = filtered[0].id;
                setActiveSessionId(nextId);
                try {
                  const msgs = await api.getMessages(nextId);
                  setMessages(msgs);
                } catch {
                  setMessages([]);
                }
                if (useUiStore.getState().currentView === "chat") {
                  setCurrentView("chat");
                }
              } else {
                setActiveSessionId(null);
                setMessages([]);
              }
            }
          }
        );

        unlistenMsg = await listen<{
          sessionId: string;
          userMessage: Message;
          assistantMessage: Message;
          updatedSessionTitle?: string | null;
        }>("wake-message-result", async (event) => {
          const payload = event.payload;
          setActiveSessionId(payload.sessionId);
          if (useUiStore.getState().currentView === "chat") {
            setCurrentView("chat");
          }

          try {
            const msgs = await api.getMessages(payload.sessionId);
            setMessages(msgs);
          } catch {
            setMessages([
              ...useSessionStore.getState().messages,
              payload.userMessage,
              payload.assistantMessage,
            ]);
          }

          try {
            const currentSessions = useSessionStore.getState().sessions;
            const exists = currentSessions.some((s) => s.id === payload.sessionId);
            if (exists) {
              if (payload.updatedSessionTitle) {
                const newTitle = payload.updatedSessionTitle;
                setSessions(
                  currentSessions.map((s) =>
                    s.id === payload.sessionId ? { ...s, title: newTitle, titulo: newTitle } : s
                  )
                );
              }
            } else {
              const loaded = await api.listSessions();
              setSessions(loaded);
            }
          } catch {
            try {
              const loaded = await api.listSessions();
              setSessions(loaded);
            } catch {}
          }
        });

        unlistenRenamed = await listen<{ id: string; title: string }>(
          "session-renamed",
          (event) => {
            const { id, title } = event.payload;
            setSessions(
              useSessionStore
                .getState()
                .sessions.map((s) => (s.id === id ? { ...s, title } : s))
            );
          }
        );

        unlistenShortcut = await listen<string>(
          "shortcut-conflict",
          (event) => {
            if (event.payload) {
              setShortcutConflict(event.payload);
            }
          }
        );

        // Qualquer mutação de tarefa/semana/hábito dispara recarga do quadro.
        unlistenKanban = await listen<{ week_id: string; motivo: string }>(
          "kanban-changed",
          () => {
            bumpKanbanRevision();
          }
        );
      } catch {
        // Fallback for non-tauri dev environment or setup failure – allow retry
        tauriEventsSetupDone = false;
      }
    };

    setup();

    return () => {
      // StrictMode double-mount in dev triggers a fake unmount before async setup completes.
      // Keep single-flight guard alive to avoid duplicate subscriptions; only real unmount
      // should reset the flag explicitly. Still call available unlistens for cleanup.
      if (unlistenStatus) unlistenStatus();
      if (unlistenMsg) unlistenMsg();
      if (unlistenInbox) unlistenInbox();
      if (unlistenRenamed) unlistenRenamed();
      if (unlistenShortcut) unlistenShortcut();
      if (unlistenSessionCreated) unlistenSessionCreated();
      if (unlistenSessionActive) unlistenSessionActive();
      if (unlistenSessionDeleted) unlistenSessionDeleted();
      if (unlistenKanban) unlistenKanban();
    };
  }, [
    setUnreadInboxCount,
    setCurrentView,
    setShortcutConflict,
    bumpKanbanRevision,
    setSessions,
    setActiveSessionId,
    setMessages,
    setWakeStatus,
  ]);
}
