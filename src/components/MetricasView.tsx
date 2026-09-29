import { useCallback, useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Flame, Shield } from "lucide-react";
import { addDays, format, parseISO } from "date-fns";
import { api } from "../api";
import type { Metricas } from "../types";

const DAY_SHORT = ["S", "T", "Q", "Q", "S", "S", "D"];

function dayISO(inicio: string, i: number) {
  return format(addDays(parseISO(inicio), i), "yyyy-MM-dd");
}

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

      <section className="rounded-[16px] border border-[#141414] bg-[#ffffff] p-5">
        <div className="mb-2 flex items-center gap-2">
          <Flame size={16} aria-hidden="true" />
          <h2 className="flim-nav font-bold text-[#141414]">Hoje em risco</h2>
          <span className="ml-auto flex items-center gap-1.5 rounded-full border border-[#d9d9d9] px-3 py-1 text-xs font-semibold text-[#141414]" title="Cada escudo protege um dia vazio automaticamente">
            <Shield size={13} aria-hidden="true" />
            {m.escudos === 1 ? "1 escudo" : `${m.escudos} escudos`}
          </span>
        </div>
        {m.hoje_pendente.length === 0 ? (
          <p className="text-sm text-[#141414]">Tudo feito hoje. A sequência está a salvo.</p>
        ) : (
          <div className="space-y-1">
            {m.hoje_pendente.map((h) => (
              <p key={h.id} className="text-sm text-[#141414]">
                <strong>{h.nome}</strong>
                {h.streak > 0 && <span className="text-[#141414]/60"> — {h.streak} {h.streak === 1 ? "dia" : "dias"} em jogo</span>}
              </p>
            ))}
            <p className="pt-1 text-xs text-[#141414]/50">Marque no Hoje para manter as sequências acesas.</p>
          </div>
        )}
      </section>

      <section className="rounded-[16px] border border-[#d9d9d9] bg-[#ffffff] p-5">
        <h2 className="flim-nav mb-3 font-bold text-[#141414]">Semana por hábito</h2>
        {m.habitos.length === 0 ? (
          <p className="text-sm text-[#141414]/50">Sem hábitos. Crie no Hoje.</p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="w-28 shrink-0" />
              {DAY_SHORT.map((d, i) => (
                <span key={i} className="flim-nav w-6 text-center text-[#141414]/40">{d}</span>
              ))}
            </div>
            {m.habitos.map((h) => (
              <div key={h.id}>
                <div className="flex items-center gap-2">
                  <span className="w-28 shrink-0 truncate text-sm font-semibold text-[#141414]" title={h.nome}>{h.nome}</span>
                  {h.dias.map((done, i) => {
                    const iso = dayISO(m.semana.inicio, i);
                    const prot = !done && h.protegidas.includes(iso);
                    return (
                      <span
                        key={i}
                        title={`${h.nome} · ${iso}${prot ? " (protegido)" : done ? "" : " (falta)"}`}
                        className={`h-6 w-6 rounded-full border ${done ? "border-[#141414] bg-[#141414]" : prot ? "border-[#141414] bg-[#fecc33]" : "border-[#d9d9d9] bg-transparent"}`}
                      />
                    );
                  })}
                  {h.streak > 0 && (
                    <span className="flim-nav ml-1 flex items-center gap-1 text-[#141414]">
                      <Flame size={12} aria-hidden="true" />{h.streak}
                    </span>
                  )}
                </div>
                {h.marco && (
                  <p className="ml-28 mt-1 inline-block rounded-[25px] bg-[#fecc33] px-2 py-0.5 text-[11px] font-bold text-[#141414]">
                    Marco: {h.marco} dias
                  </p>
                )}
              </div>
            ))}
            <p className="text-[11px] text-[#141414]/40">Amarelo = dia salvo pelo escudo.</p>
          </div>
        )}
      </section>

      <div className="grid grid-cols-2 gap-2 tabular-nums md:grid-cols-4">
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
            <Line type="monotone" dataKey="feitos" stroke="#141414" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
        {m.habitos.length > 0 && (
          <div className="mt-2 space-y-1">
            {m.habitos.map((h) => (
              <p key={h.id} className="text-xs text-[#141414]/60">
                {h.nome}: {h.done_days}/7 dias, streak {h.streak}
                {h.tipo === "numeric" && h.meta > 0 && ` · meta ${h.meta}${h.unidade ? ` ${h.unidade}` : ""}`}
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
          <div className="space-y-1.5 text-sm leading-relaxed text-[#141414]">
            {resumo.split("\n").map((line, i) => {
              const t = line.trim();
              if (!t) return null;
              const bullet = t.replace(/^([-*•]|\d+[.)])\s*/, "");
              const isItem = bullet !== t;
              return (
                <p key={i} className="flex gap-2">
                  {isItem && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#141414]" />}
                  <span>{isItem ? bullet : t}</span>
                </p>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-[#141414]/50">3 bullets: vitórias, perdidos, foco próxima semana.</p>
        )}
      </section>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
