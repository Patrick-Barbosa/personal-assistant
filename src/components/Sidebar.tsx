import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  SquarePen,
  MessageSquare,
  Search,
  PanelLeft,
  PanelLeftClose,
  Network,
  Sun,
  Moon,
  Inbox,
  Sparkles,
  Clock,
  SquareKanban,
} from "lucide-react";
import { CopernicoSun } from "./icons/CopernicoSun";
import { CopernicoWordmark } from "./icons/CopernicoWordmark";
import { Session } from "../types";
import { DeleteConfirmModal } from "./DeleteConfirmModal";
import { SidebarSessionItem } from "./SidebarSessionItem";
import { groupSessionsByDate, SessionDateGroup } from "../utils/dateGrouping";
import { ScrollArea } from "./ui/scroll-area";
import { Tooltip } from "./ui/tooltip";

interface SidebarProps {
  sessions: Session[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onRenameSession: (id: string, newTitle: string) => void;
  onDeleteSession: (id: string) => void;
  isOpen: boolean;
  onToggleOpen: () => void;
  onOpenSearch: () => void;
  currentView: "chat" | "graph" | "inbox" | "kanban";
  onChangeView: (view: "chat" | "graph" | "inbox" | "kanban") => void;
  unreadInboxCount?: number;
  onOpenSkills?: () => void;
  onOpenRoutines?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onRenameSession,
  onDeleteSession,
  isOpen,
  onToggleOpen,
  onOpenSearch,
  currentView,
  onChangeView,
  unreadInboxCount = 0,
  onOpenSkills,
  onOpenRoutines,
}) => {
  const [sessionToDelete, setSessionToDelete] = useState<Session | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("copernico-theme") as "dark" | "light") || "dark";
    }
    return "dark";
  });

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("copernico-theme", next);
    if (next === "light") {
      document.documentElement.classList.add("light");
      document.documentElement.classList.remove("dark");
    } else {
      document.documentElement.classList.add("dark");
      document.documentElement.classList.remove("light");
    }
    window.dispatchEvent(new CustomEvent("copernico-theme-changed", { detail: next }));
  };

  const grouped = groupSessionsByDate(sessions);
  const groupKeys: SessionDateGroup[] = ["Hoje", "Ontem", "Esta Semana", "Anteriores"];

  return (
    <>
      {/* Collapsed Rail (Minimal 48px bar) */}
      {!isOpen && (
        <motion.aside
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.15 }}
          className="w-12 h-full bg-[var(--bg-app)] border-r border-[var(--border-subtle)]/80 flex flex-col items-center py-3 gap-2 z-20 shrink-0 select-none"
        >
          <div className="p-1 mb-1 flex items-center justify-center" title="Copernico">
            <CopernicoSun size={26} />
          </div>

          <Tooltip content="Abrir barra lateral" side="right">
            <button
              type="button"
              aria-label="Abrir barra lateral"
              onClick={onToggleOpen}
              className="p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded-xl transition-all"
            >
              <PanelLeft size={16} />
            </button>
          </Tooltip>

          <Tooltip content="Novo chat" side="right">
            <button
              type="button"
              aria-label="Novo chat"
              onClick={onNewSession}
              className="p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded-xl transition-all"
            >
              <SquarePen size={16} />
            </button>
          </Tooltip>

          <Tooltip content="Buscar notas (Ctrl+K)" side="right">
            <button
              type="button"
              aria-label="Buscar notas"
              onClick={onOpenSearch}
              className="p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded-xl transition-all"
            >
              <Search size={16} />
            </button>
          </Tooltip>

          <Tooltip content={currentView === "graph" ? "Voltar ao Chat" : "Grafo de Notas"} side="right">
            <button
              type="button"
              aria-label={currentView === "graph" ? "Voltar ao chat" : "Abrir grafo de notas"}
              aria-pressed={currentView === "graph"}
              onClick={() => onChangeView(currentView === "graph" ? "chat" : "graph")}
              className={`p-2 rounded-xl transition-all ${
                currentView === "graph"
                  ? "bg-amber-500/15 text-[var(--text-accent)] border border-amber-500/30"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
              }`}
            >
              <Network size={16} />
            </button>
          </Tooltip>

          <Tooltip content={`Inbox ${unreadInboxCount ? `(${unreadInboxCount})` : ""}`} side="right">
            <button
              type="button"
              aria-label="Abrir inbox"
              aria-pressed={currentView === "inbox"}
              onClick={() => onChangeView("inbox")}
              className={`p-2 rounded-xl transition-all relative ${
                currentView === "inbox"
                  ? "bg-amber-500/15 text-[var(--text-accent)] border border-amber-500/30"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
              }`}
            >
              <Inbox size={16} />
              {unreadInboxCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-amber-500 text-[#241a05] font-bold text-[8px] flex items-center justify-center shadow-sm">
                  {unreadInboxCount > 9 ? "9+" : unreadInboxCount}
                </span>
              )}
            </button>
          </Tooltip>

          {onOpenSkills && (
            <Tooltip content="Hub de Skills" side="right">
              <button
                type="button"
                aria-label="Abrir hub de skills"
                onClick={onOpenSkills}
                className="p-2 text-[var(--text-muted)] hover:text-[var(--text-accent)] hover:bg-[var(--bg-hover)] rounded-xl transition-all"
              >
                <Sparkles size={16} />
              </button>
            </Tooltip>
          )}

          {onOpenRoutines && (
            <Tooltip content="Rotinas Agendadas" side="right">
              <button
                type="button"
                aria-label="Abrir rotinas agendadas"
                onClick={onOpenRoutines}
                className="p-2 text-[var(--text-muted)] hover:text-[var(--text-accent)] hover:bg-[var(--bg-hover)] rounded-xl transition-all"
              >
                <Clock size={16} />
              </button>
            </Tooltip>
          )}

          <Tooltip content="Quadro Semanal" side="right">
            <button
              type="button"
              aria-label="Abrir quadro semanal"
              aria-pressed={currentView === "kanban"}
              onClick={() => onChangeView("kanban")}
              className={`p-2 rounded-xl transition-all ${
                currentView === "kanban"
                  ? "bg-amber-500/15 text-[var(--text-accent)] border border-amber-500/30"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
              }`}
            >
              <SquareKanban size={16} />
            </button>
          </Tooltip>

          <div className="mt-auto">
            <Tooltip content={theme === "dark" ? "Modo Claro" : "Modo Escuro"} side="right">
              <button
                type="button"
                aria-label={theme === "dark" ? "Ativar modo claro" : "Ativar modo escuro"}
                onClick={toggleTheme}
                className="p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded-xl transition-all"
              >
                {theme === "dark" ? (
                  <Sun size={16} className="text-[var(--text-accent)]" />
                ) : (
                  <Moon size={16} className="text-[var(--text-accent)]" />
                )}
              </button>
            </Tooltip>
          </div>
        </motion.aside>
      )}

      {/* Expanded Sidebar Drawer */}
      <AnimatePresence>
        {isOpen && (
          <motion.aside
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 250, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="h-full bg-[var(--bg-app)] border-r border-[var(--border-subtle)]/80 flex flex-col z-30 shrink-0 select-none overflow-hidden"
          >
            {/* Header */}
            <div className="h-12 px-3 border-b border-[var(--border-subtle)]/80 flex items-center justify-between shrink-0">
              <CopernicoWordmark height={26} />
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  aria-label="Buscar notas"
                  onClick={onOpenSearch}
                  className="p-1.5 hover:bg-[var(--bg-hover)] rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                  title="Buscar Notas"
                >
                  <Search size={15} />
                </button>
                <button
                  type="button"
                  aria-label="Fechar barra lateral"
                  onClick={onToggleOpen}
                  className="p-1.5 hover:bg-[var(--bg-hover)] rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                  title="Fechar barra lateral"
                >
                  <PanelLeftClose size={15} />
                </button>
              </div>
            </div>

            {/* Actions Bar */}
            <div className="p-2.5 space-y-2 shrink-0 border-b border-[var(--border-subtle)]/80">
              <button
                type="button"
                onClick={() => {
                  onChangeView("chat");
                  onNewSession();
                }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium text-[var(--text-secondary)] bg-[var(--bg-card)] hover:bg-[var(--bg-card)] border border-[var(--border-subtle)] hover:border-amber-500/30 transition-all shadow-sm"
              >
                <SquarePen size={14} className="text-[var(--text-accent)]" />
                <span>Novo chat</span>
              </button>

              {/* View Buttons */}
              <div className="grid grid-cols-2 gap-1">
                <button
                  type="button"
                  aria-pressed={currentView === "chat"}
                  onClick={() => onChangeView("chat")}
                  className={`flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                    currentView === "chat"
                      ? "bg-amber-500/15 text-[var(--text-accent)] border border-amber-500/30 font-semibold"
                      : "text-[var(--text-muted)] hover:bg-[var(--bg-card)] hover:text-[var(--text-secondary)]"
                  }`}
                >
                  <MessageSquare size={12} />
                  <span>Chat</span>
                </button>
                <button
                  type="button"
                  aria-pressed={currentView === "graph"}
                  onClick={() => onChangeView("graph")}
                  className={`flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                    currentView === "graph"
                      ? "bg-amber-500/15 text-[var(--text-accent)] border border-amber-500/30 font-semibold"
                      : "text-[var(--text-muted)] hover:bg-[var(--bg-card)] hover:text-[var(--text-secondary)]"
                  }`}
                >
                  <Network size={12} />
                  <span>Grafo</span>
                </button>
                <button
                  type="button"
                  aria-pressed={currentView === "inbox"}
                  onClick={() => onChangeView("inbox")}
                  className={`flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-medium transition-all relative ${
                    currentView === "inbox"
                      ? "bg-amber-500/15 text-[var(--text-accent)] border border-amber-500/30 font-semibold"
                      : "text-[var(--text-muted)] hover:bg-[var(--bg-card)] hover:text-[var(--text-secondary)]"
                  }`}
                >
                  <Inbox size={12} />
                  <span>Inbox</span>
                  {unreadInboxCount > 0 && (
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                  )}
                </button>
                <button
                  type="button"
                  aria-pressed={currentView === "kanban"}
                  onClick={() => onChangeView("kanban")}
                  className={`flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                    currentView === "kanban"
                      ? "bg-amber-500/15 text-[var(--text-accent)] border border-amber-500/30 font-semibold"
                      : "text-[var(--text-muted)] hover:bg-[var(--bg-card)] hover:text-[var(--text-secondary)]"
                  }`}
                >
                  <SquareKanban size={12} />
                  <span>Quadro</span>
                </button>
              </div>
            </div>

            {/* Sessions ScrollArea */}
            <ScrollArea className="flex-1 p-2 space-y-3">
              {groupKeys.map((group) => {
                const items = grouped[group];
                if (items.length === 0) return null;
                return (
                  <div key={group} className="space-y-1">
                    <span className="text-[10px] font-semibold tracking-wider text-[var(--text-muted)] uppercase px-2">
                      {group}
                    </span>
                    <div className="space-y-0.5 mt-0.5">
                      {items.map((session) => (
                        <SidebarSessionItem
                          key={session.id}
                          session={session}
                          isActive={currentView === "chat" && session.id === activeSessionId}
                          onSelect={(id) => {
                            onChangeView("chat");
                            onSelectSession(id);
                          }}
                          onRename={onRenameSession}
                          onRequestDelete={setSessionToDelete}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </ScrollArea>

            {/* Footer */}
            <div className="p-2 border-t border-[var(--border-subtle)]/80 flex items-center justify-between text-xs text-[var(--text-muted)]">
              <span className="text-[11px] text-[var(--text-muted)] font-mono">v0.1.0</span>
              <button
                type="button"
                aria-label={theme === "dark" ? "Ativar modo claro" : "Ativar modo escuro"}
                onClick={toggleTheme}
                className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)] transition-colors"
              >
                {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
              </button>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <DeleteConfirmModal
        isOpen={!!sessionToDelete}
        sessionTitle={sessionToDelete?.title || sessionToDelete?.titulo || "Conversa"}
        onConfirm={() => {
          if (sessionToDelete) {
            onDeleteSession(sessionToDelete.id);
            setSessionToDelete(null);
          }
        }}
        onCancel={() => setSessionToDelete(null)}
      />
    </>
  );
};
