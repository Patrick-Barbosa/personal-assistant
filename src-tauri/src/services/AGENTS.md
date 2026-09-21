# AGENTS.md — Application Services (`src-tauri/src/services/`)

Documentação especializada e constituição local para a camada de serviços e regras de negócio do Copernico.

## 1. Escopo e Responsabilidade
Esta camada orquestra os fluxos de trabalho, casos de uso e inteligência do sistema:
- `agent_engine.rs`: Loop ReAct, dispatch e filtragem de ferramentas (Builtin Tools), geração de respostas e streaming.
- `vault_srv.rs`: **Único dono** da lógica de notas Markdown (CRUD, wikilinks `[[...]]`, grafo de conhecimento, sanitização e compilação de arquivos `.base`).
- `memory_srv.rs`: Busca semântica, reindexação vetorial e pontuação híbrida (BM25 + vetorial).
- `voice_orch.rs`: Orquestração de voz em tempo real, detecção de silêncio, ciclo de escuta contínua e transições de estado do indicador visual.
- `consolidation_srv.rs`: **Único executor de escrita** pós-sessão de voz; cria itens e propostas no Inbox sem poluir o cofre diretamente.
- `greeting_srv.rs`: Geração, agendamento, cache e expiração TTL de saudações matinais/noturnas.
- `skill_srv.rs` & `skill_runner_srv.rs`: Ciclo de vida de skills locais, agendamento de rotinas e execução de runners.
- `plugin_srv.rs`: Descoberta, validação de manifests e integração de plugins MCP externos.

## 2. Regras Obrigatórias
1. **Coordenação via Traits ou `Arc`**:
   - Os serviços devem interagir com a infraestrutura via traits de `domain::traits` ou referências atômicas (`Arc<...>` / `Arc<Mutex<...>>`).
2. **Propriedade Exclusiva das Regras de Domínio**:
   - `vault_srv.rs` é o **único responsável** por compilar arquivos `.base`, normalizar links `[[wikilinks]]` e calcular slugs de notas. Nenhuma outra camada deve manipular sintaxe de wikilinks diretamente.
   - `consolidation_srv.rs` é o **único executor de escrita** para aprendizagens geradas pelo diálogo de voz (gravando no SQLite via `InboxRepo` para aprovação posterior do usuário).
3. **Erros de Domínio**:
   - Falhas em regras de negócio retornam `Result<T, DomainError>`. Nunca force pânicos (`panic!`, `unwrap()`, `expect()`).
4. **Isolamento de Tauri**:
   - Os serviços não devem depender de `tauri::AppHandle` diretamente, exceto quando estritamente necessário para envio de eventos (preferindo os emissores fortemente tipados de `bridge/emitter.rs`).

## 3. Anti-padrões
- **NUNCA** execute queries SQL diretas dentro dos serviços; sempre chame os repositórios em `infra/sqlite/`.
- **NUNCA** altere notas no cofre Obsidian sem passar pela validação de `vault_srv.rs`.
- **NUNCA** use `unwrap()` em locks de concorrência (`Mutex` ou `RwLock`). Trate o erro graciosamente.
