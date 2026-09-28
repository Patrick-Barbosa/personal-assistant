import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  CalendarRange,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  FileText,
  Filter,
  Flame,
  Info,
  Keyboard,
  Loader2,
  LockKeyhole,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  UserRound,
  X,
} from "lucide-react";
import { api } from "../api";
import { useUiStore } from "../stores/ui-store";
import { KanbanBoard, KanbanColumn, KanbanTask, TaskColumn, TaskLinks } from "../types";
import { KanbanCard } from "./KanbanCard";
import { DeleteConfirmModal } from "./DeleteConfirmModal";
import { TaskEditorPanel } from "./TaskEditorPanel";
import { HabitModal } from "./HabitModal";
import { StreakCards } from "./insights/StreakCards";
import { DayBars } from "./insights/DayBars";
import { WeekTrend } from "./insights/WeekTrend";
import { EstimatedVsRealized } from "./insights/EstimatedVsRealized";
import { formatShortDate, isoWeekIdOf, isoWeekIdOfDate, isoWeekNumber, shiftWeekId } from "../utils/isoWeek";
import {
  activeKanbanFilterChips,
  backendDropIndex,
  DEFAULT_KANBAN_FILTERS,
  filterKanbanTasks,
  hasActiveKanbanFilters,
  isTaskDueToday,
  isTaskOverdue,
  localDateKey,
  normalizeKanbanContext,
  removeKanbanFilter,
  toggleKanbanFilter,
  type KanbanFilters,
} from "../utils/kanbanFilters";
import type { Insights } from "../types";

const COLUMNS: KanbanColumn[] = [
  { id: "todo", label: "A fazer" },
  { id: "doing", label: "Em progresso" },
  { id: "done", label: "Feito" },
];

const STAGE_META: Record<TaskColumn, { dot: string; hint: string }> = {
  todo: { dot: "bg-zinc-400", hint: "Prontas para começar" },
  doing: { dot: "bg-amber-400", hint: "Em foco agora" },
  done: { dot: "bg-emerald-400", hint: "Concluídas" },
};

const CONTEXT_STORAGE_KEY = "copernico-kanban-context-v1";

type DropTarget = { column: TaskColumn; index: number };
type LoadPhase = "initial" | "refreshing" | "idle" | "error";
type CreateState = "idle" | "creating" | "success" | "error";
type Feedback = { id: number; tone: "success" | "error" | "info"; message: string };
type StoredKanbanContext = ReturnType<typeof normalizeKanbanContext>;

function readStoredContext(): StoredKanbanContext {
  if (typeof window === "undefined") {
    return normalizeKanbanContext(null);
  }
  try {
    const raw = window.localStorage.getItem(CONTEXT_STORAGE_KEY);
    return normalizeKanbanContext(raw ? JSON.parse(raw) : null);
  } catch {
    return normalizeKanbanContext(null);
  }
}

