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

  useEffect(() => {
    setDraft(String(habit.valor ?? 0));
  }, [habit.valor]);

  async function toggleBinary(checked: boolean) {
    await api.checkHabit(habit.id, checked ? 1 : 0, data);
    onChanged();
  }

  async function commitNumeric(v: number) {
    if (Number.isNaN(v)) return;
    await api.checkHabit(habit.id, v, data);
    onChanged();
  }

  async function remove() {
    await api.deleteHabit(habit.id);
    onChanged();
  }

  return (
    <div className="flex items-center gap-3 rounded-[16px] border border-[#d9d9d9] bg-[#ffffff] px-3 py-2">
      {habit.tipo === "binary" ? (
        <Checkbox.Root
          checked={habit.valor > 0}
          onCheckedChange={(checked) => toggleBinary(checked === true)}
          className="flex h-5 w-5 items-center justify-center rounded-[4px] border border-[#141414] bg-[#ffffff] outline-none data-[checked]:bg-[#30a81d] data-[checked]:text-[#ffffff]"
        >
          <Checkbox.Indicator className="text-sm data-[unchecked]:hidden">
            ✓
          </Checkbox.Indicator>
        </Checkbox.Root>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Slider.Root
            value={[Number(draft) || 0]}
            min={0}
            max={100}
            step={1}
            onValueChange={(v) => setDraft(String((v as number[])[0]))}
            onValueCommitted={(v) => commitNumeric((v as unknown as number[])[0] ?? Number(draft))}
            className="flex-1"
          >
            <Slider.Track className="h-1.5 rounded bg-[#e9e9e9]">
              <Slider.Indicator className="rounded bg-[#30a81d]" />
              <Slider.Thumb className="h-4 w-4 rounded-full border border-[#141414] bg-[#ffffff] outline-none" />
            </Slider.Track>
          </Slider.Root>
          <input
            type="number"
            min={0}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => commitNumeric(Number(draft))}
            onKeyDown={(e) => e.key === "Enter" && commitNumeric(Number(draft))}
            className="w-16 rounded-[8px] border border-[#d9d9d9] bg-[#ffffff] px-2 py-1 text-sm text-[#141414] outline-none"
          />
          {habit.unidade && <span className="text-xs text-[#141414]/50">{habit.unidade}</span>}
        </div>
      )}
      <span className="flex-1 truncate text-sm text-[#141414]">
        {habit.nome}
      </span>
      <button onClick={remove} className="rounded px-1 text-xs text-[#141414]/30 hover:text-red-600" title="Excluir hábito">
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
      setNome("");
      setUnidade("");
      await api.createHabit(n, tipo, unidade.trim());
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
        <div className="mt-2 flex gap-2">
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addHabit()}
            placeholder="Novo hábito… ex: Ler"
            className="flex-1 rounded-[8px] border border-[#d9d9d9] bg-[#f5f5f5] px-3 py-2 text-sm text-[#141414] outline-none placeholder:text-[#141414]/40"
          />
          <select value={tipo} onChange={(e) => setTipo(e.target.value as "binary" | "numeric")} className="rounded-[8px] border border-[#d9d9d9] bg-[#f5f5f5] px-2 text-sm text-[#141414]">
            <option value="binary">Fez/Não</option>
            <option value="numeric">Número</option>
          </select>
          {tipo === "numeric" && (
            <input
              value={unidade}
              onChange={(e) => setUnidade(e.target.value)}
              placeholder="min"
              className="w-16 rounded-[8px] border border-[#d9d9d9] bg-[#f5f5f5] px-3 py-2 text-sm outline-none placeholder:text-[#141414]/40"
            />
          )}
          <button onClick={addHabit} className="flim-nav rounded-[8px] bg-[#141414] px-4 py-2 text-[#ffffff]">
            +
          </button>
        </div>
      </section>

      <section className="rounded-[16px] border border-[#d9d9d9] bg-[#ffffff] p-5">
        <h2 className="flim-nav mb-2 font-bold text-[#141414]">Fazendo hoje ({hoje?.doing.length ?? 0})</h2>
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
            className="w-full rounded-[8px] border border-[#d9d9d9] bg-[#f5f5f5] px-3 py-2 text-sm text-[#141414] outline-none placeholder:text-[#141414]/40"
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
