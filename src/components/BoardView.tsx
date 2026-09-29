import { useMemo, useState } from "react";
import { DndContext, useDraggable, useDroppable, type DragEndEvent } from "@dnd-kit/core";
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

function Card({ task, showDay, onChanged, onOpen }: { task: Task; showDay: boolean; onChanged: () => void; onOpen: () => void }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.titulo);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id });

  async function save() {
    const t = title.trim();
    setEditing(false);
    if (t && t !== task.titulo) {
      await api.updateTask(task.id, { titulo: t });
      onChanged();
    } else {
      setTitle(task.titulo);
    }
  }

  async function remove() {
    await api.deleteTask(task.id);
    onChanged();
  }

  return (
    <div
      ref={setNodeRef}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
      className={`rounded-[16px] border border-[#d9d9d9] bg-[#ffffff] p-3 transition-colors hover:border-[#141414]/40 ${isDragging ? "opacity-50" : ""}`}
    >
      <div
        {...listeners}
        {...attributes}
        className="mb-1 flex cursor-grab touch-none items-center gap-2 rounded-[6px] px-1 py-0.5 active:cursor-grabbing"
        title="Arraste para mover entre Backlog, dias e Feito"
      >
        <span className="text-xs text-[#141414]/40">⠿</span>
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
          <span className="text-[11px] text-[#141414]/50" title="Tem nota .md">
            📝
          </span>
        )}
      </div>
      {editing ? (
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => e.key === "Enter" && save()}
          className="w-full rounded-[8px] border border-[#141414] bg-[#ffffff] px-2 py-1 text-sm text-[#141414] outline-none"
        />
      ) : (
        <p onClick={() => setEditing(true)} className="cursor-text text-sm text-[#141414]" title="Clique para renomear">
          {task.titulo}
        </p>
      )}
      <div className="mt-2 flex gap-1">
        <button onClick={onOpen} className="rounded-[8px] border border-[#d9d9d9] bg-[#f5f5f5] px-2 py-0.5 text-xs text-[#141414]" title="Abrir detalhe">
          Abrir
        </button>
        <button onClick={remove} className="ml-auto rounded px-2 py-0.5 text-xs text-[#141414]/40 hover:text-red-600" title="Excluir">
          ✕
        </button>
      </div>
    </div>
  );
}

function PlaceColumn({ place, tasks, hint, onChanged, onOpen }: { place: Place; tasks: Task[]; hint?: string; onChanged: () => void; onOpen: (t: Task) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: `place-${place}` });
  return (
    <div ref={setNodeRef} className={`flex min-h-[180px] flex-col overflow-hidden rounded-[16px] border p-3 ${isOver ? "border-[#30a81d] bg-[#ffffff]" : "border-[#d9d9d9] bg-[#ffffff]/70"}`}>
      <h2 className="flim-nav font-bold text-[#141414]">
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
          <Card key={t.id} task={t} showDay={place === "backlog" || place === "done"} onChanged={onChanged} onOpen={() => onOpen(t)} />
        ))}
      </div>
    </div>
  );
}

function TrayStrip({ tasks, onChanged, onOpen }: { tasks: Task[]; onChanged: () => void; onOpen: (t: Task) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: `place-${TRAY}` });
  return (
    <div ref={setNodeRef} className={`mb-3 rounded-[16px] border border-dashed p-3 ${isOver ? "border-[#30a81d] bg-[#ffffff]" : "border-[#ff8400] bg-[#ffffff]"}`}>
      <p className="flim-nav mb-2 text-[#141414]/60">A agendar ({tasks.length}) — arraste para um dia</p>
      <div className="flex gap-2 overflow-x-auto">
        {tasks.map((t) => (
          <div key={t.id} className="w-[240px] shrink-0">
            <Card task={t} showDay={false} onChanged={onChanged} onOpen={() => onOpen(t)} />
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
        <button onClick={onPlanWithAI} className="flim-nav ml-auto rounded-[8px] bg-[#141414] px-4 py-2 text-[#ffffff]" title="A IA cria tarefas no backlog">
          ✨ Planejar com IA
        </button>
      </div>
      <p className="mb-3 text-sm text-[#141414]/60">
        A IA preenche o <strong>Backlog</strong>. Arraste pela faixa ⠿ para os dias.
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
      <DndContext onDragEnd={handleDragEnd}>
        {groups[TRAY].length > 0 && (
          <TrayStrip tasks={groups[TRAY]} onChanged={refresh} onOpen={setSelected} />
        )}
        <div className="mb-4 flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="NOVA TAREFA NO BACKLOG…"
            className="flim-nav flex-1 rounded-[160px] border border-[#d9d9d9] bg-[#ffffff] px-5 py-3 text-[#141414] outline-none transition-colors placeholder:text-[#141414]/40 focus:border-[#141414]"
          />
          <button onClick={add} className="flim-nav rounded-[8px] bg-[#141414] px-5 py-2 text-[#ffffff] transition-colors hover:bg-[#2a2a2a]">
            Adicionar
          </button>
        </div>
        <div className="grid flex-1 grid-cols-1 content-start gap-3 overflow-y-auto pb-2 sm:grid-cols-2 xl:grid-cols-3">
          <PlaceColumn place="backlog" tasks={groups.backlog} hint="A IA planeja aqui" onChanged={refresh} onOpen={setSelected} />
          {DAY_LABELS.map((d) => (
            <PlaceColumn key={d} place={d as Place} tasks={groups[d as Place]} onChanged={refresh} onOpen={setSelected} />
          ))}
          <PlaceColumn place="done" tasks={groups.done} hint="Concluídas" onChanged={refresh} onOpen={setSelected} />
        </div>
      </DndContext>
      <TaskDetail task={selected} onClose={() => setSelected(null)} onSaved={refresh} />
    </div>
  );
}
