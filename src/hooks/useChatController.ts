import { useSessionStore } from "../stores/session-store";
import { useUiStore } from "../stores/ui-store";
import { useVoiceStore } from "../stores/voice-store";
import { api } from "../api";
import { toNoteSlug } from "../utils/transcriptCleaner";
import type { Message, AttachedNote } from "../types";

export function useChatController() {
  const sessions = useSessionStore((s) => s.sessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const messages = useSessionStore((s) => s.messages);
  const inputText = useSessionStore((s) => s.inputText);
  const isLoading = useSessionStore((s) => s.isLoading);
  const attachedNotes = useSessionStore((s) => s.attachedNotes);
  const origin = useSessionStore((s) => s.origin);

  const setSessions = useSessionStore((s) => s.setSessions);
  const setActiveSessionId = useSessionStore((s) => s.setActiveSessionId);
  const setMessages = useSessionStore((s) => s.setMessages);
  const setInputText = useSessionStore((s) => s.setInputText);
  const setIsLoading = useSessionStore((s) => s.setIsLoading);
  const setAttachedNotes = useSessionStore((s) => s.setAttachedNotes);
  const addAttachedNote = useSessionStore((s) => s.addAttachedNote);
  const removeAttachedNote = useSessionStore((s) => s.removeAttachedNote);
  const clearAttachedNotes = useSessionStore((s) => s.clearAttachedNotes);

  const setCurrentView = useUiStore((s) => s.setCurrentView);
  const setSpeakingMessageId = useVoiceStore((s) => s.setSpeakingMessageId);

  const selectSession = async (id: string) => {
    setActiveSessionId(id);
    setCurrentView("chat");
    try {
      const msgs = await api.getMessages(id);
      setMessages(msgs);
    } catch (err) {
      console.error("Load session messages error:", err);
    }
  };

  const newSession = () => {
    setActiveSessionId(null);
    setMessages([]);
    setCurrentView("chat");
    clearAttachedNotes();
  };

  const renameSession = async (id: string, newTitle: string) => {
    try {
      await api.renameSession(id, newTitle);
      setSessions(
        sessions.map((s) =>
          s.id === id ? { ...s, title: newTitle, titulo: newTitle } : s
        )
      );
    } catch (err) {
      console.error("Rename session error:", err);
    }
  };

  const deleteSession = async (id: string) => {
    try {
      await api.deleteSession(id);
      const remaining = sessions.filter((s) => s.id !== id);
      setSessions(remaining);
      if (activeSessionId === id) {
        if (remaining.length > 0) {
          selectSession(remaining[0].id);
        } else {
          newSession();
        }
      }
    } catch (err) {
      console.error("Delete session error:", err);
    }
  };

  const openNoteInChat = (title: string, content: string) => {
    const slug = toNoteSlug(title) || "nota";
    addAttachedNote({ title, content, slug });
    setCurrentView("chat");
    const currentInput = useSessionStore.getState().inputText;
    const mention = `@${slug}`;
    if (!currentInput.includes(mention)) {
      setInputText(currentInput ? `${currentInput} ${mention} ` : `${mention} `);
    }
  };

  const sendMessage = async (
    msgOrigin: "text" | "voice",
    textOverride?: string
  ) => {
    const rawText = textOverride !== undefined ? textOverride : inputText;
    if (!rawText.trim() || isLoading) return;

    const userText = rawText.trim();
    setInputText("");

    let currentSessionId = activeSessionId;
    if (!currentSessionId) {
      const newS = await api.newSession();
      setSessions([newS, ...sessions]);
      currentSessionId = newS.id;
      setActiveSessionId(newS.id);
    }

    let promptPayload = userText;
    if (attachedNotes.length > 0) {
      const contextSection = attachedNotes
        .map(
          (n) =>
            `### Nota Anexada: "${n.title}"\n\`\`\`markdown\n${n.content}\n\`\`\``
        )
        .join("\n\n");
      promptPayload = `[Contexto de Notas Fornecido pelo Usuário]:\n${contextSection}\n\n---\n\nPergunta ou Instrução:\n${userText}`;
    }

    const tempUserMsg: Message = {
      id: `temp-${Date.now()}`,
      session_id: currentSessionId,
      role: "user",
      content: userText,
      created_at: new Date().toISOString(),
    };
    setMessages([...messages, tempUserMsg]);
    setIsLoading(true);
    clearAttachedNotes();

    try {
      const res = await api.sendMessage(
        currentSessionId,
        promptPayload,
        msgOrigin
      );

      try {
        const full = await api.getMessages(currentSessionId);
        const cleaned = full.map((m) =>
          String(m.id) === String(res.user_message.id)
            ? { ...m, content: userText }
            : m
        );
        setMessages(cleaned);
      } catch {
        setMessages([
          ...useSessionStore
            .getState()
            .messages.filter(
              (m) =>
                m.id !== tempUserMsg.id &&
                m.id !== res.user_message.id &&
                m.id !== res.assistant_message.id
            ),
          { ...res.user_message, content: userText },
          res.assistant_message,
        ]);
      }

      // Talk-button UX (web voice): auto-play the reply, no wake word needed.
      // Skipped inside a voice session — the session engine speaks with its own level-tracked audio.
      if (msgOrigin === "voice" && !useUiStore.getState().voiceSessionOpen) {
        void speakMessage(res.assistant_message);
      }

      if (res.updated_session_title) {
        setSessions(
          useSessionStore
            .getState()
            .sessions.map((s) =>
              s.id === currentSessionId
                ? { ...s, title: res.updated_session_title! }
                : s
            )
        );
      }
    } catch (err) {
      const errStr = String(err);
      if (errStr.includes("Sessão não encontrada")) {
        try {
          const newS = await api.newSession();
          const prevSessions = useSessionStore.getState().sessions;
          setSessions([newS, ...prevSessions.filter((s) => s.id !== newS.id)]);
          setActiveSessionId(newS.id);
          currentSessionId = newS.id;
          const retryRes = await api.sendMessage(newS.id, promptPayload, msgOrigin);
          try {
            const full = await api.getMessages(newS.id);
            const cleaned = full.map((m) =>
              String(m.id) === String(retryRes.user_message.id) ? { ...m, content: userText } : m
            );
            setMessages(cleaned);
          } catch {
            setMessages([
              ...useSessionStore
                .getState()
                .messages.filter(
                  (m) =>
                    m.id !== tempUserMsg.id &&
                    m.id !== retryRes.user_message.id &&
                    m.id !== retryRes.assistant_message.id
                ),
              { ...retryRes.user_message, content: userText },
              retryRes.assistant_message,
            ]);
          }
          if (retryRes.updated_session_title) {
            setSessions(
              useSessionStore.getState().sessions.map((s) =>
                s.id === newS.id
                  ? { ...s, title: retryRes.updated_session_title!, titulo: retryRes.updated_session_title! }
                  : s
              )
            );
          }
          return;
        } catch (retryErr) {
          console.error("Ghost session retry failed:", retryErr);
          const errorMsg: Message = {
            id: `err-${Date.now()}`,
            session_id: currentSessionId,
            role: "assistant",
            content: `⚠️ Erro ao processar mensagem: ${String(retryErr)}`,
            created_at: new Date().toISOString(),
          };
          setMessages([...useSessionStore.getState().messages, errorMsg]);
          return;
        }
      }
      console.error("Send message error:", err);
      const errorMsg: Message = {
        id: `err-${Date.now()}`,
        session_id: currentSessionId,
        role: "assistant",
        content: `⚠️ Erro ao processar mensagem: ${String(err)}`,
        created_at: new Date().toISOString(),
      };
      setMessages([...useSessionStore.getState().messages, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const deleteMessage = async (messageId: string | number) => {
    try {
      await api.deleteMessage(messageId);
      setMessages(messages.filter((m) => String(m.id) !== String(messageId)));
    } catch (err) {
      console.error("Delete message error:", err);
    }
  };

  const timeTravelEdit = async (
    messageId: string | number,
    newText: string
  ) => {
    if (!activeSessionId || !newText.trim() || isLoading) return;
    const trimmed = newText.trim();
    setIsLoading(true);

    const targetIdx = messages.findIndex(
      (m) => String(m.id) === String(messageId)
    );
    const priorMessages =
      targetIdx >= 0 ? messages.slice(0, targetIdx) : messages;

    const tempUserMsg: Message = {
      id: `temp-${Date.now()}`,
      session_id: activeSessionId,
      role: "user",
      content: trimmed,
      created_at: new Date().toISOString(),
    };
    setMessages([...priorMessages, tempUserMsg]);

    try {
      const res = await api.timeTravelEdit(
        activeSessionId,
        messageId,
        trimmed,
        origin
      );
      try {
        const full = await api.getMessages(activeSessionId);
        const cleaned = full.map((m) =>
          String(m.id) === String(res.user_message.id)
            ? { ...m, content: trimmed }
            : m
        );
        setMessages(cleaned);
      } catch {
        setMessages([
          ...priorMessages,
          { ...res.user_message, content: trimmed },
          res.assistant_message,
        ]);
      }

      if (res.updated_session_title) {
        setSessions(
          useSessionStore
            .getState()
            .sessions.map((s) =>
              s.id === activeSessionId
                ? {
                    ...s,
                    title: res.updated_session_title!,
                    titulo: res.updated_session_title!,
                  }
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

  const speakMessage = async (msg: Message) => {
    try {
      await api.stopTts();
      setSpeakingMessageId(msg.id);
      await api.speakText(msg.content);
    } catch (err) {
      console.error("TTS playback error:", err);
    } finally {
      setSpeakingMessageId(null);
    }
  };

  const stopSpeak = async () => {
    try {
      await api.fadeOutTts(250);
    } catch (err) {
      console.error("TTS stop error:", err);
    } finally {
      setSpeakingMessageId(null);
    }
  };

  return {
    selectSession,
    newSession,
    renameSession,
    deleteSession,
    openNoteInChat,
    sendMessage,
    deleteMessage,
    timeTravelEdit,
    speakMessage,
    stopSpeak,
    attachNote: addAttachedNote,
    removeAttachedNote,
  };
}
