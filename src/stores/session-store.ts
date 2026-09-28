/**
 * Zustand store for session and chat state.
 * Manages sessions list, active session, messages, input, and loading state.
 * Replaces prop-drilling of chat-related state from App.tsx.
 */
import { create } from "zustand";
import type { Session, Message, AttachedNote } from "../types";

interface SessionState {
  /** All chat sessions */
  sessions: Session[];
  /** Currently active session ID */
  activeSessionId: string | null;
  /** Messages for the active session */
  messages: Message[];
  /** Current text in the input bar */
  inputText: string;
  /** Whether a message is being sent / streamed */
  isLoading: boolean;
  /** Notes attached via @mention for context */
  attachedNotes: AttachedNote[];
  /** Input origin: typed text or voice transcription */
  origin: "text" | "voice";
}

interface SessionActions {
  setSessions: (sessions: Session[]) => void;
  setActiveSessionId: (id: string | null) => void;
  setMessages: (messages: Message[]) => void;
  addMessage: (message: Message) => void;
  setInputText: (text: string) => void;
  setIsLoading: (loading: boolean) => void;
  setAttachedNotes: (notes: AttachedNote[]) => void;
  addAttachedNote: (note: AttachedNote) => void;
  removeAttachedNote: (slug: string) => void;
  clearAttachedNotes: () => void;
  setOrigin: (origin: "text" | "voice") => void;
  /** Convenience: reset to a clean chat state */
  resetChat: () => void;
}

const initialChatState: Pick<
  SessionState,
  "messages" | "inputText" | "isLoading" | "attachedNotes" | "origin"
> = {
  messages: [],
  inputText: "",
  isLoading: false,
  attachedNotes: [],
  origin: "text",
};

export const useSessionStore = create<SessionState & SessionActions>()(
  (set) => ({
    // State
    sessions: [],
    activeSessionId: null,
    ...initialChatState,

    // Actions
    setSessions: (sessions) => set({ sessions }),
    setActiveSessionId: (id) => set({ activeSessionId: id }),
    setMessages: (messages) => set({ messages }),
    addMessage: (message) =>
      set((s) => ({ messages: [...s.messages, message] })),
    setInputText: (text) => set({ inputText: text }),
    setIsLoading: (loading) => set({ isLoading: loading }),
    setAttachedNotes: (notes) => set({ attachedNotes: notes }),
    addAttachedNote: (note) =>
      set((s) => {
        if (s.attachedNotes.some((n) => n.slug === note.slug)) return s;
        return { attachedNotes: [...s.attachedNotes, note] };
      }),
    removeAttachedNote: (slug) =>
      set((s) => ({
        attachedNotes: s.attachedNotes.filter((n) => n.slug !== slug),
      })),
    clearAttachedNotes: () => set({ attachedNotes: [] }),
    setOrigin: (origin) => set({ origin }),
    resetChat: () => set(initialChatState),
  })
);
