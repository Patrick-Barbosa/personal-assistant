/**
 * Zustand store for global UI state.
 * Manages sidebar visibility, active view, and modal open/close states.
 * Replaces prop-drilling of UI booleans from App.tsx.
 */
import { create } from "zustand";

type ViewId = "chat" | "graph" | "inbox" | "kanban";

interface UiState {
  /** Whether the sidebar drawer is open */
  sidebarOpen: boolean;
  /** Currently active main view */
  currentView: ViewId;
  /** Modal visibility flags */
  settingsModalOpen: boolean;
  skillsModalOpen: boolean;
  routinesModalOpen: boolean;
  searchModalOpen: boolean;
  onboardingOpen: boolean;
  /** Shortcut conflict message (null = no conflict) */
  shortcutConflict: string | null;
  /** Unread inbox badge count */
  unreadInboxCount: number;
  /** Bumped on every `kanban-changed` event so the board can refetch */
  kanbanRevision: number;
  /** Voice session overlay (talk → hear loop with intensity circle + transcript) */
  voiceSessionOpen: boolean;
}

interface UiActions {
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setCurrentView: (view: ViewId) => void;
  setSettingsModalOpen: (open: boolean) => void;
  setSkillsModalOpen: (open: boolean) => void;
  setRoutinesModalOpen: (open: boolean) => void;
  setSearchModalOpen: (open: boolean) => void;
  setOnboardingOpen: (open: boolean) => void;
  setShortcutConflict: (conflict: string | null) => void;
  setUnreadInboxCount: (count: number) => void;
  bumpKanbanRevision: () => void;
  setVoiceSessionOpen: (open: boolean) => void;
}

export const useUiStore = create<UiState & UiActions>()((set) => ({
  // State
  sidebarOpen: false,
  currentView: "chat",
  settingsModalOpen: false,
  skillsModalOpen: false,
  routinesModalOpen: false,
  searchModalOpen: false,
  onboardingOpen: false,
  shortcutConflict: null,
  unreadInboxCount: 0,
  kanbanRevision: 0,
  voiceSessionOpen: false,

  // Actions
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setCurrentView: (view) => set({ currentView: view }),
  setSettingsModalOpen: (open) => set({ settingsModalOpen: open }),
  setSkillsModalOpen: (open) => set({ skillsModalOpen: open }),
  setRoutinesModalOpen: (open) => set({ routinesModalOpen: open }),
  setSearchModalOpen: (open) => set({ searchModalOpen: open }),
  setOnboardingOpen: (open) => set({ onboardingOpen: open }),
  setShortcutConflict: (conflict) => set({ shortcutConflict: conflict }),
  setUnreadInboxCount: (count) => set({ unreadInboxCount: count }),
  bumpKanbanRevision: () => set((s) => ({ kanbanRevision: s.kanbanRevision + 1 })),
  setVoiceSessionOpen: (open) => set({ voiceSessionOpen: open }),
}));
