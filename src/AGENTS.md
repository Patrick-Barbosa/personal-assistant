# AGENTS.md — Frontend React (`src/`)

Documentação especializada e constituição local para a interface web/desktop do Copernico.

## 1. Escopo e Responsabilidade
Esta camada é a interface gráfica do Copernico, executada no WebView do Tauri:
- **Stack**: React 19, TypeScript 5, Vite, Tailwind CSS v4, Framer Motion, Canvas 2D (visualização de grafo de `[[wikilinks]]`).
- **Janela Única**:
  - `main`: Interface web unificada (1200×800 ou `http://localhost:1420`), janela desktop padrão com decorações, suporte a markdown rico (`react-markdown` + `remark-gfm`) e indicador de status de voz integrado no dashboard. Sem janelas transparentes ou overlays flutuantes.
- **Núcleo de Comunicação**: `src/api.ts` (único ponto de entrada para chamadas IPC `invoke`).
- **Status de Voz Integrado**: Badge de voz em `src/components/AppHeader.tsx` consumindo `useVoiceStore.wakeStatus` atualizado via eventos `wake-status-changed`.

## 2. Regras Obrigatórias
1. **Tipagem Estrita e Proibição de Novos `any`**:
   - Proibido introduzir novos tipos `any` em `src/api.ts` e componentes.
   - Toda resposta de IPC deve ser mapeada para interfaces tipadas em `src/types.ts`.
2. **Contrato Visual do Badge de Voz (`AppHeader.tsx`, `useVoiceStore`)**:
   - `AppHeader.tsx` (`renderVoiceBadge`) renderiza o estado da voz (`idle`, `recording`, `processing`, `speaking`, `listening`) a partir de `wakeStatus` no `useVoiceStore`.
   - Atualizações de voz ocorrem via eventos IPC `wake-status-changed` sem depender de janelas secundárias ou popups.
3. **Encapsulamento de Chamadas Backend via `api.ts`**:
   - Componentes React NUNCA devem chamar `@tauri-apps/api/core::invoke` diretamente.
   - Todas as invocações devem ser declaradas como métodos assíncronos no objeto `api` em `src/api.ts`, mantendo mocks de fallback para desenvolvimento no navegador.

## 3. Anti-padrões
- **NUNCA** faça chamadas IPC `invoke` fora de `src/api.ts`.
- **NUNCA** quebre a suíte de testes do frontend (`pnpm test:unit`). Cobertura atual: utils puros (`cronDescription.test.ts`); toda nova lógica pura deve chegar com testes — `--passWithNoTests` é fallback, não meta.
- **NUNCA** recrie componentes de janela transparente, overlays flutuantes (`VoiceIndicatorOverlay.tsx`) ou lógica de query params `mode=indicator`.
- **NUNCA** ignore o contrato de janelas em `src-tauri/tauri.conf.json`.
