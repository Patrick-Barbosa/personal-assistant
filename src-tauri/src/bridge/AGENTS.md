# AGENTS.md — Tauri Bridge (`src-tauri/src/bridge/`)

Documentação especializada e constituição local para a camada de entrada Tauri, rotas IPC e eventos do Copernico.

## 1. Escopo e Responsabilidade
Esta camada faz a ponte entre o frontend (React) e o backend (Rust):
- `commands/`: Handlers de comando registrados no Tauri (`#[tauri::command]`).
- `emitter.rs`: Funções fortemente tipadas para emissão de eventos em tempo real para a interface (`emit_inbox_updated`, `emit_wake_status_changed`, etc.).

## 2. Regras Obrigatórias
1. **Camada Fina (Thin Controller)**:
   - Comandos Tauri devem apenas desserializar os parâmetros, extrair `tauri::State`, delegar a execução para o serviço responsável e mapear erros com `.map_err(|e| e.to_string())`.
2. **Proibição de I/O Direto**:
   - **NUNCA** execute queries SQL (`rusqlite`) ou leia/escreva arquivos em disco diretamente dentro dos handlers de comando. Toda operação pertence aos serviços ou repositórios.
3. **Emissão Tipada de Eventos**:
   - Nunca use `app.emit("string-livre", json!({...}))` solto no código. Centralize e utilize exclusivamente as funções de `emitter.rs` com payloads definidos em structs tipadas.
4. **Contrato IPC e Zero Regressões (IPC-01)**:
   - Antes de adicionar, renomear ou remover qualquer comando, consulte `issues-open.md` (IPC-01).
   - Não crie parâmetros duplicados com casing misto (`topK` e `top_k`, `title` e `newTitle`).
   - Siga o fluxo canônico em três pontas:
     1. `commands/`: `#[tauri::command] pub async fn nome(...) -> Result<T, String>`
     2. `src-tauri/src/lib.rs`: registrar em `generate_handler![...]`
     3. `src/api.ts` (+ `src/types.ts`): wrapper tipado chamando `invoke<T>("nome", { ... })`

## 3. Anti-padrões
- **NUNCA** use `unwrap()` ou `expect()` em rotas Tauri ou ao acessar estados e janelas.
- **NUNCA** introduza regras de negócio nos comandos (ex: parsing de Markdown, lógica ReAct ou agendamentos devem viver em `services/`).
- **NUNCA** adicione comandos sem registrar simultaneamente no handler do Tauri e no cliente `src/api.ts`.
