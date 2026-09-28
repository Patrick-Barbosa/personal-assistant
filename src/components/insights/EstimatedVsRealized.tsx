import React from "react";
import type { LineSeriesPoint } from "../../types";
import { toPolyline } from "../../utils/svgChart";

const VB_W = 560;
const VB_H = 190;
const PAD_LEFT = 40;
const PAD_RIGHT = 12;
const PAD_TOP = 18;
const PAD_BOTTOM = 30;

interface Props {
  lines: LineSeriesPoint[];
  periodo: string;
  /** Refaz a chamada `list_insights` na outra granularidade (backend calcula). */
  onToggle: (periodo: "semana" | "mes") => void;
  loading?: boolean;
}

function niceMax(value: number): number {
  if (value <= 5) return 5;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

/** Linhas SVG "estimado vs realizado" com escala compartilhada e unidade explícita. */
export const EstimatedVsRealized: React.FC<Props> = ({ lines, periodo, onToggle, loading = false }) => {
  const plotW = VB_W - PAD_LEFT - PAD_RIGHT;
  const plotH = VB_H - PAD_TOP - PAD_BOTTOM;
  const rawMax = Math.max(
    1,
    ...lines.flatMap((point) => [
      point.estimado_tarefas,
      point.realizado_tarefas,
      point.estimado_habitos,
      point.realizado_habitos,
    ])
  );
  const max = niceMax(rawMax);
  const hasActivity = lines.some(
    (point) =>
      point.estimado_tarefas > 0 ||
      point.realizado_tarefas > 0 ||
      point.estimado_habitos > 0 ||
      point.realizado_habitos > 0
  );

  const scaled = (values: number[]): { x: number; y: number }[] =>
    values.map((value, index) => ({
      x:
        PAD_LEFT +
        (lines.length === 1
          ? plotW / 2
          : (index / (lines.length - 1)) * plotW),
      y: PAD_TOP + plotH - (Math.min(max, Math.max(0, value)) / max) * plotH,
    }));

  const tarefasEst = scaled(lines.map((point) => point.estimado_tarefas));
  const tarefasReal = scaled(lines.map((point) => point.realizado_tarefas));
  const habitosEst = scaled(lines.map((point) => point.estimado_habitos));
  const habitosReal = scaled(lines.map((point) => point.realizado_habitos));

  return (
    <section aria-labelledby="estimated-realized-title">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div>
          <h2 id="estimated-realized-title" className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Estimado vs realizado
          </h2>
          <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">contagem por período · mesma escala para tarefas e hábitos</p>
        </div>
        <div className="ml-auto flex items-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-input)]/70 p-0.5" role="group" aria-label="Granularidade do gráfico">
          {(["semana", "mes"] as const).map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={periodo === item}
              disabled={loading}
              onClick={() => onToggle(item)}
              className={`rounded-md px-2 py-1 text-[10px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                periodo === item
                  ? "bg-amber-500/15 text-[var(--text-accent)]"
                  : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              }`}
            >
              {item === "semana" ? "Semanal" : "Mensal"}
            </button>
          ))}
        </div>
      </div>

      {lines.length === 0 || !hasActivity ? (
        <p className="py-6 text-center text-xs text-[var(--text-muted)]">
          Ainda não há períodos estimados ou realizados para comparar.
        </p>
      ) : (
        <>
          <p className="sr-only">
            {lines
              .map(
                (point) =>
                  `${point.periodo}: ${point.realizado_tarefas} de ${point.estimado_tarefas} tarefas e ${point.realizado_habitos} de ${point.estimado_habitos} hábitos.`
              )
              .join(" ")}
          </p>
          <svg
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            className="h-auto w-full"
            role="img"
            aria-labelledby="estimated-realized-title estimated-realized-description"
          >
            <desc id="estimated-realized-description">
              Comparação entre tarefas e hábitos estimados e realizados, em contagem, usando a mesma escala de zero a {max}.
            </desc>

            {[0, 0.5, 1].map((fraction) => {
              const y = PAD_TOP + plotH - fraction * plotH;
              const value = Math.round(max * fraction);
              return (
                <g key={fraction}>
                  <line
                    x1={PAD_LEFT}
                    y1={y}
                    x2={VB_W - PAD_RIGHT}
                    y2={y}
                    stroke="var(--border-subtle)"
                    strokeWidth={1}
                    strokeDasharray={fraction === 0 ? undefined : "3 4"}
                  />
                  <text x={PAD_LEFT - 7} y={y + 3} textAnchor="end" fontSize={11} fill="var(--text-muted)">
                    {value}
                  </text>
                </g>
              );
            })}

            <polyline
              points={toPolyline(tarefasEst)}
              fill="none"
              stroke="#f59e0b88"
              strokeWidth={1.5}
              strokeDasharray="5 4"
            />
            <polyline
              points={toPolyline(tarefasReal)}
              fill="none"
              stroke="#f59e0b"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <polyline
              points={toPolyline(habitosEst)}
              fill="none"
              stroke="#22c55e88"
              strokeWidth={1.5}
              strokeDasharray="5 4"
            />
            <polyline
              points={toPolyline(habitosReal)}
              fill="none"
              stroke="#22c55e"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />

            {lines.map((point, index) => (
              <g key={point.periodo}>
                <circle cx={tarefasReal[index].x} cy={tarefasReal[index].y} r={2.5} fill="#f59e0b">
                  <title>{`${point.periodo}: tarefas ${point.realizado_tarefas}/${point.estimado_tarefas}`}</title>
                </circle>
                <circle cx={habitosReal[index].x} cy={habitosReal[index].y} r={2.5} fill="#22c55e">
                  <title>{`${point.periodo}: hábitos ${point.realizado_habitos}/${point.estimado_habitos}`}</title>
                </circle>
                {(index % 2 === 0 || index === lines.length - 1) && (
                  <text
                    x={tarefasReal[index].x}
                    y={VB_H - 8}
                    textAnchor="middle"
                    fontSize={11}
                    fill="var(--text-muted)"
                  >
                    {point.periodo}
                  </text>
                )}
              </g>
            ))}
          </svg>

          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-[var(--text-muted)]">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-4 border-t-2 border-dashed border-amber-500/70" />
              tarefas esperadas
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-4 bg-amber-500" />
              tarefas finalizadas
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-4 border-t-2 border-dashed border-emerald-500/70" />
              hábitos esperados
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-4 bg-emerald-500" />
              hábitos concluídos
            </span>
          </div>
        </>
      )}
    </section>
  );
};
