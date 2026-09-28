import { describe, expect, it } from "vitest";
import {
  DEFAULT_VAD,
  newVadState,
  offThreshold,
  onThreshold,
  vadUpdate,
} from "./vadGate";

describe("vadGate", () => {
  it("arms on the 3rd consecutive hot frame (quiet mic case)", () => {
    expect(onThreshold(0.004)).toBeCloseTo(0.005, 4);
    const s = newVadState(0);
    expect(vadUpdate(s, 0.004, 0.004, 16)).toBe("continue");
    expect(vadUpdate(s, 0.0062, 0.004, 32)).toBe("continue");
    expect(vadUpdate(s, 0.0062, 0.004, 48)).toBe("continue");
    expect(vadUpdate(s, 0.0062, 0.004, 64)).toBe("continue");
    expect(s.armed).toBe(true);
  });

  it("never ends speech without arming; emits empty only after the cutoff", () => {
    const s = newVadState(0);
    expect(vadUpdate(s, 0.0045, 0.004, 1000)).toBe("continue");
    expect(vadUpdate(s, 0.0045, 0.004, DEFAULT_VAD.emptyTurnMs + 1)).toBe("empty");
  });

  it("releases only after a sustained hangover; blips reset the clock", () => {
    const s = newVadState(0);
    vadUpdate(s, 0.0062, 0.004, 16);
    vadUpdate(s, 0.0062, 0.004, 32);
    vadUpdate(s, 0.0062, 0.004, 48);
    expect(s.armed).toBe(true);
    // Cold for less than hangover -> continue.
    expect(vadUpdate(s, 0.003, 0.004, 500)).toBe("continue");
    // Blip above off threshold refreshes lastHotAt.
    expect(vadUpdate(s, 0.005, 0.004, 700)).toBe("continue");
    expect(vadUpdate(s, 0.003, 0.004, 700 + DEFAULT_VAD.hangoverMs + 1)).toBe("speech-end");
  });

  it("rejects isolated spikes", () => {
    const s = newVadState(0);
    expect(vadUpdate(s, 0.004, 0.004, 16)).toBe("continue");
    expect(vadUpdate(s, 0.05, 0.004, 32)).toBe("continue");
    expect(vadUpdate(s, 0.004, 0.004, 48)).toBe("continue");
    expect(s.armed).toBe(false);
  });

  it("watchdogs a pinned-hot stream at 25s", () => {
    const s = newVadState(0);
    vadUpdate(s, 0.02, 0.004, 16);
    vadUpdate(s, 0.02, 0.004, 32);
    vadUpdate(s, 0.02, 0.004, 48);
    expect(s.armed).toBe(true);
    expect(vadUpdate(s, 0.02, 0.004, DEFAULT_VAD.maxTurnMs - 100)).toBe("continue");
    expect(vadUpdate(s, 0.02, 0.004, DEFAULT_VAD.maxTurnMs + 1)).toBe("watchdog");
  });

  it("keeps off < on across the floor range", () => {
    for (const floor of [0.002, 0.004, 0.01, 0.03, 0.06]) {
      expect(offThreshold(floor)).toBeLessThan(onThreshold(floor));
    }
  });
});
