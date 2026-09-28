import React, { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import type { VoicePhase } from "../hooks/useVoiceSession";
import { cssVarRgb } from "../utils/cssVarRgb";
import type { RGB } from "../utils/cssVarRgb";

const PHASE_TOKEN: Record<VoicePhase, string> = {
  listening: "--accent",
  processing: "--text-info",
  speaking: "--text-success",
  idle: "--text-muted",
};

const LIGHT_TOKEN: Record<VoicePhase, string> = {
  listening: "--text-accent",
  processing: "--text-info",
  speaking: "--text-success",
  idle: "--text-muted",
};

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function rgba(c: RGB, a: number): string {
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
}

interface VoiceOrbProps {
  levelRef: MutableRefObject<number>;
  waveRef: MutableRefObject<Float32Array>;
  phase: VoicePhase;
  /** Manual override: tap to end the turn immediately. */
  onTap: () => void;
  size?: number;
}

/**
 * Single Ember orb (PRD-orb §4): one core, one light source, one ring,
 * pre-rendered halo sprite, token-driven colors, zero blur calls in the loop.
 */
export const VoiceOrb: React.FC<VoiceOrbProps> = ({
  levelRef,
  waveRef,
  phase,
  onTap,
  size = 320,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const tapRef = useRef(onTap);
  tapRef.current = onTap;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const isLight =
      typeof document !== "undefined" &&
      document.documentElement.classList.contains("light");
    const ground: RGB = isLight ? [63, 63, 70] : [10, 10, 15];

    // Resolve tokens on phase/size change only (never per frame).
    let coreTok: RGB = cssVarRgb(PHASE_TOKEN[phaseRef.current] ?? "--text-muted");
    let lightTok: RGB = cssVarRgb(LIGHT_TOKEN[phaseRef.current] ?? "--text-muted");
    let lastResolvedPhase: VoicePhase = phaseRef.current;

    const resolveTokens = () => {
      coreTok = cssVarRgb(PHASE_TOKEN[phaseRef.current] ?? "--text-muted");
      lightTok = cssVarRgb(LIGHT_TOKEN[phaseRef.current] ?? "--text-muted");
      lastResolvedPhase = phaseRef.current;
      haloSprite = null;
    };

    // Pre-rendered halo sprite per (size, phase).
    let haloSprite: HTMLCanvasElement | null = null;
    const getHalo = (): HTMLCanvasElement => {
      if (haloSprite) return haloSprite;
      const s = document.createElement("canvas");
      s.width = Math.max(1, Math.round(size * dpr));
      s.height = Math.max(1, Math.round(size * dpr));
      const c = s.getContext("2d");
      if (c) {
        const w = size;
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        const g = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w * 0.46);
        g.addColorStop(0, rgba(coreTok, 1));
        g.addColorStop(1, rgba(coreTok, 0));
        c.fillStyle = g;
        c.fillRect(0, 0, w, w);
      }
      haloSprite = s;
      return s;
    };

    let raf = 0;
    let last = performance.now();
    let energy = 0.25;
    let rot = 0;
    const cur: RGB = [...coreTok] as RGB;
    const curLight: RGB = [...lightTok] as RGB;
    const smooth = new Float32Array(96);

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      if (lastResolvedPhase !== phaseRef.current) resolveTokens();
      const ph = phaseRef.current;

      // Asymmetric energy follower: fast attack, silky release.
      const target = Math.max(0, Math.min(1, levelRef.current));
      if (reduced) {
        energy += (0.25 - energy) * Math.min(1, dt * 5);
      } else {
        const rate = target > energy ? 12 : 4;
        energy += (target - energy) * Math.min(1, rate * dt);
      }
      if (!reduced) rot += dt * 0.2;

      // Phase color lerp (~450ms ease-out).
      const k = 1 - Math.exp(-dt * 6.7);
      for (let i = 0; i < 3; i++) {
        cur[i] += (coreTok[i] - cur[i]) * k;
        curLight[i] += (lightTok[i] - curLight[i]) * k;
      }

      const light = mix(curLight, [255, 255, 255], 0.55);
      const dark = mix(cur, ground, 0.4);
      const stop0: RGB = isLight ? mix(light, [255, 255, 255], 0.9) : [255, 255, 255];

      const w = size;
      const cx = w / 2;
      const cy = w / 2;
      const breathe = reduced ? 1 : 1 + Math.sin(now / 1337) * 0.015;
      const R = w * 0.215 * (1 + energy * 0.1) * breathe;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, w);

      // Halo blit with dynamic alpha (no per-frame gradients, no blur passes).
      let haloAlpha: number;
      if (ph === "processing" && !reduced) {
        haloAlpha = 0.17 + 0.05 * Math.sin((now / 1600) * Math.PI * 2);
      } else if (ph === "idle") {
        haloAlpha = Math.max(0.1, 0.2 + energy * 0.25);
      } else {
        haloAlpha = 0.2 + energy * 0.25;
      }
      ctx.globalAlpha = haloAlpha;
      ctx.drawImage(getHalo(), 0, 0, w, w);
      ctx.globalAlpha = 1;

      // Core with single offset light source.
      const body = ctx.createRadialGradient(
        cx - R * 0.32, cy - R * 0.36, R * 0.08,
        cx, cy, R,
      );
      body.addColorStop(0, rgba(stop0, 1));
      body.addColorStop(0.25, rgba(light, 1));
      body.addColorStop(0.7, rgba(cur, 1));
      body.addColorStop(1, rgba(dark, 1));
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fill();

      // Single static specular.
      ctx.save();
      ctx.translate(cx - R * 0.34, cy - R * 0.4);
      const spec = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 0.28);
      spec.addColorStop(0, "rgba(255,255,255,0.55)");
      spec.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = spec;
      ctx.beginPath();
      ctx.arc(0, 0, R * 0.28, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Single waveform ring: per-bin EMA + closed quadratic-midpoint spline.
      const wave = waveRef.current;
      const N = 96;
      for (let i = 0; i < N; i++) {
        const v = i < wave.length ? wave[i] : 0;
        smooth[i] += (v - smooth[i]) * 0.35;
      }
      const baseR = w * 0.335 * breathe;
      const amp = w * 0.045 * (0.3 + energy * 0.9);
      ctx.beginPath();
      for (let i = 0; i <= N; i++) {
        const j = i % N;
        const a = (j / N) * Math.PI * 2 + rot;
        const r = baseR + smooth[j] * amp;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        if (i === 0) {
          const jPrev = N - 1;
          const aPrev = (jPrev / N) * Math.PI * 2 + rot;
          const rPrev = baseR + smooth[jPrev] * amp;
          ctx.moveTo(
            (cx + Math.cos(aPrev) * rPrev + x) / 2,
            (cy + Math.sin(aPrev) * rPrev + y) / 2,
          );
        } else {
          const pj = (i - 1) % N;
          const aP = (pj / N) * Math.PI * 2 + rot;
          const rP = baseR + smooth[pj] * amp;
          const px = cx + Math.cos(aP) * rP;
          const py = cy + Math.sin(aP) * rP;
          ctx.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2);
        }
      }
      ctx.closePath();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = rgba(light, 0.85);
      ctx.stroke();

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [size, levelRef, waveRef]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size }}
      onClick={() => tapRef.current()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          tapRef.current();
        }
      }}
      className="cursor-pointer rounded-full"
      role="button"
      tabIndex={0}
      aria-label="Enviar turno de voz agora"
      title="Toque para enviar o turno"
    />
  );
};
