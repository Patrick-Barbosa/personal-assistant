import { describe, expect, it } from "vitest";
import {
  LISTENING_VOLUME,
  PROCESSING_VOLUME,
  RECORDING_VOLUME_FLOOR,
  SPEAKING_VOLUME,
  amplifyRms,
  formatSunTransition,
  isSunDebugEnabled,
  resolveSunVisual,
} from "./sunMachine";

describe("sunMachine", () => {
  it("speaking: branco fixo, badge Falando, sem chime", () => {
    const v = resolveSunVisual("speaking", 0, "recording");
    expect(v.volume).toBe(SPEAKING_VOLUME);
    expect(v.tone).toBe("white");
    expect(v.badge).toBe("Falando...");
    expect(v.badgeTone).toBe("amber");
    expect(v.badgePulse).toBe(true);
    expect(v.breathing).toBe(false);
    expect(v.chime).toBeNull();
  });

  it("processing: volume fixo, badge Pensando, end-chime", () => {
    const v = resolveSunVisual("processing", 0.9, "recording");
    expect(v.volume).toBe(PROCESSING_VOLUME);
    expect(v.badge).toBe("Pensando...");
    expect(v.badgePulse).toBe(false);
    expect(v.chime).toBe("end");
  });

  it("listening: sky fixo, badge Sua vez, followup-chime", () => {
    const v = resolveSunVisual("listening", 0, "processing");
    expect(v.volume).toBe(LISTENING_VOLUME);
    expect(v.tone).toBe("sky");
    expect(v.badge).toBe("Sua vez...");
    expect(v.badgeTone).toBe("sky");
    expect(v.chime).toBe("followup");
  });

  it("recording em silêncio: piso de visibilidade + badge Ouvindo + breathing", () => {
    const v = resolveSunVisual("recording", 0, "speaking");
    expect(v.volume).toBe(RECORDING_VOLUME_FLOOR);
    expect(v.volume).toBeGreaterThan(0);
    expect(v.tone).toBe("amber");
    expect(v.badge).toBe("Ouvindo...");
    expect(v.badgePulse).toBe(true);
    expect(v.breathing).toBe(true);
    expect(v.voiceActive).toBe(false);
  });

  it("recording com voz: pétalas abrem pelo RMS, sem breathing", () => {
    const v = resolveSunVisual("recording", 0.5, "speaking");
    expect(v.volume).toBeCloseTo(1, 5);
    expect(v.breathing).toBe(false);
    expect(v.voiceActive).toBe(true);
  });

  it("recording vindo de listening: sem airy inicial", () => {
    expect(resolveSunVisual("recording", 0, "listening").chime).toBeNull();
    expect(resolveSunVisual("recording", 0, "idle").chime).toBe("listening");
  });

  it("idle: sem badge, RMS cru, respira no silêncio", () => {
    const quiet = resolveSunVisual("idle", 0, "idle");
    expect(quiet.badge).toBeNull();
    expect(quiet.volume).toBe(0);
    expect(quiet.breathing).toBe(true);
    const loud = resolveSunVisual("idle", 0.2, "idle");
    expect(loud.volume).toBeCloseTo(1, 5);
    expect(loud.breathing).toBe(false);
  });

  it("mesmo estado (update de RMS): nunca toca chime", () => {
    expect(resolveSunVisual("recording", 0.4, "recording").chime).toBeNull();
    expect(resolveSunVisual("listening", 0.1, "listening").chime).toBeNull();
    expect(resolveSunVisual("speaking", 0, "speaking").chime).toBeNull();
  });

  it("amplifyRms: higieniza entradas inválidas", () => {
    expect(amplifyRms(Number.NaN)).toBe(0);
    expect(amplifyRms(-0.5)).toBe(0);
    expect(amplifyRms(10)).toBe(1);
    expect(amplifyRms(0.01)).toBeCloseTo(0.095, 5);
  });

  it("formatSunTransition: linha objetiva correlacionável", () => {
    expect(formatSunTransition("idle", "speaking", 0.02, "wake-status-changed")).toBe(
      "[SOL] idle→speaking via wake-status-changed (rms=0.020)"
    );
  });

  it("isSunDebugEnabled: false sem localStorage (node)", () => {
    expect(isSunDebugEnabled()).toBe(false);
  });
});
