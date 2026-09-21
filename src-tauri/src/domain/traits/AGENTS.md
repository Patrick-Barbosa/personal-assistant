# AGENTS.md — Domain Traits (`src-tauri/src/domain/traits/`)

Documentação especializada e constituição local para a camada de portas e contratos abstratos (Hexagonal Architecture) do Copernico.

## 1. Escopo e Responsabilidade
Este módulo define exclusivamente os **contratos de portas (interfaces abstratas)** que desacoplam as regras de negócio dos adaptadores de infraestrutura:
- `providers.rs`: `LlmProvider`, `SttProvider`, `TtsProvider`, `EmbeddingProvider`, `ProviderInfo`, `ProviderError`
- `stores.rs`: `SessionStore`, `MessageStore`, `InboxStore`, `SettingsStore`
- `vault.rs`: `VaultFileSystem`, `VaultIndexStore`
- `tools.rs`: `BuiltinTool`, `ToolContext`

## 2. Regras Obrigatórias
1. **Assincronismo Padronizado**: Métodos assíncronos em traits públicas devem usar `#[async_trait]`. Traits devem exigir `Send + Sync` para suportar concorrência segura em threads do Tokio/Tauri.
2. **Tipagem de Erro Pura do Domínio**:
   - Métodos de armazenamento e filesystem retornam sempre `Result<T, DomainError>`.
   - Métodos de provedores de IA retornam sempre `Result<T, ProviderError>`.
3. **Isolamento de Infraestrutura**: Proibido qualquer acoplamento a implementações concretas (`r2d2`, `rusqlite`, `reqwest`, `fastembed`, etc.). Os traits operam exclusivamente com tipos de `domain::models` e `std::path::Path`.
4. **Sem Dependências Circulares**: `domain/traits/` pode importar de `domain/models/` e `domain/errors.rs`, mas nunca de `infra/`, `services/`, `bridge/` ou `workers/`.

## 3. Anti-padrões
- **NUNCA** referencie structs concretas de adaptadores (ex: proibir usar `DbPool`, `SqliteConnection`, `DeepSeekClient` nas assinaturas).
- **NUNCA** retorne tipos de erro de bibliotecas externas (ex: `rusqlite::Error`, `reqwest::Error`) diretamente na trait.
- **NUNCA** implemente lógica de execução ou I/O dentro dos traits; traits apenas definem interfaces e comportamentos default puros.
