import { describe, expect, it } from "vitest";
import { orbGeometry } from "./orbGeometry";

describe("orbGeometry", () => {
  it("keeps every layer inside the 0.48 budget", () => {
    for (const size of [160, 240, 340]) {
      for (const energy of [0, 0.5, 1]) {
        const g = orbGeometry(size, energy);
        expect(g.maxDrawnRadius).toBeLessThanOrEqual(0.48 * size);
        expect(g.ringRadius + g.ringLineWidth / 2).toBeLessThanOrEqual(0.4 * size);
        expect(g.haloRadius).toBeLessThanOrEqual(0.46 * size);
      }
    }
  });
});
