import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CalendarDays,
  Check,
  CheckCircle2,
  FileText,
  Flame,
  Loader2,
  LockKeyhole,
  MoreHorizontal,
  RotateCcw,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { Habit, KanbanColumn, KanbanTask, TaskColumn, TaskLinks } from "../types";
import { formatShortDate } from "../utils/isoWeek";
import { isTaskOverdue, localDateKey } from "../utils/kanbanFilters";

interface KanbanCardProps {
  task: KanbanTask;
  columns: KanbanColumn[];
  readOnly: boolean;
  /** Vínculos resolvidos do board (notas relacionadas + entities). */
  links?: TaskLinks;
  /** Hábitos do board (cor + streak do card quando `task_kind='habit'`). */
  habits?: Habit[];
  isDragging?: boolean;
  isPending?: boolean;
  mutationsDisabled?: boolean;
  today?: string;
  canReorderUp?: boolean;
  canReorderDown?: boolean;
  onDragStart: (task: KanbanTask) => void;
  onDragEnd: () => void;
  onMove: (task: KanbanTask, column: TaskColumn, index?: number) => void;
  onReorder?: (task: KanbanTask, direction: -1 | 1) => void;
  onOpen: (task: KanbanTask) => void;
  onRequestDelete: (task: KanbanTask) => void;
  onMenuOpenChange?: (open: boolean) => void;
  /** Remove um chip: slug de caminho (nota) ou `entity:<id>`. */
  onUnlink: (task: KanbanTask, slug: string) => void;
}

type TaskLinkItem = {
  title: string;
  slug: string;
  kind: "note" | "entity";
};

type MenuPosition = { top: number; left: number };

// Compartilhado entre cards: o clique que fecha o menu de A não pode abrir B.
let suppressCardOpenUntil = 0;

function linkItems(links?: TaskLinks): TaskLinkItem[] {
  return [
    ...(links?.notes ?? []).map((path) => ({
      title: path.replace(/\.md$/i, "").split("/").pop() ?? path,
      slug: path,
      kind: "note" as const,
    })),
    ...(links?.entities ?? []).map((entity) => ({
      title: entity.titulo,
      slug: `entity:${entity.id}`,
      kind: "entity" as const,
    })),
  ];
}

