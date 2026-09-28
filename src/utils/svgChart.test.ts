import { describe, expect, it } from "vitest";
import { barSlot, fixedScaleSeriesPoints, seriesPoints, toPolyline } from "./svgChart";

describe("seriesPoints", () => {
  it("retorna vazio para série vazia (sem NaN)", () => {
    expect(seriesPoints([], 100, 50)).toEqual([]);
  });

  it("mapeia o maior valor para o topo e o zero para a base", () => {
    const pts = seriesPoints([0, 50, 100], 200, 100);
    expect(pts).toHaveLength(3);
    expect(pts[0]).toEqual({ x: 0, y: 100 });
    expect(pts[1]).toEqual({ x: 100, y: 50 });
    expect(pts[2]).toEqual({ x: 200, y: 0 });
  });

  it("série toda zerada desenha na base sem divisão por zero", () => {
    const pts = seriesPoints([0, 0, 0], 30, 30);
    expect(pts.every((p) => p.y === 30 && Number.isFinite(p.y))).toBe(true);
  });

  it("ponto único fica centralizado", () => {
    expect(seriesPoints([7], 100, 10)).toEqual([{ x: 50, y: 0 }]);
  });

  it("x é monotônico crescente até width", () => {
    const pts = seriesPoints([1, 2, 3, 4], 60, 20);
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i].x).toBeGreaterThan(pts[i - 1].x);
    }
    expect(pts[pts.length - 1].x).toBe(60);
  });
});

describe("fixedScaleSeriesPoints", () => {
  it("mantém a mesma escala percentual para séries diferentes", () => {
    const points = fixedScaleSeriesPoints([0, 50, 100], 200, 100);
    expect(points).toEqual([
      { x: 0, y: 100 },
      { x: 100, y: 50 },
      { x: 200, y: 0 },
    ]);
  });

  it("limita valores fora do intervalo", () => {
    const points = fixedScaleSeriesPoints([-20, 50, 140], 200, 100);
    expect(points[0].y).toBe(100);
    expect(points[2].y).toBe(0);
  });
});

describe("toPolyline", () => {
  it("formata 'x,y' separados por espaço", () => {
    expect(toPolyline([{ x: 1, y: 2 }, { x: 3.5, y: 0 }])).toBe("1,2 3.5,0");
  });

  it("série vazia vira string vazia", () => {
    expect(toPolyline([])).toBe("");
  });
});

describe("barSlot", () => {
  it("distribui as barras sem estourar a largura", () => {
    const count = 14;
    for (let i = 0; i < count; i++) {
      const { x, w } = barSlot(i, count, 560, 4);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(w).toBeGreaterThan(0);
      expect(x + w).toBeLessThanOrEqual(560);
      if (i > 0) {
        const prev = barSlot(i - 1, count, 560, 4);
        expect(x).toBeGreaterThanOrEqual(prev.x + prev.w);
      }
    }
  });

  it("count 0 ou negativo não divide por zero", () => {
    const { x, w } = barSlot(0, 0, 100, 2);
    expect(Number.isFinite(x)).toBe(true);
    expect(w).toBeGreaterThan(0);
  });

  it("slot estreito nunca vira largura negativa", () => {
    const { w } = barSlot(0, 100, 50, 40);
    expect(w).toBeGreaterThanOrEqual(1);
  });
});
