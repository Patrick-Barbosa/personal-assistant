import React, { useState, useEffect } from "react";
import { Radio, Activity, Sliders, Check } from "lucide-react";
import { api } from "../../api";

interface DebugScores {
  copernico: number;
  zefiro?: number;
  lich?: number;
  rms: number;
  threshold: number;
}

export const SettingsWakewordTab: React.FC = () => {
  const [debugScores, setDebugScores] = useState<DebugScores>({
    copernico: 0,
    zefiro: 0,
    lich: 0,
    rms: 0,
    threshold: 0.5,
  });
  const [copernicoPeak, setCopernicoPeak] = useState(0);
  const [threshold, setThreshold] = useState(0.5);
  const [thresholdFeedback, setThresholdFeedback] = useState<string | null>(null);

  useEffect(() => {
    api.getWakeWordThreshold().then((th) => {
      if (th && th > 0) setThreshold(th);
    });

    let unlisten: (() => void) | undefined;
    const setupListener = async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen<DebugScores>("wake-scores-debug", (event) => {
          const payload = event.payload;
          setDebugScores(payload);
          setCopernicoPeak((prev) => Math.max(prev, payload.copernico));
        });
      } catch {}
    };
    setupListener();

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const handleSaveThreshold = async (newVal: number) => {
    setThreshold(newVal);
    try {
      await api.setWakeWordThreshold(newVal);
      setThresholdFeedback("Sensibilidade salva!");
      setTimeout(() => setThresholdFeedback(null), 2500);
    } catch {
      setThresholdFeedback("Erro ao salvar.");
    }
  };

  const copernicoPct = Math.round(debugScores.copernico * 100);
  const thresholdPct = Math.round(threshold * 100);
  const rmsPct = Math.min(100, Math.round(debugScores.rms * 1000));

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <Radio size={16} className="text-amber-400" />
          <span>Detecção e Calibração de Wake Word</span>
        </h3>
        <p className="text-xs text-[var(--text-muted)] mt-1 leading-relaxed">
          O Copernico roda o modelo neural ONNX localmente em segundo plano. Diga "Copérnico" para ativar.
        </p>
      </div>

      {/* Live Monitor Card */}
      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)]/80 p-4 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-[var(--text-secondary)] flex items-center gap-1.5">
            <Activity size={14} className="text-amber-400" />
            <span>Monitor de Áudio em Tempo Real</span>
          </span>
          <button
            type="button"
            onClick={() => setCopernicoPeak(0)}
            className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] px-2 py-1 rounded bg-[var(--bg-elevated)] transition-colors"
          >
            Zerar pico
          </button>
        </div>

        {/* RMS Meter */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-[11px] font-mono text-[var(--text-muted)]">
            <span>Volume do Microfone (RMS)</span>
            <span>{rmsPct}%</span>
          </div>
          <div className="h-2 w-full bg-[var(--bg-elevated)] rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full transition-all duration-75"
              style={{ width: `${rmsPct}%` }}
            />
          </div>
        </div>

        {/* Score Meter */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-[11px] font-mono text-[var(--text-muted)]">
            <span>Score "Copérnico" (Pico: {Math.round(copernicoPeak * 100)}%)</span>
            <span className={copernicoPct >= thresholdPct ? "text-amber-400 font-bold" : "text-[var(--text-secondary)]"}>
              {copernicoPct}% / {thresholdPct}%
            </span>
          </div>
          <div className="h-3 w-full bg-[var(--bg-elevated)] rounded-full overflow-hidden relative">
            <div
              className={`h-full rounded-full transition-all duration-100 ${
                copernicoPct >= thresholdPct ? "bg-amber-400" : "bg-amber-500/40"
              }`}
              style={{ width: `${copernicoPct}%` }}
            />
            {/* Threshold Line Marker */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-rose-400 z-10"
              style={{ left: `${thresholdPct}%` }}
              title={`Threshold atual: ${thresholdPct}%`}
            />
          </div>
        </div>
      </div>

      {/* Threshold Slider Card */}
      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)]/80 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-[var(--text-secondary)] flex items-center gap-1.5">
            <Sliders size={14} className="text-amber-400" />
            <span>Sensibilidade de Ativação</span>
          </span>
          <span className="text-xs font-mono text-amber-400 font-semibold">{threshold.toFixed(2)}</span>
        </div>

        <input
          type="range"
          min="0.25"
          max="0.85"
          step="0.01"
          value={threshold}
          onChange={(e) => handleSaveThreshold(parseFloat(e.target.value))}
          className="w-full accent-amber-500 cursor-pointer"
        />

        <div className="flex justify-between text-[10px] text-[var(--text-muted)]">
          <span>Mais sensível (0.25)</span>
          <span>Recomendado (0.50)</span>
          <span>Mais rígido (0.85)</span>
        </div>

        {thresholdFeedback && (
          <div className="flex items-center gap-1.5 text-xs text-emerald-400 pt-1">
            <Check size={13} />
            <span>{thresholdFeedback}</span>
          </div>
        )}
      </div>
    </div>
  );
};
