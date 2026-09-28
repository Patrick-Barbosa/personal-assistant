/**
 * Sonda dev-only para o bug "voice-turn → full reload" (ver handoff.md §4).
 *
 * Captura o payload EXATO do evento `vite:beforeFullReload` (path / triggeredBy)
 * antes da navegação destruir o console, persistindo-o em localStorage.
 * No boot seguinte, os registros capturados são re-exibidos no console.
 *
 * Em produção (`import.meta.env.DEV === false`) apenas tenta ressurfavar
 * registros órfãos e o listener é removido por tree-shaking.
 */

interface ReloadProbeEntry {
  at: string;
  event: string;
  payload: unknown;
}

const STORAGE_KEY = "copernico:reload-probe";
const MAX_ENTRIES = 20;

function readHistory(): ReloadProbeEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ReloadProbeEntry[]) : [];
  } catch {
    return [];
  }
}

function record(event: string, payload: unknown): void {
  try {
    const history = readHistory();
    history.push({ at: new Date().toISOString(), event, payload });
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(history.slice(-MAX_ENTRIES)),
    );
  } catch {
    // Sonda nunca pode derrubar o app; silencioso por design.
  }
}

// Ressurface registros do boot anterior (o próprio reload limpa o console).
const pending = readHistory();
if (pending.length > 0) {
  const [nav] = performance.getEntriesByType(
    "navigation",
  ) as PerformanceNavigationTiming[];
  console.warn(
    `[reload-probe] ${pending.length} evento(s) capturado(s) no boot anterior ` +
      `(navType=${nav ? nav.type : "unknown"}):`,
    pending,
  );
}

if (import.meta.env.DEV && import.meta.hot) {
  // Dislogo ANTES do location.reload() do client do Vite (client.mjs handleMessage
  // → notifyListeners("vite:beforeFullReload", payload)) — único momento em que o
  // payload completo com path/triggeredBy ainda existe em memória.
  import.meta.hot.on("vite:beforeFullReload", (payload: unknown) => {
    record("vite:beforeFullReload", payload);
  });
  // Captura queda/reconexão do WS (caminho de reload sem frame, client.mjs:1001).
  import.meta.hot.on("vite:ws:disconnect", (payload: unknown) => {
    record("vite:ws:disconnect", payload);
  });
  // Atualizações HMR que chegaram logo antes do reload (contexto adicional).
  import.meta.hot.on("vite:beforeUpdate", (payload: unknown) => {
    record("vite:beforeUpdate", payload);
  });
}
