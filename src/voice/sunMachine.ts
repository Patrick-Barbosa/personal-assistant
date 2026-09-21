// Contrato visual do Sol por estado de voz — única fonte de verdade.
//
// Função pura: (status, rms) -> SunVisual. Sem JSX, sem Tauri, sem áudio.
// Toda decisão "o que o sol faz em cada estado" mora aqui; os componentes
// (`SunBackground`, `CopernicoSun`, `VoiceIndicatorOverlay`) só executam.
// Logs de transição usam o mesmo prefixo `[SOL]` do backend Rust para
// correlação direta nos arquivos de log.

export type WakeVoiceStatus =
  | "idle"
  | "recording"
  | "processing"
  | "speaking"
  | "listening";

export type SunTone = "amber" | "white" | "sky";

export type SunChime = "listening" | "followup" | "end" | null;

export interface SunVisual {
  /** Abertura das pétalas / intensidade do núcleo (0..1). */
  volume: number;
  /** Tom do ambiente (glow + sombra). */
  tone: SunTone;
  /** Brilho do ambiente (0..1). */
  intensity: number;
  /** Respiração (orb-breathing) ligada. */
  breathing: boolean;
  /** Há voz do usuário agora (RMS acima do limiar). */
  voiceActive: boolean;
  /** Etiqueta sob o sol; null = sem badge. */
  badge: string | null;
  /** Cor da etiqueta. */
  badgeTone: "amber" | "sky" | null;
  /** Ponto pulsante na etiqueta. */
  badgePulse: boolean;
  /** Chime a tocar nesta transição; null = silêncio. */
  chime: SunChime;
}

/** Ganho aplicado ao RMS do mic para abrir as pétalas. */
export const RMS_AMPLIFICATION = 9.5;
/** RMS amplificado acima disso conta como voz do usuário. */
export const VOICE_ACTIVITY_THRESHOLD = 0.05;
/** Piso de visibilidade em recording: o sol nunca apaga no silêncio. */
export const RECORDING_VOLUME_FLOOR = 0.15;
/** Volumes fixos por estado (independem do mic). */
export const SPEAKING_VOLUME = 0.45;
export const PROCESSING_VOLUME = 0.35;
export const LISTENING_VOLUME = 0.25;

export function amplifyRms(rms: number): number {
  const safe = Number.isFinite(rms) ? Math.max(0, rms) : 0;
  return Math.min(1, safe * RMS_AMPLIFICATION);
}

function chimeForTransition(
  next: WakeVoiceStatus,
  prev: WakeVoiceStatus
): SunChime {
  // Mesmo estado (ex.: update de RMS em recording): não é transição, silêncio.
  if (next === prev) return null;
  if (next === "recording") {
    // Sem airy inicial ao recomeçar no follow-up (evita estouro).
    return prev === "listening" ? null : "listening";
  }
  if (next === "listening") return "followup";
  if (next === "processing") return "end";
  return null;
}

export function resolveSunVisual(
  status: WakeVoiceStatus,
  rms: number,
  prev: WakeVoiceStatus = "idle"
): SunVisual {
  const amplified = amplifyRms(rms);
  const voiceActive = amplified > VOICE_ACTIVITY_THRESHOLD;

  switch (status) {
    case "speaking":
      return {
        volume: rms > 0 ? Math.max(amplified, 0.2) : SPEAKING_VOLUME,
        tone: "white",
        intensity: 1,
        breathing: false,
        voiceActive,
        badge: "Falando...",
        badgeTone: "amber",
        badgePulse: true,
        chime: chimeForTransition(status, prev),
      };
    case "processing":
      return {
        volume: PROCESSING_VOLUME,
        tone: "amber",
        intensity: 0.8,
        breathing: false,
        voiceActive,
        badge: "Pensando...",
        badgeTone: "amber",
        badgePulse: false,
        chime: chimeForTransition(status, prev),
      };
    case "listening":
      return {
        volume: LISTENING_VOLUME,
        tone: "sky",
        intensity: 0.8,
        breathing: false,
        voiceActive,
        badge: "Sua vez...",
        badgeTone: "sky",
        badgePulse: true,
        chime: chimeForTransition(status, prev),
      };
    case "recording":
      return {
        volume: Math.max(amplified, RECORDING_VOLUME_FLOOR),
        tone: "amber",
        intensity: 0.6,
        breathing: !voiceActive,
        voiceActive,
        badge: "Ouvindo...",
        badgeTone: "amber",
        badgePulse: true,
        chime: chimeForTransition(status, prev),
      };
    case "idle":
    default:
      return {
        volume: amplified,
        tone: "amber",
        intensity: 0.4,
        breathing: !voiceActive,
        voiceActive,
        badge: null,
        badgeTone: null,
        badgePulse: false,
        chime: chimeForTransition(status, prev),
      };
  }
}

/** Linha de log objetiva por transição, correlacionável com o backend. */
export function formatSunTransition(
  prev: WakeVoiceStatus,
  next: WakeVoiceStatus,
  rms: number,
  via: string
): string {
  const r = Number.isFinite(rms) ? rms : 0;
  return `[SOL] ${prev}→${next} via ${via} (rms=${r.toFixed(3)})`;
}

/** Liga/desliga logs `[SOL]` do frontend via `localStorage.debugSun = "1"`. */
export function isSunDebugEnabled(): boolean {
  try {
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem("debugSun") === "1";
  } catch {
    return false;
  }
}
