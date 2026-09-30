import { useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { NotebookPen } from "lucide-react";
import { api } from "../api";
import { categoryColor, categoryLabel, type Board, type Category, type NotaDiaria, type NotaTarefa, type Notas, type Task } from "../types";
import TaskDetail from "./TaskDetail";
import PageHeader from "./PageHeader";

interface Props {
  board: Board;
  refresh: () => void;
}

function snippet(md: string, n = 120) {
  const plain = md.replace(/[#>*`\-\\[\]()]/g, "").replace(/\s+/g, " ").trim();
  return plain.length > n ? plain.slice(0, n) + "…" : plain || "(vazia)";
}

export default function NotasView({ board, refresh }: Props) {
  const [notas, setNotas] = useState<Notas | null>(null);
  const [query, setQuery] = useState("");
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [selectedDaily, setSelectedDaily] = useState<NotaDiaria | null>(null);
  const [error, setError] = useState("");
  const [cats, setCats] = useState<Category[]>([]);
  const [catFilter, setCatFilter] = useState("");
  const [sugestoes, setSugestoes] = useState<{ id: string; categoria: string }[]>([]);
  const [organizing, setOrganizing] = useState(false);

  const load = useCallback(async () => {
    setNotas(await api.getNotas());
    api.listCategorias().then(setCats).catch(() => {});
  }, []);

  useEffect(() => {
    load().catch((e) => setError(String(e.message ?? e)));
  }, [load]);

  const q = query.trim().toLowerCase();
  const tarefas = useMemo(
    () =>
      (notas?.tarefas ?? []).filter((t) => {
        const cat = t.categoria ?? "";
        if (catFilter === "none" ? cat !== "" : catFilter && cat !== catFilter) return false;
        return !q || t.titulo.toLowerCase().includes(q) || t.note_md.toLowerCase().includes(q);
      }),
    [notas, q, catFilter],
  );
  const diarias = useMemo(
    () => (notas?.diarias ?? []).filter((d) => !q || d.data.includes(q) || d.conteudo.toLowerCase().includes(q)),
    [notas, q],
  );

  function openTask(t: NotaTarefa) {
    const full = [...board.todo, ...board.doing, ...board.done].find((x) => x.id === t.id);
    if (full) {
      setSelectedDaily(null);
      setSelectedTask(full);
    }
  }

  async function newNote() {
    setError("");
    try {
      const t = await api.createTask("Nova nota");
      refresh();
      setSelectedDaily(null);
      setSelectedTask(t);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const previewTask = selectedTask
    ? [...board.todo, ...board.doing, ...board.done].find((x) => x.id === selectedTask.id) ?? selectedTask
    : null;

  async function organizar() {
    setError("");
    setOrganizing(true);
    try {
      const r = await api.organizarNotas();
      setSugestoes(r.sugestoes);
      if (r.sugestoes.length === 0) setError("Nada sem categoria para organizar.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOrganizing(false);
    }
  }

  async function aplicarSugestoes() {
    for (const s of sugestoes) {
      await api.updateTask(s.id, { categoria: s.categoria });
    }
    setSugestoes([]);
    refresh();
    load();
  }

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mx-auto flex min-h-0 w-full max-w-[1200px] flex-1 flex-col">
      <PageHeader
        eyebrow="Tudo que você escreveu"
        title="Notas"
        className="mb-3"
        aside={
          <button onClick={newNote} className="flim-nav flex items-center gap-1.5 rounded-[8px] bg-[#141414] px-4 py-2 text-[#ffffff] transition-colors hover:bg-[#2a2a2a]">
            <NotebookPen size={14} aria-hidden="true" /> Nova nota
          </button>
        }
      />
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="BUSCAR NAS NOTAS…"
        aria-label="Buscar nas notas"
        autoComplete="off"
        className="flim-nav mb-3 rounded-[160px] border border-[#d9d9d9] bg-[#ffffff] px-5 py-2.5 text-[#141414] outline-none transition-colors placeholder:text-[#141414]/40 focus:border-[#141414]"
      />
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      <div className="mb-3 flex flex-wrap items-center gap-1">
        <button
          onClick={() => setCatFilter("")}
          className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${catFilter === "" ? "border-[#141414] bg-[#141414] text-[#ffffff]" : "border-[#d9d9d9] bg-[#ffffff] text-[#141414]"}`}
        >
          Todos os tópicos
        </button>
        {cats.map((c) => (
          <button
            key={c.id}
            onClick={() => setCatFilter(catFilter === c.id ? "" : c.id)}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${catFilter === c.id ? "border-[#141414] bg-[#141414] text-[#ffffff]" : "border-[#d9d9d9] bg-[#ffffff] text-[#141414]"}`}
          >
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: c.cor }} />
            {c.nome}
          </button>
        ))}
        <button
          onClick={() => setCatFilter(catFilter === "none" ? "" : "none")}
          className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${catFilter === "none" ? "border-[#141414] bg-[#141414] text-[#ffffff]" : "border-[#d9d9d9] bg-[#ffffff] text-[#141414]"}`}
        >
          Sem tópico
        </button>
        <button
          onClick={organizar}
          disabled={organizing}
          className="flim-nav ml-auto rounded-[8px] border border-[#d9d9d9] bg-[#ffffff] px-3 py-1.5 text-[#141414] transition-colors hover:border-[#141414] disabled:opacity-40"
          title="A IA sugere tópico para notas sem categoria; você confirma"
        >
          {organizing ? "Organizando…" : "✨ Organizar com IA"}
        </button>
      </div>
      {sugestoes.length > 0 && (
        <div className="mb-3 rounded-[16px] border border-[#141414] bg-[#ffffff] p-3">
          <p className="flim-nav mb-2 text-[#141414]/60">Sugestões da IA — confira antes de aplicar</p>
          <div className="mb-2 space-y-1">
            {sugestoes.map((s) => {
              const t = (notas?.tarefas ?? []).find((x) => x.id === s.id);
              return (
                <p key={s.id} className="flex items-center gap-2 text-sm text-[#141414]">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: categoryColor(s.categoria, cats) }} />
                  <span className="truncate">{t?.titulo ?? s.id}</span>
                  <span className="text-xs text-[#141414]/50">→ {categoryLabel(s.categoria, cats)}</span>
                </p>
              );
            })}
          </div>
          <div className="flex gap-2">
            <button onClick={aplicarSugestoes} className="flim-nav rounded-[8px] bg-[#141414] px-4 py-1.5 text-[#ffffff]">
              Aplicar todas
            </button>
            <button onClick={() => setSugestoes([])} className="flim-nav rounded-[8px] border border-[#d9d9d9] px-4 py-1.5 text-[#141414]">
              Descartar
            </button>
          </div>
        </div>
      )}
      <div className="grid flex-1 grid-cols-1 gap-3 overflow-y-auto pb-2 md:grid-cols-2 md:overflow-hidden md:pb-0">
        <div className="space-y-3 md:overflow-y-auto md:pr-0.5">
          <section>
            <h2 className="flim-nav mb-2 font-bold text-[#141414]/60">De tarefas ({tarefas.length})</h2>
            <div className="space-y-2">
              {tarefas.map((t) => (
                <button
                  key={t.id}
                  onClick={() => openTask(t)}
                  className={`block w-full rounded-[16px] border p-3 text-left transition-colors hover:border-[#141414]/40 ${selectedTask?.id === t.id && !selectedDaily ? "border-[#141414] bg-[#ffffff]" : "border-[#d9d9d9] bg-[#ffffff]/70"}`}
                >
                  <p className="flex items-center gap-2 text-sm font-bold text-[#141414]">
                    {t.categoria && <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: categoryColor(t.categoria, cats) }} title={categoryLabel(t.categoria, cats)} />}
                    <span className="truncate">{t.titulo}</span>
                  </p>
                  <p className="mt-1 truncate text-sm text-[#141414]/60">{snippet(t.note_md)}</p>
                </button>
              ))}
              {tarefas.length === 0 && <p className="text-sm text-[#141414]/40">Nenhuma nota de tarefa. Abra um card na Semana e escreva.</p>}
            </div>
          </section>
          <section>
            <h2 className="flim-nav mb-2 font-bold text-[#141414]/60">Diárias ({diarias.length})</h2>
            <div className="space-y-2">
              {diarias.map((d) => (
                <button
                  key={d.data}
                  onClick={() => {
                    setSelectedTask(null);
                    setSelectedDaily(d);
                  }}
                  className={`block w-full rounded-[16px] border p-3 text-left transition-colors hover:border-[#141414]/40 ${selectedDaily?.data === d.data ? "border-[#141414] bg-[#ffffff]" : "border-[#d9d9d9] bg-[#ffffff]/70"}`}
                >
                  <p className="text-sm font-bold text-[#141414]">{new Date(d.data + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })}</p>
                  <p className="mt-1 truncate text-sm text-[#141414]/60">{snippet(d.conteudo)}</p>
                </button>
              ))}
              {diarias.length === 0 && <p className="text-sm text-[#141414]/40">Nenhuma nota diária. Escreva no Hoje.</p>}
            </div>
          </section>
        </div>
        <div className="max-h-[40vh] overflow-y-auto rounded-[16px] border border-[#d9d9d9] bg-[#ffffff] p-5 md:max-h-none">
          {previewTask && !selectedDaily ? (
            <>
              <p className="flim-nav text-[#141414]/50">Nota da tarefa</p>
              <h2 className="mb-2 text-xl font-bold text-[#141414]">{previewTask.titulo}</h2>
              <div className="md-body text-sm leading-relaxed text-[#141414]">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{previewTask.note_md || "(vazia)"}</ReactMarkdown>
              </div>
              <p className="mt-3 text-xs text-[#141414]/40">Edite no detalhe da tarefa.</p>
            </>
          ) : selectedDaily ? (
            <>
              <p className="flim-nav text-[#141414]/50">Nota diária</p>
              <h2 className="mb-2 text-xl font-bold text-[#141414]">
                {new Date(selectedDaily.data + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" })}
              </h2>
              <div className="md-body text-sm leading-relaxed text-[#141414]">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{selectedDaily.conteudo || "(vazia)"}</ReactMarkdown>
              </div>
            </>
          ) : (
            <p className="text-sm text-[#141414]/40">Selecione uma nota para ler.</p>
          )}
        </div>
      </div>
      </div>
      <TaskDetail task={selectedTask} onClose={() => setSelectedTask(null)} onSaved={() => { refresh(); load(); }} />
    </div>
  );
}