function isMissingWeekError(message: string): boolean {
  const normalized = message.toLocaleLowerCase("pt-BR");
  return (
    normalized.includes("não encontrada") ||
    normalized.includes("nao encontrada") ||
    normalized.includes("not found") ||
    normalized.includes("inexistente")
  );
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Board Kanban semanal (seg → dom, semana ISO) com drag HTML5 nativo. */
export const KanbanView: React.FC = () => {
  const kanbanRevision = useUiStore((state) => state.kanbanRevision);
  const [storedContext] = useState<StoredKanbanContext>(readStoredContext);

  const [board, setBoard] = useState<KanbanBoard | null>(null);
  const [semana, setSemana] = useState<string | null>(storedContext.semana);
  const [loadPhase, setLoadPhase] = useState<LoadPhase>("initial");
  const [today, setToday] = useState(() => localDateKey());
  const [boardError, setBoardError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [insightsError, setInsightsError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const [tab, setTab] = useState<"board" | "insights">(storedContext.tab);
  const [periodo, setPeriodo] = useState<"semana" | "mes">(storedContext.periodo);
  const [filters, setFilters] = useState<KanbanFilters>(storedContext.filters);

  const [addingTo, setAddingTo] = useState<TaskColumn | null>(null);
  const [draft, setDraft] = useState("");
  const [draftDue, setDraftDue] = useState("");
  const [createState, setCreateState] = useState<CreateState>("idle");
  const [createError, setCreateError] = useState<string | null>(null);

  /** Fallback simples (só título/prazo) — usado apenas para hábitos. */
  const [editTask, setEditTask] = useState<KanbanTask | null>(null);
  const [editTitulo, setEditTitulo] = useState("");
  const [editDue, setEditDue] = useState("");
  /** Painel rico da Fase 2 — tarefas normais nunca caem no modal simples. */
  const [panelTaskId, setPanelTaskId] = useState<string | null>(null);
  const [deleteTask, setDeleteTask] = useState<KanbanTask | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const deleteBusyRef = useRef(false);
  /** Modal de hábitos (Fase 4) — criação/edição/ativação/remoção. */
  const [habitsOpen, setHabitsOpen] = useState(false);
  /** Hábito a editar ao abrir o modal (atalho vindo de uma task de hábito). */
  const [editingHabitId, setEditingHabitId] = useState<string | null>(null);

  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const draggingTaskIdRef = useRef<string | null>(null);
  const pendingBoardReloadRef = useRef(false);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [pendingTaskIds, setPendingTaskIds] = useState<Set<string>>(() => new Set());
  const [filterOpen, setFilterOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(true);

  const boardRequestRef = useRef(0);
  const contextVersionRef = useRef(0);
  const createOperationCounterRef = useRef(0);
  const activeCreateOperationRef = useRef<number | null>(null);
  const insightsRequestRef = useRef(0);
  const boardWeekIdRef = useRef<string | null>(null);
  const boardStatusRef = useRef<"open" | "closed" | null>(null);
  const boardRef = useRef<KanbanBoard | null>(null);
  const semanaRef = useRef<string | null>(semana);
  const boardScrollRef = useRef(0);
  const insightsScrollRef = useRef(0);
  const composerInputRef = useRef<HTMLInputElement | null>(null);
  const composerTriggerRef = useRef<HTMLElement | null>(null);
  const filterButtonRef = useRef<HTMLButtonElement | null>(null);
  const filterPopoverRef = useRef<HTMLDivElement | null>(null);
  const shortcutsButtonRef = useRef<HTMLButtonElement | null>(null);
  const shortcutsPopoverRef = useRef<HTMLDivElement | null>(null);
  const focusedColumnRef = useRef<TaskColumn>("todo");
  const menuOpenRef = useRef(false);
  const feedbackTimerRef = useRef<number | null>(null);
  const operationCounterRef = useRef(0);
  const taskOperationRef = useRef<Map<string, number>>(new Map());
  const taskQueueRef = useRef<Map<string, Promise<void>>>(new Map());
  const pendingTaskIdsRef = useRef<Set<string>>(new Set());

  const announce = useCallback((message: string, tone: Feedback["tone"] = "info") => {
    if (feedbackTimerRef.current !== null) window.clearTimeout(feedbackTimerRef.current);
    setStatusMessage(message);
    setFeedback({ id: Date.now() + Math.random(), tone, message });
    feedbackTimerRef.current = window.setTimeout(() => setFeedback(null), 4800);
  }, []);

  const applyTaskToBoard = useCallback((task: KanbanTask) => {
    const current = boardRef.current;
    if (!current || (current.week.id && current.week.id !== task.week_id)) return;
    const exists = current.tasks.some((item) => item.id === task.id);
    const nextTasks = exists
      ? current.tasks.map((item) => (item.id === task.id ? task : item))
      : [...current.tasks, task];
    const next = { ...current, tasks: nextTasks };
    boardRef.current = next;
    setBoard(next);
  }, []);

  const load = useCallback(
    async (target: string | null = semanaRef.current, clearErrorOnSuccess = true) => {
      if (draggingTaskIdRef.current) {
        pendingBoardReloadRef.current = true;
        return;
      }
      pendingBoardReloadRef.current = false;
      const requestId = boardRequestRef.current + 1;
      const contextVersion = contextVersionRef.current;
      boardRequestRef.current = requestId;
      const hadBoard = boardRef.current !== null;
      const currentWeekId = boardRef.current?.week.id ?? null;
      const shouldClearBoard =
        !hadBoard ||
        (target !== null && currentWeekId !== target) ||
        (target === null && boardRef.current?.week.status === "closed");
      const previousScroll = boardScrollRef.current;
      const columnScroll = new Map<string, number>();
      document.querySelectorAll<HTMLElement>("[data-kanban-column-scroll]").forEach((element) => {
        const column = element.dataset.column;
        if (column) columnScroll.set(column, element.scrollTop);
      });
      if (shouldClearBoard) {
        boardRef.current = null;
        setBoard(null);
        window.requestAnimationFrame(() => {
          const scroller = document.querySelector<HTMLElement>("[data-kanban-scroll]");
          if (scroller) scroller.scrollTop = 0;
        });
      }
      setLoadPhase(hadBoard && !shouldClearBoard ? "refreshing" : "initial");

      try {
        const next = await api.listKanbanWeek(target);
        if (requestId !== boardRequestRef.current || contextVersion !== contextVersionRef.current) return;
        boardWeekIdRef.current = next.week.id || null;
        boardStatusRef.current = next.week.status;
        boardRef.current = next;
        setBoard(next);
        setLoadPhase("idle");
        if (clearErrorOnSuccess) setBoardError(null);
        if (hadBoard && !shouldClearBoard && (previousScroll > 0 || columnScroll.size > 0)) {
          window.requestAnimationFrame(() => {
            const scroller = document.querySelector<HTMLElement>("[data-kanban-scroll]");
            if (scroller) scroller.scrollTop = previousScroll;
            document.querySelectorAll<HTMLElement>("[data-kanban-column-scroll]").forEach((element) => {
              const column = element.dataset.column;
              if (column && columnScroll.has(column)) element.scrollTop = columnScroll.get(column) ?? 0;
            });
          });
        }
      } catch (error) {
        if (requestId !== boardRequestRef.current || contextVersion !== contextVersionRef.current) return;
        const message = messageFromError(error);
        setBoardError(message);
        setLoadPhase("error");
        if (target && isMissingWeekError(message)) {
          setSemana(null);
          announce("A semana selecionada não está mais disponível. Abri a semana atual.", "info");
        }
      }
    },
    [announce]
  );

  const loadInsights = useCallback(async (target: "semana" | "mes") => {
    const requestId = insightsRequestRef.current + 1;
    insightsRequestRef.current = requestId;
    setInsightsLoading(true);
    try {
      const next = await api.listInsights(target);
      if (requestId !== insightsRequestRef.current) return;
      setInsights(next);
      setInsightsError(null);
    } catch (error) {
      if (requestId !== insightsRequestRef.current) return;
      setInsightsError(messageFromError(error));
    } finally {
      if (requestId === insightsRequestRef.current) setInsightsLoading(false);
    }
  }, []);

  useEffect(() => {
    contextVersionRef.current += 1;
    activeCreateOperationRef.current = null;
    semanaRef.current = semana;
    setBoardError(null);
    setMutationError(null);
    setStatusMessage(null);
    setFeedback(null);
    boardScrollRef.current = 0;
    setAddingTo(null);
    setDraft("");
    setDraftDue("");
    setCreateState("idle");
    setCreateError(null);
    draggingTaskIdRef.current = null;
    setDraggingTaskId(null);
    setDropTarget(null);
    setDeleteTask(null);
    setEditTask(null);
    setPanelTaskId(null);
    setHabitsOpen(false);
    setEditingHabitId(null);
  }, [semana]);

  useEffect(() => {
    boardRef.current = board;
    boardWeekIdRef.current = board?.week.id ?? null;
    boardStatusRef.current = board?.week.status ?? null;
  }, [board]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        CONTEXT_STORAGE_KEY,
        JSON.stringify({ semana, tab, periodo, filters } satisfies Record<string, unknown>)
      );
    } catch {
      // A contexto local é uma conveniência; uma política de storage cheia
      // nunca deve impedir o quadro de funcionar.
    }
  }, [filters, periodo, semana, tab]);

  useEffect(() => {
    void load(semana);
  }, [kanbanRevision, load, semana]);

  useEffect(() => {
    if (tab === "insights") {
      setFilterOpen(false);
      setShortcutsOpen(false);
      setAddingTo(null);
      if (activeCreateOperationRef.current === null) {
        setDraft("");
        setDraftDue("");
        setCreateState("idle");
        setCreateError(null);
      }
      setDraggingTaskId(null);
      draggingTaskIdRef.current = null;
      setDropTarget(null);
    }
    const frame = window.requestAnimationFrame(() => {
      const scroller = document.querySelector<HTMLElement>("[data-kanban-scroll]");
      if (scroller) scroller.scrollTop = tab === "board" ? boardScrollRef.current : insightsScrollRef.current;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [tab]);

  useEffect(() => {
    if (tab === "insights") void loadInsights(periodo);
  }, [kanbanRevision, loadInsights, periodo, tab]);

  useEffect(() => {
    if (draggingTaskId || !pendingBoardReloadRef.current) return;
    pendingBoardReloadRef.current = false;
    void load(semanaRef.current);
  }, [draggingTaskId, load]);

  useEffect(() => {
    let timer: number | null = null;
    const scheduleNextDay = () => {
      const now = new Date();
      const next = new Date(now);
      next.setHours(24, 0, 0, 0);
      timer = window.setTimeout(() => {
        setToday(localDateKey());
        scheduleNextDay();
      }, Math.max(1000, next.getTime() - now.getTime()));
    };
    scheduleNextDay();
    return () => {
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current !== null) window.clearTimeout(feedbackTimerRef.current);
    };
  }, []);

  const currentWeekId = isoWeekIdOfDate(today);
  const isCurrentWeek = board?.week.id === currentWeekId;
  const readOnly = board?.week.status === "closed" || Boolean(board && !isCurrentWeek);
  const boardStale = loadPhase === "error" && board !== null;
  const canMutate = Boolean(board && !readOnly && isCurrentWeek && !boardStale && loadPhase === "idle");
  const isRefreshing = loadPhase === "refreshing";
  const isInitialLoading = loadPhase === "initial" && !board;

  useEffect(() => {
    if (!readOnly) return;
    setDeleteTask(null);
    setEditTask(null);
    setPanelTaskId(null);
  }, [readOnly]);

  const tasks = useMemo(() => board?.tasks ?? [], [board]);
  const linksByTask = useMemo(() => {
    const map = new Map<string, TaskLinks | undefined>();
    for (const links of board?.links ?? []) map.set(links.task_id, links);
    return map;
  }, [board]);
  const byColumn = useMemo(() => {
    const map: Record<TaskColumn, KanbanTask[]> = { todo: [], doing: [], done: [] };
    for (const task of tasks) map[task.task_column].push(task);
    for (const key of Object.keys(map) as TaskColumn[]) {
      map[key].sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));
    }
    return map;
  }, [tasks]);

  const visibleTasks = useMemo(
    () => filterKanbanTasks(tasks, linksByTask, filters, today),
    [filters, linksByTask, tasks, today]
  );
  const visibleByColumn = useMemo(() => {
    const map: Record<TaskColumn, KanbanTask[]> = { todo: [], doing: [], done: [] };
    for (const task of visibleTasks) map[task.task_column].push(task);
    for (const key of Object.keys(map) as TaskColumn[]) {
      map[key].sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));
    }
    return map;
  }, [visibleTasks]);
  const filtersActive = hasActiveKanbanFilters(filters);
  const filterChips = useMemo(() => activeKanbanFilterChips(filters), [filters]);
  const doneCount = byColumn.done.length;
  const completionPct = tasks.length > 0 ? Math.round((doneCount / tasks.length) * 100) : 0;
  const dueTodayCount = tasks.filter((task) => isTaskDueToday(task, today)).length;
  const overdueCount = tasks.filter((task) => isTaskOverdue(task, today)).length;
  const habitToday = tasks.filter((task) => task.task_kind === "habit" && task.due_date === today);
  const habitTodayDone = habitToday.filter((task) => task.task_column === "done").length;
  const weekNumber = board ? isoWeekNumber(board.week.id || isoWeekIdOf(new Date())) : null;

  const restoreTaskFocus = useCallback((taskId: string | null) => {
    if (!taskId) return;
    window.requestAnimationFrame(() => {
      const target = document.getElementById(`kanban-task-${taskId}-open`);
      if (target instanceof HTMLElement) target.focus();
    });
  }, []);

  const restoreComposerFocus = useCallback(() => {
    window.requestAnimationFrame(() => {
      if (composerTriggerRef.current?.isConnected) composerTriggerRef.current.focus();
    });
  }, []);

  const markTaskPending = useCallback((taskId: string) => {
    pendingTaskIdsRef.current.add(taskId);
    setPendingTaskIds(new Set(pendingTaskIdsRef.current));
    const operationId = operationCounterRef.current + 1;
    operationCounterRef.current = operationId;
    taskOperationRef.current.set(taskId, operationId);
    return operationId;
  }, []);

  const finishTaskPending = useCallback((taskId: string, operationId: number) => {
    if (taskOperationRef.current.get(taskId) !== operationId) return;
    taskOperationRef.current.delete(taskId);
    pendingTaskIdsRef.current.delete(taskId);
    setPendingTaskIds(new Set(pendingTaskIdsRef.current));
  }, []);

  const enqueueTaskMutation = useCallback((taskId: string, operation: () => Promise<KanbanTask>) => {
    const previous = taskQueueRef.current.get(taskId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    taskQueueRef.current.set(
      taskId,
      next.then(
        () => undefined,
        () => undefined
      )
    );
    return next;
  }, []);

  const moveTask = useCallback(
    async (task: KanbanTask, column: TaskColumn, index?: number) => {
      if (!canMutate || pendingTaskIdsRef.current.has(task.id)) return;
      const sourceColumn = byColumn[task.task_column];
      const destination = byColumn[column].filter((item) => item.id !== task.id);
      const currentIndex = sourceColumn.findIndex((item) => item.id === task.id);
      const targetIndex = index ?? destination.length;
      if (column === task.task_column && currentIndex === targetIndex) return;
      if (column === task.task_column && (targetIndex < 0 || targetIndex > destination.length)) return;

      const requestedWeek = semanaRef.current;
      const operationId = markTaskPending(task.id);
      try {
        const updated = await enqueueTaskMutation(task.id, () =>
          api.moveKanbanTask(task.id, column, targetIndex)
        );
        if (taskOperationRef.current.get(task.id) !== operationId) return;
        if (semanaRef.current !== requestedWeek) return;
        if (!boardRef.current || boardRef.current.week.id === updated.week_id || !boardRef.current.week.id) {
          applyTaskToBoard(updated);
        }
        setMutationError(null);
        announce(
          task.task_kind === "habit"
            ? column === "done"
              ? "Hábito registrado. A métrica foi atualizada."
              : "Ocorrência de hábito reaberta."
            : column === "done"
              ? "Tarefa concluída."
              : "Tarefa movida com sucesso.",
          "success"
        );
        window.requestAnimationFrame(() => {
          if (!document.getElementById(`kanban-task-${task.id}-open`)) {
            (filtersActive ? filterButtonRef.current : document.getElementById("kanban-tab-board"))?.focus();
          } else {
            restoreTaskFocus(task.id);
          }
        });
        await load(semanaRef.current, false);
      } catch (error) {
        if (taskOperationRef.current.get(task.id) !== operationId) return;
        if (semanaRef.current !== requestedWeek) return;
        setMutationError(messageFromError(error));
        announce("Não foi possível mover a tarefa. O quadro será reconciliado.", "error");
        await load(requestedWeek, false);
      } finally {
        finishTaskPending(task.id, operationId);
      }
    },
    [announce, applyTaskToBoard, byColumn, canMutate, enqueueTaskMutation, filtersActive, finishTaskPending, load, markTaskPending, restoreTaskFocus]
  );

  const reorderTask = useCallback(
    (task: KanbanTask, direction: -1 | 1) => {
      const fullColumn = byColumn[task.task_column];
      const visibleColumn = visibleByColumn[task.task_column];
      const visibleIndex = visibleColumn.findIndex((item) => item.id === task.id);
      if (visibleIndex < 0) return;
      const visualIndex = visibleIndex + direction;
      if (visualIndex < 0 || visualIndex > visibleColumn.filter((item) => item.id !== task.id).length) return;
      const targetIndex = backendDropIndex(fullColumn, visibleColumn, visualIndex, task.id);
      void moveTask(task, task.task_column, targetIndex);
    },
    [byColumn, moveTask, visibleByColumn]
  );

  const openComposer = useCallback(
    (column: TaskColumn, trigger?: HTMLElement) => {
      if (!canMutate || createState === "creating" || activeCreateOperationRef.current !== null) return;
      setTab("board");
      composerTriggerRef.current = trigger ?? composerTriggerRef.current;
      if (addingTo === column) {
        if (draft.trim() || draftDue || createState === "error") {
          window.requestAnimationFrame(() => composerInputRef.current?.focus());
          return;
        }
        setAddingTo(null);
        setDraft("");
        setDraftDue("");
        setCreateState("idle");
        setCreateError(null);
        restoreComposerFocus();
        return;
      }
      setAddingTo(column);
      setDraft("");
      setDraftDue("");
      setCreateState("idle");
      setCreateError(null);
      setStatusMessage(null);
      window.requestAnimationFrame(() => composerInputRef.current?.focus());
    },
    [addingTo, canMutate, createState, draft, draftDue, restoreComposerFocus]
  );

  const closeComposer = useCallback(
    (restoreFocus = true) => {
      if (createState === "creating" || activeCreateOperationRef.current !== null) return;
      setAddingTo(null);
      setDraft("");
      setDraftDue("");
      setCreateState("idle");
      setCreateError(null);
      if (restoreFocus) restoreComposerFocus();
    },
    [createState, restoreComposerFocus]
  );

  const createTask = useCallback(async () => {
    const title = draft.trim();
    const column = addingTo;
    if (!title || !column || createState === "creating" || activeCreateOperationRef.current !== null || !canMutate) {
      if (!title) {
        setCreateState("error");
        setCreateError("Digite um título para criar a tarefa.");
        window.requestAnimationFrame(() => composerInputRef.current?.focus());
      }
      return;
    }
    const requestedWeek = semanaRef.current;
    const createOperationId = createOperationCounterRef.current + 1;
    createOperationCounterRef.current = createOperationId;
    activeCreateOperationRef.current = createOperationId;
    let created: KanbanTask | null = null;
    let createdOperationId: number | null = null;
    setCreateState("creating");
    setCreateError(null);
    try {
      const createdTask = draftDue
        ? await api.createKanbanTask(title, column, draftDue)
        : await api.createKanbanTask(title, column);
      if (activeCreateOperationRef.current !== createOperationId || semanaRef.current !== requestedWeek) return;
      created = createdTask;
      createdOperationId = markTaskPending(createdTask.id);
      applyTaskToBoard(createdTask);
      setAddingTo(null);
      setDraft("");
      setDraftDue("");
      setCreateState("success");
      setCreateError(null);
      setMutationError(null);
      announce(`Tarefa “${title}” criada com sucesso.`, "success");
      restoreTaskFocus(createdTask.id);
      await load(semanaRef.current, false);
      window.setTimeout(() => {
        if (activeCreateOperationRef.current === createOperationId && !document.getElementById(`kanban-task-${createdTask.id}-open`)) restoreComposerFocus();
      }, 80);
    } catch (error) {
      if (activeCreateOperationRef.current !== createOperationId || semanaRef.current !== requestedWeek) return;
      setCreateState("error");
      setCreateError(messageFromError(error));
      setMutationError(messageFromError(error));
      announce("Não foi possível criar a tarefa. O rascunho foi preservado.", "error");
    } finally {
      if (createdOperationId !== null && created) finishTaskPending(created.id, createdOperationId);
      if (activeCreateOperationRef.current === createOperationId) {
        activeCreateOperationRef.current = null;
        setCreateState((current) => (current === "creating" ? "idle" : current));
      }
    }
  }, [addingTo, announce, applyTaskToBoard, canMutate, createState, draft, draftDue, finishTaskPending, load, markTaskPending, restoreComposerFocus, restoreTaskFocus]);

  const openEditor = useCallback(
    (task: KanbanTask) => {
      if (!board || isInitialLoading || pendingTaskIdsRef.current.has(task.id)) return;
      if (task.task_kind === "habit") {
        setEditTitulo(task.titulo);
        setEditDue(task.due_date ?? "");
        setEditTask(task);
        return;
      }
      setPanelTaskId(task.id);
    },
    [board, isInitialLoading]
  );

  const closePanel = useCallback(() => {
    const taskId = panelTaskId;
    setPanelTaskId(null);
    restoreTaskFocus(taskId);
  }, [panelTaskId, restoreTaskFocus]);

  const closeEditTask = useCallback(() => {
    const taskId = editTask?.id ?? null;
    setEditTask(null);
    restoreTaskFocus(taskId);
  }, [editTask, restoreTaskFocus]);

  const openHabitEditorFromTask = useCallback(() => {
    if (!editTask) return;
    setEditingHabitId(editTask.habit_id ?? null);
    setHabitsOpen(true);
  }, [editTask]);

  const closeHabitModal = useCallback(() => {
    const taskId = editTask?.id ?? null;
    setHabitsOpen(false);
    setEditingHabitId(null);
    setEditTask(null);
    if (taskId) restoreTaskFocus(taskId);
  }, [editTask, restoreTaskFocus]);

  const panelTask = useMemo(
    () => tasks.find((task) => task.id === panelTaskId) ?? null,
    [panelTaskId, tasks]
  );
  const panelLinks = useMemo<TaskLinks>(
    () =>
      linksByTask.get(panelTaskId ?? "") ?? {
        task_id: panelTaskId ?? "",
        notes: [],
        entities: [],
      },
    [linksByTask, panelTaskId]
  );

  const saveEditor = useCallback(async () => {
    if (!editTask || !canMutate || pendingTaskIdsRef.current.has(editTask.id)) return;
    const taskId = editTask.id;
    const operationId = markTaskPending(taskId);
    try {
      await api.updateKanbanTask(taskId, editTitulo.trim(), editDue || null);
      setEditTask(null);
      restoreTaskFocus(taskId);
      setMutationError(null);
      announce("Tarefa atualizada.", "success");
      await load(semanaRef.current, false);
    } catch (error) {
      setMutationError(messageFromError(error));
      announce("Não foi possível atualizar a tarefa.", "error");
    } finally {
      finishTaskPending(taskId, operationId);
    }
  }, [announce, canMutate, editDue, editTask, editTitulo, finishTaskPending, load, markTaskPending, restoreTaskFocus]);

  const confirmDelete = useCallback(async () => {
    if (!deleteTask || !canMutate || isDeleting || deleteBusyRef.current || pendingTaskIdsRef.current.has(deleteTask.id)) return;
    deleteBusyRef.current = true;
    const taskId = deleteTask.id;
    const operationId = markTaskPending(taskId);
    setIsDeleting(true);
    try {
      await api.deleteKanbanTask(taskId);
      setDeleteTask(null);
      setEditTask(null);
      setPanelTaskId(null);
      setMutationError(null);
      announce("Tarefa excluída do quadro. A nota foi preservada.", "success");
      await load(semanaRef.current, false);
      window.requestAnimationFrame(() => {
        if (!document.getElementById(`kanban-task-${taskId}-open`)) {
          (document.getElementById("kanban-tab-board") as HTMLElement | null)?.focus();
        }
      });
    } catch (error) {
      setMutationError(messageFromError(error));
      announce("Não foi possível excluir a tarefa.", "error");
    } finally {
      finishTaskPending(taskId, operationId);
      deleteBusyRef.current = false;
      setIsDeleting(false);
    }
  }, [announce, canMutate, deleteTask, finishTaskPending, isDeleting, load, markTaskPending]);

  const requestDelete = useCallback(
    (task: KanbanTask) => {
      if (!canMutate || pendingTaskIdsRef.current.has(task.id)) return;
      setDeleteTask(task);
    },
    [canMutate]
  );

  const unlinkTask = useCallback(
    async (task: KanbanTask, slug: string) => {
      if (!canMutate || pendingTaskIdsRef.current.has(task.id)) return;
      const operationId = markTaskPending(task.id);
      try {
        if (slug.startsWith("entity:")) {
          await api.unlinkTaskEntity(task.id, slug.slice("entity:".length));
        } else {
          await api.unlinkTaskNote(task.id, slug);
        }
        setMutationError(null);
        announce("Vínculo removido.", "success");
        await load(semanaRef.current, false);
      } catch (error) {
        setMutationError(messageFromError(error));
        announce("Não foi possível remover o vínculo.", "error");
      } finally {
        finishTaskPending(task.id, operationId);
      }
    },
    [announce, canMutate, finishTaskPending, load, markTaskPending]
  );

  const getDropIndex = useCallback((event: React.DragEvent<HTMLElement>): number => {
    const cards = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[data-task-id]"));
    const others = cards.filter((card) => card.dataset.taskId !== draggingTaskIdRef.current);
    let index = others.length;
    for (let indexCursor = 0; indexCursor < others.length; indexCursor += 1) {
      const rect = others[indexCursor].getBoundingClientRect();
      if (event.clientY < rect.top + rect.height / 2) {
        index = indexCursor;
        break;
      }
    }
    return index;
  }, []);

  const handleDragOver = useCallback(
    (event: React.DragEvent<HTMLElement>, column: TaskColumn) => {
      if (!canMutate || !draggingTaskIdRef.current) {
        if (draggingTaskIdRef.current) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "none";
        }
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setDropTarget({ column, index: getDropIndex(event) });
    },
    [canMutate, getDropIndex]
  );

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLElement>, column: TaskColumn) => {
    const related = event.relatedTarget as Node | null;
    if (!related || !event.currentTarget.contains(related)) {
      setDropTarget((current) => (current?.column === column ? null : current));
    }
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLElement>, column: TaskColumn) => {
      event.preventDefault();
      const id = event.dataTransfer.getData("text/plain") || draggingTaskIdRef.current;
      setDropTarget(null);
      draggingTaskIdRef.current = null;
      setDraggingTaskId(null);
      if (!canMutate || !id) return;
      const task = boardRef.current?.tasks.find((item) => item.id === id);
      if (!task) return;
      const visualIndex = dropTarget?.column === column ? dropTarget.index : getDropIndex(event);
      const index = backendDropIndex(byColumn[column], visibleByColumn[column], visualIndex, id);
      void moveTask(task, column, index);
    },
    [byColumn, canMutate, dropTarget, getDropIndex, moveTask, visibleByColumn]
  );

  const handleTabKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, current: "board" | "insights") => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next =
        event.key === "Home"
          ? "board"
          : event.key === "End"
            ? "insights"
            : current === "board"
              ? "insights"
              : "board";
      setTab(next);
      window.requestAnimationFrame(() => {
        const target = next === "board" ? document.getElementById("kanban-tab-board") : document.getElementById("kanban-tab-insights");
        if (target instanceof HTMLElement) target.focus();
      });
    },
    []
  );

  const clearFilters = useCallback(() => {
    setFilters({ ...DEFAULT_KANBAN_FILTERS });
    setFilterOpen(false);
    window.requestAnimationFrame(() => filterButtonRef.current?.focus());
  }, []);

  const removeFilterChip = useCallback((key: (typeof filterChips)[number]["key"]) => {
    setFilters((current) => removeKanbanFilter(current, key));
    window.requestAnimationFrame(() => filterButtonRef.current?.focus());
  }, []);

  const toggleFilter = useCallback((key: "today" | "overdue" | "habits" | "notes" | "entities") => {
    setFilters((current) => toggleKanbanFilter(current, key));
  }, []);

  useEffect(() => {
    if (!filterOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (filterPopoverRef.current?.contains(target) || filterButtonRef.current?.contains(target)) return;
      setFilterOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setFilterOpen(false);
        filterButtonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.requestAnimationFrame(() => {
      filterPopoverRef.current?.querySelector<HTMLElement>("input, button")?.focus();
    });
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [filterOpen]);

  useEffect(() => {
    if (!shortcutsOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (shortcutsPopoverRef.current?.contains(target) || shortcutsButtonRef.current?.contains(target)) return;
      setShortcutsOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setShortcutsOpen(false);
        shortcutsButtonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [shortcutsOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLocaleLowerCase() !== "n" || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable
      ) {
        return;
      }
      if (
        filterOpen ||
        shortcutsOpen ||
        menuOpenRef.current ||
        addingTo ||
        !canMutate ||
        tab !== "board" ||
        deleteTask ||
        editTask ||
        panelTaskId ||
        habitsOpen
      ) {
        return;
      }
      event.preventDefault();
      const activeTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
      openComposer(focusedColumnRef.current, activeTrigger);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [addingTo, canMutate, deleteTask, editTask, filterOpen, habitsOpen, openComposer, panelTaskId, shortcutsOpen, tab]);

  useEffect(() => {
    if (!addingTo || filterOpen || shortcutsOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeComposer();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [addingTo, closeComposer, filterOpen, shortcutsOpen]);

  useEffect(() => {
    if (!editTask || deleteTask) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const taskId = editTask.id;
      setEditTask(null);
      window.requestAnimationFrame(() => restoreTaskFocus(taskId));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteTask, editTask, restoreTaskFocus]);

  const handleMenuOpenChange = useCallback((open: boolean) => {
    menuOpenRef.current = open;
  }, []);

  const renderDropLine = (show: boolean) =>
    show ? (
      <div className="kanban-drop-line relative h-2 -my-1" aria-hidden="true">
        <div className="absolute inset-x-1 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-amber-400 shadow-[0_0_0_1px_rgba(245,158,11,0.18)]" />
      </div>
    ) : null;

  const renderEmptyColumn = (column: KanbanColumn, visibleCount: number, totalCount: number) => {
    if (isInitialLoading || addingTo === column.id || draggingTaskId) return null;
    const hiddenByFilter = filtersActive && totalCount > visibleCount;
    return (
      <div className="flex min-h-[132px] flex-col items-center justify-center gap-2 px-3 text-center">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)]/60 text-[var(--text-muted)]">
          {hiddenByFilter ? <Filter size={14} /> : column.id === "todo" ? <CircleDashed size={15} /> : column.id === "doing" ? <Flame size={15} /> : <CheckCircle2 size={15} />}
        </div>
        <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
          {hiddenByFilter
            ? "Nenhum card corresponde aos filtros."
            : boardStale
              ? "Atualize o quadro para liberar mutações."
              : readOnly
                ? "Sem tarefas nesta coluna."
              : column.id === "todo"
                ? "Crie a primeira tarefa ou arraste algo para cá."
                : column.id === "doing"
                  ? "Arraste uma tarefa para cá quando começar."
                  : "As tarefas concluídas aparecerão aqui."}
        </p>
        {hiddenByFilter && column.id === "todo" ? (
          <button type="button" onClick={clearFilters} className="inline-flex items-center gap-1 rounded-md border border-amber-500/25 px-2 py-1 text-[10px] font-medium text-[var(--text-accent)] transition-colors hover:bg-amber-500/10">
            <RefreshCw size={11} />
            Limpar filtros
          </button>
        ) : hiddenByFilter ? null : canMutate && column.id === "todo" ? (
          <button
            type="button"
            disabled={createState === "creating"}
            onClick={(event) => openComposer(column.id, event.currentTarget)}
            className="inline-flex items-center gap-1 rounded-md border border-amber-500/25 px-2 py-1 text-[10px] font-medium text-[var(--text-accent)] transition-colors hover:bg-amber-500/10 disabled:cursor-wait disabled:opacity-40"
          >
            <Plus size={11} />
            Criar tarefa
          </button>
        ) : null}
      </div>
    );
  };

  const skeletonBoard = (
    <div className="grid min-h-0 grid-cols-1 gap-3 md:grid-cols-3" aria-label="Carregando quadro">
      {COLUMNS.map((column) => (
        <section key={column.id} className="min-h-[220px] rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-column)]/70 p-3">
          <div className="mb-3 flex items-center gap-2">
            <div className="kanban-skeleton-bar h-2 w-2 rounded-full" />
            <div className="kanban-skeleton-bar h-3 w-24 rounded" />
          </div>
          <div className="space-y-2">
            <div className="kanban-skeleton-bar h-16 rounded-xl" />
            <div className="kanban-skeleton-bar h-12 rounded-xl" />
          </div>
        </section>
      ))}
    </div>
  );

  const renderSummary = () => {
    if (!board) return null;
    return (
      <section className="kanban-summary mt-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-input)]/55 px-3 py-2.5" aria-label="Resumo da semana">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex min-w-[150px] flex-1 items-center gap-2.5">
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">Concluídas</span>
                <span className="text-[11px] font-semibold tabular-nums text-[var(--text-primary)]">{doneCount}/{tasks.length}</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--bg-elevated)]" role="progressbar" aria-label="Progresso da semana" aria-valuemin={0} aria-valuemax={100} aria-valuenow={completionPct}>
                <div className="h-full rounded-full bg-amber-400 transition-[width] duration-200" style={{ width: `${completionPct}%` }} />
              </div>
            </div>
            <span className="text-[10px] tabular-nums text-[var(--text-muted)]">{completionPct}%</span>
          </div>
          <div className="hidden h-7 w-px bg-[var(--border-subtle)] sm:block" aria-hidden="true" />
          <button
            type="button"
            onClick={() => {
              setTab("board");
              toggleFilter("today");
            }}
            aria-pressed={filters.today}
            className={`kanban-summary-metric rounded-lg px-2 py-1 text-left transition-colors hover:bg-[var(--bg-hover)] ${filters.today ? "bg-amber-500/10 text-[var(--text-accent)]" : "text-[var(--text-secondary)]"}`}
          >
            <span className="block text-[9px] uppercase tracking-wider text-[var(--text-muted)]">Hoje</span>
            <span className="text-xs font-semibold tabular-nums">{dueTodayCount} {dueTodayCount === 1 ? "tarefa" : "tarefas"}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setTab("board");
              toggleFilter("overdue");
            }}
            aria-pressed={filters.overdue}
            className={`kanban-summary-metric rounded-lg px-2 py-1 text-left transition-colors hover:bg-[var(--bg-hover)] ${filters.overdue ? "bg-red-500/10 text-[var(--text-danger)]" : overdueCount > 0 ? "text-[var(--text-danger)]" : "text-[var(--text-secondary)]"}`}
          >
            <span className="block text-[9px] uppercase tracking-wider text-[var(--text-muted)]">Atrasadas</span>
            <span className="text-xs font-semibold tabular-nums">{overdueCount}</span>
          </button>
          <button
            type="button"
            onClick={() => setHabitsOpen(true)}
            aria-label={`Abrir hábitos. Ocorrências de hoje: ${habitTodayDone} de ${habitToday.length}.`}
            className="kanban-summary-metric rounded-lg px-2 py-1 text-left text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)]"
            title="Abrir gestão de hábitos · ocorrências carregadas nesta semana"
          >
            <span className="block text-[9px] uppercase tracking-wider text-[var(--text-muted)]">Ocorrências hoje</span>
            <span className="inline-flex items-center gap-1 text-xs font-semibold tabular-nums"><Flame size={11} className="text-[var(--text-warning)]" />{habitTodayDone}/{habitToday.length}</span>
          </button>
          <span className={`ml-auto inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-medium ${readOnly || boardStale ? "border-[var(--border-subtle)] text-[var(--text-muted)]" : "border-emerald-500/25 bg-emerald-500/10 text-[var(--text-success)]"}`}>
            {readOnly || boardStale ? <LockKeyhole size={10} /> : <CheckCircle2 size={10} />}
            {boardStale ? "Desatualizada · reconcilie" : readOnly ? (board?.week.status === "closed" ? "Fechada · leitura" : "Histórico · leitura") : "Aberta · edição"}
          </span>
        </div>
      </section>
    );
  };

  const renderFilterPopover = () => {
    if (!filterOpen) return null;
    return (
      <div ref={filterPopoverRef} role="dialog" aria-label="Filtros do quadro" className="kanban-filter-popover absolute right-0 top-[calc(100%+8px)] z-40 w-[min(292px,calc(100vw-32px))] rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card-elevated)] p-3 shadow-2xl">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold text-[var(--text-primary)]">Filtrar semana</p>
            <p className="text-[10px] text-[var(--text-muted)]">A busca acontece somente nos cards carregados.</p>
          </div>
          <button type="button" onClick={() => setFilterOpen(false)} aria-label="Fechar filtros" className="rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
            <X size={13} />
          </button>
        </div>
        <div className="space-y-1.5">
          {([
            ["today", "Vence hoje", CalendarRange],
            ["overdue", "Atrasadas", AlertTriangle],
            ["habits", "Tarefas de hábito", Flame],
            ["notes", "Possui nota vinculada", FileText],
            ["entities", "Possui entity vinculada", UserRound],
          ] as const).map(([key, label, Icon]) => (
            <label key={key} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">
              <input type="checkbox" checked={filters[key]} onChange={() => toggleFilter(key)} className="h-3.5 w-3.5 accent-[var(--accent)]" />
              <Icon size={13} className="text-[var(--text-muted)]" />
              {label}
            </label>
          ))}
        </div>
        <div className="my-2 h-px bg-[var(--border-subtle)]" />
        <fieldset>
          <legend className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Status</legend>
          <div className="grid grid-cols-3 gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-input)]/70 p-0.5">
            {(["all", "open", "completed"] as const).map((status) => (
              <button key={status} type="button" aria-pressed={filters.status === status} onClick={() => setFilters((current) => ({ ...current, status }))} className={`rounded-md px-1.5 py-1.5 text-[10px] font-medium transition-colors ${filters.status === status ? "bg-amber-500/15 text-[var(--text-accent)]" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`}>
                {status === "all" ? "Todas" : status === "open" ? "Abertas" : "Feitas"}
              </button>
            ))}
          </div>
        </fieldset>
        <button type="button" onClick={clearFilters} disabled={!filtersActive} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--border-subtle)] px-2 py-1.5 text-[10px] font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-35">
          <RefreshCw size={11} />
          Limpar filtros
        </button>
      </div>
    );
  };

  const editingHabitOccurrence = editTask?.task_kind === "habit";
  const panelReadOnly = !canMutate || Boolean(panelTaskId && pendingTaskIds.has(panelTaskId));
  const editReadOnly = !canMutate || Boolean(editTask && pendingTaskIds.has(editTask.id));

  const renderShortcuts = () => {
    if (!shortcutsOpen) return null;
    return (
      <div ref={shortcutsPopoverRef} role="dialog" aria-label="Atalhos do quadro" className="absolute right-0 top-[calc(100%+8px)] z-40 w-64 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card-elevated)] p-3 shadow-2xl">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-[var(--text-primary)]">Atalhos do quadro</p>
          <button type="button" onClick={() => setShortcutsOpen(false)} aria-label="Fechar atalhos" className="rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"><X size={13} /></button>
        </div>
        <dl className="space-y-1.5 text-[11px] text-[var(--text-secondary)]">
          <div className="flex items-center justify-between gap-3"><dt>Nova tarefa</dt><dd><kbd className="rounded border border-[var(--border-subtle)] px-1.5 py-0.5 text-[10px]">N</kbd></dd></div>
          <div className="flex items-center justify-between gap-3"><dt>Criar rascunho</dt><dd><kbd className="rounded border border-[var(--border-subtle)] px-1.5 py-0.5 text-[10px]">Enter</kbd></dd></div>
          <div className="flex items-center justify-between gap-3"><dt>Concluir card</dt><dd><kbd className="rounded border border-[var(--border-subtle)] px-1.5 py-0.5 text-[10px]">Espaço</kbd></dd></div>
          <div className="flex items-center justify-between gap-3"><dt>Navegar cards</dt><dd><kbd className="rounded border border-[var(--border-subtle)] px-1.5 py-0.5 text-[10px]">↑ ↓ ← →</kbd></dd></div>
          <div className="flex items-center justify-between gap-3"><dt>Cancelar / fechar</dt><dd><kbd className="rounded border border-[var(--border-subtle)] px-1.5 py-0.5 text-[10px]">Esc</kbd></dd></div>
        </dl>
      </div>
    );
  };

  return (
    <div className="kanban-surface flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--bg-board)]">
      <p key={feedback?.id ?? "idle"} className="sr-only" aria-live="polite" aria-atomic="true">
        {statusMessage}
      </p>

      <header className="shrink-0 border-b border-[var(--border-subtle)] bg-[var(--bg-card)]/55 px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-amber-500/25 bg-amber-500/10 text-[var(--text-accent)]">
              <CalendarRange size={16} />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold tracking-tight text-[var(--text-primary)]">
                  Semana {weekNumber !== null ? String(weekNumber).padStart(2, "0") : "—"}
                </h2>
                {board && (
                  <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${board.week.status === "open" && isCurrentWeek && !boardStale ? "border-emerald-500/30 bg-emerald-500/10 text-[var(--text-success)]" : "border-[var(--border-subtle)] bg-[var(--bg-input)] text-[var(--text-muted)]"}`}>
                    {board.week.status === "open" && isCurrentWeek && !boardStale ? <CheckCircle2 size={10} /> : <LockKeyhole size={10} />}
                    {board.week.status === "closed" ? "Fechada · leitura" : boardStale ? "Desatualizada" : isCurrentWeek ? "Aberta" : "Histórico · leitura"}
                  </span>
                )}
              </div>
              <p className="mt-0.5 truncate text-[11px] text-[var(--text-muted)]">
                {board ? `${board.week.year} · ${formatShortDate(board.week.week_start)} — ${formatShortDate(board.week.week_end)}` : semana ? `Semana ${semana}` : boardError ? "Semana indisponível" : "Carregando contexto da semana…"}
              </p>
            </div>
          </div>

          {isRefreshing && <span className="inline-flex items-center gap-1 text-[10px] text-[var(--text-muted)]"><Loader2 size={11} className="animate-spin" />Sincronizando</span>}
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-input)]/70 p-0.5" role="tablist" aria-label="Visualização do Kanban">
            {(["board", "insights"] as const).map((item) => (
              <button key={item} id={`kanban-tab-${item}`} type="button" role="tab" aria-controls={`kanban-panel-${item}`} aria-selected={tab === item} tabIndex={tab === item ? 0 : -1} onKeyDown={(event) => handleTabKeyDown(event, item)} onClick={() => setTab(item)} className={`rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors ${tab === item ? "bg-amber-500/15 text-[var(--text-accent)]" : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"}`}>
                {item === "board" ? "Board" : "Insights"}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-input)]/70 px-0.5 py-0.5">
            <button type="button" aria-label="Semana anterior" onClick={() => setSemana((current) => (current ? shiftWeekId(current, -1) : board ? shiftWeekId(board.week.id || isoWeekIdOf(new Date()), -1) : current))} disabled={loadPhase === "initial" || (!board && semana === null)} title="Semana anterior" className="rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-35"><ChevronLeft size={15} /></button>
            {semana === null ? <span className="px-2 text-[10px] font-medium text-[var(--text-accent)]">Semana aberta</span> : <button type="button" onClick={() => setSemana(null)} disabled={loadPhase === "initial"} title="Voltar para a semana aberta" className="rounded-md border border-amber-500/25 bg-amber-500/10 px-2 py-1 text-[10px] font-medium text-[var(--text-accent)] transition-colors hover:bg-amber-500/15">Atual</button>}
            <button type="button" aria-label="Próxima semana" onClick={() => setSemana((current) => (current ? shiftWeekId(current, 1) : board ? shiftWeekId(board.week.id || isoWeekIdOf(new Date()), 1) : current))} disabled={loadPhase === "initial" || (!board && semana === null)} title="Próxima semana" className="rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-35"><ChevronRight size={15} /></button>
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            <button type="button" onClick={() => setHabitsOpen(true)} title="Gerenciar hábitos globais" className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-input)]/70 px-2.5 py-1.5 text-[11px] font-medium text-[var(--text-muted)] transition-colors hover:border-amber-500/30 hover:text-[var(--text-primary)]">
              <Flame size={12} className="text-[var(--text-warning)]" />Hábitos{board && board.habits.length > 0 && <span className="rounded-full bg-[var(--bg-elevated)] px-1.5 text-[10px] tabular-nums text-[var(--text-secondary)]">{board.habits.length}</span>}
            </button>
            {board && !readOnly && isCurrentWeek ? (
              <button type="button" disabled={!canMutate || createState === "creating"} onClick={(event) => openComposer(focusedColumnRef.current, event.currentTarget)} className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-[11px] font-semibold text-[#241a05] shadow-sm shadow-amber-500/20 transition-colors hover:bg-amber-400 disabled:cursor-wait disabled:opacity-60">
                {canMutate ? <Plus size={13} /> : <Loader2 size={13} className="animate-spin" />}
                {canMutate ? "Nova tarefa" : boardStale ? "Atualize o quadro" : "Sincronizando…"}
              </button>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] px-3 py-1.5 text-[11px] text-[var(--text-muted)]">
                {readOnly ? <LockKeyhole size={12} /> : <Loader2 size={12} className="animate-spin" />}
                {readOnly ? (board?.week.status === "closed" ? "Semana fechada" : "Histórico · leitura") : boardStale ? "Atualize o quadro" : isInitialLoading ? "Carregando…" : "Indisponível"}
              </span>
            )}
          </div>
        </div>
        {renderSummary()}
      </header>

      {boardError && (
        <div role="alert" className="flex shrink-0 items-start gap-2.5 border-b border-red-500/25 bg-red-500/10 px-4 py-2.5 text-xs text-[var(--text-danger)] sm:px-5">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-[var(--text-danger)]" />
          <div className="min-w-0 flex-1"><p className="font-medium">{boardStale ? "O quadro está desatualizado. Mutações aguardam uma reconciliação." : "Não foi possível atualizar o quadro."}</p><details className="mt-0.5 text-[11px] opacity-75"><summary className="cursor-pointer">Ver detalhes</summary><p className="mt-1 break-words">{boardError}</p></details></div>
          <button type="button" onClick={() => { setBoardError(null); void load(semana); }} className="inline-flex shrink-0 items-center gap-1 rounded-md border border-red-400/25 px-2 py-1 text-[10px] font-medium transition-colors hover:bg-red-500/10"><RefreshCw size={11} />Tentar novamente</button>
          <button type="button" onClick={() => setBoardError(null)} aria-label="Fechar erro" className="shrink-0 rounded-md px-1.5 py-1 text-[10px] opacity-75 hover:bg-red-500/10"><X size={12} /></button>
        </div>
      )}

      {mutationError && (
        <div role="alert" className="flex shrink-0 items-start gap-2.5 border-b border-amber-500/25 bg-amber-500/[0.07] px-4 py-2.5 text-xs text-[var(--text-warning)] sm:px-5">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1"><p className="font-medium">A última ação não foi concluída.</p><p className="mt-0.5 break-words opacity-80">{mutationError}</p></div>
          <button type="button" onClick={() => setMutationError(null)} aria-label="Fechar erro da ação" className="shrink-0 rounded-md px-1.5 py-1 text-[10px] opacity-75 hover:bg-amber-500/10"><X size={12} /></button>
        </div>
      )}

      {tab === "board" && board && (
        <div className="shrink-0 border-b border-[var(--border-subtle)] bg-[var(--bg-card)]/35 px-4 py-2.5 sm:px-5">
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative min-w-[190px] flex-1 sm:max-w-[280px]">
              <span className="sr-only">Buscar tarefas por título</span>
              <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input value={filters.query} onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))} placeholder="Buscar títulos…" className="h-8 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-input)]/80 pl-8 pr-8 text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-amber-500/50" />
              {filters.query && <button type="button" aria-label="Limpar busca" onClick={() => setFilters((current) => ({ ...current, query: "" }))} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"><X size={12} /></button>}
            </label>
            <div className="relative">
              <button ref={filterButtonRef} type="button" onClick={() => setFilterOpen((current) => !current)} aria-expanded={filterOpen} aria-haspopup="dialog" className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium transition-colors ${filtersActive ? "border-amber-500/35 bg-amber-500/10 text-[var(--text-accent)]" : "border-[var(--border-subtle)] bg-[var(--bg-input)]/80 text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`}>
                <SlidersHorizontal size={13} />Filtros{filterChips.length > 0 && <span className="rounded-full bg-amber-500/20 px-1.5 text-[10px] tabular-nums">{filterChips.length}</span>}
              </button>
              {renderFilterPopover()}
            </div>
            <span className="ml-auto text-[10px] tabular-nums text-[var(--text-muted)]" aria-live="polite">{visibleTasks.length} de {tasks.length} {tasks.length === 1 ? "tarefa" : "tarefas"}</span>
            <div className="relative">
              <button ref={shortcutsButtonRef} type="button" onClick={() => setShortcutsOpen((current) => !current)} aria-expanded={shortcutsOpen} aria-haspopup="dialog" aria-label="Ver atalhos do quadro" title="Atalhos do quadro" className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-input)]/80 text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"><Keyboard size={14} /></button>
              {renderShortcuts()}
            </div>
          </div>
          {filterChips.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5" aria-label="Filtros ativos">
              <span className="text-[10px] text-[var(--text-muted)]">Ativos:</span>
              {filterChips.map((chip) => <button key={`${chip.key}-${chip.label}`} type="button" onClick={() => removeFilterChip(chip.key)} className="inline-flex items-center gap-1 rounded-full border border-amber-500/25 bg-amber-500/[0.08] px-2 py-1 text-[10px] text-[var(--text-accent)] hover:bg-amber-500/15">{chip.label}<X size={10} /></button>)}
              <button type="button" onClick={clearFilters} className="rounded-full px-2 py-1 text-[10px] text-[var(--text-muted)] underline-offset-2 hover:text-[var(--text-primary)] hover:underline">Limpar filtros</button>
            </div>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-4" data-kanban-scroll onScroll={(event) => { if (tab === "board") boardScrollRef.current = event.currentTarget.scrollTop; else insightsScrollRef.current = event.currentTarget.scrollTop; }}>
        {tab === "insights" ? (
          <div id="kanban-panel-insights" role="tabpanel" aria-labelledby="kanban-tab-insights" aria-busy={insightsLoading} className="kanban-insights mx-auto max-w-6xl space-y-3">
            {semana !== null && <div className="flex items-start gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-input)]/60 px-3 py-2 text-[11px] text-[var(--text-muted)]"><Info size={13} className="mt-0.5 shrink-0 text-[var(--text-accent)]" /><span>Os Insights são agregados do ciclo atual. A semana <strong className="font-medium text-[var(--text-secondary)]">{semana}</strong> continua disponível no Board.</span></div>}
            {insightsError && <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-xs text-[var(--text-danger)]"><AlertTriangle size={14} className="mt-0.5 shrink-0" /><div className="flex-1"><p className="font-medium">Não foi possível carregar os insights.</p><p className="mt-1 opacity-75">{insightsError}</p></div><button type="button" onClick={() => void loadInsights(periodo)} className="rounded-md border border-red-400/25 px-2 py-1 text-[10px] hover:bg-red-500/10">Tentar novamente</button></div>}
            {insightsLoading && !insights ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Carregando insights">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-24 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)]/60 p-3"><div className="kanban-skeleton-bar h-2 w-20 rounded" /><div className="kanban-skeleton-bar mt-3 h-6 w-16 rounded" /><div className="kanban-skeleton-bar mt-2 h-2 w-24 rounded" /></div>)}</div>
            ) : !insightsLoading && !insights ? (
              <div className="flex min-h-[280px] flex-col items-center justify-center gap-2 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)]/45 text-center"><p className="text-sm text-[var(--text-secondary)]">Insights ainda não estão disponíveis.</p><button type="button" onClick={() => void loadInsights(periodo)} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:border-amber-500/35"><RefreshCw size={12} />Tentar novamente</button></div>
            ) : insights ? (
              <><StreakCards insights={insights} /><div className="kanban-insights-grid grid grid-cols-1 gap-4"><section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)]/55 p-3"><DayBars bars={insights.bars} /></section><section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)]/55 p-3"><WeekTrend trend={insights.trend} /></section></div><section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)]/55 p-3"><EstimatedVsRealized lines={insights.lines} periodo={insights.periodo} onToggle={setPeriodo} loading={insightsLoading} /></section></>
            ) : null}
          </div>
        ) : (
          <div id="kanban-panel-board" role="tabpanel" aria-labelledby="kanban-tab-board" aria-busy={loadPhase !== "idle"} className="relative min-h-full">
            {isInitialLoading ? skeletonBoard : board ? (
              <div className="relative" aria-busy={loadPhase !== "idle"}>
                {isRefreshing && (
                  <div className="absolute right-0 top-0 z-10 inline-flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] px-2 py-1 text-[10px] text-[var(--text-muted)] shadow-sm">
                    <Loader2 size={11} className="animate-spin" />
                    Reconciliando…
                  </div>
                )}
                {filtersActive && visibleTasks.length === 0 && (
                  <div className="kanban-filtered-empty mb-3 flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-card)]/45 px-4 py-5 text-center" role="status">
                    <Filter size={16} className="text-[var(--text-muted)]" />
                    <p className="text-xs font-medium text-[var(--text-secondary)]">Nenhuma tarefa corresponde aos filtros ativos.</p>
                    <button type="button" onClick={clearFilters} className="text-[11px] text-[var(--text-accent)] underline-offset-2 hover:underline">Limpar filtros</button>
                  </div>
                )}
                <div className="grid min-h-0 grid-cols-1 gap-3 md:grid-cols-3">
                  {COLUMNS.map((column) => {
                    const totalColumnTasks = byColumn[column.id];
                    const columnTasks = visibleByColumn[column.id];
                    const meta = STAGE_META[column.id];
                    const dropActive = dropTarget?.column === column.id;
                    const dropIndex = dropActive && dropTarget ? dropTarget.index : -1;
                    const otherTasks = columnTasks.filter((task) => task.id !== draggingTaskId);
                    const dropBeforeId = dropIndex >= 0 && dropIndex < otherTasks.length ? otherTasks[dropIndex]?.id : null;
                    const showDropAtEnd = dropActive && otherTasks.length > 0 && dropIndex >= otherTasks.length;
                    const invalidWhileDragging = Boolean(draggingTaskId && !canMutate);
                    return (
                      <section
                        key={column.id}
                        data-column={column.id}
                        onFocusCapture={() => { focusedColumnRef.current = column.id; }}
                        onDragOver={(event) => handleDragOver(event, column.id)}
                        onDragLeave={(event) => handleDragLeave(event, column.id)}
                        onDrop={(event) => handleDrop(event, column.id)}
                        className={`kanban-column flex min-h-[300px] min-w-0 flex-col rounded-2xl border bg-[var(--bg-column)]/75 transition-[border-color,background-color,box-shadow] duration-150 ${dropActive ? "kanban-column-drop-active border-amber-400/60 bg-amber-500/[0.04] shadow-[inset_0_0_0_1px_rgba(245,158,11,0.12)]" : invalidWhileDragging ? "kanban-column-drop-invalid border-red-500/25" : "border-[var(--border-subtle)]"}`}
                        aria-label={`${column.label}: ${columnTasks.length} tarefas`}
                        title={meta.hint}
                      >
                        <header className="flex shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-2.5">
                          <span className={`h-2 w-2 rounded-full ${meta.dot}`} aria-hidden="true" />
                          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">{column.label}</h3>
                          <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-input)] px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-[var(--text-muted)]">{filtersActive ? `${columnTasks.length}/${totalColumnTasks.length}` : totalColumnTasks.length}</span>
                          {!readOnly && isCurrentWeek && <button type="button" disabled={!canMutate || createState === "creating"} onClick={(event) => openComposer(column.id, event.currentTarget)} aria-label={`Nova tarefa em ${column.label}`} title={`Nova tarefa em ${column.label}`} className="ml-auto rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-accent)] disabled:cursor-wait disabled:opacity-40"><Plus size={14} /></button>}
                        </header>

                        <div data-kanban-column-scroll data-column={column.id} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
                          {canMutate && addingTo === column.id && (
                            <form className="kanban-composer rounded-xl border border-amber-500/35 bg-[var(--bg-card)]/90 p-2 shadow-sm" onSubmit={(event) => { event.preventDefault(); void createTask(); }} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeComposer(); } }}>
                              <div className="mb-1.5 flex items-center justify-between gap-2"><p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-accent)]">Nova em {column.label}</p><button type="button" onClick={() => closeComposer()} disabled={createState === "creating"} aria-label="Fechar criação de tarefa" className="rounded p-0.5 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-40"><X size={12} /></button></div>
                              <label className="sr-only" htmlFor={`kanban-create-${column.id}`}>Título da nova tarefa em {column.label}</label>
                              <input ref={composerInputRef} id={`kanban-create-${column.id}`} value={draft} onChange={(event) => { setDraft(event.target.value); if (createState === "error") { setCreateState("idle"); setCreateError(null); } }} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeComposer(); } }} placeholder="Título da tarefa…" aria-label={`Título da nova tarefa em ${column.label}`} aria-invalid={createState === "error"} className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] px-2.5 py-2 text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-amber-500/55" />
                              <label className="mt-2 block text-[10px] text-[var(--text-muted)]" htmlFor={`kanban-create-due-${column.id}`}>Prazo <span className="text-[var(--text-muted)]">(opcional)</span></label>
                              <input id={`kanban-create-due-${column.id}`} type="date" value={draftDue} onChange={(event) => setDraftDue(event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] px-2 py-1.5 text-[11px] text-[var(--text-primary)] outline-none focus:border-amber-500/55" />
                              {createError && <p className="mt-2 text-[10px] text-[var(--text-danger)]" role="alert">{createError}</p>}
                              <div className="mt-2 flex items-center justify-end gap-1.5">
                                <button type="button" onClick={() => closeComposer()} disabled={createState === "creating"} className="rounded-md px-2 py-1 text-[10px] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40">Cancelar</button>
                                <button type="submit" disabled={!draft.trim() || createState === "creating"} className="inline-flex items-center gap-1 rounded-md bg-amber-500 px-2 py-1 text-[10px] font-semibold text-[#241a05] transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40">{createState === "creating" && <Loader2 size={11} className="animate-spin" />}{createState === "creating" ? "Criando…" : "Criar"}</button>
                              </div>
                              <p className="mt-2 text-[9px] text-[var(--text-muted)]">Enter cria · Esc cancela</p>
                            </form>
                          )}

                          {draggingTaskId && canMutate && columnTasks.length === 0 && (
                            <div className={`kanban-drop-zone flex min-h-[112px] items-center justify-center rounded-xl border border-dashed px-3 text-center text-[10px] ${dropActive ? "border-amber-400/65 bg-amber-500/10 text-[var(--text-accent)]" : "border-[var(--border-subtle)] text-[var(--text-muted)]"}`} aria-label={`Zona de destino ${column.label}`}>
                              {dropActive ? `Soltar em ${column.label}` : `Arraste para ${column.label}`}
                            </div>
                          )}

                          {columnTasks.map((task) => {
                            const visibleIndex = columnTasks.findIndex((item) => item.id === task.id);
                            return (
                              <React.Fragment key={task.id}>
                                {renderDropLine(dropBeforeId === task.id)}
                                <KanbanCard
                                  task={task}
                                  columns={COLUMNS}
                                  readOnly={readOnly}
                                  mutationsDisabled={!canMutate}
                                  links={linksByTask.get(task.id)}
                                  habits={board.habits ?? []}
                                  isDragging={draggingTaskId === task.id}
                                  isPending={pendingTaskIds.has(task.id)}
                                  today={today}
                                  canReorderUp={visibleIndex > 0}
                                  canReorderDown={visibleIndex >= 0 && visibleIndex < columnTasks.length - 1}
                                  onDragStart={(draggedTask) => { draggingTaskIdRef.current = draggedTask.id; setDraggingTaskId(draggedTask.id); setDropTarget(null); }}
                                  onDragEnd={() => { draggingTaskIdRef.current = null; setDraggingTaskId(null); setDropTarget(null); }}
                                  onMove={moveTask}
                                  onReorder={reorderTask}
                                  onOpen={openEditor}
                                  onRequestDelete={requestDelete}
                                  onMenuOpenChange={handleMenuOpenChange}
                                  onUnlink={(linkedTask, slug) => { void unlinkTask(linkedTask, slug); }}
                                />
                              </React.Fragment>
                            );
                          })}

                          {renderDropLine(showDropAtEnd)}
                          {!isInitialLoading && columnTasks.length === 0 && addingTo !== column.id && renderEmptyColumn(column, columnTasks.length, totalColumnTasks.length)}
                        </div>
                      </section>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="flex min-h-[300px] flex-col items-center justify-center gap-2 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)]/45 text-center"><p className="text-sm text-[var(--text-secondary)]">Não foi possível abrir o quadro.</p><button type="button" onClick={() => void load(semana)} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:border-amber-500/35"><RefreshCw size={12} />Tentar novamente</button></div>
            )}
          </div>
        )}
      </div>

      {feedback && (
        <div aria-live="off" className={`kanban-feedback pointer-events-auto fixed bottom-4 right-4 z-[70] flex max-w-[min(360px,calc(100vw-32px))] items-start gap-2 rounded-xl border px-3 py-2.5 text-xs shadow-xl ${feedback.tone === "error" ? "border-red-500/30 bg-[var(--bg-card-elevated)] text-[var(--text-danger)]" : feedback.tone === "success" ? "border-emerald-500/30 bg-[var(--bg-card-elevated)] text-[var(--text-success)]" : "border-amber-500/30 bg-[var(--bg-card-elevated)] text-[var(--text-secondary)]"}`}>
          {feedback.tone === "error" ? <AlertTriangle size={14} className="mt-0.5 shrink-0" /> : feedback.tone === "success" ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> : <Info size={14} className="mt-0.5 shrink-0" />}
          <span className="min-w-0 flex-1 leading-relaxed">{feedback.message}</span>
          <button type="button" onClick={() => setFeedback(null)} aria-label="Fechar aviso" className="rounded p-0.5 opacity-60 hover:opacity-100"><X size={12} /></button>
        </div>
      )}

      {panelTask && <TaskEditorPanel task={panelTask} links={panelLinks} readOnly={panelReadOnly} deleteOpen={!!deleteTask} onClose={closePanel} onRequestDelete={requestDelete} />}

      {editTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={closeEditTask}>
          <motion.div role="dialog" aria-modal="true" aria-labelledby="habit-task-dialog-title" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.15 }} onClick={(event) => event.stopPropagation()} className="w-full max-w-md rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5 shadow-2xl">
            <h3 id="habit-task-dialog-title" className="mb-4 text-sm font-semibold text-[var(--text-primary)]">{editTask.task_kind === "habit" ? "Tarefa de hábito" : "Editar tarefa"}</h3>
            <label className="mb-1 block text-[11px] font-medium text-[var(--text-muted)]" htmlFor="habit-task-title">Título</label>
            <input id="habit-task-title" autoFocus value={editTitulo} onChange={(event) => setEditTitulo(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !editReadOnly && !editingHabitOccurrence) void saveEditor(); }} disabled={editReadOnly || editingHabitOccurrence} className="mb-3 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] px-3 py-2 text-[13px] text-[var(--text-primary)] outline-none focus:border-amber-500/50 disabled:opacity-60" />
            <label className="mb-1 block text-[11px] font-medium text-[var(--text-muted)]" htmlFor="habit-task-due">Prazo (opcional)</label>
            <input id="habit-task-due" type="date" value={editDue} onChange={(event) => setEditDue(event.target.value)} disabled={editReadOnly || editingHabitOccurrence} className="mb-4 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] px-3 py-2 text-[13px] text-[var(--text-primary)] outline-none focus:border-amber-500/50 disabled:opacity-60" />
            {editingHabitOccurrence && <p className="mb-3 border-t border-[var(--border-subtle)] pt-3 text-[11px] text-[var(--text-muted)]">Ocorrência gerada pelo hábito. Título, prazo e cor são definidos no hábito para preservar a métrica; use a ação do card para registrar a conclusão.</p>}
            {readOnly && <p className="mb-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-input)] px-2.5 py-2 text-[11px] text-[var(--text-muted)]">Esta semana está somente leitura. O conteúdo permanece disponível para consulta.</p>}
            <div className="flex items-center justify-between gap-2">
              {editTask.task_kind === "habit" && (
                <button type="button" onClick={openHabitEditorFromTask} disabled={editReadOnly} className="inline-flex items-center gap-1 rounded-lg border border-amber-500/30 px-3 py-1.5 text-xs text-[var(--text-accent)] hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-40">
                  <Flame size={11} className="text-[var(--text-warning)]" />
                  {readOnly ? "Somente leitura" : "Editar hábito"}
                </button>
              )}
              {editTask.task_kind !== "habit" && (
                <button type="button" onClick={() => requestDelete(editTask)} disabled={editReadOnly} className="rounded-lg border border-red-500/30 px-3 py-1.5 text-xs text-[var(--text-danger)] hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40">
                  Excluir
                </button>
              )}
              <div className="flex items-center gap-2">
                <button type="button" onClick={closeEditTask} className="rounded-lg border border-[var(--border-subtle)] px-3 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--bg-hover)]">Fechar</button>
                {!editingHabitOccurrence && <button type="button" onClick={() => void saveEditor()} disabled={editReadOnly || !editTitulo.trim()} className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-medium text-[#241a05] hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40">Salvar</button>}
              </div>
            </div>
          </motion.div>
        </div>
      )}

      <HabitModal isOpen={habitsOpen} onClose={closeHabitModal} initialHabitId={editingHabitId} />
      <DeleteConfirmModal isOpen={!!deleteTask} sessionTitle={deleteTask?.titulo ?? ""} busy={isDeleting} title="Excluir tarefa" description="A tarefa será desvinculada do quadro. Notas `.md` associadas permanecem no cofre." onConfirm={() => { void confirmDelete(); }} onCancel={() => setDeleteTask(null)} />
      {isDeleting && <span className="sr-only" aria-live="polite">Excluindo tarefa…</span>}
    </div>
  );
};
