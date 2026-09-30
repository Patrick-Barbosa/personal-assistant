import { useCallback, useEffect, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Flame, Shield } from "lucide-react";
import { addDays, format, parseISO } from "date-fns";
import { api } from "../api";
import PageHeader from "./PageHeader";
import type { Metricas } from "../types";

const DAY_SHORT = ["S", "T", "Q", "Q", "S", "S", "D"];
const LINE_COLORS = ["#141414", "#5c5c5c", "#8a8a8a", "#b5b5b5", "#ff8400"];
const CARD = "rounded-[16px] border border-[#d9d9d9] bg-[#ffffff] p-4";

function dayISO(inicio: string, i: number) {
  return format(addDays(parseISO(inicio), i), "yyyy-MM-dd");
}

function freqLabel(planejados: boolean[]) {
  const n = planejados.filter(Boolean).length;
  if (n >= 7) return "todo dia";
  if (n <= 0) return "sem dias";
  return `${n}x/semana`;
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

  const evo = m.historico.semanas.map((s, i) => {
    const row: Record<string, number | string | null> = { semana: s.rotulo };
    for (const serie of m.historico.series) row[serie.id] = serie.pct[i];
    return row;
  });

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mx-auto w-full max-w-[1200px] space-y-3">
        <PageHeader
          eyebrow="Revisão semanal"
          title="Métricas"
          aside={
            <p className="text-sm tabular-nums text-[#141414]">
              {m.semana.inicio} → {m.semana.fim}
            </p>
          }
        />

        <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-12">
          <section className={`${CARD} lg:col-span-7`}>
            <div className="mb-2 flex items-center gap-2">
              <h2 className="flim-nav font-bold text-[#141414]">Resumo IA</h2>
              <button
                onClick={gerarResumo}
                disabled={loadingResumo}
                className="flim-nav ml-auto rounded-[8px] bg-[#141414] px-3 py-1 text-[#ffffff] transition-transform focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#141414] active:scale-[0.98] disabled:opacity-40"
              >
                {loadingResumo ? "Gerando…" : "Gerar resumo"}
              </button>
            </div>
            {resumo ? (
              <div className="max-w-[65ch] space-y-1.5 text-sm leading-relaxed text-[#141414]">
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

          <section className="rounded-[16px] border border-[#141414] bg-[#ffffff] p-4 lg:col-span-5">
            <div className="mb-2 flex items-center gap-2">
              <Flame size={16} aria-hidden="true" className="text-[#ff8400]" fill="#ff8400" />
              <h2 className="flim-nav font-bold text-[#141414]">Hoje em risco</h2>
            </div>
            {m.hoje_pendente.length === 0 ? (
              <p className="text-sm text-[#141414]">Tudo feito hoje. A sequência está a salvo.</p>
            ) : (
              <div className="space-y-1">
                {m.hoje_pendente.map((h) => (
                  <p key={h.id} className="flex items-center gap-1.5 text-sm text-[#141414]">
                    <Flame size={13} aria-hidden="true" className="shrink-0 text-[#ff8400]" fill="#ff8400" />
                    <span>
                      <strong>{h.nome}</strong>
                      {h.streak > 0 && <span className="text-[#141414]/60"> — {h.streak} em sequência em jogo</span>}
                    </span>
                  </p>
                ))}
                <p className="pt-1 text-xs text-[#141414]/50">Marque no Hoje para manter as sequências acesas.</p>
              </div>
            )}
            <div className="mt-3 flex items-center gap-2 border-t border-[#e9e9e9] pt-3">
              <span className="flex items-center gap-1" title="Cada escudo cobre 1 sessão perdida automaticamente">
                {[0, 1].map((i) => (
                  <Shield key={i} size={18} aria-hidden="true" className={i < m.escudos ? "text-[#141414]" : "text-[#141414]/20"} fill={i < m.escudos ? "#141414" : "none"} />
                ))}
              </span>
              <p className="text-xs font-semibold text-[#141414]">{m.escudos === 1 ? "1 escudo" : `${m.escudos} escudos`}</p>
              <p className="ml-auto text-[11px] text-[#141414]/50">3 em sequência = +1 (máx. 2)</p>
            </div>
          </section>

          <div className="grid grid-cols-2 gap-2 tabular-nums md:grid-cols-4 lg:col-span-12">
            <div className="rounded-[16px] border border-[#d9d9d9] bg-[#ffffff] p-3">
              <p className="flim-nav text-[#141414]/50">Média hábitos</p>
              <p className="text-xl font-bold text-[#141414]">{m.geral.media_pct}%</p>
            </div>
            <div className="rounded-[16px] border border-[#d9d9d9] bg-[#ffffff] p-3">
              <p className="flim-nav text-[#141414]/50">Hábitos 100%</p>
              <p className="text-xl font-bold text-[#141414]">{m.geral.cheios}</p>
            </div>
            <div className="rounded-[16px] border border-[#d9d9d9] bg-[#ffffff] p-3">
              <p className="flim-nav text-[#141414]/50">Tarefas</p>
              <p className="text-sm font-bold text-[#141414]">
                {m.tarefas.concluidas}/{m.tarefas.criadas} ({m.tarefas.pct}%)
              </p>
              <p className="text-xs text-[#141414]/50">carregadas: {m.tarefas.carregadas}</p>
            </div>
            <div className="rounded-[16px] border border-[#d9d9d9] bg-[#ffffff] p-3">
              <p className="flim-nav text-[#141414]/50">Notas</p>
              <p className="text-xl font-bold text-[#141414]">{m.notas.total}</p>
            </div>
          </div>

          <section className={`${CARD} lg:col-span-5`}>
            <div className="mb-2 flex items-center gap-2">
              <Flame size={16} aria-hidden="true" className="text-[#ff8400]" fill="#ff8400" />
              <h2 className="flim-nav font-bold text-[#141414]">Sequências</h2>
            </div>
            {m.habitos.length === 0 ? (
              <p className="text-sm text-[#141414]/50">Sem hábitos. Crie no Hoje.</p>
            ) : (
              <ul className="divide-y divide-[#e9e9e9]">
                {m.habitos.map((h) => (
                  <li key={h.id} className="flex items-center gap-2 py-1.5">
                    <Flame size={16} aria-hidden="true" className={h.streak > 0 ? "shrink-0 text-[#ff8400]" : "shrink-0 text-[#141414]/20"} fill={h.streak > 0 ? "#ff8400" : "none"} />
                    <p className="min-w-0 flex-1 truncate text-sm font-semibold text-[#141414]">{h.nome}</p>
                    <span className="shrink-0 rounded-full border border-[#d9d9d9] px-2 py-px text-[11px] text-[#141414]/60">{freqLabel(h.planejados)}</span>
                    <p className={`shrink-0 text-sm tabular-nums ${h.streak > 0 ? "font-bold text-[#141414]" : "text-[#141414]/40"}`}>
                      {h.streak > 0 ? `${h.streak} em seq.` : "—"}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={`${CARD} lg:col-span-7`}>
            <h2 className="flim-nav mb-2 font-bold text-[#141414]">Semana por hábito</h2>
            {m.habitos.length === 0 ? (
              <p className="text-sm text-[#141414]/50">Sem hábitos. Crie no Hoje.</p>
            ) : (
              <div className="space-y-2.5">
                <div className="flex items-center gap-2">
                  <span className="w-24 shrink-0" />
                  {DAY_SHORT.map((d, i) => (
                    <span key={i} className="flim-nav w-6 text-center text-[#141414]/40">{d}</span>
                  ))}
                  <span className="min-w-24 flex-1" />
                </div>
                {m.habitos.map((h) => (
                  <div key={h.id}>
                    <div className="flex items-center gap-2">
                      <span
                        className="w-24 shrink-0 truncate text-sm font-semibold text-[#141414]"
                        title={`${h.nome} · ${freqLabel(h.planejados)}${h.tipo === "numeric" && h.meta > 0 ? ` · meta ${h.meta}${h.unidade ? ` ${h.unidade}` : ""}` : ""}`}
                      >
                        {h.nome}
                      </span>
                      {h.dias.map((done, i) => {
                        const iso = dayISO(m.semana.inicio, i);
                        if (!h.planejados[i]) {
                          if (done) {
                            return (
                              <span
                                key={i}
                                title={`${h.nome} · ${iso} (extra, fora do plano)`}
                                className="h-6 w-6 shrink-0 rounded-full border-2 border-[#30a81d] bg-transparent"
                              />
                            );
                          }
                          return (
                            <span key={i} className="flex h-6 w-6 shrink-0 items-center justify-center" title={`${h.nome} · ${iso} (descanso)`}>
                              <span className="h-1.5 w-1.5 rounded-full bg-[#d9d9d9]" />
                            </span>
                          );
                        }
                        const prot = !done && h.protegidas.includes(iso);
                        return (
                          <span
                            key={i}
                            title={`${h.nome} · ${iso}${prot ? " (protegido)" : done ? " (feito)" : " (falta)"}`}
                            className={`h-6 w-6 shrink-0 rounded-full border ${done ? "border-[#30a81d] bg-[#30a81d]" : prot ? "border-[#141414] bg-[#fecc33]" : "border-[#ff8400] bg-transparent"}`}
                          />
                        );
                      })}
                      {h.streak > 0 && (
                        <span className="flim-nav flex shrink-0 items-center gap-1 text-[#ff8400]" title="sessões planejadas em sequência">
                          <Flame size={12} aria-hidden="true" fill="#ff8400" />{h.streak}
                        </span>
                      )}
                      <span className="flex min-w-24 flex-1 items-center gap-2" title={`${h.done_days} de ${h.planned_days} sessões · ${h.pct}%${h.extras.length > 0 ? ` · +${h.extras.length} extra` : ""}`}>
                        <span className="h-1.5 min-w-6 flex-1 overflow-hidden rounded-full bg-[#e9e9e9]">
                          <span className={`block h-full rounded-full ${h.pct === 100 ? "bg-[#30a81d]" : "bg-[#141414]"}`} style={{ width: `${h.pct}%` }} />
                        </span>
                        <span className={`shrink-0 text-xs tabular-nums ${h.pct === 100 ? "font-bold text-[#30a81d]" : "text-[#141414]/60"}`}>
                          {h.done_days}/{h.planned_days} · {h.pct}%
                          {h.extras.length > 0 && <span className="font-bold text-[#30a81d]"> · +{h.extras.length} extra</span>}
                        </span>
                      </span>
                    </div>
                    {h.marco && (
                      <p className="ml-24 mt-1 inline-block rounded-[25px] bg-[#fecc33] px-2 py-0.5 text-[11px] font-bold text-[#141414]">
                        Marco: {h.marco} em sequência
                      </p>
                    )}
                  </div>
                ))}
                <p className="text-[11px] text-[#141414]/40">Verde = feito · contorno laranja = falta · contorno verde = extra fora do plano · cinza = descanso · amarelo = escudo.</p>
              </div>
            )}
          </section>

          <section className={`${CARD} lg:col-span-7`}>
            <h2 className="flim-nav mb-2 font-bold text-[#141414]">Evolução por hábito (% da meta semanal)</h2>
            {m.historico.series.length === 0 ? (
              <p className="text-sm text-[#141414]/50">Sem hábitos. Crie no Hoje.</p>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={evo}>
                  <CartesianGrid stroke="#d9d9d9" strokeDasharray="3 3" />
                  <XAxis dataKey="semana" tick={{ fill: "#141414", fontSize: 11 }} />
                  <YAxis domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} tick={{ fill: "#141414", fontSize: 11 }} />
                  <Tooltip formatter={(v) => (v == null ? "—" : `${v}%`)} />
                  <ReferenceLine y={100} stroke="#30a81d" strokeDasharray="4 3" label={{ value: "meta", fontSize: 11, fill: "#30a81d" }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {m.historico.series.map((s, i) => (
                    <Line
                      key={s.id}
                      type="monotone"
                      dataKey={s.id}
                      name={s.nome}
                      stroke={LINE_COLORS[i % LINE_COLORS.length]}
                      strokeDasharray={i >= LINE_COLORS.length ? "6 3" : undefined}
                      strokeWidth={2}
                      dot={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </section>

          <section className={`${CARD} lg:col-span-5`}>
            <h2 className="flim-nav mb-2 font-bold text-[#141414]">Movimento da semana (feitos/dia)</h2>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={m.serie}>
                <CartesianGrid stroke="#d9d9d9" strokeDasharray="3 3" />
                <XAxis dataKey="data" tick={{ fill: "#141414", fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fill: "#141414", fontSize: 11 }} />
                <Tooltip />
                <Line type="monotone" dataKey="feitos" stroke="#141414" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </section>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}
