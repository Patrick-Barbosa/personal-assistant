import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { playListeningChime, playEndChime, playFollowUpChime } from "../utils/audioCue";
import { api } from "../api";
import { CopernicoSun } from "./icons/CopernicoSun";
import { SunBackground } from "../voice/SunBackground";
import {
  formatSunTransition,
  isSunDebugEnabled,
  resolveSunVisual,
  type SunChime,
  type SunVisual,
  type WakeVoiceStatus,
} from "../voice/sunMachine";

export type { WakeVoiceStatus } from "../voice/sunMachine";

// Orquestrador fino do indicador de voz: assina eventos Tauri, alimenta a
// sunMachine (única fonte de verdade do comportamento por estado) e renderiza
// as camadas (fundo + sol + etiqueta). Nenhuma decisão visual mora aqui.

function playChime(chime: SunChime) {
  if (chime === "listening") playListeningChime();
  else if (chime === "followup") playFollowUpChime();
  else if (chime === "end") playEndChime();
}

function solDebug(message: string) {
  if (isSunDebugEnabled()) {
    // eslint-disable-next-line no-console
    console.debug(message);
  }
  // Diagnóstico temporário: espelha no copernico.log via backend ([SOL-FRONT]).
  // Fire-and-forget de propósito (nunca bloqueia o render).
  api.reportSunDebug(message).catch(() => {});
}

const STATUS_TITLES: Record<WakeVoiceStatus, string> = {
  recording: "Copernico ouvindo... Clique para abrir",
  listening: "Sua vez de falar... Clique para abrir",
  processing: "Copernico pensando... Clique para abrir",
  speaking: "Copernico falando... Clique para abrir",
  idle: "Copernico (Sol Heliocêntrico) — Clique para abrir",
};

const BADGE_CLASSES: Record<"amber" | "sky", string> = {
  amber:
    "border-amber-400/60 text-amber-200",
  sky:
    "border-sky-400/50 text-sky-200",
};

// SOL-01/H7: estado module-level e sessionStorage que sobrevivem a
// remounts do React (StrictMode / HMR) e reloads da WebView2 no Windows.
function readSavedStatus(): WakeVoiceStatus {
  try {
    if (typeof sessionStorage !== "undefined") {
      const saved = sessionStorage.getItem("copernico_wake_status") as WakeVoiceStatus | null;
      if (saved && ["recording", "speaking", "listening", "processing"].includes(saved)) {
        return saved;
      }
    }
  } catch {}
  return "idle";
}

function writeSavedStatus(st: WakeVoiceStatus) {
  try {
    if (typeof sessionStorage !== "undefined") {
      if (st === "idle") {
        sessionStorage.removeItem("copernico_wake_status");
      } else {
        sessionStorage.setItem("copernico_wake_status", st);
      }
    }
  } catch {}
}

const _initialStatus = readSavedStatus();
let _lastKnownStatus: WakeVoiceStatus = _initialStatus;
let _lastKnownVisual: SunVisual | null =
  _initialStatus !== "idle" ? resolveSunVisual(_initialStatus, 0, "idle") : null;

