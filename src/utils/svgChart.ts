/**
 * Helpers puros de geometria para os gráficos SVG da aba Insights.
 *
 * Nenhum agregado é calculado aqui — os dados chegam prontos de
 * `list_insights` (invariante: o frontend só desenha). Estas funções apenas
 * mapeiam valores já agregados para coordenadas de um `viewBox`.
 */

export interface SvgPoint {
  x: number;
  y: number;
}

const round = (v: number): number => Math.round(v * 10) / 10;

/**
 * Mapeia uma série de valores (0…max) para pontos de um `viewBox` de
 * `width × height` (y invertido: 0 no topo).
 *
 * * série vazia ⇒ `[]` (nunca NaN);
 * * todos os zeros ⇒ linha na base do gráfico;
 * * o maior valor encosta no topo (`y = 0`).
 */
export function seriesPoints(values: number[], width: number, height: number): SvgPoint[] {
  if (values.length === 0) return [];
  const max = Math.max(...values);
  const scale = max > 0 ? height / max : 0;
  const last = values.length - 1;
  return values.map((v, i) => ({
    x: last === 0 ? round(width / 2) : round((i / last) * width),
    y: round(height - v * scale),
  }));
}

/**
 * Mapeia uma série para uma escala fixa. Útil quando duas séries percentuais
 * precisam compartilhar a mesma referência visual mesmo em semanas diferentes.
 * Valores fora do intervalo são limitados para não gerar geometria inválida.
 */
export function fixedScaleSeriesPoints(
  values: number[],
  width: number,
  height: number,
  min = 0,
  max = 100
): SvgPoint[] {
  if (values.length === 0) return [];
  const span = max - min;
  const safeSpan = span > 0 ? span : 1;
  const last = values.length - 1;
  return values.map((value, index) => {
    const clamped = Math.min(max, Math.max(min, value));
    return {
      x: last === 0 ? round(width / 2) : round((index / last) * width),
      y: round(height - ((clamped - min) / safeSpan) * height),
    };
  });
}

/** Concatena pontos no formato aceito por `<polyline points="…">`. */
export function toPolyline(points: SvgPoint[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(" ");
}

/**
 * Posição e largura da barra `index` de `count` barras dentro de `width`,
 * com `gap` de respiro entre elas (nunca retorna largura < 1).
 */
export function barSlot(
  index: number,
  count: number,
  width: number,
  gap: number
): { x: number; w: number } {
  const safeCount = Math.max(count, 1);
  const slot = width / safeCount;
  const w = Math.max(slot - gap, 1);
  return { x: round(index * slot), w: round(w) };
}
