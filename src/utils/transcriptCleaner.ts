export function toNoteSlug(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

export function cleanTranscript(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const hadQuestion = trimmed.includes("?");
  const words = trimmed.split(/\s+/);
  const start = Math.max(0, words.length - 4);
  const lVariants = new Set(["leach", "leech", "litchie", "lich", "liche", "litch", "lits", "lix", "lit", "lite"]);
  let cutIdx: number | null = null;
  for (let i = start; i < words.length; i++) {
    const raw = words[i];
    const cleaned = raw.replace(/^[^a-zA-Z0-9\u00C0-\u024F]+|[^a-zA-Z0-9\u00C0-\u024F]+$/g, "").toLowerCase();
    if (!cleaned) continue;
    const isZ = cleaned.startsWith("z") && cleaned.length >= 2;
    const isL = lVariants.has(cleaned);
    if (isZ || isL) {
      cutIdx = i;
      break;
    }
  }
  let cleaned = "";
  if (cutIdx !== null) {
    if (cutIdx === 0 && words.length <= 2) {
      const allAreCut = words.every((w) => {
        const c = w.replace(/^[^a-zA-Z0-9\u00C0-\u024F]+|[^a-zA-Z0-9\u00C0-\u024F]+$/g, "").toLowerCase();
        return c.startsWith("z") || lVariants.has(c);
      });
      if (allAreCut) return "";
    }
    cleaned = words.slice(0, cutIdx).join(" ");
  } else {
    cleaned = trimmed;
  }
  cleaned = cleaned.replace(/[,;:\-]+$/g, "").trim();
  if (!cleaned) return "";
  if (hadQuestion && !cleaned.endsWith("?")) cleaned += "?";
  return cleaned;
}
