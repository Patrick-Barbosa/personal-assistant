export type RGB = [number, number, number];

/** Dark-theme fallback values from src/styles.css. */
const FALLBACKS: Record<string, RGB> = {
  "--accent": [245, 158, 11],
  "--text-accent": [252, 211, 77],
  "--text-info": [125, 211, 252],
  "--text-success": [110, 231, 183],
  "--text-muted": [161, 161, 170],
};

function parseHex(raw: string): RGB | null {
  const v = raw.trim().toLowerCase();
  const short = /^#([0-9a-f]{3})$/.exec(v);
  if (short) {
    const h = short[1];
    return [
      parseInt(h[0] + h[0], 16),
      parseInt(h[1] + h[1], 16),
      parseInt(h[2] + h[2], 16),
    ];
  }
  const full = /^#([0-9a-f]{6})$/.exec(v);
  if (full) {
    const h = full[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  return null;
}

/**
 * Resolves a Copernico CSS variable to RGB.
 * Falls back to the dark-theme value when unparseable or unavailable.
 */
export function cssVarRgb(name: string): RGB {
  const fallback: RGB = FALLBACKS[name] ?? [161, 161, 170];
  try {
    if (typeof document === "undefined" || typeof getComputedStyle === "undefined") return [...fallback] as RGB;
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name);
    if (!raw) return [...fallback] as RGB;
    return parseHex(raw) ?? ([...fallback] as RGB);
  } catch {
    return [...fallback] as RGB;
  }
}
