import React from "react";
import type { WeekTrendPoint } from "../../types";
import { fixedScaleSeriesPoints, toPolyline } from "../../utils/svgChart";

const VB_W = 560;
const VB_H = 184;
const PAD_LEFT = 38;
const PAD_RIGHT = 12;
const PAD_TOP = 18;
const PAD_BOTTOM = 30;

function weekLabel(weekId: string): string {
  return weekId.slice(-3);
}

/** Tendência das últimas 8 semanas com uma escala percentual fixa de 0–100%. */
export const WeekTrend: React.FC<{ trend: WeekTrendPoint[] }> = ({ trend }) => {
  const plotW = VB_W - PAD_LEFT - PAD_RIGHT;
  const plotH = VB_H - PAD_TOP - PAD_BOTTOM;
  const conclusao = fixedScaleSeriesPoints(
    trend.map((point) => point.pct_conclusao),
    plotW,
    plotH
  );
  const habitos = fixedScaleSeriesPoints(
    trend.map((point) => point.taxa_habitos),
    plotW,
    plotH
  );
  const lastIndex = trend.length - 1;
  const hasActivity = trend.some(
    (point) => point.pct_conclusao > 0 || point.taxa_habitos > 0
  );

  if (trend.length === 0 || !hasActivity) {
    return (
      <section aria-labelledby="week-trend-title">
        <h2 id="week-trend-title" className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          Tendência entre semanas
        </h2>
        <p className="py-6 text-center text-xs text-[var(--text-muted)]">
          Ainda não há conclusão registrada para comparar.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="week-trend-title">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 id="week-trend-title" className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          Tendência entre semanas
        </h2>
        <span className="text-[10px] text-[var(--text-muted)]">escala fixa · 0–100%</span>
      </div>

      <p className="sr-only">
        {trend
          .map(
            (point) =>
              `${point.week_id}: ${point.pct_conclusao}% de tarefas concluídas e ${point.taxa_habitos}% de hábitos.`
          )
          .join(" ")}
      </p>

      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        className="h-auto w-full"
        role="img"
        aria-labelledby="week-trend-title week-trend-description"
      >
        <desc id="week-trend-description">
          Comparação percentual de tarefas concluídas e hábitos concluídos nas últimas oito semanas, usando a mesma escala de zero a cem por cento.
        </desc>

        {[100, 50, 0].map((value) => {
          const y = PAD_TOP + plotH - (value / 100) * plotH;
          return (
            <g key={value}>
              <line
                x1={PAD_LEFT}
                y1={y}
                x2={VB_W - PAD_RIGHT}
                y2={y}
                stroke="var(--border-subtle)"
                strokeWidth={1}
                strokeDasharray={value === 0 ? undefined : "3 4"}
              />
              <text x={PAD_LEFT - 7} y={y + 3} textAnchor="end" fontSize={11} fill="var(--text-muted)">
                {value}%
              </text>
            </g>
          );
        })}

        <polyline
          points={toPolyline(
            conclusao.map((point) => ({ x: point.x + PAD_LEFT, y: point.y + PAD_TOP }))
          )}
          fill="none"
          stroke="#f59e0b"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <polyline
          points={toPolyline(
            habitos.map((point) => ({ x: point.x + PAD_LEFT, y: point.y + PAD_TOP }))
          )}
          fill="none"
          stroke="#22c55e"
          strokeWidth={2}
          strokeDasharray="5 4"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {trend.map((point, index) => {
          const conclusionPoint = conclusao[index];
          const habitPoint = habitos[index];
          if (!conclusionPoint || !habitPoint) return null;
          const isCurrent = index === lastIndex;
          return (
            <g key={point.week_id}>
              <circle
                cx={conclusionPoint.x + PAD_LEFT}
                cy={conclusionPoint.y + PAD_TOP}
                r={isCurrent ? 4 : 3}
                fill="#f59e0b"
                stroke={isCurrent ? "var(--bg-card)" : "none"}
                strokeWidth={isCurrent ? 2 : 0}
              >
                <title>{`${point.week_id}: ${point.pct_conclusao}% tarefas`}</title>
              </circle>
              <circle
                cx={habitPoint.x + PAD_LEFT}
                cy={habitPoint.y + PAD_TOP}
                r={isCurrent ? 4 : 3}
                fill="#22c55e"
                stroke={isCurrent ? "var(--bg-card)" : "none"}
                strokeWidth={isCurrent ? 2 : 0}
              >
                <title>{`${point.week_id}: ${point.taxa_habitos}% hábitos`}</title>
              </circle>
              <text
                x={conclusionPoint.x + PAD_LEFT}
                y={VB_H - 8}
                textAnchor="middle"
                fontSize={11}
                fill={isCurrent ? "var(--text-secondary)" : "var(--text-muted)"}
              >
                {weekLabel(point.week_id)}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-[var(--text-muted)]">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 bg-amber-500" />
          conclusão de tarefas
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-4 border-t-2 border-dashed border-emerald-500" />
          taxa de hábitos
        </span>
        <span className="ml-auto">ponto final = semana atual</span>
      </div>
    </section>
  );
};
