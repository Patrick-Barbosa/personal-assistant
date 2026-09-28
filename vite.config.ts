import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

/**
 * Rastreador de frames WS do dev server — diagnostica o bug "voice-turn →
 * full reload" (handoff.md §4). Loga no terminal cada payload enviado
 * (exceto `ping`) com o stack do call-site, permitindo mapear o frame para
 * um dos send-sites do bundle do Vite (ou provar que veio de fora deles).
 * Só roda em dev (`configureServer`); remova após fechar o diagnóstico.
 */
function wsSendTrace(): Plugin {
  const wrapped = new Set<object>();
  const wrap = (channel: unknown) => {
    if (!channel || typeof channel !== "object" || wrapped.has(channel)) return;
    wrapped.add(channel);
    const original = (
      channel as { send: (...args: unknown[]) => void }
    ).send.bind(channel);
    (channel as { send: (...args: unknown[]) => void }).send = (
      ...args: unknown[]
    ) => {
      try {
        for (const arg of args) {
          const type =
            arg && typeof arg === "object"
              ? (arg as { type?: string }).type
              : undefined;
          if (type && type !== "ping") {
            const stack = new Error("ws-send-trace").stack ?? "(sem stack)";
            console.error(`[ws-send] ${JSON.stringify(arg)}\n${stack}`);
          }
        }
      } catch {
        // A sonda nunca pode derrubar o dev server.
      }
      return original(...args);
    };
  };
  return {
    name: "copernico:ws-send-trace",
    configureServer(server) {
      wrap(server.hot);
      wrap((server as { ws?: unknown }).ws);
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), wsSendTrace()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: [
        "**/src-tauri/**",
        "**/cofres/**",
        "**/logs/**",
        "**/*.db",
        "**/*.db-*",
        "**/*.log",
      ],
    },
  },
});
