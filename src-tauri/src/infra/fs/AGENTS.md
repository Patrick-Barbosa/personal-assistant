# AGENTS.md — Filesystem Infrastructure (`src-tauri/src/infra/fs/`)

Documentação especializada e constituição local para operações no sistema de arquivos e acesso a disco do Copernico.

## 1. Escopo e Responsabilidade
Este módulo gerencia o acesso atômico e seguro ao sistema de arquivos local e aos cofres Markdown:
- `vault_fs.rs`: Implementação de `VaultFileSystem` (`LocalVaultFileSystem`), com escrita atômica, exclusão de pastas ocultas (`.obsidian`, `.trash`, etc.) e varredura de Markdown.
- `code_runner.rs`: Execução segura de scripts de skills (Python) com isolamento e validação de argumentos.
- `greeting_fs.rs`: Cache e persistência local de arquivos de áudio e texto de saudações matinais/noturnas.

## 2. Regras Obrigatórias
1. **Escrita Atômica Obrigatória**:
   - Qualquer modificação ou gravação de arquivos DEVE usar o padrão atômico (`tempfile::Builder` na mesma pasta de destino + `write_all` + `flush` + `.persist(dest)`).
   - Nunca use `std::fs::write` diretamente para notas ou arquivos de configuração críticos, evitando corrupção em caso de queda de energia ou crash.
2. **Defesa Rigorosa contra Path Traversal**:
   - Bloqueie terminantemente segmentos `..` ou caminhos relativos que tentem escapar da raiz autorizada do cofre ou da pasta de skills.
3. **Respeito às Restrições do Windows**:
   - Nomes reservados do sistema operacional (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`) e caracteres proibidos (`<>:"/\|?*`) devem ser bloqueados e higienizados.
4. **Cofre Obsidian Somente Leitura**:
   - O cofre Obsidian do usuário (`cofres/obsidian/`) é estritamente **SOMENTE LEITURA** por padrão para qualquer agente autônomo.
   - Nenhuma escrita direta é permitida sem autorização explícita do usuário (gerando itens de proposta no inbox em vez de alterar o cofre diretamente).

## 3. Anti-padrões
- **NUNCA** execute comandos destrutivos de shell (`rm -rf`, `del /f /q`, `Remove-Item`).
- **NUNCA** ignore a lista de diretórios ocultos (`HIDDEN_DIR_PREFIXES`), lendo arquivos internos de `.obsidian` ou `.trash`.
- **NUNCA** crie arquivos temporários fora do diretório pai de destino (mover arquivos entre partições de disco diferentes no Windows falharia a atomicidade de `persist`).
