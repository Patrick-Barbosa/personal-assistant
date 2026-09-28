import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Bold,
  CheckSquare,
  Code,
  Eye,
  Italic,
  Link2,
  List,
  Loader2,
  Pencil,
  Plus,
  Quote,
  Trash2,
  Type,
  User,
  X,
} from "lucide-react";
import { api } from "../api";
import { AttachedNote, EntityItem, KanbanTask, NoteTitleItem, TaskLinks } from "../types";
import { AttachedNotesChips } from "./AttachedNotesChips";
import { MentionPopover } from "./MentionPopover";
import { SlashCommandPopover, SlashItem } from "./SlashCommandPopover";

interface TaskEditorPanelProps {
  task: KanbanTask;
  links: TaskLinks;
  readOnly: boolean;
  /** Another confirmation overlay is above the editor. */
  deleteOpen?: boolean;
  onClose: () => void;
  onRequestDelete: (task: KanbanTask) => void;
}

/** Atalhos Markdown do popover de `/` (o mesmo componente do InputBar). */
const SLASH_ITEMS: SlashItem[] = [
  { id: "md-h2", command: "## ", label: "## Título", desc: "Seção de segundo nível", icon: "H", hasScripts: false },
  { id: "md-todo", command: "- [ ] ", label: "☐ Tarefa", desc: "Item de checklist", icon: "☑️", hasScripts: false },
  { id: "md-list", command: "- ", label: "• Lista", desc: "Lista com marcadores", icon: "•", hasScripts: false },
  { id: "md-quote", command: "> ", label: "> Citação", desc: "Bloco de citação", icon: "❝", hasScripts: false },
  { id: "md-code", command: "```\n\n```", label: "Código", desc: "Bloco de código", icon: "⌨️", hasScripts: false },
  { id: "md-bold", command: "**negrito**", label: "**Negrito**", desc: "Texto em negrito", icon: "🅱️", hasScripts: false },
];

/** Caminho sintético de entity dentro do popover de menções. */
const entityPath = (id: string) => `entity:${id}`;

const isEntityItem = (item: NoteTitleItem) => item.vault === "entidade";

