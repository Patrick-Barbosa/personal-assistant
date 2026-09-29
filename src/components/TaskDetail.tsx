import { useEffect, useMemo, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { diffLines } from "diff";
import { api } from "../api";
import { CATEGORY_COLORS, DAY_LABELS, type Category, type Task } from "../types";

interface Props {
  task: Task | null;
  onClose: () => void;
  onSaved: () => void;
}

type Mode = "editar" | "previa" | "diff";

export default function TaskDetail({ task, onClose, onSaved }: Props) {
  const [titulo, setTitulo] = useState("");
  const [dayLabel, setDayLabel] = useState("");
  const [categoria, setCategoria] = useState("");
  const [note, setNote] = useState("");
  const [savedNote, setSavedNote] = useState("");
  const [mode, setMode] = useState<Mode>("editar");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [cats, setCats] = useState<Category[]>([]);
  const [newCat, setNewCat] = useState("");
  const [newColor, setNewColor] = useState(CATEGORY_COLORS[0]);

  useEffect(() => {
    if (task) {
      setTitulo(task.titulo);
      setDayLabel(task.day_label ?? "");
      setCategoria(task.categoria ?? "");
      setNote(task.note_md ?? "");
      setSavedNote(task.note_md ?? "");
      setMode("editar");
      setError("");
      setNewCat("");
      api.listCategorias().then(setCats).catch(() => {});
    }
  }, [task]);

  const diffParts = useMemo(() => {
    if (mode !== "diff") return [];
    return diffLines(savedNote || "", note || "");
  }, [mode, savedNote, note]);

  const dirty = task ? titulo.trim() !== task.titulo || dayLabel !== (task.day_label ?? "") || categoria !== (task.categoria ?? "") || note !== (task.note_md ?? "") : false;

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
        categoria,
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
        <Dialog.Backdrop className="fixed inset-0 bg-[#141414]/40" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 max-h-[90vh] w-[min(640px,92vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto overscroll-contain rounded-[16px] border border-[#d9d9d9] bg-[#ffffff] p-5 outline-none">
          {task && (
            <>
              <Dialog.Title className="text-base font-bold text-[#141414]">Detalhe da tarefa</Dialog.Title>
              <Dialog.Description className="mb-4 text-sm text-[#141414]/50">
                Título + etiqueta do dia + nota .md
              </Dialog.Description>

              <label className="flim-nav mb-1 block text-[#141414]/60">Título</label>
              <input
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                aria-label="Título da tarefa"
                className="mb-3 w-full rounded-[8px] border border-[#d9d9d9] bg-[#f5f5f5] px-3 py-2 text-sm text-[#141414] outline-none transition-colors focus:border-[#141414]"
              />

              <label className="flim-nav mb-1 block text-[#141414]/60">Dia da semana</label>
              <div className="mb-4 flex flex-wrap gap-1">
                <button
                  onClick={() => setDayLabel("")}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${dayLabel === "" ? "border-[#141414] bg-[#141414] text-[#ffffff]" : "border-[#d9d9d9] text-[#141414]"}`}
                >
                  Sem dia
                </button>
                {DAY_LABELS.map((d) => (
                  <button
                    key={d}
                    onClick={() => setDayLabel(d)}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold ${dayLabel === d ? "border-[#141414] bg-[#141414] text-[#ffffff]" : "border-[#d9d9d9] text-[#141414]"}`}
                  >
                    {d}
                  </button>
                ))}
              </div>

              <label className="flim-nav mb-1 block text-[#141414]/60">Categoria</label>
              <div className="mb-2 flex flex-wrap gap-1">
                <button
                  onClick={() => setCategoria("")}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${categoria === "" ? "border-[#141414] bg-[#141414] text-[#ffffff]" : "border-[#d9d9d9] text-[#141414] hover:border-[#141414]/40"}`}
                >
                  Sem categoria
                </button>
                {cats.map((c) => (
                  <span
                    key={c.id}
                    className={`flex items-center gap-1.5 rounded-full border py-1 pl-3 pr-1.5 text-xs font-semibold ${categoria === c.id ? "border-[#141414] bg-[#141414] text-[#ffffff]" : "border-[#d9d9d9] text-[#141414]"}`}
                  >
                    <button onClick={() => setCategoria(c.id)} className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: c.cor }} />
                      {c.nome}
                    </button>
                    <button
                      onClick={async () => {
                        await api.deleteCategoria(c.id);
                        if (categoria === c.id) setCategoria("");
                        setCats(await api.listCategorias());
                        onSaved();
                      }}
                      aria-label={`Excluir categoria ${c.nome}`}
                      className="rounded-full px-1 opacity-40 hover:opacity-100 hover:text-red-600"
                      title="Excluir categoria"
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
              <div className="mb-4 flex items-center gap-1.5">
                <input
                  value={newCat}
                  onChange={(e) => setNewCat(e.target.value)}
                  onKeyDown={async (e) => {
                    if (e.key === "Enter" && newCat.trim()) {
                      const c = await api.createCategoria(newCat.trim(), newColor);
                      setCats(await api.listCategorias());
                      setCategoria(c.id);
                      setNewCat("");
                    }
                  }}
                  placeholder="Nova categoria…"
                  aria-label="Nome da nova categoria"
                  className="w-36 rounded-[8px] border border-[#d9d9d9] bg-[#f5f5f5] px-2 py-1 text-xs outline-none focus:border-[#141414]"
                />
                <div className="flex gap-1">
                  {CATEGORY_COLORS.map((cor) => (
                    <button
                      key={cor}
                      onClick={() => setNewColor(cor)}
                      aria-label={`Cor ${cor}`}
                      className={`h-5 w-5 rounded-full border ${newColor === cor ? "border-[#141414] ring-1 ring-[#141414]" : "border-[#d9d9d9]"}`}
                      style={{ backgroundColor: cor }}
                    />
                  ))}
                </div>
              </div>

              <div className="mb-2 flex gap-1">
                {(["editar", "previa", "diff"] as Mode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={`flim-nav rounded-[8px] px-3 py-1 ${mode === m ? "bg-[#141414] text-[#ffffff]" : "text-[#141414]/50 hover:text-[#141414]"}`}
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
                  aria-label="Nota da tarefa em Markdown"
                  className="w-full rounded-[8px] border border-[#d9d9d9] bg-[#f5f5f5] px-3 py-2 font-mono text-sm text-[#141414] outline-none transition-colors placeholder:text-[#141414]/40 focus:border-[#141414]"
                />
              )}

              {mode === "previa" && (
                <div className="min-h-40 rounded-[8px] border border-[#d9d9d9] bg-[#f5f5f5] px-4 py-3 text-sm text-[#141414]">
                  {note.trim() ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{note}</ReactMarkdown>
                  ) : (
                    <p className="text-[#141414]/40">Nada para pré-visualizar.</p>
                  )}
                </div>
              )}

              {mode === "diff" && (
                <div className="min-h-40 whitespace-pre-wrap rounded-[8px] border border-[#d9d9d9] bg-[#f5f5f5] px-4 py-3 font-mono text-xs">
                  {note === savedNote ? (
                    <p className="font-sans text-sm text-[#141414]/50">Sem alterações desde o último save.</p>
                  ) : (
                    diffParts.map((p, i) => (
                      <span
                        key={i}
                        className={p.added ? "bg-[#30a81d]/20 text-[#141414]" : p.removed ? "bg-[#ff8400]/20 text-[#141414]" : "text-[#141414]/60"}
                      >
                        {p.value}
                      </span>
                    ))
                  )}
                </div>
              )}

              {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

              <div className="mt-4 flex justify-end gap-2">
                <Dialog.Close className="flim-nav rounded-[8px] border border-[#d9d9d9] px-4 py-2 text-[#141414]">
                  Fechar
                </Dialog.Close>
                <button
                  onClick={save}
                  disabled={saving || !dirty}
                  className="flim-nav rounded-[8px] bg-[#141414] px-4 py-2 text-[#ffffff] disabled:opacity-40"
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
