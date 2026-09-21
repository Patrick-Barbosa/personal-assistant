import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  SquarePen,
  MessageSquare,
  Trash2,
  Edit2,
  Check,
  X,
  Search,
  PanelLeft,
  PanelLeftClose,
  Network,
  Sun,
  Moon,
  Inbox,
  Sparkles,
  Clock,
} from "lucide-react";
import { CopernicoSun } from "./icons/CopernicoSun";
import { CopernicoWordmark } from "./icons/CopernicoWordmark";
import { Session } from "../types";
import { DeleteConfirmModal } from "./DeleteConfirmModal";

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
  currentView: "chat" | "graph" | "inbox";
  onChangeView: (view: "chat" | "graph" | "inbox") => void;
  unreadInboxCount?: number;
  onOpenSkills?: () => void;
  onOpenRoutines?: () => void;
}

function groupSessionsByDate(sessions: Session[]) {
  const groups: { [key: string]: Session[] } = {
    Hoje: [],
    Ontem: [],
    "Esta Semana": [],
    Anteriores: [],
  };

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
  const startOfWeek = startOfToday - 7 * 24 * 60 * 60 * 1000;

  for (const session of sessions) {
    const sessionTime = new Date(session.updated_at || session.created_at).getTime();
    if (sessionTime >= startOfToday) {
      groups["Hoje"].push(session);
    } else if (sessionTime >= startOfYesterday) {
      groups["Ontem"].push(session);
    } else if (sessionTime >= startOfWeek) {
      groups["Esta Semana"].push(session);
    } else {
      groups["Anteriores"].push(session);
    }
  }

  return groups;
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [sessionToDelete, setSessionToDelete] = useState<Session | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("copernico-theme");
      return saved === "light" ? "light" : "dark";
    }
    return "dark";
  });

  const toggleTheme = () => {
    const newTheme = theme === "dark" ? "light" : "dark";
    setTheme(newTheme);
    try {
      localStorage.setItem("copernico-theme", newTheme);
      if (newTheme === "light") {
        document.documentElement.classList.add("light");
        document.documentElement.classList.remove("dark");
      } else {
        document.documentElement.classList.add("dark");
        document.documentElement.classList.remove("light");
      }
      window.dispatchEvent(new CustomEvent("copernico-theme-changed", { detail: newTheme }));
    } catch (e) {
      console.error("Failed to toggle theme:", e);
    }
  };

  const handleStartEdit = (session: Session, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(session.id);
    setEditTitle(session.title || session.titulo || "Conversa");
  };

  const handleSaveEdit = (id: string, e: React.MouseEvent | React.FormEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    if (editTitle.trim()) {
      onRenameSession(id, editTitle.trim());
    }
    setEditingId(null);
  };

  const handleCancelEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(null);
  };

  const handleDeleteClick = (session: Session, e: React.MouseEvent) => {
    e.stopPropagation();
    setSessionToDelete(session);
  };

  const handleConfirmDelete = () => {
    if (sessionToDelete) {
      onDeleteSession(sessionToDelete.id);
      setSessionToDelete(null);
    }
  };

  const grouped = groupSessionsByDate(sessions);

  return (
    <>
      {/* Collapsed Rail (ChatGPT style left icon bar) */}
      {!isOpen && (
        <motion.aside
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.15 }}
          className="w-12 h-full bg-[var(--bg-app)] border-r border-[var(--border-subtle)] flex flex-col items-center py-3 gap-2 z-20 shrink-0 select-none"
        >
          {/* Logo Heliocentrismo (Escala 1:1) - 100% transparent background */}
          <div className="p-0.5 mb-1 flex items-center justify-center bg-transparent" title="Copernico">
            <CopernicoSun size={32} className="drop-shadow-[0_0_8px_rgba(245,158,11,0.35)]" />
          </div>

          {/* Toggle Sidebar Button with tooltip */}
          <div className="relative group">
            <button
              type="button"
              onClick={onToggleOpen}
              className="p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/5 rounded-xl transition-all"
            >
              <PanelLeft size={18} />
            </button>
            <span className="absolute left-full ml-2 top-1/2 -translate-y-1/2 px-2 py-1 bg-[var(--bg-card)] text-[11px] text-[var(--text-primary)] rounded-md whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity shadow-lg z-50 border border-[var(--border-subtle)]">
              Abrir barra lateral
            </span>
          </div>

          {/* New Chat Button */}
          <div className="relative group">
            <button
              type="button"
              onClick={onNewSession}
              className="p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/5 rounded-xl transition-all"
            >
              <SquarePen size={18} />
            </button>
            <span className="absolute left-full ml-2 top-1/2 -translate-y-1/2 px-2 py-1 bg-[var(--bg-card)] text-[11px] text-[var(--text-primary)] rounded-md whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity shadow-lg z-50 border border-[var(--border-subtle)]">
              Novo chat
            </span>
          </div>

          {/* Search Notes Button */}
          <div className="relative group">
            <button
              type="button"
              onClick={onOpenSearch}
              className="p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/5 rounded-xl transition-all"
            >
              <Search size={18} />
            </button>
            <span className="absolute left-full ml-2 top-1/2 -translate-y-1/2 px-2 py-1 bg-[var(--bg-card)] text-[11px] text-[var(--text-primary)] rounded-md whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity shadow-lg z-50 border border-[var(--border-subtle)]">
              Buscar notas
            </span>
          </div>

          {/* Graph View Toggle */}
          <div className="relative group">
            <button
              type="button"
              onClick={() => onChangeView(currentView === "graph" ? "chat" : "graph")}
              className={`p-2 rounded-xl transition-all ${
                currentView === "graph"
                  ? "bg-amber-500/20 text-amber-500 dark:text-amber-400 border border-amber-500/40"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/5"
              }`}
            >
              <Network size={18} />
            </button>
            <span className="absolute left-full ml-2 top-1/2 -translate-y-1/2 px-2 py-1 bg-[var(--bg-card)] text-[11px] text-[var(--text-primary)] rounded-md whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity shadow-lg z-50 border border-[var(--border-subtle)]">
              {currentView === "graph" ? "Voltar ao Chat" : "Grafo de Notas"}
            </span>
          </div>

          {/* Inbox View Toggle */}
          <div className="relative group">
            <button
              type="button"
              onClick={() => onChangeView("inbox")}
              className={`p-2 rounded-xl transition-all relative ${
                currentView === "inbox"
                  ? "bg-amber-500/20 text-amber-500 dark:text-amber-400 border border-amber-500/40"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/5"
              }`}
            >
              <Inbox size={18} />
              {unreadInboxCount !== undefined && unreadInboxCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-amber-500 text-neutral-950 font-bold text-[9px] flex items-center justify-center animate-pulse shadow-sm">
                  {unreadInboxCount > 9 ? "9+" : unreadInboxCount}
                </span>
              )}
            </button>
            <span className="absolute left-full ml-2 top-1/2 -translate-y-1/2 px-2 py-1 bg-[var(--bg-card)] text-[11px] text-[var(--text-primary)] rounded-md whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity shadow-lg z-50 border border-[var(--border-subtle)]">
              Inbox do Agente {unreadInboxCount ? `(${unreadInboxCount})` : ""}
            </span>
          </div>

          {/* Skills Hub Button */}
          {onOpenSkills && (
            <div className="relative group">
              <button
                type="button"
                onClick={onOpenSkills}
                className="p-2 text-[var(--text-muted)] hover:text-amber-500 hover:bg-black/5 dark:hover:bg-white/5 rounded-xl transition-all"
              >
                <Sparkles size={18} />
              </button>
              <span className="absolute left-full ml-2 top-1/2 -translate-y-1/2 px-2 py-1 bg-[var(--bg-card)] text-[11px] text-[var(--text-primary)] rounded-md whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity shadow-lg z-50 border border-[var(--border-subtle)]">
                Hub de Skills
              </span>
            </div>
          )}

          {/* Routines Scheduler Button */}
          {onOpenRoutines && (
            <div className="relative group">
              <button
                type="button"
                onClick={onOpenRoutines}
                className="p-2 text-[var(--text-muted)] hover:text-amber-500 hover:bg-black/5 dark:hover:bg-white/5 rounded-xl transition-all"
              >
                <Clock size={18} />
              </button>
              <span className="absolute left-full ml-2 top-1/2 -translate-y-1/2 px-2 py-1 bg-[var(--bg-card)] text-[11px] text-[var(--text-primary)] rounded-md whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity shadow-lg z-50 border border-[var(--border-subtle)]">
                Rotinas Agendadas (Cron)
              </span>
            </div>
          )}

          {/* Theme Switcher at Footer of Collapsed Rail */}
          <div className="mt-auto relative group">
            <button
              type="button"
              onClick={toggleTheme}
              className="p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/5 rounded-xl transition-all"
              title={theme === "dark" ? "Mudar para modo claro" : "Mudar para modo escuro"}
            >
              {theme === "dark" ? (
                <Sun size={18} className="text-amber-400 group-hover:rotate-45 transition-transform" />
              ) : (
                <Moon size={18} className="text-amber-600 group-hover:-rotate-12 transition-transform" />
              )}
            </button>
            <span className="absolute left-full ml-2 top-1/2 -translate-y-1/2 px-2 py-1 bg-[var(--bg-card)] text-[11px] text-[var(--text-primary)] rounded-md whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity shadow-lg z-50 border border-[var(--border-subtle)]">
              {theme === "dark" ? "Modo Claro" : "Modo Escuro"}
            </span>
          </div>
        </motion.aside>
      )}

      {/* Expanded Sidebar Drawer (ChatGPT full sidebar style) */}
      <AnimatePresence>
        {isOpen && (
          <motion.aside
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 260, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="h-full bg-[var(--bg-app)] backdrop-blur-2xl border-r border-[var(--border-subtle)] flex flex-col z-30 shrink-0 select-none overflow-hidden"
          >
            {/* Sidebar Top Header - Transparent background for sun logo fusion */}
            <div className="h-12 px-3 border-b border-[var(--border-subtle)] flex items-center justify-between shrink-0 bg-transparent">
              <div className="flex items-center gap-1">
                <CopernicoWordmark height={32} className="drop-shadow-[0_0_8px_rgba(245,158,11,0.3)]" />
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={onOpenSearch}
                  className="p-1.5 hover:bg-black/5 dark:hover:bg-white/10 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                  title="Buscar Notas (Ctrl+K)"
                >
                  <Search size={16} />
                </button>
                <button
                  type="button"
                  onClick={onToggleOpen}
                  className="p-1.5 hover:bg-black/5 dark:hover:bg-white/10 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                  title="Fechar barra lateral"
                >
                  <PanelLeftClose size={16} />
                </button>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="p-2 space-y-1 shrink-0 border-b border-[var(--border-subtle)]">
              {/* Novo Chat Button (Capsule style like ChatGPT) */}
              <button
                type="button"
                onClick={() => {
                  onChangeView("chat");
                  onNewSession();
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-[var(--text-primary)] bg-[var(--bg-card)] hover:bg-black/5 dark:hover:bg-white/5 border border-[var(--border-subtle)] hover:border-amber-500/40 transition-all shadow-sm group"
              >
                <SquarePen size={15} className="text-amber-500 group-hover:scale-110 transition-transform" />
                <span>Novo chat</span>
              </button>

              {/* View Switchers */}
              <div className="grid grid-cols-3 gap-1 pt-1">
                <button
                  type="button"
                  onClick={() => onChangeView("chat")}
                  className={`flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                    currentView === "chat"
                      ? "bg-amber-500/20 text-amber-500 dark:text-amber-400 border border-amber-500/40 font-semibold"
                      : "text-[var(--text-muted)] hover:bg-black/5 dark:hover:bg-white/5 hover:text-[var(--text-primary)]"
                  }`}
                >
                  <MessageSquare size={13} />
                  <span>Chat</span>
                </button>
                <button
                  type="button"
                  onClick={() => onChangeView("graph")}
                  className={`flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                    currentView === "graph"
                      ? "bg-amber-500/20 text-amber-500 dark:text-amber-400 border border-amber-500/40 font-semibold"
                      : "text-[var(--text-muted)] hover:bg-black/5 dark:hover:bg-white/5 hover:text-[var(--text-primary)]"
                  }`}
                >
                  <Network size={13} />
                  <span>Grafo</span>
                </button>
                <button
                  type="button"
                  onClick={() => onChangeView("inbox")}
                  className={`flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-medium transition-all relative ${
                    currentView === "inbox"
                      ? "bg-amber-500/20 text-amber-500 dark:text-amber-400 border border-amber-500/40 font-semibold"
                      : "text-[var(--text-muted)] hover:bg-black/5 dark:hover:bg-white/5 hover:text-[var(--text-primary)]"
                  }`}
                >
                  <Inbox size={13} />
                  <span>Inbox</span>
                  {unreadInboxCount !== undefined && unreadInboxCount > 0 && (
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                  )}
                </button>
              </div>

              {/* Skills & Rotinas Shortcuts */}
              {(onOpenSkills || onOpenRoutines) && (
                <div className="grid grid-cols-2 gap-1 pt-1 border-t border-[var(--border-subtle)]">
                  {onOpenSkills && (
                    <button
                      type="button"
                      onClick={onOpenSkills}
                      className="flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-medium text-[var(--text-muted)] hover:bg-black/5 dark:hover:bg-white/5 hover:text-amber-600 dark:hover:text-amber-400 transition-all"
                    >
                      <Sparkles size={13} className="text-amber-500" />
                      <span>Skills</span>
                    </button>
                  )}
                  {onOpenRoutines && (
                    <button
                      type="button"
                      onClick={onOpenRoutines}
                      className="flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-medium text-[var(--text-muted)] hover:bg-black/5 dark:hover:bg-white/5 hover:text-amber-600 dark:hover:text-amber-400 transition-all"
                    >
                      <Clock size={13} className="text-amber-500" />
                      <span>Rotinas</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Sessions Scrollable List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-3">
              {Object.entries(grouped).map(([groupTitle, groupSessions]) => {
                if (groupSessions.length === 0) return null;

                return (
                  <div key={groupTitle} className="space-y-0.5">
                    <h3 className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider px-2 py-1 opacity-75">
                      {groupTitle}
                    </h3>
                    {groupSessions.map((session) => {
                      const isActive = session.id === activeSessionId && currentView === "chat";
                      const isEditing = editingId === session.id;
                      const displayTitle = session.title || session.titulo || "Conversa sem título";

                      return (
                        <div
                          key={session.id}
                          onClick={() => {
                            onChangeView("chat");
                            onSelectSession(session.id);
                          }}
                          className={`group relative flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs cursor-pointer transition-all ${
                            isActive
                              ? "bg-[var(--bg-card)] text-[var(--text-primary)] font-medium shadow-sm border border-amber-500/40"
                              : "text-[var(--text-muted)] hover:bg-black/5 dark:hover:bg-white/5 hover:text-[var(--text-primary)]"
                          }`}
                        >
                          <MessageSquare size={13} className="shrink-0 opacity-60" />

                          {isEditing ? (
                            <div
                              className="flex items-center gap-1 flex-1 min-w-0"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <input
                                type="text"
                                value={editTitle}
                                onChange={(e) => setEditTitle(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") handleSaveEdit(session.id, e);
                                  if (e.key === "Escape") setEditingId(null);
                                }}
                                autoFocus
                                className="w-full bg-[var(--bg-input)] border border-amber-500 rounded px-1.5 py-0.5 text-xs text-[var(--text-primary)] focus:outline-none"
                              />
                              <button
                                type="button"
                                onClick={(e) => handleSaveEdit(session.id, e)}
                                className="p-1 hover:text-emerald-400 text-[var(--text-muted)]"
                                title="Salvar título"
                              >
                                <Check size={12} />
                              </button>
                              <button
                                type="button"
                                onClick={handleCancelEdit}
                                className="p-1 hover:text-rose-400 text-[var(--text-muted)]"
                                title="Cancelar"
                              >
                                <X size={12} />
                              </button>
                            </div>
                          ) : (
                            <>
                              <span className="truncate flex-1 text-[11px]">{displayTitle}</span>
                              <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                                <button
                                  type="button"
                                  onClick={(e) => handleStartEdit(session, e)}
                                  className="p-1 hover:text-[var(--text-primary)] text-[var(--text-muted)] transition-colors rounded hover:bg-black/10 dark:hover:bg-white/10"
                                  title="Renomear"
                                >
                                  <Edit2 size={11} />
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => handleDeleteClick(session, e)}
                                  className="p-1 hover:text-rose-400 text-[var(--text-muted)] transition-colors rounded hover:bg-black/10 dark:hover:bg-white/10"
                                  title="Excluir"
                                >
                                  <Trash2 size={11} />
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>

            {/* Sidebar Footer: Theme Toggle Switcher */}
            <div className="p-2 border-t border-[var(--border-subtle)] mt-auto shrink-0 bg-transparent">
              <button
                type="button"
                onClick={toggleTheme}
                className="w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/5 transition-all group"
                title={theme === "dark" ? "Mudar para modo claro" : "Mudar para modo escuro"}
              >
                <div className="flex items-center gap-2">
                  {theme === "dark" ? (
                    <Sun size={15} className="text-amber-400 group-hover:rotate-45 transition-transform" />
                  ) : (
                    <Moon size={15} className="text-amber-600 group-hover:-rotate-12 transition-transform" />
                  )}
                  <span>{theme === "dark" ? "Modo Claro" : "Modo Escuro"}</span>
                </div>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/5 border border-[var(--border-subtle)]">
                  {theme === "dark" ? "Escuro" : "Claro"}
                </span>
              </button>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal (custom, no browser confirm) */}
      <DeleteConfirmModal
        isOpen={sessionToDelete !== null}
        sessionTitle={sessionToDelete?.title || sessionToDelete?.titulo || "esta conversa"}
        onConfirm={handleConfirmDelete}
        onCancel={() => setSessionToDelete(null)}
      />
    </>
  );
};
