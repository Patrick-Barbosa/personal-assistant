# AGENTS.md — Copernico (Hub Central)

Constituição operacional central para qualquer agente ou desenvolvedor neste repositório.
Permissões de ferramentas e execução vivem em `./opencode.json` (raiz). Em conflito sobre **o quê fazer**, este arquivo manda; sobre **permissões de comandos**, `opencode.json` manda.

## 1. Identidade & Missão
- **Copernico**: App desktop Windows (Tauri 2 + Rust + React 19), overlay frameless transparente estilo Raycast (`Ctrl`+`Espaço`).
- **Missão**: Segundo cérebro local — busca semântica em cofres Markdown, persistência SQLite local, agente DeepSeek com Tool Calling, voz neural (Groq Whisper STT, Edge-TTS, wake word sidecar).
- **Princípios**: Local-first, baixa RAM, zero latência desnecessária, integridade de dados e escrita segura em disco.

## 2. Regras Constitucionais Globais
1. **Windows-first**: PowerShell, caminhos via `PathBuf`, sem comandos Unix (`rm -rf`, `export`). Respeite nomes reservados (`CON`, `PRN`, `AUX`, `NUL`, etc.) e caracteres proibidos (`<>:"/\|?*`).
2. **Cofre Obsidian Intocável**: O cofre Markdown do usuário (`cofres/obsidian/`) é somente leitura para escrita autônoma. Nenhuma nota deve ser modificada ou criada sem autorização expressa.
3. **Zero Regressões em IPC**: Siga o fluxo em três pontas (Rust command -> `generate_handler!` -> `src/api.ts`). Consulte `issues-open.md` (IPC-01) antes de alterar ou criar rotas.
4. **Sem Placeholders ou Pânicos**: Proibido `TODO`, `unimplemented!`, `panic!`, `unwrap()` ou `expect()` em rotas Tauri e locks de estado (`read().unwrap()`).
5. **Arquitetura Hexagonal Estrita**: O domínio é isolado de I/O. Consulte o índice de documentações especializadas abaixo para as regras de cada módulo.

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
| **Frontend**| `src/` | [Frontend AGENTS.md](src/AGENTS.md) | React 19, Tailwind v4, máquina de estados `sunMachine` |

## 4. Verificação & Build (Windows PowerShell)

```powershell
pnpm build
pnpm test:unit
Set-Location src-tauri; cargo test --test unit_tests
cargo fmt --check; cargo clippy -- -D warnings
```
