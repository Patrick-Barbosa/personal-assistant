/**
 * Zustand store for voice / wake-word state.
 * Tracks recording status and TTS playback. The dashboard reflects voice
 * state via the `wake-status-changed` badge in `AppHeader` (no overlay window).
 */
import { create } from "zustand";

export type WakeStatus = "idle" | "recording" | "processing" | "speaking" | "listening";

interface VoiceState {
  /** Current wake-word / recording state */
  wakeStatus: WakeStatus;
  /** ID of the message currently being spoken via TTS (null = nothing playing) */
  speakingMessageId: string | number | null;
}

interface VoiceActions {
  setWakeStatus: (status: WakeStatus) => void;
  setSpeakingMessageId: (id: string | number | null) => void;
}

export const useVoiceStore = create<VoiceState & VoiceActions>()((set) => ({
  // State
  wakeStatus: "idle",
  speakingMessageId: null,

  // Actions
  setWakeStatus: (status) => set({ wakeStatus: status }),
  setSpeakingMessageId: (id) => set({ speakingMessageId: id }),
}));