/** Editor rico da tarefa: nota `.md` no vault padrão com salvamento debounced. */
export const TaskEditorPanel: React.FC<TaskEditorPanelProps> = ({
  task,
  links,
  readOnly,
  deleteOpen = false,
  onClose,
  onRequestDelete,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const firstField = dialogRef.current?.querySelector<HTMLElement>(
        "input:not([disabled]), textarea:not([disabled])"
      );
      (firstField ?? dialogRef.current?.querySelector<HTMLElement>("button:not([disabled])"))?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  // ── Estado da nota ──
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [metaSaveState, setMetaSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);

  // ── Metadados da tarefa ──
  const [titulo, setTitulo] = useState(task.titulo);
  const [due, setDue] = useState(task.due_date ?? "");

  // ── Menções [[ ]] e comandos / ──
  const [notes, setNotes] = useState<NoteTitleItem[]>([]);
  const [entities, setEntities] = useState<EntityItem[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");
  const [slashIndex, setSlashIndex] = useState(0);

  // ── Picker de entities para vincular ──
  const [entityPickerOpen, setEntityPickerOpen] = useState(false);
  const [newEntity, setNewEntity] = useState("");
  const pickerRef = useRef<HTMLDivElement | null>(null);

  // Refs de flush no desmonte (o debounce pode estar pendente ao fechar).
  const dirtyRef = useRef(false);
  const contentRef = useRef<string | null>(null);
  const titleRef = useRef(task.titulo);
  const dueRef = useRef(task.due_date ?? "");
  const readOnlyRef = useRef(readOnly);
  const taskIdRef = useRef(task.id);
  const editVersionRef = useRef(0);
  const savedVersionRef = useRef(0);
  const bodySaveChainRef = useRef<Promise<void>>(Promise.resolve());
  const bodyTimerRef = useRef<number | null>(null);
  const metaVersionRef = useRef(0);
  const savedMetaVersionRef = useRef(0);
  const metaDirtyRef = useRef(false);
  const metaSaveChainRef = useRef<Promise<void>>(Promise.resolve());
  const closingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    contentRef.current = content;
  }, [content]);
  useEffect(() => {
    readOnlyRef.current = readOnly;
  }, [readOnly]);
  useEffect(() => {
    taskIdRef.current = task.id;
  }, [task.id]);

  // Uma reconciliação externa pode atualizar a tarefa enquanto o painel está
  // aberto. Só aceitamos o novo título/prazo quando o usuário não está editando
  // esses metadados; caso contrário, uma resposta antiga não pode sobrescrever
  // a edição local.
  useEffect(() => {
    if (metaDirtyRef.current || loading) return;
    const nextDue = task.due_date ?? "";
    if (titulo !== task.titulo) {
      titleRef.current = task.titulo;
      setTitulo(task.titulo);
    }
    if (due !== nextDue) {
      dueRef.current = nextDue;
      setDue(nextDue);
    }
  }, [due, loading, task.due_date, task.titulo, titulo]);

  const queueBodySave = useCallback((body: string, version: number, taskId: string) => {
    const operation = bodySaveChainRef.current
      .catch(() => undefined)
      .then(async () => {
        if (taskId === taskIdRef.current && version < editVersionRef.current) return;
        await api.saveTaskNote(taskId, body);
        if (!mountedRef.current || taskIdRef.current !== taskId) return;
        savedVersionRef.current = Math.max(savedVersionRef.current, version);
        dirtyRef.current = editVersionRef.current > savedVersionRef.current;
        if (dirtyRef.current) {
          setSaveState("saving");
        } else {
          setSaveState("saved");
          setError(null);
        }
      });
    bodySaveChainRef.current = operation;
    return operation;
  }, []);

  const flushBodySave = useCallback(async () => {
    if (bodyTimerRef.current !== null) {
      window.clearTimeout(bodyTimerRef.current);
      bodyTimerRef.current = null;
    }
    const body = contentRef.current;
    if (
      body === null ||
      readOnlyRef.current ||
      editVersionRef.current <= savedVersionRef.current
    ) {
      return;
    }
    setSaveState("saving");
    await queueBodySave(body, editVersionRef.current, taskIdRef.current);
  }, [queueBodySave]);

  const queueMetaSave = useCallback(
    (title: string, dueDate: string, version: number, taskId: string) => {
      const operation = metaSaveChainRef.current
        .catch(() => undefined)
        .then(async () => {
          if (taskId === taskIdRef.current && version < metaVersionRef.current) return;
          const cleanTitle = title.trim();
          if (!cleanTitle) throw new Error("Título da tarefa é obrigatório");
          await api.updateKanbanTask(taskId, cleanTitle, dueDate || null);
          if (!mountedRef.current || taskIdRef.current !== taskId) return;
          savedMetaVersionRef.current = Math.max(savedMetaVersionRef.current, version);
          metaDirtyRef.current = metaVersionRef.current > savedMetaVersionRef.current;
          if (metaDirtyRef.current) {
            setMetaSaveState("saving");
          } else {
            setMetaSaveState("saved");
            setError(null);
          }
        });
      metaSaveChainRef.current = operation;
      return operation;
    },
    []
  );

  const flushMetaSave = useCallback(async () => {
    if (readOnlyRef.current || !metaDirtyRef.current) return;
    setMetaSaveState("saving");
    await queueMetaSave(
      titleRef.current,
      dueRef.current,
      metaVersionRef.current,
      taskIdRef.current
    );
  }, [queueMetaSave]);

  // ── Carrega (ou cria) a nota canônica ao abrir ──
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setContent(null);
    setSaveState("idle");
    setMetaSaveState("idle");
    setError(null);
    taskIdRef.current = task.id;
    titleRef.current = task.titulo;
    dueRef.current = task.due_date ?? "";
    editVersionRef.current = 0;
    savedVersionRef.current = 0;
    dirtyRef.current = false;
    metaVersionRef.current = 0;
    savedMetaVersionRef.current = 0;
    metaDirtyRef.current = false;
    setTitulo(task.titulo);
    setDue(task.due_date ?? "");
    void (async () => {
      try {
        let current = task;
        if (!current.note_path && !readOnly) {
          current = await api.createTaskNote(current.id);
        }
        const body = current.note_path ? await api.getTaskNote(current.id) : "";
        if (cancelled) return;
        const nextContent = body ?? "";
        contentRef.current = nextContent;
        setContent(nextContent);
        dirtyRef.current = false;
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setContent("");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Recarrega somente ao trocar de tarefa — recargas do board preservam o id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  // ── Salvamento debounced (800ms) ──
  useEffect(() => {
    if (loading || readOnly || content === null || !dirtyRef.current) return;
    if (bodyTimerRef.current !== null) window.clearTimeout(bodyTimerRef.current);
    const version = editVersionRef.current;
    const taskId = taskIdRef.current;
    setSaveState("saving");
    bodyTimerRef.current = window.setTimeout(() => {
      bodyTimerRef.current = null;
      void queueBodySave(content, version, taskId).catch((err) => {
        if (!mountedRef.current || taskIdRef.current !== taskId) return;
        setSaveState("error");
        setError(err instanceof Error ? err.message : String(err));
      });
    }, 800);
    return () => {
      if (bodyTimerRef.current !== null) {
        window.clearTimeout(bodyTimerRef.current);
        bodyTimerRef.current = null;
      }
    };
  }, [content, loading, queueBodySave, readOnly]);

  // ── Flush ao fechar/desmontar ──
  useEffect(() => {
    return () => {
      const body = contentRef.current;
      if (dirtyRef.current && body !== null && !readOnlyRef.current) {
        void queueBodySave(body, editVersionRef.current, taskIdRef.current).catch((err) => {
          console.error("Falha ao salvar nota da tarefa", err);
        });
      }
      if (metaDirtyRef.current && !readOnlyRef.current) {
        void queueMetaSave(
          titleRef.current,
          dueRef.current,
          metaVersionRef.current,
          taskIdRef.current
        ).catch((err) => {
          console.error("Falha ao salvar metadados da tarefa", err);
        });
      }
    };
  }, [queueBodySave, queueMetaSave]);

  // ── Catálogo para menções (notas + entities) ──
  useEffect(() => {
    let cancelled = false;
    void api
      .listNoteTitles()
      .then((items) => {
        if (!cancelled) setNotes(items);
      })
      .catch(() => undefined);
    void api
      .listEntities(null, null)
      .then((items) => {
        if (!cancelled) setEntities(items);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Fecha o picker de entities ao clicar fora.
  useEffect(() => {
    if (!entityPickerOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setEntityPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [entityPickerOpen]);

  const refreshEntities = useCallback(() => {
    void api
      .listEntities(null, null)
      .then(setEntities)
      .catch(() => undefined);
  }, []);

  // ── Itens filtrados dos popovers ──
  const mentionItems = useMemo(() => {
    if (!mentionOpen) return [];
    const q = mentionQuery.toLowerCase().trim();
    const entityItems: NoteTitleItem[] = entities
      .filter((e) => !q || e.titulo.toLowerCase().includes(q))
      .map((e) => ({ title: e.titulo, vault: "entidade", path: entityPath(e.id) }));
    const noteItems = notes.filter((n) => !q || n.title.toLowerCase().includes(q));
    return [...entityItems, ...noteItems].slice(0, 8);
  }, [mentionOpen, mentionQuery, entities, notes]);

  const slashItems = useMemo(() => {
    if (!slashOpen) return [];
    const q = slashQuery.toLowerCase().trim();
    return SLASH_ITEMS.filter((item) => !q || item.label.toLowerCase().includes(q)).slice(0, 8);
  }, [slashOpen, slashQuery]);

  const availableEntities = useMemo(
    () => entities.filter((e) => !links.entities.some((linked) => linked.id === e.id)),
    [entities, links.entities]
  );

  // ── Notas/entities vinculadas como chips ──
  const noteChips: AttachedNote[] = useMemo(
    () =>
      links.notes.map((path) => ({
        title: path.replace(/\.md$/i, "").split("/").pop() ?? path,
        content: "",
        slug: path,
      })),
    [links.notes]
  );

  const setContentAndDirty = useCallback((next: string) => {
    contentRef.current = next;
    editVersionRef.current += 1;
    setContent(next);
    dirtyRef.current = true;
    setSaveState("saving");
  }, []);

  const setTitleAndDirty = useCallback((next: string) => {
    titleRef.current = next;
    metaVersionRef.current += 1;
    metaDirtyRef.current = true;
    setTitulo(next);
    setMetaSaveState("saving");
  }, []);

  const setDueAndDirty = useCallback((next: string) => {
    dueRef.current = next;
    metaVersionRef.current += 1;
    metaDirtyRef.current = true;
    setDue(next);
    setMetaSaveState("saving");
  }, []);

  /** Substitui o gatilho digitado antes do cursor por `insert`. */
  const replaceBeforeCursor = useCallback(
    (regex: RegExp, insert: string) => {
      const el = textareaRef.current;
      const text = contentRef.current ?? "";
      const cursor = el?.selectionStart ?? text.length;
      const before = text.slice(0, cursor);
      const after = text.slice(el?.selectionEnd ?? cursor);
      const match = before.match(regex);
      if (!match) return;
      const newBefore = before.slice(0, before.length - match[0].length) + insert;
      const next = newBefore + after;
      setContentAndDirty(next);
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(newBefore.length, newBefore.length);
      });
    },
    [setContentAndDirty]
  );

  /** Envolve a seleção com marcadores (toolbar). */
  const wrapSelection = useCallback(
    (markerBefore: string, markerAfter: string) => {
      const el = textareaRef.current;
      const text = contentRef.current ?? "";
      const start = el?.selectionStart ?? text.length;
      const end = el?.selectionEnd ?? start;
      const next =
        text.slice(0, start) + markerBefore + text.slice(start, end) + markerAfter + text.slice(end);
      setContentAndDirty(next);
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(start + markerBefore.length, end + markerBefore.length);
      });
    },
    [setContentAndDirty]
  );

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setContentAndDirty(text);

    const cursor = e.target.selectionStart || text.length;
    const before = text.slice(0, cursor);
    const slashMatch = before.match(/(?:^|\s)\/([a-zA-Z0-9_-]*)$/);
    const mentionMatch = before.match(/\[\[([^\[\]]*)$/);
    if (slashMatch) {
      setSlashOpen(true);
      setSlashQuery(slashMatch[1]);
      setMentionOpen(false);
    } else if (mentionMatch) {
      setMentionOpen(true);
      setMentionQuery(mentionMatch[1]);
      setSlashOpen(false);
    } else {
      setSlashOpen(false);
      setMentionOpen(false);
    }
  };

  const handleSelectSlash = (item: SlashItem) => {
    setSlashOpen(false);
    replaceBeforeCursor(/(?:^|\s)\/([a-zA-Z0-9_-]*)$/, item.command);
  };

  const handleSelectMention = (item: NoteTitleItem) => {
    setMentionOpen(false);
    if (isEntityItem(item)) {
      const entityId = item.path.slice("entity:".length);
      replaceBeforeCursor(/\[\[([^\[\]]*)$/, `[[${item.title}]] `);
      if (!readOnly) {
        void api.linkTaskEntity(task.id, entityId).catch((err) => {
          setError(err instanceof Error ? err.message : String(err));
        });
      }
      return;
    }
    replaceBeforeCursor(/\[\[([^\[\]]*)$/, `[[${item.title}]] `);
    // Menção em nota do vault padrão também vira vínculo no card.
    if (!readOnly && item.vault === "default") {
      void api.linkTaskNote(task.id, item.path).catch(() => undefined);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashOpen && slashItems.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIndex((prev) => (prev + 1) % slashItems.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIndex((prev) => (prev - 1 + slashItems.length) % slashItems.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        handleSelectSlash(slashItems[slashIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlashOpen(false);
        return;
      }
    }
    if (mentionOpen && mentionItems.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((prev) => (prev + 1) % mentionItems.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((prev) => (prev - 1 + mentionItems.length) % mentionItems.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        handleSelectMention(mentionItems[mentionIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionOpen(false);
        return;
      }
    }
    // Enter dentro do textarea insere quebra de linha normalmente (Shift+Enter
    // idem) — o corpo é Markdown livre, sem envio por Enter.
  };

  /** Persiste título/prazo (só quando realmente mudou). */
  const persistMeta = useCallback(async () => {
    if (readOnlyRef.current || !metaDirtyRef.current) return;
    const cleanTitle = titleRef.current.trim();
    if (!cleanTitle) {
      const message = "Título da tarefa é obrigatório";
      setError(message);
      setMetaSaveState("error");
      throw new Error(message);
    }
    setMetaSaveState("saving");
    try {
      await queueMetaSave(
        titleRef.current,
        dueRef.current,
        metaVersionRef.current,
        taskIdRef.current
      );
    } catch (err) {
      setMetaSaveState("error");
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }, [queueMetaSave]);

  const handleClose = useCallback(async () => {
    if (closingRef.current) return;
    closingRef.current = true;
    try {
      await flushMetaSave();
      await flushBodySave();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      closingRef.current = false;
    }
  }, [flushBodySave, flushMetaSave, onClose]);

  const handleRequestDelete = useCallback(async () => {
    if (readOnlyRef.current || closingRef.current) return;
    closingRef.current = true;
    try {
      await flushMetaSave();
      await flushBodySave();
      onRequestDelete(task);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      closingRef.current = false;
    }
  }, [flushBodySave, flushMetaSave, onRequestDelete, task]);

  const handlePickEntity = (entity: EntityItem) => {
    setEntityPickerOpen(false);
    if (readOnly) return;
    void api
      .linkTaskEntity(task.id, entity.id)
      .then(() => setError(null))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  };

  const handleCreateEntity = async () => {
    const nome = newEntity.trim();
    if (!nome || readOnly) return;
    setNewEntity("");
    setEntityPickerOpen(false);
    try {
      const created = await api.createEntity(nome, "livre");
      await api.linkTaskEntity(task.id, created.id);
      refreshEntities();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // Esc fecha os popovers primeiro; sem popover, fecha o painel.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || deleteOpen) return;
      if (slashOpen || mentionOpen || entityPickerOpen) {
        event.preventDefault();
        event.stopPropagation();
        setSlashOpen(false);
        setMentionOpen(false);
        setEntityPickerOpen(false);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      void handleClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [deleteOpen, entityPickerOpen, handleClose, mentionOpen, slashOpen]);

  const saveLabel =
    saveState === "saving"
      ? "Nota: salvando…"
      : saveState === "saved"
        ? "Nota: salva"
        : saveState === "error"
          ? "Nota: falha ao salvar"
          : "";
  const metaSaveLabel =
    metaSaveState === "saving"
      ? "Metadados: salvando…"
      : metaSaveState === "saved"
        ? "Metadados: salvos"
        : metaSaveState === "error"
          ? "Metadados: falha ao salvar"
          : "";

  const toolButton =
    "p-1.5 rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-40";

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      )
    );
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialogRef.current.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !dialogRef.current.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={() => void handleClose()}
    >
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-editor-title"
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.15 }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleDialogKeyDown}
        className="w-full max-w-2xl h-[78vh] max-h-[760px] rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] shadow-2xl flex flex-col overflow-hidden"
      >
        {/* ── Cabeçalho: título + prazo + estado ── */}
        <div className="px-4 pt-4 pb-2 shrink-0">
          <div className="flex items-center gap-2 mb-2">
            <Pencil size={13} className="text-[var(--text-accent)] shrink-0" />
            <span id="task-editor-title" className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Editor da tarefa
            </span>
            <span className="text-[10px] font-mono text-[var(--text-muted)]">{task.week_id}</span>
            <span className="rounded-full border border-[var(--border-subtle)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
              {task.task_column === "todo" ? "A fazer" : task.task_column === "doing" ? "Em progresso" : "Feito"}
            </span>
            {task.task_kind === "habit" && (
              <span className="rounded-full border border-orange-500/30 bg-orange-500/10 px-1.5 py-0.5 text-[10px] text-[var(--text-warning)]">
                Hábito
              </span>
            )}
            <button
              type="button"
              onClick={() => void handleClose()}
              aria-label="Fechar editor"
              className="ml-auto p-1 rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
            >
              <X size={15} />
            </button>
          </div>

          <input
            value={titulo}
            onChange={(e) => setTitleAndDirty(e.target.value)}
            onBlur={() => void persistMeta().catch(() => undefined)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void persistMeta().catch(() => undefined);
              }
            }}
            disabled={readOnly}
            placeholder="Título da tarefa"
            className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] px-3 py-2 text-sm font-medium text-[var(--text-primary)] outline-none focus:border-amber-500/50 disabled:opacity-60"
          />

          <div className="flex items-center gap-2 mt-2">
            <input
              type="date"
              value={due}
              onChange={(e) => setDueAndDirty(e.target.value)}
              onBlur={() => void persistMeta().catch(() => undefined)}
              disabled={readOnly}
              className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] px-2 py-1 text-xs text-[var(--text-primary)] outline-none focus:border-amber-500/50 disabled:opacity-60"
            />
            {saveLabel && (
              <span
                aria-live="polite"
                className={`text-[10px] ${
                  saveState === "error" ? "text-[var(--text-danger)]" : "text-[var(--text-muted)]"
                }`}
              >
                {saveLabel}
              </span>
            )}
            {metaSaveLabel && (
              <span
                aria-live="polite"
                className={`text-[10px] ${
                  metaSaveState === "error" ? "text-[var(--text-danger)]" : "text-[var(--text-muted)]"
                }`}
              >
                {metaSaveLabel}
              </span>
            )}
            {readOnly && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--border-subtle)] text-[var(--text-muted)]">
                Semana fechada · somente leitura
              </span>
            )}
            <button
              type="button"
              onClick={() => void handleRequestDelete()}
              disabled={readOnly || task.task_kind === "habit"}
              className="ml-auto inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg text-[var(--text-danger)] border border-red-500/30 hover:bg-red-500/10 transition-colors disabled:opacity-40"
            >
              <Trash2 size={12} />
              Excluir (desvincula)
            </button>
          </div>
        </div>

        {/* ── Toolbar Markdown ── */}
        <div className="flex items-center gap-1 px-4 py-1.5 border-t border-[var(--border-subtle)] shrink-0">
          <button type="button" title="Negrito" aria-label="Negrito" disabled={readOnly || preview} onClick={() => wrapSelection("**", "**")} className={toolButton}>
            <Bold size={13} />
          </button>
          <button type="button" title="Itálico" aria-label="Itálico" disabled={readOnly || preview} onClick={() => wrapSelection("*", "*")} className={toolButton}>
            <Italic size={13} />
          </button>
          <button type="button" title="Lista" aria-label="Lista" disabled={readOnly || preview} onClick={() => wrapSelection("- ", "")} className={toolButton}>
            <List size={13} />
          </button>
          <button type="button" title="Tarefa (checkbox)" aria-label="Tarefa (checkbox)" disabled={readOnly || preview} onClick={() => wrapSelection("- [ ] ", "")} className={toolButton}>
            <CheckSquare size={13} />
          </button>
          <button type="button" title="Citação" aria-label="Citação" disabled={readOnly || preview} onClick={() => wrapSelection("> ", "")} className={toolButton}>
            <Quote size={13} />
          </button>
          <button type="button" title="Código" aria-label="Código" disabled={readOnly || preview} onClick={() => wrapSelection("`", "`")} className={toolButton}>
            <Code size={13} />
          </button>
          <button type="button" title="Título" aria-label="Título" disabled={readOnly || preview} onClick={() => wrapSelection("## ", "")} className={toolButton}>
            <Type size={13} />
          </button>

          <button
            type="button"
            onClick={() => setPreview((v) => !v)}
            title={preview ? "Voltar a editar" : "Pré-visualizar Markdown"}
            className={`ml-auto inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] border transition-colors ${
              preview
                ? "border-amber-500/40 bg-amber-500/10 text-[var(--text-accent)]"
                : "border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            {preview ? <Pencil size={11} /> : <Eye size={11} />}
            {preview ? "Editar" : "Preview"}
          </button>
        </div>

        {/* ── Área de texto / preview (popovers acima do cursor) ── */}
        <div className="relative flex-1 min-h-0 px-4 pb-2 flex flex-col">
          <MentionPopover
            isOpen={mentionOpen}
            notes={mentionItems}
            selectedIndex={mentionIndex}
            onSelect={handleSelectMention}
          />
          <SlashCommandPopover
            isOpen={slashOpen}
            items={slashItems}
            selectedIndex={slashIndex}
            onSelect={handleSelectSlash}
          />

          {error && (
            <div role="alert" className="mb-1 flex items-center gap-2 text-[11px] bg-red-500/10 border border-red-500/25 text-[var(--text-danger)] rounded-lg px-2 py-1.5">
              <AlertTriangle size={12} className="shrink-0" />
              <span className="break-all">{error}</span>
              <button
                type="button"
                onClick={() => setError(null)}
                className="ml-auto px-1.5 rounded hover:bg-red-500/20"
              >
                Fechar
              </button>
            </div>
          )}

          {loading || content === null ? (
            <div className="flex-1 flex items-center justify-center gap-2 text-sm text-[var(--text-muted)]">
              <Loader2 size={15} className="animate-spin" />
              Abrindo nota…
            </div>
          ) : preview ? (
            <div className="markdown-body select-text flex-1 overflow-y-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] px-4 py-3 text-sm text-[var(--text-primary)]">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>
          ) : (
            <textarea
              ref={textareaRef}
              value={content}
              onChange={handleTextChange}
              onKeyDown={handleKeyDown}
              readOnly={readOnly}
              placeholder={
                task.task_kind === "habit"
                  ? "Tarefa de hábito: sem nota — só status e métrica."
                  : "Escreva o corpo da tarefa em Markdown… use [[ para mencionar notas e entities, / para atalhos."
              }
              className="select-text flex-1 w-full resize-none rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] px-3 py-2.5 text-sm leading-relaxed text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-amber-500/40 read-only:opacity-60"
            />
          )}
        </div>

        {/* ── Vínculos: notas + entities ── */}
        <div className="shrink-0 border-t border-[var(--border-subtle)] px-4 py-2.5 space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-[var(--text-muted)] mr-1">
              <Link2 size={10} />
              Vínculos
            </span>

            <AttachedNotesChips
              compact
              readOnly={readOnly}
              notes={noteChips}
              onRemove={(slug) => {
                if (readOnly) return;
                void api
                  .unlinkTaskNote(task.id, slug)
                  .then(() => setError(null))
                  .catch((err) => setError(err instanceof Error ? err.message : String(err)));
              }}
            />

            {links.entities.map((entity) => (
              <span
                key={entity.id}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs bg-sky-500/10 text-[var(--text-info)] border border-sky-500/25"
              >
                <User size={12} className="shrink-0" />
                <span className="truncate max-w-[140px] font-medium">{entity.titulo}</span>
                {!readOnly && (
                  <button
                    type="button"
                    aria-label={`Desvincular entity ${entity.titulo}`}
                    onClick={() => {
                      void api
                        .unlinkTaskEntity(task.id, entity.id)
                        .catch((err) => setError(err instanceof Error ? err.message : String(err)));
                    }}
                    className="hover:text-[var(--text-info)] rounded-sm p-0.5 transition-colors cursor-pointer"
                    title="Desvincular entity"
                  >
                    <X size={11} />
                  </button>
                )}
              </span>
            ))}

            {!readOnly && (
              <div className="relative" ref={pickerRef}>
                <button
                  type="button"
                  onClick={() => setEntityPickerOpen((v) => !v)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] border border-dashed border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-accent)] hover:border-amber-500/40 transition-colors"
                >
                  <Plus size={11} />
                  Entity
                </button>
                {entityPickerOpen && (
                  <div className="absolute bottom-full right-0 mb-2 w-64 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] shadow-2xl z-50 overflow-hidden">
                    <div className="px-3 py-1.5 border-b border-[var(--border-subtle)] text-[10px] font-semibold tracking-wider text-[var(--text-muted)] uppercase">
                      Vincular entity
                    </div>
                    <div className="max-h-44 overflow-y-auto p-1 space-y-0.5">
                      {availableEntities.length === 0 && (
                        <p className="px-2 py-1.5 text-[11px] text-[var(--text-muted)]">
                          Nenhuma entity disponível.
                        </p>
                      )}
                      {availableEntities.map((entity) => (
                        <button
                          key={entity.id}
                          type="button"
                          onClick={() => handlePickEntity(entity)}
                          className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-xs text-left text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] transition-colors"
                        >
                          <span className="truncate font-medium">{entity.titulo}</span>
                          <span className="text-[10px] font-mono ml-2 text-[var(--text-muted)]">
                            {entity.subtipo}
                          </span>
                        </button>
                      ))}
                    </div>
                    <div className="p-2 border-t border-[var(--border-subtle)] flex gap-1.5">
                      <input
                        value={newEntity}
                        onChange={(e) => setNewEntity(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void handleCreateEntity();
                          }
                        }}
                        placeholder="Nova entity…"
                        className="flex-1 min-w-0 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] px-2 py-1 text-xs text-[var(--text-primary)] outline-none focus:border-amber-500/50"
                      />
                      <button
                        type="button"
                        onClick={() => void handleCreateEntity()}
                        disabled={!newEntity.trim()}
                        className="px-2 py-1 rounded-lg text-xs font-medium text-[#241a05] bg-amber-500 hover:bg-amber-400 disabled:opacity-40 transition-colors"
                      >
                        Criar
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {readOnly ? (
            <p className="text-[10px] text-[var(--text-muted)]">
              Semana fechada · leitura e navegação de vínculos apenas.
            </p>
          ) : (
            <p className="text-[10px] text-[var(--text-muted)]">
              <kbd className="px-1 py-0.5 rounded bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[9px]">
                [[
              </kbd>{" "}
              mencionar notas/entities ·{" "}
              <kbd className="px-1 py-0.5 rounded bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[9px]">
                /
              </kbd>{" "}
              atalhos Markdown · salvamento automático
            </p>
          )}
        </div>
      </motion.div>
    </div>
  );
};
