import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { VoiceIndicatorOverlay } from "./components/VoiceIndicatorOverlay";
import "./styles.css";

// Avaliação síncrona imediata da URL para renderizar VoiceIndicatorOverlay sem nunca montar o App
const isIndicatorInitial =
  typeof window !== "undefined" &&
  (window.location.search.includes("mode=indicator") ||
    window.location.hash.includes("mode=indicator"));

function Root() {
  // null = modo ainda não resolvido: renderiza vazio para nunca exibir o App
  // dentro da janela do indicador (flash) nem o sol na janela principal.
  // O caminho síncrono (produção, com ?mode=indicator) resolve na hora;
  // em dev a detecção por label é assíncrona e a tela fica vazia até lá.
  const [isIndicator, setIsIndicator] = useState<boolean | null>(
    isIndicatorInitial ? true : null
  );

  useEffect(() => {
    // Se já foi detectado (síncrono ou anterior), não precisa de fallback
    if (isIndicator !== null) return;

    let cancelled = false;
    const detectWindow = async () => {
      try {
        const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
        const win = getCurrentWebviewWindow();
        if (!cancelled) {
          setIsIndicator(win.label === "indicator");
        }
      } catch {
        // Fallback no ambiente web (sem Tauri): janela principal
        if (!cancelled) {
          setIsIndicator(false);
        }
      }
    };
    detectWindow();
    return () => {
      cancelled = true;
    };
  }, [isIndicator]);

  if (isIndicator === null) {
    return null;
  }

  if (isIndicator) {
    return <VoiceIndicatorOverlay />;
  }

  return <App />;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);

