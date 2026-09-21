# AGENTS.md — Frontend React (`src/`)

Documentação especializada e constituição local para a interface web/desktop do Copernico.

## 1. Escopo e Responsabilidade
Esta camada é a interface gráfica do Copernico, executada no WebView do Tauri:
- **Stack**: React 19, TypeScript 5, Vite, Tailwind CSS v4, Framer Motion, Canvas 2D (visualização de grafo de `[[wikilinks]]`).
- **Janelas**:
  - `main`: Overlay desktop (960×640), estilo Raycast (`Ctrl`+`Espaço`), suporte a markdown rico (`react-markdown` + `remark-gfm`).
  - `indicator`: Janela flutuante transparente (154×154) para indicador visual do Sol e diálogo de voz.
- **Núcleo de Comunicação**: `src/api.ts` (único ponto de entrada para chamadas IPC `invoke`).
- **Máquina Visual de Voz**: `src/voice/sunMachine.ts` (contrato de estados do Sol, testado via Vitest).

## 2. Regras Obrigatórias
1. **Tipagem Estrita e Proibição de Novos `any`**:
   - Proibido introduzir novos tipos `any` em `src/api.ts` e componentes.
   - Toda resposta de IPC deve ser mapeada para interfaces tipadas em `src/types.ts`.
2. **Contrato Visual do Sol (`sunMachine.ts`)**:
   - `src/voice/sunMachine.ts` é a **única fonte de verdade** para o estado visual do Sol (`idle`, `recording`, `processing`, `speaking`, `listening`).
   - Funções em `sunMachine.ts` são puras: `(status, rms) -> SunVisual`. Sem JSX, sem chamadas Tauri e sem lógica de áudio.
   - Qualquer alteração em transições ou chimes deve manter os testes de unidade passando (`pnpm test:unit`).
3. **Encapsulamento de Chamadas Backend via `api.ts`**:
   - Componentes React NUNCA devem chamar `@tauri-apps/api/core::invoke` diretamente.
   - Todas as invocações devem ser declaradas como métodos assíncronos no objeto `api` em `src/api.ts`, mantendo mocks de fallback para desenvolvimento no navegador.

## 3. Anti-padrões
- **NUNCA** faça chamadas IPC `invoke` fora de `src/api.ts`.
- **NUNCA** quebre a suíte de testes do frontend (`pnpm test:unit`).
- **NUNCA** acople lógica de renderização de componentes dentro de `sunMachine.ts`.
- **NUNCA** ignore o contrato de janelas em `src-tauri/tauri.conf.json`.
