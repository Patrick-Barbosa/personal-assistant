import { useCallback, useEffect, useState } from "react";
import { Checkbox } from "@base-ui/react/checkbox";
import { Slider } from "@base-ui/react/slider";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { format } from "date-fns";
import { api } from "../api";
import type { Habit, Hoje } from "../types";

function HabitRow({ habit, data, onChanged }: { habit: Habit; data: string; onChanged: () => void }) {
  const [draft, setDraft] = useState(String(habit.valor ?? 0));
  const [editingUnit, setEditingUnit] = useState(false);
  const [unitDraft, setUnitDraft] = useState(habit.unidade ?? "");
  const [metaDraft, setMetaDraft] = useState(String(habit.meta ?? 0));

  useEffect(() => {
    setDraft(String(habit.valor ?? 0));
    setUnitDraft(habit.unidade ?? "");
    setMetaDraft(String(habit.meta ?? 0));
  }, [habit.valor, habit.unidade, habit.meta]);

  async function toggleBinary(checked: boolean) {
    await api.checkHabit(habit.id, checked ? 1 : 0, data);
    onChanged();
  }

  async function commitNumeric(v: number) {
    if (Number.isNaN(v) || v < 0) return;
    await api.checkHabit(habit.id, v, data);
    onChanged();
  }

  async function saveUnit() {
    setEditingUnit(false);
    const patch: { unidade?: string; meta?: number } = {};
    if (unitDraft.trim() !== (habit.unidade ?? "")) patch.unidade = unitDraft.trim();
    const m = Number(metaDraft) || 0;
    if (m !== (habit.meta ?? 0)) patch.meta = m;
    if (Object.keys(patch).length > 0) {
      await api.updateHabit(habit.id, patch);
      onChanged();
    }
  }

  async function remove() {
    await api.deleteHabit(habit.id);
    onChanged();
  }

  const sliderMax = Math.max(10, Math.ceil((Number(draft) || 0) * 1.5), Math.ceil(habit.valor * 1.5), Math.ceil((habit.meta || 0) * 1.5));
  const progress = habit.meta > 0 ? Math.min(100, Math.round((habit.valor / habit.meta) * 100)) : 0;

  return (
    <div className="flex items-center gap-3 rounded-[16px] border border-[#d9d9d9] bg-[#ffffff] px-3 py-2">
      {habit.tipo === "binary" ? (
        <Checkbox.Root
          checked={habit.valor > 0}
          onCheckedChange={(checked) => toggleBinary(checked === true)}
          aria-label={habit.nome}
          className="flex h-5 w-5 items-center justify-center rounded-[4px] border border-[#141414] bg-[#ffffff] outline-none data-[checked]:bg-[#30a81d] data-[checked]:text-[#ffffff]"
        >
          <Checkbox.Indicator className="text-sm data-[unchecked]:hidden">
            ✓
          </Checkbox.Indicator>
        </Checkbox.Root>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <button
            onClick={() => commitNumeric((Number(draft) || 0) - 1)}
            disabled={(Number(draft) || 0) <= 0}
            aria-label={`Diminuir ${habit.nome}`}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border border-[#141414] bg-[#ffffff] text-lg font-bold text-[#141414] transition-colors hover:bg-[#141414] hover:text-[#ffffff] disabled:opacity-30 disabled:hover:bg-[#ffffff] disabled:hover:text-[#141414]"
          >
            −
          </button>
          <input
            type="number"
            min={0}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => commitNumeric(Number(draft))}
            onKeyDown={(e) => e.key === "Enter" && commitNumeric(Number(draft))}
            aria-label={`Valor de hoje para ${habit.nome}`}
            className="w-14 rounded-[8px] border border-[#d9d9d9] bg-[#f5f5f5] px-1 py-1.5 text-center text-sm font-bold tabular-nums text-[#141414] outline-none transition-colors focus:border-[#141414]"
            title="Valor de hoje"
          />
          <button
            onClick={() => commitNumeric((Number(draft) || 0) + 1)}
            aria-label={`Aumentar ${habit.nome}`}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-[#141414] text-lg font-bold text-[#ffffff] transition-colors hover:bg-[#2a2a2a]"
          >
            +
          </button>
          {editingUnit ? (
            <form
              className="flex items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                saveUnit();
              }}
            >
              <input
                autoFocus
                value={unitDraft}
                onChange={(e) => setUnitDraft(e.target.value)}
                placeholder="páginas, km, min…"
                aria-label="Unidade de medida"
                className="w-28 rounded-[8px] border border-[#141414] bg-[#ffffff] px-2 py-1 text-sm outline-none"
              />
              <input
                value={metaDraft}
                onChange={(e) => setMetaDraft(e.target.value)}
                placeholder="meta"
                type="number"
                min={0}
                aria-label="Meta diária"
                className="w-20 rounded-[8px] border border-[#141414] bg-[#ffffff] px-2 py-1 text-sm outline-none"
                title="Meta diária"
              />
              <button type="submit" className="flim-nav rounded-[6px] bg-[#141414] px-2 py-1 text-[#ffffff]">
                OK
              </button>
            </form>
          ) : (
            <button onClick={() => setEditingUnit(true)} className="truncate text-sm text-[#141414]/60 hover:text-[#141414]" title="Clique para editar a unidade">
              {habit.unidade || "+ unidade"}
            </button>
          )}
          <Slider.Root
            value={[Number(draft) || 0]}
            min={0}
            max={sliderMax}
            step={1}
            onValueChange={(v) => setDraft(String((v as number[])[0]))}
            onValueCommitted={(v) => commitNumeric((v as unknown as number[])[0] ?? Number(draft))}
            className="hidden min-w-24 flex-1 sm:block"
          >
            <Slider.Track className="h-1.5 rounded bg-[#e9e9e9]">
              <Slider.Indicator className="rounded bg-[#30a81d]" />
              <Slider.Thumb className="h-4 w-4 rounded-full border border-[#141414] bg-[#ffffff] outline-none" />
            </Slider.Track>
          </Slider.Root>
        </div>
      )}
      <span className="flex-1 truncate text-sm text-[#141414]">
        {habit.nome}
        {habit.tipo === "numeric" && habit.meta > 0 && (
          <span className="ml-2 text-xs text-[#141414]/50">
            {habit.valor}/{habit.meta}{habit.unidade ? ` ${habit.unidade}` : ""}
          </span>
        )}
      </span>
      {habit.tipo === "numeric" && habit.meta > 0 && (
        <span className="hidden h-1.5 w-16 overflow-hidden rounded bg-[#e9e9e9] sm:block" title={`${progress}% da meta`}>
          <span className="block h-full rounded bg-[#30a81d]" style={{ width: `${progress}%` }} />
        </span>
      )}
      <button onClick={remove} aria-label={`Excluir hábito ${habit.nome}`} className="rounded px-1 text-xs text-[#141414]/30 transition-colors hover:text-red-600" title="Excluir hábito">
        ✕
      </button>
    </div>
  );
}

