# AGENTS.md — SQLite Infrastructure (`src-tauri/src/infra/sqlite/`)

Documentação especializada e constituição local para o adaptador de banco de dados SQLite local do Copernico.

## 1. Escopo e Responsabilidade
Este módulo implementa o pool de conexões, inicialização/migrações DDL e os repositórios concretos de persistência:
- `pool.rs`: Criação e configuração de `DbPool` (`r2d2::Pool<SqliteConnectionManager>`) e migrações idempotentes.
- `session_repo.rs`: Repositório de sessões e mensagens (`SessionRepo`).
- `inbox_repo.rs`: Repositório de itens de inbox, decisões e retenção (`InboxRepo`).
- `settings_repo.rs`: Repositório chave-valor de preferências e prompts (`SettingsRepo`).
- `vault_index_repo.rs`: Repositório de embeddings e cache de metadados do cofre (`VaultIndexRepo`).
- `plugin_repo.rs`: Repositório de plugins, temas e rotinas agendadas (`PluginRepo`).

## 2. Regras Obrigatórias
1. **Configurações Obrigatórias de Conexão**:
   - `PRAGMA foreign_keys = ON;` em todas as conexões (incluindo `:memory:` para testes).
   - `PRAGMA journal_mode = WAL;` para conexões em arquivo em disco (evita contenção leitor/escritor).
   - `busy_timeout` configurado para mitigar `SQLITE_BUSY` sob concorrência.
2. **Implementação de Contratos de Domínio**:
   - Os repositórios devem implementar as traits correspondentes de `crate::domain::traits::stores` (`SessionStore`, `MessageStore`, `InboxStore`, `SettingsStore`, etc.).
3. **Encapsulamento Estrito**:
   - **NUNCA** exponha `rusqlite::Connection` ou o pool fora desta camada.
   - Outras camadas (`services/`, `bridge/`) interagem apenas com as structs de repositório ou via traits do domínio.
4. **Mapeamento de Erros**:
   - Erros do SQLite ou r2d2 devem ser convertidos em `DomainError::DatabaseError(...)` ou variantes do domínio apropriadas.

## 3. Anti-padrões
- **NUNCA** execute consultas SQL (`SELECT`, `INSERT`, `UPDATE`, `DELETE`) fora deste diretório (proibido em `bridge/` ou `services/`).
- **NUNCA** use `unwrap()` ou `expect()` ao obter conexões do pool ou executar queries; propague erros via `?`.
- **NUNCA** execute scripts DDL destrutivos (`DROP TABLE`, `ALTER TABLE ... DROP COLUMN`) sem fallback ou estratégia de migração não-destrutiva.
