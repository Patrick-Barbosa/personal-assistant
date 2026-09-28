import React, { useState, useEffect } from "react";
import {
  X,
  Radio,
  Volume2,
  Bot,
  FolderOpen,
  Boxes,
  KeyRound,
} from "lucide-react";
import { SettingsWakewordTab } from "./settings/SettingsWakewordTab";
import { SettingsTtsTab } from "./settings/SettingsTtsTab";
import { SettingsPromptsTab } from "./settings/SettingsPromptsTab";
import { SettingsBrainTab } from "./settings/SettingsBrainTab";
import { SettingsPluginsTab } from "./settings/SettingsPluginsTab";
import { SettingsApiKeysTab } from "./settings/SettingsApiKeysTab";
import { api } from "../api";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenSession?: (sessionId: string) => void;
  onOpenSkills?: () => void;
  onOpenRoutines?: () => void;
}

type SettingsTab = "apikeys" | "wakeword" | "tts" | "prompts" | "brain" | "plugins";

export const SECTIONS = [
  {
    id: "apikeys" as const,
    title: "Chaves de API",
    label: "DeepSeek & Groq",
    icon: KeyRound,
  },
  {
    id: "wakeword" as const,
    title: "Wake Word",
    label: "Detecção e Calibração",
    icon: Radio,
  },
  {
    id: "tts" as const,
    title: "Voz & TTS",
    label: "Síntese de Fala Neural",
    icon: Volume2,
  },
  {
    id: "prompts" as const,
    title: "System Prompts",
    label: "Diretrizes e Persona",
    icon: Bot,
  },
  {
    id: "brain" as const,
    title: "Cofres & Vetores",
    label: "Base de Conhecimento",
    icon: FolderOpen,
  },
  {
    id: "plugins" as const,
    title: "Extensões & MCP",
    label: "Ferramentas e Temas",
    icon: Boxes,
  },
];

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>("wakeword");

  useEffect(() => {
    if (!isOpen) return;
    // Pause automatic wake detection while calibrating settings
    api.setWakeDetectionActive(false);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      api.setWakeDetectionActive(true);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 select-none">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
        onClick={onClose}
      />

      {/* Dialog Body */}
      <div className="relative z-50 w-full max-w-4xl h-[85vh] max-h-[720px] rounded-2xl bg-[var(--bg-app)] border border-[var(--border-subtle)] shadow-2xl overflow-hidden flex flex-col sm:flex-row text-[var(--text-primary)] animate-in fade-in-0 zoom-in-95 duration-150">
        {/* Left Tabs Column */}
        <div className="w-full sm:w-56 border-b sm:border-b-0 sm:border-r border-[var(--border-subtle)] bg-[var(--bg-app)]/60 p-3 flex flex-col justify-between shrink-0">
          <div className="space-y-1">
            <div className="px-3 py-2 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
              Configurações
            </div>
            {SECTIONS.map((sec) => {
              const Icon = sec.icon;
              const isActive = activeTab === sec.id;
              return (
                <button
                  key={sec.id}
                  type="button"
                  onClick={() => setActiveTab(sec.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs text-left transition-all cursor-pointer ${
                    isActive
                      ? "bg-amber-500/15 text-amber-300 font-semibold border border-amber-500/30 shadow-xs"
                      : "text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-card)] border border-transparent"
                  }`}
                >
                  <Icon
                    size={15}
                    className={isActive ? "text-amber-400" : "text-[var(--text-muted)]"}
                  />
                  <div>
                    <div className="truncate font-medium">{sec.title}</div>
                    <div className="text-[10px] text-[var(--text-muted)] truncate">
                      {sec.label}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="hidden sm:block px-3 py-2 text-[10px] text-[var(--text-muted)] font-mono border-t border-[var(--border-subtle)]">
            Copernico v0.1.0 (Local-First)
          </div>
        </div>

        {/* Right Content Area */}
        <div className="flex-1 flex flex-col overflow-hidden bg-[var(--bg-card)]/30">
          {/* Header with Close */}
          <div className="h-12 px-6 border-b border-[var(--border-subtle)] flex items-center justify-between shrink-0">
            <span className="text-xs font-semibold text-[var(--text-secondary)]">
              {SECTIONS.find((s) => s.id === activeTab)?.title}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors"
              title="Fechar (Esc)"
            >
              <X size={15} />
            </button>
          </div>

          {/* Tab View */}
          <div className="flex-1 overflow-y-auto p-6">
            {activeTab === "apikeys" && <SettingsApiKeysTab />}
            {activeTab === "wakeword" && <SettingsWakewordTab />}
            {activeTab === "tts" && <SettingsTtsTab />}
            {activeTab === "prompts" && <SettingsPromptsTab />}
            {activeTab === "brain" && <SettingsBrainTab />}
            {activeTab === "plugins" && <SettingsPluginsTab />}
          </div>
        </div>
      </div>
    </div>
  );
};
