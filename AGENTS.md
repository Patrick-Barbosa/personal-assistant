# AGENTS.md — Copernico (Hub Central)

Constituição operacional central para qualquer agente ou desenvolvedor neste repositório.
Permissões de ferramentas e execução vivem em `./opencode.json` (raiz). Em conflito sobre **o quê fazer**, este arquivo manda; sobre **permissões de comandos**, `opencode.json` manda.

## 1. Identidade & Missão
- **Copernico**: App desktop Windows (Tauri 2 + Rust + React 19), interface web limpa unificada em localhost (`http://localhost:1420`) ou janela desktop padrão com decorações (1200×800).
- **Missão**: Segundo cérebro local — busca semântica em cofres Markdown, persistência SQLite local, agente DeepSeek com Tool Calling, voz neural background audio-first (Groq Whisper STT, Edge-TTS, wake word sidecar, sem janelas transparentes ou overlays nativos).
- **Princípios**: Local-first, baixa RAM, zero latência desnecessária, integridade de dados e escrita segura em disco.

## 2. Regras Constitucionais Globais
1. **Windows-first**: PowerShell, caminhos via `PathBuf`, sem comandos Unix (`rm -rf`, `export`). Respeite nomes reservados (`CON`, `PRN`, `AUX`, `NUL`, etc.) e caracteres proibidos (`<>:"/\|?*`).
2. **Cofre Obsidian Intocável**: O cofre Markdown do usuário (`cofres/obsidian/`) é somente leitura para escrita autônoma. Nenhuma nota deve ser modificada ou criada sem autorização expressa.
3. **Zero Regressões em IPC**: Siga o fluxo em três pontas (Rust command -> `generate_handler!` -> `src/api.ts`). Consulte `issues-open.md` (IPC-01) antes de alterar ou criar rotas.
4. **Sem Placeholders ou Pânicos**: Proibido `TODO`, `unimplemented!`, `panic!`, `unwrap()` ou `expect()` em rotas Tauri e locks de estado (`read().unwrap()`).
5. **Arquitetura Hexagonal Estrita**: O domínio é isolado de I/O. Consulte o índice de documentações especializadas abaixo para as regras de cada módulo.
6. **Background Audio-First**: A interação por voz opera 100% em background (áudio e eventos IPC para a interface principal), sem janelas transparentes, overlays nativos Win32 ou popups visuais de voz.

## 3. Índice de Módulos & Documentações Locais
Cada camada do projeto possui seu próprio guia operacional especializado. Leia o `AGENTS.md` do diretório antes de alterar código na respectiva área:

| Camada | Diretório | Guia Especializado | Escopo |
| :--- | :--- | :--- | :--- |
| **Domínio** | `src-tauri/src/domain/models/` | [Models AGENTS.md](src-tauri/src/domain/models/AGENTS.md) | Structs puras, entidades de dados, serde defaults |
| **Domínio** | `src-tauri/src/domain/traits/` | [Traits AGENTS.md](src-tauri/src/domain/traits/AGENTS.md) | Contratos abstratos (ports), provedores e stores |
| **Infra** | `src-tauri/src/infra/sqlite/` | [SQLite AGENTS.md](src-tauri/src/infra/sqlite/AGENTS.md) | Pool WAL, migrações DDL e repositórios concretos |
| **Infra** | `src-tauri/src/infra/ai/` | [AI AGENTS.md](src-tauri/src/infra/ai/AGENTS.md) | Clientes DeepSeek, FastEmbed ONNX, Whisper e Edge-TTS |
| **Infra** | `src-tauri/src/infra/fs/` | [FS AGENTS.md](src-tauri/src/infra/fs/AGENTS.md) | Escrita atômica, exclusão de ocultos e defesa traversal |
| **Serviços** | `src-tauri/src/services/` | [Services AGENTS.md](src-tauri/src/services/AGENTS.md) | Regras de negócio, ReAct, `vault_srv`, `voice_orch` |
| **Bridge** | `src-tauri/src/bridge/` | [Bridge AGENTS.md](src-tauri/src/bridge/AGENTS.md) | Comandos Tauri IPC (thin controllers) e emissores tipados |
| **Frontend**| `src/` | [Frontend AGENTS.md](src/AGENTS.md) | React 19, Tailwind v4, badge de voz `AppHeader` + `wake-status-changed` |

## 4. Verificação & Build (Windows PowerShell)

```powershell
pnpm build
pnpm test:unit
Set-Location src-tauri; cargo test --test unit_tests
cargo fmt --check; cargo clippy -- -D warnings
```

## 5. Uso Diário: Browser + Backend Python (modo web é o padrão)

O app agora roda no navegador: `sh start_web.sh` (ou `python3 -m backend.server` + `pnpm dev --port 1420`).
Wake word foi aposentada — o botão de microfone (push-to-talk: MediaRecorder → `/api/stt` → `/api/chat` → `/api/tts`)
é o fluxo de voz, com auto-play da resposta e badge `speaking` no `AppHeader`.

Regra operacional:
1. **Para uso diário, use o modo web**: backend em `http://127.0.0.1:8000` (mesmo `cofres/cache.db` do Tauri, sem migração) + Vite em `:1420`. Sem compilação Rust no loop.
2. **`src-tauri/` está congelado** — referência somente leitura. Mudanças novas vão para `backend/*.py`.
3. Verificação web: `python3 backend/smoke_test.py` (31 checks, banco temporário) + `pnpm build` + `pnpm test:unit`.
4. Sondas de diagnóstico legadas do modo Tauri (`src/viteReloadProbe.ts` + plugin `ws-send-trace` em `vite.config.ts`, bug de flash dev-only do `pnpm tauri dev`) podem ser removidas — o flash não existe no modo web.