/** Card do quadro: contexto compacto, ação rápida, menu seguro e foco previsível. */
export const KanbanCard: React.FC<KanbanCardProps> = ({
  task,
  columns,
  readOnly,
  links,
  habits,
  isDragging = false,
  isPending = false,
  mutationsDisabled = false,
  today = localDateKey(),
  canReorderUp = false,
  canReorderDown = false,
  onDragStart,
  onDragEnd,
  onMove,
  onReorder,
  onOpen,
  onRequestDelete,
  onMenuOpenChange,
  onUnlink,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const suppressCardOpenRef = useRef(false);

  const isHabit = task.task_kind === "habit";
  const habit = isHabit ? habits?.find((h) => h.id === task.habit_id) ?? null : null;
  const otherColumns = columns.filter((column) => column.id !== task.task_column);
  const overdue = isTaskOverdue(task, today);
  const done = task.task_column === "done";
  const controlsDisabled = readOnly || mutationsDisabled || isPending;
  const taskLinks = linkItems(links);
  const visibleLinks = taskLinks.slice(0, 2);
  const hiddenLinkCount = Math.max(0, taskLinks.length - visibleLinks.length);

  const closeMenu = useCallback((restoreFocus = false) => {
    onMenuOpenChange?.(false);
    setMenuOpen(false);
    setMenuPosition(null);
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, [onMenuOpenChange]);

  useEffect(() => {
    if (controlsDisabled) closeMenu(false);
  }, [closeMenu, controlsDisabled]);

  useEffect(() => {
    return () => onMenuOpenChange?.(false);
  }, [onMenuOpenChange]);

  const placeMenu = useCallback((trigger: HTMLButtonElement) => {
    triggerRef.current = trigger;
    const rect = trigger.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
    const menuWidth = 224;
    const left = Math.min(
      Math.max(8, rect.right - menuWidth),
      Math.max(8, viewportWidth - menuWidth - 8)
    );
    const estimatedHeight = 116 + otherColumns.length * 34 + (onReorder ? 76 : 0) + (isHabit ? 0 : 42);
    const top = Math.min(
      Math.max(8, rect.bottom + 6),
      Math.max(8, viewportHeight - estimatedHeight - 8)
    );
    setMenuPosition({ top, left });
    onMenuOpenChange?.(true);
    setMenuOpen(true);
    window.requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    });
  }, [isHabit, onMenuOpenChange, onReorder, otherColumns.length]);

  useLayoutEffect(() => {
    if (!menuOpen || !menuPosition || !menuRef.current || !triggerRef.current) return;
    const menu = menuRef.current;
    const trigger = triggerRef.current.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
    const width = menu.offsetWidth || 224;
    const height = menu.offsetHeight || 240;
    const left = Math.min(Math.max(8, trigger.right - width), Math.max(8, viewportWidth - width - 8));
    const top = Math.min(Math.max(8, trigger.bottom + 6), Math.max(8, viewportHeight - height - 8));
    if (left !== menuPosition.left || top !== menuPosition.top) setMenuPosition({ top, left });
  }, [menuOpen, menuPosition, otherColumns.length, isHabit, onReorder]);

  useEffect(() => {
    if (!menuOpen) return;
    const reposition = () => {
      const trigger = triggerRef.current;
      const menu = menuRef.current;
      if (!trigger || !menu) return;
      const rect = trigger.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
      const width = menu.offsetWidth || 224;
      const height = menu.offsetHeight || 240;
      setMenuPosition({
        top: Math.min(Math.max(8, rect.bottom + 6), Math.max(8, viewportHeight - height - 8)),
        left: Math.min(Math.max(8, rect.right - width), Math.max(8, viewportWidth - width - 8)),
      });
    };
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      const elementTarget = target instanceof Element ? target : null;
      const clickedCard = Boolean(elementTarget?.closest("[data-task-id]"));
      suppressCardOpenRef.current = clickedCard;
      if (clickedCard) suppressCardOpenUntil = Date.now() + 120;
      closeMenu(false);
      if (clickedCard) {
        window.setTimeout(() => {
          suppressCardOpenRef.current = false;
        }, 0);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const items = Array.from(
        menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? []
      );
      const current = document.activeElement instanceof HTMLButtonElement ? items.indexOf(document.activeElement) : -1;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeMenu(true);
        return;
      }
      if (items.length === 0) return;
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : event.key === "ArrowDown"
                ? (current + 1 + items.length) % items.length
                : (current - 1 + items.length) % items.length;
        items[next]?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [closeMenu, menuOpen]);

  const handleOpen = () => {
    if (suppressCardOpenRef.current || Date.now() < suppressCardOpenUntil) {
      suppressCardOpenRef.current = false;
      suppressCardOpenUntil = 0;
      return;
    }
    onOpen(task);
  };

  const handleCardKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      if (controlsDisabled) return;
      onMove(task, done ? "todo" : "done");
      return;
    }
    if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const cards = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-kanban-card-open]"));
    const current = cards.indexOf(event.currentTarget);
    if (current < 0 || cards.length === 0) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? cards.length - 1
          : event.key === "ArrowDown" || event.key === "ArrowRight"
            ? Math.min(cards.length - 1, current + 1)
            : Math.max(0, current - 1);
    cards[next]?.focus();
  };

  const handleComplete = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (controlsDisabled) return;
    onMove(task, done ? "todo" : "done");
  };

  const statusLabel = done
    ? isHabit
      ? "Concluída · métrica registrada"
      : "Concluída"
    : overdue
      ? "Atrasada"
      : task.task_column === "doing"
        ? "Em progresso"
        : "A fazer";
  const cardState = isPending
    ? "border-amber-400/55 bg-[var(--bg-card)]/90"
    : isDragging
      ? "border-amber-400/30 bg-[var(--bg-card)]/50"
      : done
        ? "border-emerald-500/30 bg-emerald-500/[0.045]"
        : overdue
          ? "border-red-500/30 bg-red-500/[0.035]"
          : readOnly
            ? "border-[var(--border-subtle)] bg-[var(--bg-card)]/75"
            : "border-[var(--border-subtle)] bg-[var(--bg-card)] hover:border-amber-500/40";

  return (
    <>
      <article
        data-task-id={task.id}
        data-kanban-card
        id={`kanban-task-${task.id}`}
        draggable={!controlsDisabled}
        tabIndex={-1}
        role="group"
        aria-roledescription="task card"
        aria-label={`${task.titulo}. ${statusLabel}.`}
        aria-busy={isPending || mutationsDisabled}
        aria-grabbed={isDragging}
        onDragStart={(event) => {
          if (controlsDisabled) {
            event.preventDefault();
            return;
          }
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", task.id);
          onDragStart(task);
        }}
        onDragEnd={onDragEnd}
        style={habit ? ({ "--habit-color": habit.cor } as React.CSSProperties) : undefined}
        className={`kanban-card group relative isolate rounded-xl border px-3 py-2.5 transition-[border-color,background-color,opacity,box-shadow] duration-150 ${controlsDisabled ? "" : "cursor-grab active:cursor-grabbing"} ${cardState} ${
          isDragging ? "kanban-card-dragging opacity-40" : ""
        } ${isPending ? "kanban-card-pending" : ""}`}
      >
        <button
          id={`kanban-task-${task.id}-open`}
          data-kanban-card-open
          type="button"
          onClick={handleOpen}
          onKeyDown={handleCardKeyDown}
          aria-label={`Abrir tarefa ${task.titulo}. ${statusLabel}.${
            readOnly
              ? " Tarefa somente leitura."
              : mutationsDisabled
                ? " Sincronizando o quadro; aguarde para concluir."
                : ` Use Espaço para ${done ? "reabrir" : "concluir"}.`
          }`}
          aria-keyshortcuts={controlsDisabled ? undefined : "Space ArrowUp ArrowDown ArrowLeft ArrowRight"}
          className="absolute inset-0 z-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-board)]"
        />
        {habit && (
          <span
            aria-hidden="true"
            className="absolute inset-y-2 left-0 w-0.5 rounded-full"
            style={{ background: "var(--habit-color)" }}
          />
        )}

        <div className="pointer-events-none relative z-10 flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p
              className={`kanban-card-title text-[13px] leading-snug text-[var(--text-primary)] ${
                done ? "text-[var(--text-secondary)] line-through decoration-[var(--state-success)]/70" : ""
              }`}
              title={task.titulo}
            >
              {task.titulo}
            </p>

            <div className="mt-1.5 flex min-h-5 flex-wrap items-center gap-1.5">
              {isHabit && habit && (
                <span
                  className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium"
                  style={{
                    borderColor: `${habit.cor}55`,
                    background: `${habit.cor}16`,
                    color: "var(--text-secondary)",
                  }}
                  title={`Hábito: ${habit.titulo}`}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: habit.cor }} />
                  Hábito
                </span>
              )}

              {isHabit && habit && habit.streak_atual > 0 && (
                <span
                  className="inline-flex items-center gap-1 rounded-md border border-orange-500/35 bg-orange-500/10 px-1.5 py-0.5 text-[10px] text-[var(--text-warning)]"
                  title="Sequência de dias consecutivos"
                >
                  <Flame size={10} />
                  {habit.streak_atual}d
                </span>
              )}

              {task.due_date && (
                <span
                  className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] ${
                    overdue
                      ? "border-red-500/35 bg-red-500/10 text-[var(--text-danger)]"
                      : "border-[var(--border-subtle)] text-[var(--text-muted)]"
                  }`}
                  title={overdue ? "Tarefa atrasada" : "Prazo da tarefa"}
                >
                  <CalendarDays size={10} />
                  {formatShortDate(task.due_date)}
                  {overdue && <span className="sr-only">Atrasada</span>}
                </span>
              )}

              {task.note_path && (
                <span
                  role="img"
                  className="inline-flex items-center gap-1 text-[10px] text-[var(--text-muted)]"
                  title="Possui nota vinculada"
                  aria-label="Possui nota vinculada"
                >
                  <FileText size={10} aria-hidden="true" />
                </span>
              )}
            </div>

            {taskLinks.length > 0 && (
              <div
                className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1"
                onClick={(event) => event.stopPropagation()}
              >
                {visibleLinks.map((link) => {
                  const Icon = link.kind === "note" ? FileText : UserRound;
                  return (
                    <span
                      key={link.slug}
                      className={`inline-flex max-w-[46%] items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] ${
                        link.kind === "note"
                          ? "border-amber-500/20 bg-amber-500/[0.06] text-[var(--text-accent)]"
                          : "border-sky-500/20 bg-sky-500/[0.06] text-[var(--text-info)]"
                      }`}
                      title={`${link.kind === "note" ? "Nota" : "Entity"}: ${link.title}`}
                    >
                      <Icon size={10} className="shrink-0" />
                      <span className="truncate">{link.title}</span>
                      {!controlsDisabled && (
                        <button
                          type="button"
                          aria-label={`Remover vínculo ${link.title}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            onUnlink(task, link.slug);
                          }}
                          className="pointer-events-auto relative z-20 ml-0.5 rounded-sm p-0.5 text-current opacity-60 transition-opacity hover:opacity-100"
                          title="Remover vínculo"
                        >
                          <X size={10} />
                        </button>
                      )}
                    </span>
                  );
                })}
                {hiddenLinkCount > 0 && (
                  <span
                    role="img"
                    aria-label={`${hiddenLinkCount} vínculo(s) adicional(is)`}
                    className="inline-flex items-center rounded-md border border-[var(--border-subtle)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]"
                    title={`${hiddenLinkCount} vínculo(s) adicional(is)`}
                  >
                    +{hiddenLinkCount}
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="relative flex shrink-0 items-center gap-0.5">
            {!readOnly && (
              <button
                type="button"
                data-kanban-complete
                onClick={handleComplete}
                disabled={controlsDisabled}
                aria-label={mutationsDisabled ? "Aguardando sincronização do quadro" : isHabit ? (done ? "Reabrir ocorrência do hábito" : "Registrar conclusão do hábito") : done ? "Reabrir tarefa" : "Concluir tarefa"}
                title={isPending ? "Salvando…" : mutationsDisabled ? "Aguarde a sincronização" : isHabit ? (done ? "Reabrir ocorrência" : "Registrar conclusão") : done ? "Reabrir tarefa" : "Concluir tarefa"}
                className={`pointer-events-auto relative z-20 rounded-md p-1.5 transition-colors disabled:cursor-wait disabled:opacity-60 ${
                  done
                    ? "text-[var(--text-success)] hover:bg-emerald-500/10"
                    : "text-[var(--text-muted)] hover:bg-emerald-500/10 hover:text-[var(--text-success)]"
                }`}
              >
                {isPending ? <Loader2 size={13} className="animate-spin" /> : done ? <RotateCcw size={13} /> : <Check size={14} />}
              </button>
            )}

            {done && (
              <span className="p-1 text-[var(--text-success)]" aria-label="Tarefa concluída" title="Tarefa concluída">
                <CheckCircle2 size={14} />
              </span>
            )}

            {readOnly && !done && (
              <span className="p-1 text-[var(--text-muted)]" aria-label="Semana somente leitura" title="Semana somente leitura">
                <LockKeyhole size={12} />
              </span>
            )}

            {!readOnly && (
              <div className="relative">
                <button
                  ref={triggerRef}
                  data-kanban-menu-trigger
                  type="button"
                  disabled={controlsDisabled}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (menuOpen) {
                      closeMenu(true);
                    } else {
                      placeMenu(event.currentTarget);
                    }
                  }}
                  aria-label={`Ações da tarefa ${task.titulo}`}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  className="pointer-events-auto relative z-20 rounded-md p-1.5 text-[var(--text-muted)] opacity-80 transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:opacity-100 disabled:cursor-wait disabled:opacity-40"
                >
                  <MoreHorizontal size={14} />
                </button>
              </div>
            )}
          </div>
        </div>
      </article>

      {menuOpen && menuPosition && typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={`Ações para ${task.titulo}`}
            aria-orientation="vertical"
            style={{ top: menuPosition.top, left: menuPosition.left, maxWidth: "calc(100vw - 16px)" }}
            className="kanban-menu fixed z-[80] max-h-[calc(100vh-16px)] w-56 overflow-y-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card-elevated)] p-1 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Mover para
            </div>
            {otherColumns.map((column) => (
              <button
                key={column.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  closeMenu(true);
                  onMove(task, column.id);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:bg-[var(--bg-hover)] focus-visible:text-[var(--text-primary)]"
              >
                <ArrowRight size={12} className="text-[var(--text-accent)]" />
                {column.label}
              </button>
            ))}

            {onReorder && (
              <>
                <div className="my-1 h-px bg-[var(--border-subtle)]" />
                <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Reordenar
                </div>
                <button
                  type="button"
                  role="menuitem"
                  disabled={!canReorderUp}
                  onClick={() => {
                    closeMenu(true);
                    onReorder(task, -1);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-35"
                >
                  <ArrowUp size={12} className="text-[var(--text-accent)]" />
                  Mover para cima
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={!canReorderDown}
                  onClick={() => {
                    closeMenu(true);
                    onReorder(task, 1);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-35"
                >
                  <ArrowDown size={12} className="text-[var(--text-accent)]" />
                  Mover para baixo
                </button>
              </>
            )}

            <div className="my-1 h-px bg-[var(--border-subtle)]" />

            {!isHabit && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  closeMenu(true);
                  onRequestDelete(task);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-[var(--text-danger)] transition-colors hover:bg-red-500/10 focus-visible:bg-red-500/10"
              >
                <Trash2 size={12} />
                Excluir (desvincula)
              </button>
            )}
          </div>,
          document.body
        )}
    </>
  );
};
