import React from "react";
import type { DayBarPoint } from "../../types";
import { barSlot } from "../../utils/svgChart";

const VB_W = 560;
const VB_H = 188;
const PAD_LEFT = 42;
const PAD_RIGHT = 12;
const PAD_TOP = 18;
const PAD_BOTTOM = 30;
const TASK_LANE_H = 72;
const HABIT_GAP = 22;
const HABIT_LANE_H = 34;

function dayLabel(date: string): string {
  return date.slice(8);
}

/**
 * Últimos 14 dias em duas faixas: percentual de tarefas e contagem de
 * hábitos. As duas medidas nunca compartilham uma escala vertical.
 */
export const DayBars: React.FC<{ bars: DayBarPoint[] }> = ({ bars }) => {
  const plotW = VB_W - PAD_LEFT - PAD_RIGHT;
  const taskBaseY = PAD_TOP + TASK_LANE_H;
  const habitBaseY = taskBaseY + HABIT_GAP + HABIT_LANE_H;
  const maxHabits = Math.max(1, ...bars.map((bar) => bar.habitos_registrados));
  const lastIndex = bars.length - 1;

  const hasActivity = bars.some(
    (bar) => bar.tarefas_total > 0 || bar.habitos_registrados > 0
  );

  if (bars.length === 0 || !hasActivity) {
    return (
      <section aria-labelledby="day-bars-title">
        <h2 id="day-bars-title" className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          Últimos 14 dias
        </h2>
        <p className="py-6 text-center text-xs text-[var(--text-muted)]">
          Ainda não há tarefas ou hábitos registrados neste período.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="day-bars-title">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 id="day-bars-title" className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          Últimos 14 dias
        </h2>
        <span className="text-[10px] text-[var(--text-muted)]">tarefas % · hábitos registrados</span>
      </div>

      <p className="sr-only">
        {bars
          .map(
            (bar) =>
              `${bar.date}: ${bar.tarefas_feitas} de ${bar.tarefas_total} tarefas concluídas, ${bar.pct_tarefas}%; ${bar.habitos_registrados} hábitos registrados.`
          )
          .join(" ")}
      </p>

      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        className="h-auto w-full"
        role="img"
        aria-labelledby="day-bars-title day-bars-description"
      >
        <desc id="day-bars-description">
          Duas faixas separadas: a faixa superior mostra o percentual de tarefas concluídas e a inferior mostra quantos hábitos foram registrados.
        </desc>

        <text x={PAD_LEFT} y={PAD_TOP - 5} fontSize={11} fill="var(--text-muted)">
          tarefas · %
        </text>
        <text x={PAD_LEFT} y={taskBaseY + 1} fontSize={11} fill="var(--text-muted)">
          hábitos · nº
        </text>

        <rect
          x={PAD_LEFT}
          y={PAD_TOP}
          width={plotW}
          height={TASK_LANE_H}
          rx={4}
          fill="var(--bg-input)"
          opacity={0.48}
        />
        <rect
          x={PAD_LEFT}
          y={taskBaseY + HABIT_GAP}
          width={plotW}
          height={HABIT_LANE_H}
          rx={4}
          fill="var(--bg-input)"
          opacity={0.48}
        />

        {[0, 0.5, 1].map((fraction) => {
          const y = taskBaseY - fraction * TASK_LANE_H;
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
                {Math.round(fraction * 100)}%
              </text>
            </g>
          );
        })}
        {[0, 1].map((fraction) => {
          const y = habitBaseY - fraction * HABIT_LANE_H;
          return (
            <g key={`habit-${fraction}`}>
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
                {fraction === 1 ? maxHabits : 0}
              </text>
            </g>
          );
        })}

        {bars.map((bar, index) => {
          const { x, w } = barSlot(index, bars.length, plotW, 4);
          const xWithPadding = x + PAD_LEFT;
          const taskHeight = (bar.pct_tarefas / 100) * TASK_LANE_H;
          const habitHeight = (bar.habitos_registrados / maxHabits) * HABIT_LANE_H;
          const isToday = index === lastIndex;
          return (
            <g key={bar.date}>
              <rect
                x={xWithPadding}
                y={taskBaseY - taskHeight}
                width={w}
                height={bar.tarefas_total > 0 ? Math.max(taskHeight, 2) : 0}
                rx={2}
                fill={isToday ? "#f59e0b" : "#f59e0b99"}
              >
                <title>{`${bar.date}: ${bar.tarefas_feitas}/${bar.tarefas_total} tarefas (${bar.pct_tarefas}%)`}</title>
              </rect>
              <rect
                x={xWithPadding}
                y={habitBaseY - habitHeight}
                width={w}
                height={bar.habitos_registrados > 0 ? Math.max(habitHeight, 3) : 0}
                rx={2}
                fill={isToday ? "#34d399" : "#22c55eaa"}
              >
                <title>{`${bar.date}: ${bar.habitos_registrados} hábito(s) registrado(s)`}</title>
              </rect>
              {(index % 2 === 1 || isToday) && (
                <text
                  x={xWithPadding + w / 2}
                  y={VB_H - 9}
                  textAnchor="middle"
                  fontSize={11}
                  fill={isToday ? "var(--text-secondary)" : "var(--text-muted)"}
                >
                  {dayLabel(bar.date)}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-[var(--text-muted)]">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-500" />
          % tarefas feitas
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500" />
          hábitos registrados
        </span>
        <span className="ml-auto">escala separada por faixa</span>
      </div>
    </section>
  );
};
