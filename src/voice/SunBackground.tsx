import React from "react";
import type { SunTone } from "./sunMachine";

// Camada ambiente do Sol — fundo/glow desacoplado da arte.
//
// Recebe apenas (tone, intensity, breathing) resolvidos pela sunMachine.
// Não conhece eventos Tauri, RMS nem estados de voz. O sol (CopernicoSun)
// renderiza como children, por cima do glow.

interface SunBackgroundProps {
  tone: SunTone;
  /** Brilho do ambiente (0..1). */
  intensity: number;
  /** Respiração (orb-breathing) ligada. */
  breathing: boolean;
  size?: number;
  children?: React.ReactNode;
}

interface ToneStyle {
  /** Cor do núcleo do glow em função da intensidade (0..1). */
  core: (intensity: number) => string;
  mid: (intensity: number) => string;
  shadowClass: string;
}

const TONES: Record<SunTone, ToneStyle> = {
  white: {
    core: (i) => `rgba(255,255,255,${(0.55 * i).toFixed(3)})`,
    mid: (i) => `rgba(253,230,138,${(0.30 * i).toFixed(3)})`,
    shadowClass: "drop-shadow-[0_0_18px_rgba(255,255,255,0.7)]",
  },
  sky: {
    core: (i) => `rgba(125,211,252,${(0.50 * i).toFixed(3)})`,
    mid: (i) => `rgba(56,189,248,${(0.28 * i).toFixed(3)})`,
    shadowClass: "drop-shadow-[0_0_22px_rgba(56,189,248,0.55)]",
  },
  amber: {
    core: (i) => `rgba(245,158,11,${(0.50 * i).toFixed(3)})`,
    mid: (i) => `rgba(251,191,36,${(0.25 * i).toFixed(3)})`,
    shadowClass: "drop-shadow-[0_0_16px_rgba(245,158,11,0.55)]",
  },
};

// Véu escuro suave atrás do sol: garante contraste em qualquer papel de parede.
const SCRIM_BY_TONE: Record<SunTone, string> = {
  white:
    "radial-gradient(circle, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.35) 40%, transparent 70%)",
  amber:
    "radial-gradient(circle, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.25) 45%, transparent 70%)",
  sky:
    "radial-gradient(circle, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.25) 45%, transparent 70%)",
};

export const SunBackground: React.FC<SunBackgroundProps> = ({
  tone,
  intensity,
  breathing,
  size = 140,
  children,
}) => {
  const clamped = Math.max(0, Math.min(1, intensity));
  const style = TONES[tone];

  return (
    <div
      className={`relative flex items-center justify-center transition-transform duration-150 ${
        breathing ? "orb-breathing" : ""
      }`}
      style={{ width: size, height: size }}
    >
      {/* Véu escuro atrás do sol */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: SCRIM_BY_TONE[tone] }}
      />
      {/* Halo radial atrás do sol */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `radial-gradient(circle, ${style.core(
            clamped
          )} 0%, ${style.mid(clamped)} 45%, transparent 70%)`,
        }}
      />
      {/* Sombra projetada + sol por cima */}
      <div
        className={`relative flex items-center justify-center transition-[filter,transform] duration-200 ease-out ${style.shadowClass}`}
      >
        {children}
      </div>
    </div>
  );
};
