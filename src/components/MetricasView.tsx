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

  if (!m) return <p className="p-4 text-sm text-[#141414]/50">Carregando métricas…</p>;

  return (
    <div className="h-full space-y-4 overflow-y-auto p-4">
      <div>
        <p className="flim-nav text-[#141414]/50">Revisão semanal</p>
        <h1 className="text-[32px] font-bold leading-none text-[#141414]">Métricas</h1>
        <p className="text-sm text-[#141414]/50">
          Semana {m.semana.inicio} → {m.semana.fim}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <div className="rounded-[16px] border border-[#d9d9d9] bg-[#ffffff] p-4">
          <p className="flim-nav text-[#141414]/50">Média hábitos</p>
          <p className="text-2xl font-bold text-[#141414]">{m.geral.media_pct}%</p>
        </div>
        <div className="rounded-[16px] border border-[#d9d9d9] bg-[#ffffff] p-4">
          <p className="flim-nav text-[#141414]/50">Hábitos 7/7</p>
          <p className="text-2xl font-bold text-[#141414]">{m.geral.cheios}</p>
        </div>
        <div className="rounded-[16px] border border-[#d9d9d9] bg-[#ffffff] p-4">
          <p className="flim-nav text-[#141414]/50">Tarefas</p>
          <p className="text-sm text-[#141414]">
            {m.tarefas.concluidas}/{m.tarefas.criadas} ({m.tarefas.pct}%)
          </p>
          <p className="text-xs text-[#141414]/50">carregadas: {m.tarefas.carregadas}</p>
        </div>
        <div className="rounded-[16px] border border-[#d9d9d9] bg-[#ffffff] p-4">
          <p className="flim-nav text-[#141414]/50">Notas</p>
          <p className="text-2xl font-bold text-[#141414]">{m.notas.total}</p>
        </div>
      </div>

      <section className="rounded-[16px] border border-[#d9d9d9] bg-[#ffffff] p-5">
        <h2 className="flim-nav mb-2 font-bold text-[#141414]">% por hábito</h2>
        {m.habitos.length === 0 ? (
          <p className="text-sm text-[#141414]/50">Sem hábitos. Crie no Hoje.</p>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={m.habitos}>
              <CartesianGrid stroke="#d9d9d9" strokeDasharray="3 3" />
              <XAxis dataKey="nome" tick={{ fill: "#141414", fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fill: "#141414", fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="pct" fill="#141414" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </section>

      <section className="rounded-[16px] border border-[#d9d9d9] bg-[#ffffff] p-5">
        <h2 className="flim-nav mb-2 font-bold text-[#141414]">Evolução (hábitos feitos/dia)</h2>
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={m.serie}>
            <CartesianGrid stroke="#d9d9d9" strokeDasharray="3 3" />
            <XAxis dataKey="data" tick={{ fill: "#141414", fontSize: 11 }} />
            <YAxis allowDecimals={false} tick={{ fill: "#141414", fontSize: 11 }} />
            <Tooltip />
            <Line type="monotone" dataKey="feitos" stroke="#30a81d" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
        {m.habitos.length > 0 && (
          <div className="mt-2 space-y-1">
            {m.habitos.map((h) => (
              <p key={h.id} className="text-xs text-[#141414]/60">
                {h.nome}: {h.done_days}/7 dias, streak {h.streak}
              </p>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-[16px] border border-[#d9d9d9] bg-[#ffffff] p-5">
        <div className="mb-2 flex items-center gap-2">
          <h2 className="flim-nav font-bold text-[#141414]">Resumo IA</h2>
          <button onClick={gerarResumo} disabled={loadingResumo} className="flim-nav rounded-[8px] bg-[#141414] px-3 py-1 text-[#ffffff] disabled:opacity-40">
            {loadingResumo ? "Gerando…" : "Gerar resumo"}
          </button>
        </div>
        {resumo ? (
          <p className="whitespace-pre-wrap text-sm text-[#141414]"><span className="bg-[#fecc33]">{resumo.split("\n")[0]}</span>{resumo.split("\n").slice(1).join("\n")}</p>
        ) : (
          <p className="text-sm text-[#141414]/50">3 bullets: vitórias, perdidos, foco próxima semana.</p>
        )}
      </section>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
