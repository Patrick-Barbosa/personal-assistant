export interface VadConfig {
  onRatio: number;
  onDelta: number;
  offRatio: number;
  offFloor: number;
  armFrames: number;
  hangoverMs: number;
  minSpeechMs: number;
  emptyTurnMs: number;
  maxTurnMs: number;
}

export const DEFAULT_VAD: VadConfig = {
  onRatio: 1.25,
  onDelta: 0.002,
  offRatio: 1.08,
  offFloor: 0.0025,
  armFrames: 3,
  hangoverMs: 900,
  minSpeechMs: 500,
  emptyTurnMs: 5000,
  maxTurnMs: 25000,
};

export interface VadState {
  armed: boolean;
  hotRun: number;
  lastHotAt: number;
  startedAt: number;
}

export function newVadState(nowMs: number): VadState {
  return { armed: false, hotRun: 0, lastHotAt: nowMs, startedAt: nowMs };
}

/** Speech-on threshold: whichever is more sensitive fires. */
export function onThreshold(floor: number, cfg: VadConfig = DEFAULT_VAD): number {
  return Math.min(floor * cfg.onRatio, floor + cfg.onDelta);
}

/** Release level. Clamped strictly below the ON threshold. */
export function offThreshold(floor: number, cfg: VadConfig = DEFAULT_VAD): number {
  return Math.min(Math.max(floor * cfg.offRatio, cfg.offFloor), onThreshold(floor, cfg) - 0.0001);
}

export type VadVerdict = "continue" | "speech-end" | "empty" | "watchdog";

export function vadUpdate(
  state: VadState,
  emaRms: number,
  floor: number,
  nowMs: number,
  cfg: VadConfig = DEFAULT_VAD,
): VadVerdict {
  const onTh = onThreshold(floor, cfg);
  const offTh = offThreshold(floor, cfg);
  const elapsed = nowMs - state.startedAt;

  if (emaRms > onTh) {
    state.hotRun += 1;
  } else {
    state.hotRun = 0;
  }
  if (!state.armed && state.hotRun >= cfg.armFrames) {
    state.armed = true;
    state.lastHotAt = nowMs;
  }
  if (state.armed && emaRms > offTh) {
    state.lastHotAt = nowMs;
  }

  if (state.armed && nowMs - state.lastHotAt > cfg.hangoverMs && elapsed > cfg.minSpeechMs) {
    return "speech-end";
  }
  if (!state.armed && elapsed > cfg.emptyTurnMs) {
    return "empty";
  }
  if (elapsed > cfg.maxTurnMs) {
    return "watchdog";
  }
  return "continue";
}
