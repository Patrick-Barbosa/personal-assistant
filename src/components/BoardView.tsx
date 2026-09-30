import { useEffect, useMemo, useState } from "react";
import { DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { Check, Sparkles, StickyNote } from "lucide-react";
import { getDay } from "date-fns";
import { api } from "../api";
import { DAY_LABELS, TRAY, WEEK_PLACES, categoryColor, categoryLabel, type Board, type Category, type Place, type Task } from "../types";
import TaskDetail from "./TaskDetail";
import PageHeader from "./PageHeader";

interface Props {
  board: Board;
  refresh: () => void;
  onPlanWithAI: () => void;
}

const PLACE_LABEL: Record<Place, string> = {
  backlog: "Backlog",
  Seg: "Seg",
  Ter: "Ter",
  Qua: "Qua",
  Qui: "Qui",
  Sex: "Sex",
  Sab: "Sáb",
  Dom: "Dom",
  done: "Feito",
  [TRAY]: "A agendar",
};

function Card({ task, showDay, onChanged, onOpen, cats }: { task: Task; showDay: boolean; onChanged: () => void; onOpen: () => void; cats: Category[] }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id });

  async function remove(e: React.MouseEvent) {
    e.stopPropagation();
    if (!window.confirm(`Excluir a tarefa "${task.titulo}"?`)) return;
    await api.deleteTask(task.id);
    onChanged();
  }

  async function toggleDone(e: React.MouseEvent) {
    e.stopPropagation();
    const dest =
      task.column === "done"
        ? (task.day_label && (DAY_LABELS as readonly string[]).includes(task.day_label) ? task.day_label : "backlog")
        : "done";
    await api.placeTask(task.id, dest, 999);
    onChanged();
  }

  const done = task.column === "done";

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
      className={`cursor-grab touch-pan-y select-none rounded-[16px] border border-[#d9d9d9] bg-[#ffffff] p-3 transition-colors hover:border-[#141414]/40 active:cursor-grabbing ${isDragging ? "opacity-25" : ""}`}
      title="Arraste para mover"
    >
      <div className="flex items-center gap-2">
        <button
          onClick={toggleDone}
          aria-label={done ? `Reabrir ${task.titulo}` : `Concluir ${task.titulo}`}
          title={done ? "Reabrir" : "Concluir"}
          className="flex h-8 w-8 shrink-0 items-center justify-center transition-transform duration-150 active:scale-95"
        >
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-[8px] border transition-colors ${done ? "border-[#141414] bg-[#141414] text-[#ffffff]" : "border-[#141414]/30 text-transparent hover:border-[#141414] hover:text-[#141414]/40"}`}
          >
            <Check size={14} strokeWidth={3.5} aria-hidden="true" />
          </span>
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          title={task.titulo}
          className={`min-w-0 flex-1 truncate text-left text-sm font-semibold ${done ? "text-[#141414]/45 line-through" : "text-[#141414]"}`}
        >
          {task.titulo}
        </button>
        {task.categoria && (
          <span className="flex max-w-[120px] shrink-0 items-center gap-1.5 text-[11px] font-semibold text-[#141414]/55" title={categoryLabel(task.categoria, cats)}>
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: categoryColor(task.categoria, cats) }} />
            <span className="truncate">{categoryLabel(task.categoria, cats)}</span>
          </span>
        )}
        {showDay && task.day_label && (
          <span className="shrink-0 rounded-full border border-[#d9d9d9] bg-[#f5f5f5] px-2 py-px text-[11px] font-semibold text-[#141414]">{task.day_label}</span>
        )}
        {task.note_md && (
          <span className="shrink-0 text-[#141414]/50" title="Tem nota .md">
            <StickyNote size={13} aria-hidden="true" />
          </span>
        )}
        <button onClick={remove} aria-label={`Excluir tarefa ${task.titulo}`} className="shrink-0 rounded px-1.5 py-1 text-xs text-[#141414]/40 transition-colors hover:text-[#ff8400]" title="Excluir">
          ✕
        </button>
      </div>
    </div>
  );
}

function PlaceColumn({ place, tasks, hint, wide, isToday, onChanged, onOpen, cats }: { place: Place; tasks: Task[]; hint?: string; wide?: boolean; isToday?: boolean; onChanged: () => void; onOpen: (t: Task) => void; cats: Category[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: `place-${place}` });
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const isDay = (DAY_LABELS as readonly string[]).includes(place);
  const doneCount = tasks.filter((t) => t.column === "done").length;

  async function quickAdd(e: React.FormEvent) {
    e.preventDefault();
    const titulo = title.trim();
    if (!titulo) return;
    setTitle("");
    setAdding(false);
    const created = await api.createTask(titulo);
    if (place !== "backlog") await api.placeTask(created.id, place, tasks.length);
    onChanged();
  }

  return (
    <div ref={setNodeRef} className={`flex min-h-[180px] flex-col overflow-hidden rounded-[16px] border p-3 ${wide ? "sm:row-span-2" : ""} ${isOver || isToday ? "border-[#141414] bg-[#ffffff]" : "border-[#d9d9d9] bg-[#ffffff]/70"}`}>
      <div className="mb-2.5">
        <h2 className="flim-nav font-bold tabular-nums text-[#141414]">
          {PLACE_LABEL[place]} ({isDay && tasks.length > 0 ? `${doneCount}/` : ""}{tasks.length})
          {isToday && <span className="ml-1.5 rounded-[25px] bg-[#fecc33] px-2 py-px">Hoje</span>}
        </h2>
        {hint && <p className="mt-1 text-[11px] text-[#141414]/50">{hint}</p>}
      </div>
      <div className={`${wide ? "max-h-[500px]" : "max-h-[240px]"} space-y-2 overflow-y-auto pr-0.5`}>
        {tasks.length === 0 && !adding && (
          <button
            onClick={() => setAdding(true)}
            className="w-full rounded-[8px] border border-dashed border-[#d9d9d9] px-3 py-4 text-center text-xs text-[#141414]/40 transition-colors hover:border-[#141414]/40 hover:text-[#141414]"
          >
            {place === "backlog" ? "Vazio — peça à IA ou + crie aqui" : "Arraste para cá ou + crie aqui"}
          </button>
        )}
        {adding && (
          <form onSubmit={quickAdd} className="flex gap-1">
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => { if (!title.trim()) setAdding(false); }}
              onKeyDown={(e) => { if (e.key === "Escape") setAdding(false); }}
              placeholder="Nova tarefa…"
              aria-label={`Nova tarefa em ${PLACE_LABEL[place]}`}
              autoComplete="off"
              className="min-w-0 flex-1 rounded-[8px] border border-[#141414] bg-[#ffffff] px-3 py-2 text-sm text-[#141414] outline-none"
            />
            <button type="submit" className="flim-nav shrink-0 rounded-[8px] bg-[#141414] px-3 py-2 text-[#ffffff]">OK</button>
          </form>
        )}
        {tasks.map((t) => (
          <Card key={t.id} task={t} showDay={place === "backlog" || place === "done"} onChanged={onChanged} onOpen={() => onOpen(t)} cats={cats} />
        ))}
      </div>
    </div>
  );
}

function TrayStrip({ tasks, onChanged, onOpen, cats }: { tasks: Task[]; onChanged: () => void; onOpen: (t: Task) => void; cats: Category[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: `place-${TRAY}` });
  return (
    <div ref={setNodeRef} className={`mb-3 rounded-[16px] border border-dashed p-3 ${isOver ? "border-[#141414] bg-[#ffffff]" : "border-[#ff8400] bg-[#ffffff]"}`}>
      <p className="flim-nav mb-2 text-[#141414]/60">A agendar ({tasks.length}) — arraste para um dia</p>
      <div className="flex gap-2 overflow-x-auto">
        {tasks.map((t) => (
          <div key={t.id} className="w-[240px] shrink-0">
            <Card task={t} showDay={false} onChanged={onChanged} onOpen={() => onOpen(t)} cats={cats} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function BoardView({ board, refresh, onPlanWithAI }: Props) {
  const [draft, setDraft] = useState("");
  const [selected, setSelected] = useState<Task | null>(null);
  const [filter, setFilter] = useState("");
  const [dropError, setDropError] = useState("");
  const [pending, setPending] = useState<{ activeId: string; dest: Place; destIndex: number } | null>(null);
  const [overrides, setOverrides] = useState<Record<string, Place>>({});
  const [cats, setCats] = useState<Category[]>([]);
  const todayLabel = DAY_LABELS[(getDay(new Date()) + 6) % 7] as Place;

  useEffect(() => {
    api.listCategorias().then(setCats).catch(() => {});
  }, [board]);

  useEffect(() => {
    setOverrides({});
  }, [board]);

  const groups = useMemo(() => {
    const match = (t: Task) => !filter || (t.categoria ?? "") === filter;
    const g: Record<Place, Task[]> = { backlog: [], done: [], [TRAY]: [], Seg: [], Ter: [], Qua: [], Qui: [], Sex: [], Sab: [], Dom: [] };
    for (const t of [...board.todo, ...board.doing, ...board.done]) {
      if (!match(t)) continue;
      const ov = overrides[t.id];
      if (ov) {
        g[ov].push(t);
        continue;
      }
      if (t.column === "done") {
        // concluída fica no lugar, marcada — sem coluna Feito
        if (t.day_label && (DAY_LABELS as readonly string[]).includes(t.day_label)) g[t.day_label as Place].push(t);
        else g.backlog.push(t);
      } else if (t.column === "todo") {
        g.backlog.push(t);
      } else if (t.day_label && (DAY_LABELS as readonly string[]).includes(t.day_label)) {
        g[t.day_label as Place].push(t);
      } else {
        g[TRAY].push(t);
      }
    }
    return g;
  }, [board, filter, overrides]);

  const usedCats = useMemo(() => {
    const s = new Set<string>();
    for (const col of [...board.todo, ...board.doing, ...board.done]) {
      if (col.categoria) s.add(col.categoria);
    }
    return [...s];
  }, [board]);

  const ownerOf = useMemo(() => {
    const m = new Map<string, Place>();
    for (const p of [...WEEK_PLACES, TRAY] as Place[]) {
      for (const t of groups[p]) m.set(t.id, p);
    }
    return m;
  }, [groups]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [activeTask, setActiveTask] = useState<Task | null>(null);

  function findTask(id: string): Task | null {
    for (const col of [...board.todo, ...board.doing, ...board.done]) {
      if (col.id === id) return col;
    }
    return null;
  }

  function handleDragStart(e: DragStartEvent) {
    setActiveTask(findTask(String(e.active.id)));
  }

  function handleDragCancel() {
    setActiveTask(null);
  }

  async function add() {
    const titulo = draft.trim();
    if (!titulo) return;
    setDraft("");
    await api.createTask(titulo);
    refresh();
  }

  async function doMove(m: { activeId: string; dest: Place; destIndex: number }) {
    setDropError("");
    setOverrides((prev) => ({ ...prev, [m.activeId]: m.dest }));
    try {
      await api.placeTask(m.activeId, m.dest, m.destIndex);
      setPending(null);
      refresh();
    } catch {
      setOverrides((prev) => {
        const next = { ...prev };
        delete next[m.activeId];
        return next;
      });
      setPending(m);
      setDropError("Não consegui mover o card.");
    }
  }

  async function handleDragEnd(e: DragEndEvent) {
    const activeId = String(e.active.id);
    if (!e.over) {
      setActiveTask(null);
      return;
    }
    const overId = String(e.over.id);
    let dest: Place | null = null;
    let destIndex = 0;
    if (overId.startsWith("place-")) {
      dest = overId.slice(6) as Place;
      destIndex = groups[dest].length;
    } else {
      dest = ownerOf.get(overId) ?? null;
      if (dest) destIndex = groups[dest].findIndex((t) => t.id === overId);
    }
    if (!dest) {
      setActiveTask(null);
      return;
    }
    await doMove({ activeId, dest, destIndex });
    setActiveTask(null);
  }

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mx-auto flex min-h-0 w-full max-w-[1200px] flex-1 flex-col">
      <PageHeader
        eyebrow="Planejamento semanal"
        title="Semana"
        className="mb-3"
        sub={<>A IA preenche o <strong>Backlog</strong>. Arraste o card para os dias, clique para abrir. Concluir marca no lugar.</>}
        aside={
          <button onClick={onPlanWithAI} className="flim-nav flex items-center gap-1.5 rounded-[8px] bg-[#141414] px-4 py-2 text-[#ffffff] transition-colors hover:bg-[#2a2a2a]" title="A IA cria tarefas no backlog">
            <Sparkles size={14} aria-hidden="true" /> Planejar com IA
          </button>
        }
      />
      {dropError && (
        <p className="mb-2 flex items-center gap-2 text-sm text-[#ff8400]">
          <span>{dropError}</span>
          {pending && (
            <button onClick={() => doMove(pending)} className="flim-nav underline underline-offset-2 transition-colors hover:text-[#141414]">
              Tentar de novo
            </button>
          )}
        </p>
      )}
      {usedCats.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1">
          <button
            onClick={() => setFilter("")}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${filter === "" ? "border-[#141414] bg-[#141414] text-[#ffffff]" : "border-[#d9d9d9] bg-[#ffffff] text-[#141414]"}`}
          >
            Todas
          </button>
          {usedCats.map((c) => (
            <button
              key={c}
              onClick={() => setFilter(filter === c ? "" : c)}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${filter === c ? "border-[#141414] bg-[#141414] text-[#ffffff]" : "border-[#d9d9d9] bg-[#ffffff] text-[#141414]"}`}
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: categoryColor(c, cats) }} />
              {categoryLabel(c, cats)}
            </button>
          ))}
        </div>
      )}
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={handleDragCancel}>
        {groups[TRAY].length > 0 && (
          <TrayStrip tasks={groups[TRAY]} onChanged={refresh} onOpen={setSelected} cats={cats} />
        )}
        <div className="mb-3 flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="NOVA TAREFA NO BACKLOG…"
            aria-label="Nova tarefa no backlog"
            autoComplete="off"
            className="flim-nav flex-1 rounded-[160px] border border-[#d9d9d9] bg-[#ffffff] px-5 py-3 text-[#141414] outline-none transition-colors placeholder:text-[#141414]/40 focus:border-[#141414]"
          />
          <button onClick={add} className="flim-nav rounded-[8px] bg-[#141414] px-5 py-2 text-[#ffffff] transition-colors hover:bg-[#2a2a2a]">
            Adicionar
          </button>
        </div>
        <div className="grid flex-1 grid-cols-1 content-start gap-3 overflow-y-auto pb-2 sm:grid-cols-2 xl:grid-cols-3">
          <PlaceColumn place="backlog" tasks={groups.backlog} hint="A IA planeja aqui" wide onChanged={refresh} onOpen={setSelected} cats={cats} />
          {DAY_LABELS.map((d) => (
            <PlaceColumn key={d} place={d as Place} tasks={groups[d as Place]} isToday={d === todayLabel} onChanged={refresh} onOpen={setSelected} cats={cats} />
          ))}
        </div>
        <DragOverlay>
          {activeTask ? (
            <div className="w-[240px] rotate-2 rounded-[16px] border-2 border-[#141414] bg-[#ffffff] p-3">
              <p className="px-1 text-sm font-bold text-[#141414]">{activeTask.titulo}</p>
              {activeTask.categoria && (
                <p className="mt-1 px-1 text-[11px] text-[#141414]/60">{categoryLabel(activeTask.categoria, cats)}</p>
              )}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      </div>
      <TaskDetail task={selected} onClose={() => setSelected(null)} onSaved={refresh} />
    </div>
  );
}
