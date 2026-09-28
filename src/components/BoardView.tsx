import { useState } from "react";
import { DndContext, useDraggable, useDroppable, type DragEndEvent } from "@dnd-kit/core";
import { api } from "../api";
import { COLUMNS, COLUMN_LABELS, type Board, type Column, type Task } from "../types";
import TaskDetail from "./TaskDetail";

interface Props {
  board: Board;
  refresh: () => void;
}

const COLUMN_HINT: Record<Column, string> = {
  todo: "Backlog — a IA planeja aqui",
  doing: "Esta semana — arraste para cá",
  done: "Feito",
};

function Card({ task, onChanged, onOpen }: { task: Task; onChanged: () => void; onOpen: () => void }) {
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
      className={`rounded-[16px] border border-[#d9d9d9] bg-[#ffffff] p-3 ${isDragging ? "opacity-50" : ""}`}
    >
      <div className="mb-1 flex items-center gap-2">
        <button
          {...listeners}
          {...attributes}
          className="cursor-grab touch-none rounded px-1 text-xs text-[#141414]/40 hover:text-[#141414]"
          title="Arrastar"
        >
          ⠿
        </button>
        {task.day_label && (
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

function ColumnView({ col, tasks, onChanged, onOpen }: { col: Column; tasks: Task[]; onChanged: () => void; onOpen: (t: Task) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: `col-${col}` });
  return (
    <div ref={setNodeRef} className={`flex flex-col overflow-hidden rounded-[16px] border p-3 ${isOver ? "border-[#30a81d] bg-[#ffffff]" : "border-[#d9d9d9] bg-[#ffffff]/70"}`}>
      <h2 className="flim-nav mb-1 font-bold text-[#141414]">
        {COLUMN_LABELS[col]} ({tasks.length})
      </h2>
      <p className="mb-2 text-[11px] text-[#141414]/50">{COLUMN_HINT[col]}</p>
      <div className="flex-1 space-y-2 overflow-y-auto">
        {tasks.map((t) => (
          <Card key={t.id} task={t} onChanged={onChanged} onOpen={() => onOpen(t)} />
        ))}
      </div>
    </div>
  );
}

export default function BoardView({ board, refresh }: Props) {
  const [draft, setDraft] = useState("");
  const [selected, setSelected] = useState<Task | null>(null);

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
    let destCol: Column | null = null;
    let destIndex = 0;
    if (overId.startsWith("col-")) {
      destCol = overId.slice(4) as Column;
      destIndex = board[destCol].length;
    } else {
      for (const c of COLUMNS) {
        const i = board[c].findIndex((t) => t.id === overId);
        if (i >= 0) {
          destCol = c;
          destIndex = i;
          break;
        }
      }
    }
    if (!destCol) return;
    await api.moveTask(activeId, destCol, destIndex);
    refresh();
  }

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-4 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="NOVA TAREFA NO BACKLOG…"
          className="flim-nav flex-1 rounded-[160px] border border-[#d9d9d9] bg-[#ffffff] px-5 py-3 text-[#141414] outline-none placeholder:text-[#141414]/40"
        />
        <button onClick={add} className="flim-nav rounded-[8px] bg-[#141414] px-5 py-2 text-[#ffffff]">
          Adicionar
        </button>
      </div>
      <DndContext onDragEnd={handleDragEnd}>
        <div className="grid flex-1 grid-cols-3 gap-3 overflow-hidden">
          {COLUMNS.map((col) => (
            <ColumnView key={col} col={col} tasks={board[col]} onChanged={refresh} onOpen={setSelected} />
          ))}
        </div>
      </DndContext>
      <TaskDetail task={selected} onClose={() => setSelected(null)} onSaved={refresh} />
    </div>
  );
}
