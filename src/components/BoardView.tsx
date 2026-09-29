import { useMemo, useRef, useState } from "react";
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { GripVertical, Sparkles, StickyNote } from "lucide-react";
import { api } from "../api";
import { DAY_LABELS, TRAY, WEEK_PLACES, categoryColor, categoryLabel, type Board, type Place, type Task } from "../types";
import TaskDetail from "./TaskDetail";

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

function Card({ task, showDay, onChanged, onOpen, suppressClick }: { task: Task; showDay: boolean; onChanged: () => void; onOpen: () => void; suppressClick: () => boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id });

  async function remove(e: React.MouseEvent) {
    e.stopPropagation();
    await api.deleteTask(task.id);
    onChanged();
  }

  function handleClick() {
    if (suppressClick()) return;
    onOpen();
  }

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={handleClick}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
      className={`cursor-grab touch-pan-y select-none rounded-[16px] border border-[#d9d9d9] bg-[#ffffff] p-3 transition-colors hover:border-[#141414]/40 active:cursor-grabbing ${isDragging ? "opacity-50" : ""}`}
      title="Arraste para mover · clique para abrir"
    >
      <div className="mb-1 flex items-center gap-2 px-1 py-0.5">
        <GripVertical size={14} className="shrink-0 text-[#141414]/40" aria-hidden="true" />
        {task.categoria && (
          <span className="flex items-center gap-1 rounded-full bg-[#f5f5f5] px-2 py-0.5 text-[11px] font-semibold text-[#141414]" title={categoryLabel(task.categoria)}>
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: categoryColor(task.categoria) }} />
            {categoryLabel(task.categoria)}
          </span>
        )}
        {showDay && task.day_label && (
          <span className="rounded-full border border-[#30a81d] px-2 py-0.5 text-[11px] font-semibold text-[#141414]">{task.day_label}</span>
        )}
        {task.note_md && (
          <span className="text-[#141414]/50" title="Tem nota .md">
            <StickyNote size={13} aria-hidden="true" />
          </span>
        )}
      </div>
      <p className="px-1 text-sm text-[#141414]">
        {task.titulo}
      </p>
      <div className="mt-2 flex gap-1 px-1">
        <button onClick={remove} aria-label={`Excluir tarefa ${task.titulo}`} className="ml-auto rounded px-2 py-0.5 text-xs text-[#141414]/40 transition-colors hover:text-red-600" title="Excluir">
          ✕
        </button>
      </div>
    </div>
  );
}

function PlaceColumn({ place, tasks, hint, onChanged, onOpen, suppressClick }: { place: Place; tasks: Task[]; hint?: string; onChanged: () => void; onOpen: (t: Task) => void; suppressClick: () => boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: `place-${place}` });
  return (
    <div ref={setNodeRef} className={`flex min-h-[180px] flex-col overflow-hidden rounded-[16px] border p-3 ${isOver ? "border-[#30a81d] bg-[#ffffff]" : "border-[#d9d9d9] bg-[#ffffff]/70"}`}>
      <h2 className="flim-nav font-bold tabular-nums text-[#141414]">
        {PLACE_LABEL[place]} ({tasks.length})
      </h2>
      {hint && <p className="mb-2 text-[11px] text-[#141414]/50">{hint}</p>}
      <div className="max-h-[240px] space-y-2 overflow-y-auto pr-0.5">
        {tasks.length === 0 && (
          <div className="rounded-[8px] border border-dashed border-[#d9d9d9] px-3 py-4 text-center text-xs text-[#141414]/40">
            {place === "backlog" ? "Vazio — peça à IA" : place === "done" ? "Nada feito ainda" : "Arraste tarefas para cá"}
          </div>
        )}
        {tasks.map((t) => (
          <Card key={t.id} task={t} showDay={place === "backlog" || place === "done"} onChanged={onChanged} onOpen={() => onOpen(t)} suppressClick={suppressClick} />
        ))}
      </div>
    </div>
  );
}

