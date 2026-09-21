# AGENTS.md — Domain Models (`src-tauri/src/domain/models/`)

Documentação especializada e constituição local para a camada de modelos de domínio puro do Copernico.

## 1. Escopo e Responsabilidade
Este módulo define exclusivamente as **estruturas de dados puras** e entidades centrais do sistema:
- `Note`, `BaseFile`, `GraphData`, `GraphNode`, `GraphLink`, `RenameReport` (`note.rs`)
- `Session`, `Message`, `ChatMessage`, `ToolCall`, `FunctionCall`, `ChatUsage` (`session.rs`)
- `InboxItem` (`inbox.rs`)
- `PluginManifest`, `PluginMeta`, `SkillConfig`, `ThemeConfig`, `McpServerConfig` (`plugin.rs`)
- `ScheduledRoutine` (`routine.rs`)
- `SearchResult` (`search.rs`)
- `SkillInfo` (`skill.rs`)
- `VoiceInfo`, `GreetingItem`, `GreetingKind`, `TtsBenchmarkResult` (`voice.rs`)

## 2. Regras Obrigatórias
1. **Zero I/O e Zero Frameworks**: Proibido importar qualquer biblioteca de I/O (`rusqlite`, `tauri`, `reqwest`, `tokio`, `tempfile`, `r2d2`).
2. **Dependências Permitidas**: Apenas `std`, `serde`, `serde_json`, `serde_yaml`.
3. **Resiliência e Compatibilidade (Serde)**:
   - Use `#[serde(default)]` em campos novos ou opcionais para garantir deserialização retrocompatível de payloads legados do SQLite ou IPC.
   - Use `#[serde(skip_serializing_if = "Option::is_none")]` quando aplicável para evitar ruído em payloads JSON.
4. **Imutabilidade e Tipagem Forte**: Derive `Clone`, `Debug`, `Serialize`, `Deserialize` em todas as structs públicas de dados.

## 3. Anti-padrões
- **NUNCA** adicione lógica de acesso ao banco de dados ou chamadas HTTP dentro das structs.
- **NUNCA** faça conversões diretas de `rusqlite::Row` aqui (essas conversões pertencem aos repositórios em `infra/sqlite/`).
- **NUNCA** adicione campos dependentes de runtime ou ponteiros de conexão (ex: `Arc<Mutex<...>>`).