export const VoiceIndicatorOverlay: React.FC = () => {
  const [visual, setVisual] = useState<SunVisual>(() =>
    _lastKnownVisual ?? resolveSunVisual("idle", 0, "idle")
  );
  const [status, setStatus] = useState<WakeVoiceStatus>(_lastKnownStatus);
  const statusRef = React.useRef<WakeVoiceStatus>(_lastKnownStatus);
  // Diagnóstico temporário: prova que o canal wake-debug-scores chega vivo.
  const firstRmsReportedRef = React.useRef(false);

  useEffect(() => {
    let unlistenStatus: (() => void) | undefined;
    let unlistenDebug: (() => void) | undefined;
    let unlistenChime: (() => void) | undefined;
    // StrictMode (dev) monta → desmonta → remonta: o cleanup roda antes dos
    // awaits resolverem, então sem este guarda os listeners da 1ª montagem
    // vazam e tudo dispara em duplicata (chimes, logs, setStates).
    let cancelled = false;

    const setupListeners = async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        if (cancelled) return;

        unlistenStatus = await listen<{ status: WakeVoiceStatus; prompt?: string }>(
          "wake-status-changed",
          (event) => {
            const prev = statusRef.current;
            const next = event.payload.status;
            statusRef.current = next;
            _lastKnownStatus = next;      // SOL-01/H7: persiste entre remounts
            writeSavedStatus(next);       // SOL-01/H7: persiste entre WebView2 reloads
            setStatus(next);
            const nextVisual = resolveSunVisual(next, 0, prev);
            _lastKnownVisual = nextVisual; // SOL-01/H7: persiste entre remounts
            setVisual(nextVisual);
            playChime(nextVisual.chime);
            solDebug(formatSunTransition(prev, next, 0, "wake-status-changed"));
          }
        );

        unlistenChime = await listen("wake-play-followup-chime", () => {
          if (cancelled) return;
          solDebug("[SOL] chime followup via wake-play-followup-chime");
          playFollowUpChime();
        });
        if (cancelled) {
          unlistenStatus?.();
          unlistenChime?.();
          unlistenStatus = undefined;
          unlistenChime = undefined;
          return;
        }

        unlistenDebug = await listen<{
          copernico: number;
          zefiro?: number;
          lich?: number;
          rms: number;
          threshold: number;
        }>("wake-debug-scores", (event) => {
          // Ignora o RMS apenas enquanto o AGENTE pensa (processing), para não piscar pétalas sem áudio.
          // Durante speaking o RMS do speaker anima ritmicamente as pétalas com a fala.
          const s = statusRef.current;
          if (s === "processing") return;
          // Update de RMS: re-resolve o visual do estado atual SEM chime
          // (a máquina já silencia mesmo-estado; o spread garante por construção).
          const rawRms = event.payload.rms || 0;
          if (!firstRmsReportedRef.current) {
            firstRmsReportedRef.current = true;
            solDebug(
              `first rms received (rms=${rawRms.toFixed(3)}, status=${s})`
            );
          }
          setVisual({ ...resolveSunVisual(s, rawRms, s), chime: null });
        });
        if (cancelled) {
          unlistenStatus?.();
          unlistenDebug?.();
          unlistenChime?.();
          unlistenStatus = undefined;
          unlistenDebug = undefined;
          unlistenChime = undefined;
          return;
        }
        solDebug("[SOL] listeners attached (indicator)");
      } catch (e) {
        console.warn("Tauri event listeners not available in web preview", e);
      }
    };

    setupListeners();

    return () => {
      cancelled = true;
      solDebug("[SOL] listeners detached (indicator)");
      if (unlistenStatus) unlistenStatus();
      if (unlistenDebug) unlistenDebug();
      if (unlistenChime) unlistenChime();
    };
  }, []);

  const handleClick = () => {
    // Clicar na esfera solar abre a janela principal do Copernico
    api.toggleOverlay(true);
  };

  return (
    <div className="w-screen h-screen flex items-center justify-center p-0 bg-transparent select-none overflow-hidden pointer-events-none">
      {/* A Esfera Solar calibrada para 70% (123px) dentro da janela de 154px */}
      <div
        onClick={handleClick}
        title={STATUS_TITLES[status]}
        className="pointer-events-auto cursor-pointer relative flex items-center justify-center w-[140px] h-[140px]"
      >
        {/* Fundo ambiente desacoplado + arte do sol por cima */}
        <SunBackground
          tone={visual.tone}
          intensity={visual.intensity}
          breathing={visual.breathing}
        >
          {/* O Sol Heliocêntrico com 12 pétalas dinâmicas */}
          <CopernicoSun
            size={123}
            volume={visual.volume}
            strokeColor="#ffffff"
          />
        </SunBackground>

        {/* Etiqueta de status (uma só, dirigida pela máquina) */}
        <AnimatePresence>
          {visual.badge && visual.badgeTone && (
            <motion.div
              key="sun-badge"
              initial={{ opacity: 0, y: 8, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 4, scale: 0.9 }}
              transition={{ duration: 0.2 }}
              className={`absolute -bottom-1 px-2.5 py-0.5 rounded-full bg-neutral-950/85 border text-[10px] font-bold backdrop-blur-md shadow-lg pointer-events-none flex items-center gap-1 ${BADGE_CLASSES[visual.badgeTone]}`}
            >
              {visual.badgePulse && (
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-ping" />
              )}
              {visual.badge}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};
