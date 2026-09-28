import { useEffect, useMemo, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { diffLines } from "diff";
import { api } from "../api";
import { DAY_LABELS, type Task } from "../types";

interface Props {
  task: Task | null;
  onClose: () => void;
  onSaved: () => void;
}

type Mode = "editar" | "previa" | "diff";

export default function TaskDetail({ task, onClose, onSaved }: Props) {
  const [titulo, setTitulo] = useState("");
  const [dayLabel, setDayLabel] = useState("");
  const [note, setNote] = useState("");
  const [savedNote, setSavedNote] = useState("");
  const [mode, setMode] = useState<Mode>("editar");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (task) {
      setTitulo(task.titulo);
      setDayLabel(task.day_label ?? "");
      setNote(task.note_md ?? "");
      setSavedNote(task.note_md ?? "");
      setMode("editar");
      setError("");
    }
  }, [task]);

  const diffParts = useMemo(() => {
    if (mode !== "diff") return [];
    return diffLines(savedNote || "", note || "");
  }, [mode, savedNote, note]);

  const dirty = task ? titulo.trim() !== task.titulo || dayLabel !== (task.day_label ?? "") || note !== (task.note_md ?? "") : false;

  async function save() {
    if (!task || saving) return;
    const t = titulo.trim();
    if (!t) {
      setError("Título não pode ficar vazio.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api.updateTask(task.id, {
        titulo: t,
        day_label: dayLabel || null,
        note_md: note,
      });
      setSavedNote(note);
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog.Root open={task !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-black/60" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 max-h-[90vh] w-[min(640px,92vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-zinc-900 p-5 outline-none">
          {task && (
            <>
              <Dialog.Title className="text-base font-semibold text-zinc-100">Detalhe da tarefa</Dialog.Title>
              <Dialog.Description className="mb-4 text-sm text-zinc-500">
                Título + etiqueta do dia + nota .md
              </Dialog.Description>

              <label className="mb-1 block text-xs font-semibold text-zinc-400">Título</label>
              <input
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                className="mb-3 w-full rounded-xl bg-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-blue-600"
              />

              <label className="mb-1 block text-xs font-semibold text-zinc-400">Dia da semana</label>
              <div className="mb-4 flex flex-wrap gap-1">
                <button
                  onClick={() => setDayLabel("")}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${dayLabel === "" ? "bg-blue-600 text-white" : "bg-zinc-800 text-zinc-400"}`}
                >
                  Sem dia
                </button>
                {DAY_LABELS.map((d) => (
                  <button
                    key={d}
                    onClick={() => setDayLabel(d)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${dayLabel === d ? "bg-blue-600 text-white" : "bg-zinc-800 text-zinc-400"}`}
                  >
                    {d}
                  </button>
                ))}
              </div>

              <div className="mb-2 flex gap-1">
                {(["editar", "previa", "diff"] as Mode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={`rounded-lg px-3 py-1 text-xs font-semibold ${mode === m ? "bg-zinc-700 text-white" : "text-zinc-500 hover:text-zinc-300"}`}
                  >
                    {m === "editar" ? "Editar" : m === "previa" ? "Prévia" : "Diff"}
                  </button>
                ))}
              </div>

              {mode === "editar" && (
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={10}
                  placeholder="Nota em Markdown… ex: ## Objetivo&#10;- [ ] passo 1"
                  className="w-full rounded-xl bg-zinc-800 px-3 py-2 font-mono text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:ring-1 focus:ring-blue-600"
                />
              )}

              {mode === "previa" && (
                <div className="min-h-40 rounded-xl bg-zinc-800 px-4 py-3 text-sm text-zinc-100">
                  {note.trim() ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{note}</ReactMarkdown>
                  ) : (
                    <p className="text-zinc-500">Nada para pré-visualizar.</p>
                  )}
                </div>
              )}

              {mode === "diff" && (
                <div className="min-h-40 whitespace-pre-wrap rounded-xl bg-zinc-800 px-4 py-3 font-mono text-xs">
                  {note === savedNote ? (
                    <p className="font-sans text-sm text-zinc-500">Sem alterações desde o último save.</p>
                  ) : (
                    diffParts.map((p, i) => (
                      <span
                        key={i}
                        className={p.added ? "bg-green-900/60 text-green-200" : p.removed ? "bg-red-900/60 text-red-200" : "text-zinc-400"}
                      >
                        {p.value}
                      </span>
                    ))
                  )}
                </div>
              )}

              {error && <p className="mt-2 text-sm text-red-400">{error}</p>}

              <div className="mt-4 flex justify-end gap-2">
                <Dialog.Close className="rounded-xl bg-zinc-800 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700">
                  Fechar
                </Dialog.Close>
                <button
                  onClick={save}
                  disabled={saving || !dirty}
                  className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                >
                  {saving ? "Salvando…" : "Salvar"}
                </button>
              </div>
            </>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