function TrayStrip({ tasks, onChanged, onOpen, suppressClick }: { tasks: Task[]; onChanged: () => void; onOpen: (t: Task) => void; suppressClick: () => boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: `place-${TRAY}` });
  return (
    <div ref={setNodeRef} className={`mb-3 rounded-[16px] border border-dashed p-3 ${isOver ? "border-[#30a81d] bg-[#ffffff]" : "border-[#ff8400] bg-[#ffffff]"}`}>
      <p className="flim-nav mb-2 text-[#141414]/60">A agendar ({tasks.length}) — arraste para um dia</p>
      <div className="flex gap-2 overflow-x-auto">
        {tasks.map((t) => (
          <div key={t.id} className="w-[240px] shrink-0">
            <Card task={t} showDay={false} onChanged={onChanged} onOpen={() => onOpen(t)} suppressClick={suppressClick} />
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

  const groups = useMemo(() => {
    const match = (t: Task) => !filter || (t.categoria ?? "") === filter;
    const g: Record<Place, Task[]> = { backlog: board.todo.filter(match), done: board.done.filter(match), [TRAY]: [], Seg: [], Ter: [], Qua: [], Qui: [], Sex: [], Sab: [], Dom: [] };
    for (const t of board.doing) {
      if (!match(t)) continue;
      if (t.day_label && (DAY_LABELS as readonly string[]).includes(t.day_label)) {
        g[t.day_label as Place].push(t);
      } else {
        g[TRAY].push(t);
      }
    }
    return g;
  }, [board, filter]);

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
  const lastDrop = useRef(0);
  const suppressClick = () => Date.now() - lastDrop.current < 350;

  async function add() {
    const titulo = draft.trim();
    if (!titulo) return;
    setDraft("");
    await api.createTask(titulo);
    refresh();
  }

  async function handleDragEnd(e: DragEndEvent) {
    const activeId = String(e.active.id);
    if (!e.over) return;
    lastDrop.current = Date.now();
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
    if (!dest) return;
    setDropError("");
    try {
      await api.placeTask(activeId, dest, destIndex);
      refresh();
    } catch (e) {
      setDropError(`Não moveu: ${e instanceof Error ? e.message : e}. Reinicie o backend: python3 -m backend.server`);
    }
  }

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-2 flex items-center gap-2">
        <div>
          <p className="flim-nav text-[#141414]/50">Planejamento semanal</p>
          <h1 className="text-[32px] font-bold leading-none text-[#141414]">Semana</h1>
        </div>
        <button onClick={onPlanWithAI} className="flim-nav ml-auto flex items-center gap-1.5 rounded-[8px] bg-[#141414] px-4 py-2 text-[#ffffff] transition-colors hover:bg-[#2a2a2a]" title="A IA cria tarefas no backlog">
          <Sparkles size={14} aria-hidden="true" /> Planejar com IA
        </button>
      </div>
      <p className="mb-3 text-sm text-[#141414]/60">
        A IA preenche o <strong>Backlog</strong>. Arraste o card para os dias, clique para abrir.
      </p>
      {dropError && <p className="mb-2 text-sm text-red-600">{dropError}</p>}
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
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: categoryColor(c) }} />
              {categoryLabel(c)}
            </button>
          ))}
        </div>
      )}
      <DndContext sensors={sensors} onDragEnd={handleDragEnd} onDragCancel={() => { lastDrop.current = Date.now(); }}>
        {groups[TRAY].length > 0 && (
          <TrayStrip tasks={groups[TRAY]} onChanged={refresh} onOpen={setSelected} suppressClick={suppressClick} />
        )}
        <div className="mb-4 flex gap-2">
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
          <PlaceColumn place="backlog" tasks={groups.backlog} hint="A IA planeja aqui" onChanged={refresh} onOpen={setSelected} suppressClick={suppressClick} />
          {DAY_LABELS.map((d) => (
            <PlaceColumn key={d} place={d as Place} tasks={groups[d as Place]} onChanged={refresh} onOpen={setSelected} suppressClick={suppressClick} />
          ))}
          <PlaceColumn place="done" tasks={groups.done} hint="Concluídas" onChanged={refresh} onOpen={setSelected} suppressClick={suppressClick} />
        </div>
      </DndContext>
      <TaskDetail task={selected} onClose={() => setSelected(null)} onSaved={refresh} />
    </div>
  );
}