export default function HojeView({ onTasksChanged }: { onTasksChanged?: () => void }) {
  const today = format(new Date(), "yyyy-MM-dd");
  const display = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" });
  const [hoje, setHoje] = useState<Hoje | null>(null);
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState<"binary" | "numeric">("binary");
  const [unidade, setUnidade] = useState("");
  const [meta, setMeta] = useState("");
  const [nota, setNota] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const h = await api.getHoje(today);
    setHoje(h);
    setNota(h.nota?.conteudo ?? "");
  }, [today]);

  useEffect(() => {
    load().catch((e) => setError(String(e.message ?? e)));
  }, [load]);

  async function addHabit() {
    const n = nome.trim();
    if (!n) return;
    setError("");
    try {
      const m = tipo === "numeric" ? Number(meta) || 0 : 0;
      setNome("");
      setUnidade("");
      setMeta("");
      await api.createHabit(n, tipo, unidade.trim(), m);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function saveNota() {
    setError("");
    try {
      await api.saveNota(nota, today);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function noteToTasks() {
    const lines = nota
      .split("\n")
      .map((l) => l.replace(/^[-*[\]xX ]+/, "").trim())
      .filter(Boolean);
    if (lines.length === 0) return;
    for (const line of lines.slice(0, 20)) {
      await api.createTask(line);
    }
    onTasksChanged?.();
  }

  return (
    <div className="h-full space-y-4 overflow-y-auto p-4">
      <div>
        <p className="flim-nav text-[#141414]/50">Entrada diária</p>
        <h1 className="text-[32px] font-bold leading-none text-[#141414]">Hoje</h1>
        <p className="text-sm capitalize text-[#141414]/50">{display}</p>
      </div>

      <section className="rounded-[16px] border border-[#d9d9d9] bg-[#ffffff] p-5">
        <h2 className="flim-nav mb-2 font-bold text-[#141414]">Hábitos ({hoje?.habits.length ?? 0}/10)</h2>
        <div className="space-y-2">
          {hoje?.habits.map((h) => (
            <HabitRow key={h.id} habit={h} data={today} onChanged={load} />
          ))}
          {(hoje?.habits.length ?? 0) === 0 && (
            <p className="text-sm text-[#141414]/50">Nenhum hábito ainda. Crie até 10 abaixo.</p>
          )}
        </div>
        <div className="mt-3 space-y-2 rounded-[8px] bg-[#f5f5f5] p-3">
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addHabit()}
            placeholder="Nome do hábito… ex: Ler"
            aria-label="Nome do novo hábito"
            autoComplete="off"
            className="w-full rounded-[8px] border border-[#d9d9d9] bg-[#ffffff] px-3 py-2 text-sm text-[#141414] outline-none transition-colors placeholder:text-[#141414]/40 focus:border-[#141414]"
          />
          <div className="flex gap-2">
            <div className="flex rounded-[8px] border border-[#d9d9d9] bg-[#ffffff] p-0.5">
              <button onClick={() => setTipo("binary")} className={`flim-nav rounded-[6px] px-3 py-1.5 ${tipo === "binary" ? "bg-[#141414] text-[#ffffff]" : "text-[#141414]/60"}`}>
                Fez / Não fez
              </button>
              <button onClick={() => setTipo("numeric")} className={`flim-nav rounded-[6px] px-3 py-1.5 ${tipo === "numeric" ? "bg-[#141414] text-[#ffffff]" : "text-[#141414]/60"}`}>
                Quantidade
              </button>
            </div>
            {tipo === "numeric" && (
              <>
                <input
                  value={unidade}
                  onChange={(e) => setUnidade(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addHabit()}
                  placeholder="Mede em — ex: páginas, km, min"
                  aria-label="Unidade de medida do novo hábito"
                  className="min-w-0 flex-1 rounded-[8px] border border-[#d9d9d9] bg-[#ffffff] px-3 py-2 text-sm outline-none transition-colors placeholder:text-[#141414]/40 focus:border-[#141414]"
                />
                <input
                  value={meta}
                  onChange={(e) => setMeta(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addHabit()}
                  placeholder="Meta — ex: 20"
                  type="number"
                  min={0}
                  aria-label="Meta do novo hábito"
                  className="w-28 rounded-[8px] border border-[#d9d9d9] bg-[#ffffff] px-3 py-2 text-sm outline-none transition-colors placeholder:text-[#141414]/40 focus:border-[#141414]"
                />
              </>
            )}
            <button onClick={addHabit} className="flim-nav rounded-[8px] bg-[#141414] px-4 py-2 text-[#ffffff]">
              Criar
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-[16px] border border-[#d9d9d9] bg-[#ffffff] p-5">
        <h2 className="flim-nav mb-2 font-bold text-[#141414]">Na semana ({hoje?.doing.length ?? 0})</h2>
        <div className="space-y-1">
          {(hoje?.doing ?? []).map((t) => (
            <p key={t.id} className="truncate rounded-[8px] bg-[#f5f5f5] px-3 py-1.5 text-sm text-[#141414]">
              {t.day_label ? `[${t.day_label}] ` : ""}{t.titulo}
            </p>
          ))}
          {(hoje?.doing.length ?? 0) === 0 && <p className="text-sm text-[#141414]/50">Nada em doing. Arraste na Semana.</p>}
        </div>
      </section>

      <section className="rounded-[16px] border border-[#d9d9d9] bg-[#ffffff] p-5">
        <div className="mb-2 flex items-center gap-2">
          <h2 className="flim-nav font-bold text-[#141414]">Nota rápida</h2>
          <button onClick={() => setShowPreview(!showPreview)} className="flim-nav rounded px-2 py-0.5 text-[#141414]/50 hover:text-[#141414]">
            {showPreview ? "Editar" : "Prévia"}
          </button>
        </div>
        {showPreview ? (
          <div className="min-h-24 rounded-[8px] bg-[#f5f5f5] px-4 py-3 text-sm text-[#141414]">
            {nota.trim() ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{nota}</ReactMarkdown> : <p className="text-[#141414]/40">Vazio.</p>}
          </div>
        ) : (
          <textarea
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            rows={4}
            placeholder="Ideia rápida do dia…"
            className="w-full rounded-[8px] border border-[#d9d9d9] bg-[#f5f5f5] px-3 py-2 text-sm text-[#141414] outline-none transition-colors placeholder:text-[#141414]/40 focus:border-[#141414]"
          />
        )}
        <div className="mt-2 flex gap-2">
          <button onClick={saveNota} className="flim-nav rounded-[8px] bg-[#141414] px-4 py-2 text-[#ffffff]">
            Salvar nota
          </button>
          <button onClick={noteToTasks} className="flim-nav rounded-[8px] border border-[#d9d9d9] px-4 py-2 text-[#141414]" title="Cada linha vira tarefa no backlog">
            Criar tarefas da nota
          </button>
        </div>
      </section>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
