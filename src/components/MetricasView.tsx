import { useCallback, useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api";
import type { Metricas } from "../types";

export default function MetricasView() {
  const [m, setM] = useState<Metricas | null>(null);
  const [resumo, setResumo] = useState("");
  const [loadingResumo, setLoadingResumo] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setM(await api.getMetricas());
  }, []);

  useEffect(() => {
    load().catch((e) => setError(String(e.message ?? e)));
  }, [load]);

  async function gerarResumo() {
    setLoadingResumo(true);
    setError("");
    try {
      const r = await api.resumoSemana();
      setResumo(r.resumo);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingResumo(false);
    }
  }

  if (!m) return <p className="p-4 text-sm text-zinc-500">Carregando métricas…</p>;

  return (
    <div className="h-full space-y-4 overflow-y-auto p-4">
      <div>
        <h1 className="text-lg font-bold text-zinc-100">Métricas</h1>
        <p className="text-sm text-zinc-500">
          Semana {m.semana.inicio} → {m.semana.fim}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <div className="rounded-2xl bg-zinc-900 p-3">
          <p className="text-xs text-zinc-500">Média hábitos</p>
          <p className="text-2xl font-bold text-zinc-100">{m.geral.media_pct}%</p>
        </div>
        <div className="rounded-2xl bg-zinc-900 p-3">
          <p className="text-xs text-zinc-500">Hábitos 7/7</p>
          <p className="text-2xl font-bold text-zinc-100">{m.geral.cheios}</p>
        </div>
        <div className="rounded-2xl bg-zinc-900 p-3">
          <p className="text-xs text-zinc-500">Tarefas</p>
          <p className="text-sm text-zinc-200">
            {m.tarefas.concluidas}/{m.tarefas.criadas} ({m.tarefas.pct}%)
          </p>
          <p className="text-xs text-zinc-500">carregadas: {m.tarefas.carregadas}</p>
        </div>
        <div className="rounded-2xl bg-zinc-900 p-3">
          <p className="text-xs text-zinc-500">Notas</p>
          <p className="text-2xl font-bold text-zinc-100">{m.notas.total}</p>
        </div>
      </div>

      <section className="rounded-2xl bg-zinc-900 p-3">
        <h2 className="mb-2 text-sm font-semibold text-zinc-400">% por hábito</h2>
        {m.habitos.length === 0 ? (
          <p className="text-sm text-zinc-600">Sem hábitos. Crie no Hoje.</p>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={m.habitos}>
              <CartesianGrid stroke="#3f3f46" strokeDasharray="3 3" />
              <XAxis dataKey="nome" tick={{ fill: "#a1a1aa", fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fill: "#a1a1aa", fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="pct" fill="#30a81d" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </section>

      <section className="rounded-2xl bg-zinc-900 p-3">
        <h2 className="mb-2 text-sm font-semibold text-zinc-400">Evolução (hábitos feitos/dia)</h2>
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={m.serie}>
            <CartesianGrid stroke="#3f3f46" strokeDasharray="3 3" />
            <XAxis dataKey="data" tick={{ fill: "#a1a1aa", fontSize: 11 }} />
            <YAxis allowDecimals={false} tick={{ fill: "#a1a1aa", fontSize: 11 }} />
            <Tooltip />
            <Line type="monotone" dataKey="feitos" stroke="#fecc33" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
        {m.habitos.length > 0 && (
          <div className="mt-2 space-y-1">
            {m.habitos.map((h) => (
              <p key={h.id} className="text-xs text-zinc-400">
                {h.nome}: {h.done_days}/7 dias, streak {h.streak}
              </p>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-2xl bg-zinc-900 p-3">
        <div className="mb-2 flex items-center gap-2">
          <h2 className="text-sm font-semibold text-zinc-400">Resumo IA</h2>
          <button onClick={gerarResumo} disabled={loadingResumo} className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-40">
            {loadingResumo ? "Gerando…" : "Gerar resumo"}
          </button>
        </div>
        {resumo ? (
          <p className="whitespace-pre-wrap text-sm text-zinc-200">{resumo}</p>
        ) : (
          <p className="text-sm text-zinc-600">3 bullets: vitórias, perdidos, foco próxima semana.</p>
        )}
      </section>

      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
