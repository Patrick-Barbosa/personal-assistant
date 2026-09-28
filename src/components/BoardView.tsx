import { useState } from "react";
import { api } from "../api";
import { COLUMNS, COLUMN_LABELS, type Board, type Column, type Task } from "../types";

interface Props {
  board: Board;
  refresh: () => void;
}

const PREV: Record<Column, Column | null> = { todo: null, doing: "todo", done: "doing" };
const NEXT: Record<Column, Column | null> = { todo: "doing", doing: "done", done: null };

function Card({ task, index, onChanged }: { task: Task; index: number; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.titulo);

  async function save() {
    const t = title.trim();
    setEditing(false);
    if (t && t !== task.titulo) {
      await api.updateTask(task.id, t);
      onChanged();
    } else {
      setTitle(task.titulo);
    }
  }

  async function move(to: Column | null) {
    if (!to) return;
    await api.moveTask(task.id, to, 999);
    onChanged();
  }

  async function remove() {
    await api.deleteTask(task.id);
    onChanged();
  }

  return (
    <div className="rounded-xl bg-zinc-800 p-3">
      {editing ? (
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => e.key === "Enter" && save()}
          className="w-full rounded bg-zinc-700 px-2 py-1 text-sm text-zinc-100 outline-none"
        />
      ) : (
        <p onClick={() => setEditing(true)} className="cursor-text text-sm text-zinc-100" title="Clique para renomear">
          {task.titulo}
        </p>
      )}
      <div className="mt-2 flex gap-1">
        <button
          onClick={() => move(PREV[task.column])}
          disabled={!PREV[task.column]}
          className="rounded bg-zinc-700 px-2 py-0.5 text-xs text-zinc-300 disabled:opacity-30"
          title="Mover para trás"
        >
          ←
        </button>
        <button
          onClick={() => move(NEXT[task.column])}
          disabled={!NEXT[task.column]}
          className="rounded bg-zinc-700 px-2 py-0.5 text-xs text-zinc-300 disabled:opacity-30"
          title="Mover para frente"
        >
          →
        </button>
        <button onClick={remove} className="ml-auto rounded px-2 py-0.5 text-xs text-zinc-500 hover:text-red-400" title="Excluir">
          ✕
        </button>
      </div>
    </div>
  );
}

export default function BoardView({ board, refresh }: Props) {
  const [draft, setDraft] = useState("");

  async function add() {
    const titulo = draft.trim();
    if (!titulo) return;
    setDraft("");
    await api.createTask(titulo);
    refresh();
  }

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-4 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="Nova tarefa… (Enter para adicionar)"
          className="flex-1 rounded-xl bg-zinc-800 px-4 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:ring-1 focus:ring-blue-600"
        />
        <button onClick={add} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white">
          Adicionar
        </button>
      </div>
      <div className="grid flex-1 grid-cols-3 gap-3 overflow-hidden">
        {COLUMNS.map((col) => (
          <div key={col} className="flex flex-col overflow-hidden rounded-2xl bg-zinc-900 p-3">
            <h2 className="mb-2 text-sm font-semibold text-zinc-400">
              {COLUMN_LABELS[col]} ({board[col].length})
            </h2>
            <div className="flex-1 space-y-2 overflow-y-auto">
              {board[col].map((t, i) => (
                <Card key={t.id} task={t} index={i} onChanged={refresh} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
