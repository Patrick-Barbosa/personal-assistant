export interface OrbGeometry {
  haloRadius: number;
  coreRadius: number;
  ringRadius: number;
  ringLineWidth: number;
  maxDrawnRadius: number;
}

/**
 * Pure geometry for the Single Ember orb (PRD-orb §4.2).
 * All values are fractions of canvas size; worst case must stay ≤ 0.48 × size.
 */
export function orbGeometry(size: number, energy: number): OrbGeometry {
  const e = Math.max(0, Math.min(1, energy));
  const breathe = 1.015; // worst-case breathing scale
  const haloRadius = size * 0.46;
  const coreRadius = size * 0.215 * (1 + 0.1 * e) * breathe;
  const ringRadius = size * 0.335 * breathe + size * 0.045 * (0.3 + 0.9 * e);
  const ringLineWidth = 1.5;
  const maxDrawnRadius = Math.max(haloRadius, ringRadius + ringLineWidth / 2, coreRadius);
  return { haloRadius, coreRadius, ringRadius, ringLineWidth, maxDrawnRadius };
}
