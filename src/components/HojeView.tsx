import { useCallback, useEffect, useRef, useState } from "react";
import { Checkbox } from "@base-ui/react/checkbox";
import { Check } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { format } from "date-fns";
import { api } from "../api";
import { DAY_LABELS, categoryColor, categoryLabel, type Category, type Habit, type Hoje } from "../types";

function DayPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const active = value ? value.split(",") : [];
  function toggle(d: string) {
    const next = active.includes(d) ? active.filter((x) => x !== d) : [...active, d];
    const order: string[] = [...DAY_LABELS];
    onChange(next.sort((a, b) => order.indexOf(a) - order.indexOf(b)).join(","));
  }
  return (
    <div className="flex flex-wrap gap-1">
      {DAY_LABELS.map((d) => (
        <button
          key={d}
          onClick={() => toggle(d)}
          aria-pressed={active.includes(d)}
          title={active.includes(d) ? `Ativo em ${d}` : `Ativar em ${d}`}
          className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${active.includes(d) ? "border-[#141414] bg-[#141414] text-[#ffffff]" : "border-[#d9d9d9] text-[#141414]/60 hover:border-[#141414]/40"}`}
        >
          {d}
        </button>
      ))}
    </div>
  );
}

function HabitRow({ habit, data, onChanged, onShield }: { habit: Habit; data: string; onChanged: () => void; onShield: () => void }) {
  const [valor, setValor] = useState(String(habit.valor ?? 0));
  const [editingDays, setEditingDays] = useState(false);
  const [editingUnit, setEditingUnit] = useState(false);
  const [unitDraft, setUnitDraft] = useState(habit.unidade ?? "");
  const [metaDraft, setMetaDraft] = useState(String(habit.meta ?? 0));

  useEffect(() => {
    setValor(String(habit.valor ?? 0));
    setUnitDraft(habit.unidade ?? "");
    setMetaDraft(String(habit.meta ?? 0));
  }, [habit.valor, habit.unidade, habit.meta]);

  async function toggleFeito() {
    const r = await api.checkHabit(habit.id, { feito: habit.feito ? 0 : 1 }, data);
    if (r.escudo_ganho) onShield();
    onChanged();
  }

  async function commitValor() {
    const v = Number(valor);
    if (Number.isNaN(v) || v < 0 || v === habit.valor) return;
    const r = await api.checkHabit(habit.id, { valor: v }, data);
    if (r.escudo_ganho) onShield();
    onChanged();
  }

  async function saveUnitMeta() {
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

  const progress = habit.meta > 0 ? Math.min(100, Math.round((habit.valor / habit.meta) * 100)) : 0;
  const diasLabel = habit.dias ? habit.dias.split(",").join(" · ") : "todo dia";

  return (
    <div className="rounded-[16px] border border-[#d9d9d9] bg-[#ffffff] px-3 py-2">
      <div className="flex items-center gap-3">
        <Checkbox.Root
          checked={!!habit.feito}
          onCheckedChange={() => toggleFeito()}
          aria-label={`Marcar ${habit.nome} como feito`}
          className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-[8px] border bg-[#ffffff] outline-none transition-all duration-150 active:scale-95 data-[checked]:border-[#141414] data-[checked]:bg-[#141414] data-[checked]:text-[#ffffff] data-[unchecked]:border-[#141414]/30 data-[unchecked]:text-transparent hover:data-[unchecked]:border-[#141414] hover:data-[unchecked]:text-[#141414]/30"
        >
          <Checkbox.Indicator className="flex items-center justify-center data-[unchecked]:hidden">
            <Check size={15} strokeWidth={3.5} aria-hidden="true" />
          </Checkbox.Indicator>
        </Checkbox.Root>
        <div className="min-w-0 flex-1">
          <p className={`truncate text-sm font-semibold ${habit.feito ? "text-[#141414]/45 line-through" : "text-[#141414]"}`}>{habit.nome}</p>
          <p className="text-[11px] text-[#141414]/50">
            {diasLabel}
            {habit.tipo === "numeric" && habit.meta > 0 && ` · meta ${habit.meta}${habit.unidade ? ` ${habit.unidade}` : ""}`}
          </p>
        </div>
        {habit.tipo === "numeric" && (
          <div className="flex shrink-0 items-center gap-1.5">
            <input
              type="number"
              min={0}
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              onBlur={commitValor}
              onKeyDown={(e) => e.key === "Enter" && commitValor()}
              aria-label={`Quanto de ${habit.nome} hoje (opcional)`}
              placeholder="qto?"
              className="w-20 rounded-[8px] border border-[#d9d9d9] bg-[#f5f5f5] px-2 py-1.5 text-center text-sm font-bold tabular-nums outline-none transition-colors placeholder:font-normal placeholder:text-[#141414]/30 focus:border-[#141414]"
            />
            {editingUnit ? (
              <form
                className="flex items-center gap-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  saveUnitMeta();
                }}
              >
                <input autoFocus value={unitDraft} onChange={(e) => setUnitDraft(e.target.value)} placeholder="páginas, km, min…" aria-label="Unidade de medida" className="w-24 rounded-[8px] border border-[#141414] px-2 py-1 text-xs outline-none" />
                <input value={metaDraft} onChange={(e) => setMetaDraft(e.target.value)} placeholder="meta" type="number" min={0} aria-label="Meta diária" className="w-16 rounded-[8px] border border-[#141414] px-2 py-1 text-xs outline-none" />
                <button type="submit" className="flim-nav rounded-[6px] bg-[#141414] px-2 py-1 text-[#ffffff]">OK</button>
              </form>
            ) : (
              <button onClick={() => setEditingUnit(true)} className="max-w-20 truncate text-xs text-[#141414]/60 hover:text-[#141414]" title="Editar unidade e meta">
                {habit.unidade || "+ unid."}
              </button>
            )}
          </div>
        )}
        <button onClick={remove} aria-label={`Excluir hábito ${habit.nome}`} className="shrink-0 rounded px-1 text-xs text-[#141414]/30 transition-colors hover:text-red-600" title="Excluir hábito">
          ✕
        </button>
      </div>
      {habit.tipo === "numeric" && habit.meta > 0 && (
        <div className="ml-9 mt-1.5 h-1.5 overflow-hidden rounded bg-[#e9e9e9]" title={`${habit.valor}/${habit.meta} (${progress}%)`}>
          <div className="h-full rounded bg-[#141414] transition-all" style={{ width: `${progress}%` }} />
        </div>
      )}
      <div className="ml-9 mt-1.5">
        {editingDays ? (
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <DayPicker
                value={habit.dias}
                onChange={async (v) => {
                  await api.updateHabit(habit.id, { dias: v });
                  onChanged();
                }}
              />
            </div>
            <button onClick={() => setEditingDays(false)} className="flim-nav text-[#141414]/50 hover:text-[#141414]">OK</button>
          </div>
        ) : (
          <button onClick={() => setEditingDays(true)} className="flim-nav text-[#141414]/40 hover:text-[#141414]">
            Dias: {diasLabel} (editar)
          </button>
        )}
      </div>
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
  const [dias, setDias] = useState("");
  const [cats, setCats] = useState<Category[]>([]);
  const [nota, setNota] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [error, setError] = useState("");
  const [shieldMsg, setShieldMsg] = useState(false);
  const shieldTimer = useRef<number | null>(null);

  function notifyShield() {
    setShieldMsg(true);
    if (shieldTimer.current) window.clearTimeout(shieldTimer.current);
    shieldTimer.current = window.setTimeout(() => setShieldMsg(false), 4000);
  }

  const load = useCallback(async () => {
    const h = await api.getHoje(today);
    setHoje(h);
    setNota(h.nota?.conteudo ?? "");
    api.listCategorias().then(setCats).catch(() => {});
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
      setDias("");
      await api.createHabit(n, tipo, unidade.trim(), m, dias);
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
            <HabitRow key={h.id} habit={h} data={today} onChanged={load} onShield={notifyShield} />
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
          <div>
            <p className="flim-nav mb-1 text-[#141414]/50">Dias ativos (vazio = todo dia)</p>
            <DayPicker value={dias} onChange={setDias} />
          </div>
        </div>
      </section>

      <section className="rounded-[16px] border border-[#d9d9d9] bg-[#ffffff] p-5">
        <h2 className="flim-nav mb-2 font-bold text-[#141414]">Na semana ({hoje?.doing.length ?? 0})</h2>
        <div className="space-y-1">
          {(hoje?.doing ?? []).map((t) => (
            <p key={t.id} className="flex items-center gap-2 truncate rounded-[8px] bg-[#f5f5f5] px-3 py-1.5 text-sm text-[#141414]">
              {t.categoria && (
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: categoryColor(t.categoria, cats) }} title={categoryLabel(t.categoria, cats)} />
              )}
              <span className="truncate">{t.day_label ? `[${t.day_label}] ` : ""}{t.titulo}</span>
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

      {shieldMsg && (
        <p className="rounded-[16px] border border-[#141414] bg-[#fecc33] px-4 py-2 text-sm font-bold text-[#141414]">
          Escudo ganho! Ele protege sozinho seu próximo dia vazio (máx. 2 guardados).
        </p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
