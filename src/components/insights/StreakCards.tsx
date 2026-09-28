import React from "react";
import { CheckCircle2, Flame, Trophy } from "lucide-react";
import type { Insights } from "../../types";

/** Placar do dia e sequência dos hábitos que já chegaram ao backend. */
export const StreakCards: React.FC<{ insights: Insights }> = ({ insights }) => {
  const { streaks, habitos_hoje_total, habitos_hoje_feitos, pct_semana } = insights;
  const bestStreak = streaks.reduce((best, card) => Math.max(best, card.maior_streak), 0);

  return (
    <section aria-labelledby="streak-cards-title" className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)]/55 p-3">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id="streak-cards-title" className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          Placar de hoje
        </h2>
        <span className="text-[10px] text-[var(--text-muted)]">resumo operacional</span>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <SummaryCard
          label="% da semana"
          value={`${pct_semana}%`}
          hint="conclusão da semana aberta"
        />
        <SummaryCard
          label="Hábitos de hoje"
          value={`${habitos_hoje_feitos}/${habitos_hoje_total}`}
          hint={habitos_hoje_total === 0 ? "nada agendado para hoje" : "registrados hoje"}
          accent={habitos_hoje_total > 0 && habitos_hoje_feitos === habitos_hoje_total}
        />
        <SummaryCard
          label="Hábitos acompanhados"
          value={String(streaks.length)}
          hint="sequências em andamento"
        />
        <SummaryCard
          label="Maior sequência"
          value={`${bestStreak} ${bestStreak === 1 ? "dia" : "dias"}`}
          hint="recorde entre os hábitos"
        />
      </div>

      {streaks.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
          {streaks.map((card) => (
            <article
              key={card.habit.id}
              className="relative min-w-0 overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-input)]/75 p-3"
            >
              <span
                aria-hidden="true"
                className="absolute inset-y-2 left-0 w-0.5 rounded-full"
                style={{ background: card.habit.cor }}
              />
              <p
                className="truncate pl-1 text-xs font-medium text-[var(--text-primary)]"
                title={card.habit.titulo}
              >
                {card.habit.titulo}
              </p>
              <div className="mt-1.5 flex items-center gap-1.5 pl-1">
                <Flame size={14} className="shrink-0 text-[var(--text-warning)]" />
                <span className="text-lg font-bold leading-none tabular-nums text-[var(--text-primary)]">
                  {card.streak_atual}
                </span>
                <span className="text-[10px] text-[var(--text-muted)]">dias</span>
                {card.feito_hoje && (
                  <CheckCircle2 size={14} className="ml-auto shrink-0 text-[var(--text-success)]" aria-label="Feito hoje" />
                )}
              </div>
              <p className="mt-1.5 flex items-center gap-1 pl-1 text-[10px] text-[var(--text-muted)]">
                <Trophy size={10} />
                recorde {card.maior_streak}
                {!card.feito_hoje && " · pendente hoje"}
              </p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
};

const SummaryCard: React.FC<{
  label: string;
  value: string;
  hint: string;
  accent?: boolean;
}> = ({ label, value, hint, accent }) => (
  <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-input)]/65 p-3">
    <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{label}</p>
    <p
      className={`mt-0.5 text-xl font-bold leading-tight tabular-nums ${
        accent ? "text-[var(--text-success)]" : "text-[var(--text-primary)]"
      }`}
    >
      {value}
    </p>
    <p className="truncate text-[10px] text-[var(--text-muted)]">{hint}</p>
  </div>
);
