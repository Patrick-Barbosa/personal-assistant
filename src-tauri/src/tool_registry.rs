use crate::db::Database;
use crate::indexer::Indexer;
use crate::mcp::McpManager;
use crate::vault::VaultManager;
use async_trait::async_trait;
use rusqlite::params;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;

pub struct ToolContext {
    pub db: Arc<Database>,
    pub vault: Arc<VaultManager>,
    pub indexer: Arc<Indexer>,
    pub skills_dir: std::path::PathBuf,
}

pub use crate::domain::traits::BuiltinTool;

// ─── 1. Buscar Notas Tool ───────────────────────────────────

pub struct BuscarNotasTool;

#[async_trait]
impl BuiltinTool for BuscarNotasTool {
    fn name(&self) -> &str {
        "buscar_notas"
    }

    fn description(&self) -> &str {
        "Busca semântica no cofre Markdown. Use para responder perguntas sobre conteúdo já salvo. Retorna notas mais similares com score."
    }

    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Pergunta ou termos de busca em pt-BR"
                },
                "top_k": {
                    "type": "integer",
                    "description": "Quantidade de notas (1-10)",
                    "default": 5
                }
            },
            "required": ["query"]
        })
    }

    fn execute(&self, args: &Value, ctx: &ToolContext) -> String {
        let query = args["query"].as_str().unwrap_or("").trim();
        let top_k = args["top_k"].as_u64().unwrap_or(5) as usize;
        match ctx.indexer.search_notes(query, top_k) {
            Ok(results) => {
                let total = results.len();
                let resumo = if total == 0 {
                    format!(
                        "Buscou por '{}' e não encontrou notas correspondentes.",
                        query
                    )
                } else {
                    format!("Buscou por '{}' e retornou {} nota(s).", query, total)
                };
                json!({
                    "resultados": results,
                    "resumo": resumo,
                    "termo": query,
                    "total": total
                })
                .to_string()
            }
            Err(err) => json!({
                "erro": format!("Falha na busca: {}", err),
                "resumo": format!("Falha ao buscar por '{}': {}", query, err)
            })
            .to_string(),
        }
    }
}

// ─── 2. Ler Nota Tool ───────────────────────────────────────

pub struct LerNotaTool;

#[async_trait]
impl BuiltinTool for LerNotaTool {
    fn name(&self) -> &str {
        "ler_nota"
    }

    fn description(&self) -> &str {
        "Lê conteúdo completo + frontmatter de uma nota por título ou caminho. Use após buscar_notas para detalhar."
    }

    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "identifier": {
                    "type": "string",
                    "description": "Título, nome do arquivo ou caminho da nota"
                }
            },
            "required": ["identifier"]
        })
    }

    fn execute(&self, args: &Value, ctx: &ToolContext) -> String {
        let identifier = args["identifier"].as_str().unwrap_or("").trim();
        match ctx.vault.read_note(identifier) {
            Ok(note) => json!({
                "frontmatter": note.frontmatter,
                "corpo": note.content, // RETORNO COMPLETO SEM CORTE
                "path": note.path,
                "vault": note.vault,
                "categoria": note.categoria,
                "resumo": format!("Leu a nota '{}' (Cofre: {}).", note.titulo, note.vault)
            })
            .to_string(),
            Err(err) => json!({
                "erro": format!("{}", err),
                "resumo": format!("Tentou ler a nota '{}', mas não foi encontrada.", identifier)
            })
            .to_string(),
        }
    }
}

// ─── 3. Salvar Nota Tool ────────────────────────────────────

pub struct SalvarNotaTool;

#[async_trait]
impl BuiltinTool for SalvarNotaTool {
    fn name(&self) -> &str {
        "salvar_nota"
    }

    fn description(&self) -> &str {
        "Cria UMA NOVA nota Markdown no cofre padrão. Use SOMENTE para conteúdo novo e autocontido. NUNCA use para 'adicionar/acrescentar/incluir/adicionar itens em' nota já existente — isso é atualizar_nota. NUNCA copie o pedido do usuário como corpo; o corpo deve ser o conteúdo final (ex: a lista pronta com bullets), não a instrução."
    }

    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "titulo": {
                    "type": "string",
                    "description": "Título descritivo da nota"
                },
                "corpo": {
                    "type": "string",
                    "description": "Conteúdo Markdown enxuto, pode conter [[links]]"
                },
                "tags": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "Tags temáticas"
                },
                "topicos": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "Entidades/conceitos relevantes"
                }
            },
            "required": ["titulo", "corpo"]
        })
    }

    fn execute(&self, args: &Value, ctx: &ToolContext) -> String {
        let titulo = args["titulo"].as_str().unwrap_or("").trim();
        let corpo = args["corpo"].as_str().unwrap_or("").trim();
        if titulo.is_empty() || corpo.is_empty() {
            return json!({
                "erro": "titulo e corpo são obrigatórios",
                "resumo": "Tentativa inválida de salvar nota sem título ou corpo."
            })
            .to_string();
        }
        // Guarda anti-eco: impede salvar o pedido literal como conteúdo
        // (ex: corpo "adicionar 2 itens a lista" sem itens reais)
        let corpo_low = corpo.to_lowercase();
        let parece_instrucao = corpo.chars().count() < 120
            && (corpo_low.starts_with("adicionar")
                || corpo_low.starts_with("adicione")
                || corpo_low.starts_with("acrescent")
                || corpo_low.starts_with("inclu")
                || corpo_low.starts_with("colocar")
                || corpo_low.starts_with("coloque")
                || (corpo_low.contains("itens")
                    && (corpo_low.contains("lista") || corpo_low.contains("a lista"))
                    && !corpo.contains('\n')))
            && !corpo.contains("- ")
            && !corpo.contains("* ")
            && !corpo.contains("1.");
        if parece_instrucao {
            return json!({
                "erro": "Corpo parece ser a instrução do usuário, não o conteúdo final. Se a intenção é adicionar itens a uma nota existente, use atualizar_nota (com buscar_notas + ler_nota antes). Se faltam os itens ou a nota alvo, use perguntar_ao_usuario.",
                "resumo": "Bloqueado salvar_nota com corpo-instrução; use atualizar_nota ou pergunte."
            })
            .to_string();
        }

        // Guarda de fronteira de memória: o cofre do usuário NÃO é para diretrizes da IA.
        let tit_low = titulo.to_lowercase();
        let eh_diretriz_ia = tit_low.contains("diretrizes do copernico")
            || tit_low.contains("diretrizes de copernico")
            || tit_low.contains("regras do copernico")
            || tit_low.contains("regras do assistente")
            || tit_low.contains("diretrizes do assistente")
            || tit_low.contains("instruções do assistente")
            || tit_low.contains("instrucoes do assistente")
            || tit_low.contains("persona do copernico");
        if eh_diretriz_ia {
            return json!({
                "erro": "Bloqueado: O cofre Markdown do usuário é estritamente para o conhecimento pessoal dele. Regras, preferências de tratamento e diretrizes de conduta do Copernico NUNCA devem ser salvas como notas no cofre. O sistema de autoaprendizado pós-sessão cuidará de propor a diretriz na memória persistente.",
                "resumo": "Tentativa de criar nota sobre diretrizes do assistente no cofre foi bloqueada (fronteira de memória)."
            })
            .to_string();
        }

        let tags: Option<Vec<String>> = args["tags"].as_array().map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        });
        let topicos: Option<Vec<String>> = args["topicos"].as_array().map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        });

        match ctx.vault.create_note(titulo, corpo, tags, topicos) {
            Ok(path) => {
                let _ = ctx.indexer.index_single_note(&path, "default");
                json!({
                    "ok": true,
                    "path": path.to_string_lossy(),
                    "titulo": titulo,
                    "resumo": format!("Salvou a nota '{}' no cofre padrão.", titulo)
                })
                .to_string()
            }
            Err(err) => json!({
                "erro": format!("{}", err),
                "resumo": format!("Falha ao salvar nota '{}': {}", titulo, err)
            })
            .to_string(),
        }
    }
}

// ─── 4. Atualizar Nota Tool ─────────────────────────────────

pub struct AtualizarNotaTool;

#[async_trait]
impl BuiltinTool for AtualizarNotaTool {
    fn name(&self) -> &str {
        "atualizar_nota"
    }

    fn description(&self) -> &str {
        "Atualiza nota EXISTENTE no cofre padrão (append ou replace). Use SEMPRE que o usuário disser 'adicionar/acrescentar/incluir/colocar +N itens', 'adiciona na lista', 'atualiza a nota X'. Fluxo obrigatório: 1) buscar_notas para achar a nota alvo, 2) ler_nota para ver conteúdo atual, 3) atualizar_nota com identifier exato e novo_conteudo contendo os itens finais (não a instrução). Se não souber qual nota ou quais itens, use perguntar_ao_usuario antes."
    }

    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "identifier": {
                    "type": "string",
                    "description": "Título ou caminho da nota a atualizar"
                },
                "novo_conteudo": {
                    "type": "string",
                    "description": "Texto a adicionar/substituir"
                },
                "modo": {
                    "type": "string",
                    "enum": ["append", "replace"],
                    "description": "append=adiciona ao final, replace=substitui corpo"
                }
            },
            "required": ["identifier", "novo_conteudo"]
        })
    }

    fn execute(&self, args: &Value, ctx: &ToolContext) -> String {
        let identifier = args["identifier"].as_str().unwrap_or("").trim();
        let novo_conteudo = args["novo_conteudo"].as_str().unwrap_or("").trim();
        let modo = args["modo"].as_str().unwrap_or("append").trim();

        match ctx.vault.update_note(identifier, novo_conteudo, modo) {
            Ok(path) => {
                let _ = ctx.indexer.index_single_note(&path, "default");
                json!({
                    "ok": true,
                    "path": path.to_string_lossy(),
                    "modo": modo,
                    "resumo": format!("Atualizou a nota '{}' (modo: {}).", identifier, modo)
                })
                .to_string()
            }
            Err(err) => json!({
                "erro": format!("{}", err),
                "resumo": format!("Falha ao atualizar nota '{}': {}", identifier, err)
            })
            .to_string(),
        }
    }
}

// ─── 5. Deletar Nota Tool ───────────────────────────────────

pub struct DeletarNotaTool;

#[async_trait]
impl BuiltinTool for DeletarNotaTool {
    fn name(&self) -> &str {
        "deletar_nota"
    }

    fn description(&self) -> &str {
        "Arquiva em evolucoes/ (snapshot DD-MM-YY) e depois deleta do cofre padrão (archive-then-delete). Use para delete explícito OU para limpar duplicata já incorporada em consolidação (ex: concentrar em uma só, unificar, padrão). NUNCA tente deletar notas do cofre Obsidian."
    }

    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "identifier": {
                    "type": "string",
                    "description": "Título, nome do arquivo ou caminho da nota a deletar"
                },
                "incorporada_em": {
                    "type": "string",
                    "description": "Título da nota padrão que absorveu este conteúdo (obrigatório em consolidação, opcional em delete explícito)"
                },
                "motivo": {
                    "type": "string",
                    "description": "Motivo do arquivamento (ex: duplicata incorporada, pedido explícito do usuário)"
                }
            },
            "required": ["identifier"]
        })
    }

    fn execute(&self, args: &Value, ctx: &ToolContext) -> String {
        let identifier = args["identifier"].as_str().unwrap_or("").trim();
        if identifier.is_empty() {
            return json!({
                "erro": "identifier é obrigatório",
                "resumo": "Tentativa de deletar sem especificar nota."
            })
            .to_string();
        }
        let incorporada_em = args["incorporada_em"]
            .as_str()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let motivo = args["motivo"]
            .as_str()
            .unwrap_or("deleção via agente")
            .trim()
            .to_string();

        // Archive-then-delete: snapshot integral em evolucoes/ antes de remover.
        let snapshot_path =
            match ctx
                .vault
                .archive_note(identifier, incorporada_em.as_deref(), None, &motivo)
            {
                Ok(p) => {
                    let _ = ctx.indexer.index_single_note(&p, "default");
                    Some(p.to_string_lossy().to_string())
                }
                Err(e) => {
                    return json!({
                    "erro": format!("Falha ao arquivar '{}' antes de deletar: {}", identifier, e),
                    "resumo": format!("Archive-then-delete abortado para '{}': {}", identifier, e)
                })
                .to_string();
                }
            };

        match ctx.vault.delete_note(identifier) {
            Ok(path) => {
                let path_str = path.to_string_lossy().to_string();
                if let Ok(conn) = ctx.db.get_pool().get() {
                    let _ =
                        conn.execute("DELETE FROM vault_index WHERE path = ?1", params![path_str]);
                }
                json!({
                    "ok": true,
                    "arquivada_em": snapshot_path,
                    "mensagem": format!("Nota '{}' arquivada e deletada do cofre padrão.", identifier),
                    "resumo": match &incorporada_em {
                        Some(dest) => format!("Arquivou '{}' em evolucoes/ e deletou (incorporada em '{}').", identifier, dest),
                        None => format!("Arquivou '{}' em evolucoes/ e deletou do cofre padrão.", identifier),
                    }
                })
                .to_string()
            }
            Err(err) => json!({
                "erro": format!("{}", err),
                "resumo": format!("Falha ao deletar nota '{}': {}", identifier, err)
            })
            .to_string(),
        }
    }
}

// ─── 5b. Renomear Nota Tool (com reapontamento) ─────────────

pub struct RenomearNotaTool;

#[async_trait]
impl BuiltinTool for RenomearNotaTool {
    fn name(&self) -> &str {
        "renomear_nota"
    }

    fn description(&self) -> &str {
        "Renomeia nota do cofre padrão com reapontamento garantido de [[wikilinks]] em todas as demais notas default (escrita atômica). Use quando usuário pedir nome padrão/novo título. NUNCA renomeia Obsidian (R/O). Retorna quantos arquivos foram reapontados e quais links de Obsidian precisam de revisão manual."
    }

    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "identifier": {
                    "type": "string",
                    "description": "Título ou caminho atual da nota no cofre padrão"
                },
                "novo_titulo": {
                    "type": "string",
                    "description": "Novo título padrão (ex: Lista de Afazeres 12-09-26)"
                }
            },
            "required": ["identifier", "novo_titulo"]
        })
    }

    fn execute(&self, args: &Value, ctx: &ToolContext) -> String {
        let identifier = args["identifier"].as_str().unwrap_or("").trim();
        let novo_titulo = args["novo_titulo"].as_str().unwrap_or("").trim();
        if identifier.is_empty() || novo_titulo.is_empty() {
            return json!({
                "erro": "identifier e novo_titulo são obrigatórios",
                "resumo": "Tentativa de renomear sem especificar origem/destino."
            })
            .to_string();
        }
        match ctx.vault.rename_note_with_repoint(identifier, novo_titulo) {
            Ok(rep) => {
                let old_str = rep.old_path.to_string_lossy().to_string();
                let new_str = rep.new_path.to_string_lossy().to_string();
                if let Ok(conn) = ctx.db.get_pool().get() {
                    let _ =
                        conn.execute("DELETE FROM vault_index WHERE path = ?1", params![old_str]);
                }
                let _ = ctx.indexer.index_single_note(&rep.new_path, "default");
                for f in &rep.repointed_files {
                    let _ = ctx.indexer.index_single_note(f, "default");
                }
                json!({
                    "ok": true,
                    "old_path": old_str,
                    "new_path": new_str,
                    "repointed": rep.repointed_files.iter().map(|p| p.to_string_lossy().to_string()).collect::<Vec<_>>(),
                    "obsidian_bloqueados": rep.obsidian_blocked.iter().map(|p| p.to_string_lossy().to_string()).collect::<Vec<_>>(),
                    "resumo": format!("Renomeou '{}' para '{}' com {} reapontamento(s).", rep.old_title, rep.new_title, rep.repointed_files.len())
                })
                .to_string()
            }
            Err(err) => json!({
                "erro": format!("{}", err),
                "resumo": format!("Falha ao renomear '{}': {}", identifier, err)
            })
            .to_string(),
        }
    }
}

// ─── 5c. Consolidar Notas Tool (update + archive-then-delete atômico) ─

pub struct ConsolidarNotasTool;

#[async_trait]
impl BuiltinTool for ConsolidarNotasTool {
    fn name(&self) -> &str {
        "consolidar_notas"
    }

    fn description(&self) -> &str {
        "Consolida N notas-fonte em UMA nota padrão: faz replace na padrão com o corpo final (já com Data DD-MM-YY) e depois arquiva+deleta cada fonte (archive-then-delete). Use para 'concentrar em uma só', 'unificar', 'padrão', 'espalhadas'. Todas no cofre padrão."
    }

    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "nota_padrao": {
                    "type": "string",
                    "description": "Identifier da nota padrão que permanece"
                },
                "fontes": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "Identifiers das notas-fonte já incorporadas ao corpo final"
                },
                "corpo_final": {
                    "type": "string",
                    "description": "Corpo Markdown final da nota padrão (com bullets + Data: DD-MM-YY)"
                }
            },
            "required": ["nota_padrao", "fontes", "corpo_final"]
        })
    }

    fn execute(&self, args: &Value, ctx: &ToolContext) -> String {
        let nota_padrao = args["nota_padrao"].as_str().unwrap_or("").trim();
        let corpo_final = args["corpo_final"].as_str().unwrap_or("").trim();
        let fontes: Vec<String> = args["fontes"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|v| v.as_str().map(|s| s.trim().to_string()))
                    .filter(|s| !s.is_empty())
                    .collect()
            })
            .unwrap_or_default();
        if nota_padrao.is_empty() || corpo_final.is_empty() {
            return json!({
                "erro": "nota_padrao e corpo_final são obrigatórios",
                "resumo": "Consolidação abortada: faltou padrão ou corpo final."
            })
            .to_string();
        }
        // 1. Atualiza padrão (replace).
        let padrao_path = match ctx.vault.update_note(nota_padrao, corpo_final, "replace") {
            Ok(p) => p,
            Err(e) => {
                return json!({
                    "erro": format!("Falha ao atualizar padrão '{}': {}", nota_padrao, e),
                    "resumo": format!("Consolidação abortada na padrão '{}'.", nota_padrao)
                })
                .to_string()
            }
        };
        let _ = ctx.indexer.index_single_note(&padrao_path, "default");
        // 2. Archive-then-delete em cada fonte (pula a própria padrão).
        let mut arquivadas = Vec::new();
        let mut falhas = Vec::new();
        for fonte in fontes.iter().filter(|f| *f != nota_padrao) {
            match ctx.vault.archive_note(
                fonte,
                Some(nota_padrao),
                None,
                "duplicata incorporada em consolidação",
            ) {
                Ok(snap) => {
                    let _ = ctx.indexer.index_single_note(&snap, "default");
                    match ctx.vault.delete_note(fonte) {
                        Ok(old) => {
                            let old_str = old.to_string_lossy().to_string();
                            if let Ok(conn) = ctx.db.get_pool().get() {
                                let _ = conn.execute(
                                    "DELETE FROM vault_index WHERE path = ?1",
                                    params![old_str],
                                );
                            }
                            arquivadas.push(fonte.clone());
                        }
                        Err(e) => falhas.push(format!("{}: {}", fonte, e)),
                    }
                }
                Err(e) => falhas.push(format!("{} (arquivo): {}", fonte, e)),
            }
        }
        json!({
            "ok": falhas.is_empty(),
            "padrao": padrao_path.to_string_lossy().to_string(),
            "arquivadas_e_deletadas": arquivadas,
            "falhas": falhas,
            "resumo": format!("Consolidou em '{}': atualizada + {} fonte(s) arquivada(s) e deletada(s).", nota_padrao, arquivadas.len())
        })
        .to_string()
    }
}

// ─── 6. Perguntar ao Usuário Tool (Human-in-the-Loop) ───────

pub struct PerguntarAoUsuarioTool;

#[async_trait]
impl BuiltinTool for PerguntarAoUsuarioTool {
    fn name(&self) -> &str {
        "perguntar_ao_usuario"
    }

    fn description(&self) -> &str {
        "Faz uma pergunta clara ou solicita uma decisão/confirmação do usuário para prosseguir em uma tarefa ou rotina autônoma. Use quando houver ambiguidade, necessidade de autorização ou dúvida relevante."
    }

    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "pergunta": {
                    "type": "string",
                    "description": "Pergunta objetiva e direta para o usuário"
                },
                "opcoes": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "Opções sugeridas de resposta ou ação (opcional)"
                },
                "contexto": {
                    "type": "string",
                    "description": "Contexto ou motivo pelo qual a pergunta é necessária"
                }
            },
            "required": ["pergunta"]
        })
    }

    fn execute(&self, args: &Value, ctx: &ToolContext) -> String {
        let pergunta = args["pergunta"].as_str().unwrap_or("").trim();
        let contexto = args["contexto"].as_str().unwrap_or("").trim();
        let opcoes: Vec<String> = args["opcoes"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();

        if pergunta.is_empty() {
            return json!({
                "erro": "Pergunta não pode ser vazia",
                "resumo": "Tentou perguntar ao usuário com pergunta vazia"
            })
            .to_string();
        }

        let mut content = format!("### ❓ Pergunta do Assistente\n\n{}\n", pergunta);
        if !contexto.is_empty() {
            content.push_str(&format!("\n**Contexto:** {}\n", contexto));
        }
        if !opcoes.is_empty() {
            content.push_str("\n**Opções Sugeridas:**\n");
            for (idx, opt) in opcoes.iter().enumerate() {
                content.push_str(&format!("{}. {}\n", idx + 1, opt));
            }
        }

        let is_dialogue_only = args["apenas_dialogo"].as_bool().unwrap_or(false);
        let session_id = args["session_id"].as_str();

        if !is_dialogue_only {
            let _ = ctx.db.create_inbox_item(
                session_id,
                &format!(
                    "❓ Pergunta: {}",
                    pergunta.chars().take(50).collect::<String>()
                ),
                Some(if !contexto.is_empty() {
                    contexto
                } else {
                    pergunta
                }),
                &content,
                "question",
                true,
            );
        }

        json!({
            "status": "aguardando_resposta",
            "pergunta": pergunta,
            "opcoes": opcoes,
            "contexto": contexto,
            "mensagem": "Pergunta formulada para o usuário responder no diálogo.",
            "resumo": format!("Perguntou ao usuário: '{}'", pergunta)
        })
        .to_string()
    }
}

// ─── 7. Encerrar Sessão Tool ────────────────────────────────

pub struct EncerrarSessaoTool;

#[async_trait]
impl BuiltinTool for EncerrarSessaoTool {
    fn name(&self) -> &str {
        "encerrar_sessao"
    }

    fn description(&self) -> &str {
        "Encerra a sessão de voz atual. Use quando o usuário se despedir ou indicar que a conversa acabou (ex: 'obrigado', 'valeu', 'tchau', 'pode fechar', 'era só isso', 'por hoje é só'). NÃO use se o usuário ainda estiver perguntando algo."
    }

    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "motivo": {
                    "type": "string",
                    "description": "Breve frase ou motivo de despedida para falar ao usuário"
                }
            }
        })
    }

    fn execute(&self, args: &Value, _ctx: &ToolContext) -> String {
        let motivo = args["motivo"].as_str().unwrap_or("Conversa finalizada.");
        json!({
            "acao": "encerrar_sessao",
            "motivo": motivo,
            "status": "encerrada",
            "mensagem": "Sessão de voz encerrada com sucesso.",
            "resumo": "A sessão de voz foi finalizada."
        })
        .to_string()
    }
}

// ─── 8. Propor Melhoria de Instrução (Autoaprendizado & Meta-Instruções) ────

pub struct ProporMelhoriaInstrucaoTool;

#[async_trait]
impl BuiltinTool for ProporMelhoriaInstrucaoTool {
    fn name(&self) -> &str {
        "propor_melhoria_instrucao"
    }

    fn description(&self) -> &str {
        "Propõe uma nova instrução, regra ou diretriz de comportamento para o próprio assistente (autoaprendizado), para evitar erros futuros ou atender melhor a preferências do usuário. Registra a proposta na Inbox para aprovação do usuário."
    }

    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "titulo": {
                    "type": "string",
                    "description": "Título curto da melhoria proposta (ex: 'Ajuste de Busca por Datas')"
                },
                "justificativa": {
                    "type": "string",
                    "description": "Explicação do porquê esta diretriz está sendo proposta (o que aconteceu, o erro que ocorreu ou a preferência observada)"
                },
                "instrucao_proposta": {
                    "type": "string",
                    "description": "A regra ou diretriz exata que deve ser adicionada às instruções do assistente"
                }
            },
            "required": ["titulo", "justificativa", "instrucao_proposta"]
        })
    }

    fn execute(&self, args: &Value, ctx: &ToolContext) -> String {
        let titulo = args["titulo"]
            .as_str()
            .unwrap_or("Melhoria de Instrução")
            .trim();
        let justificativa = args["justificativa"].as_str().unwrap_or("").trim();
        let instrucao = args["instrucao_proposta"].as_str().unwrap_or("").trim();

        if instrucao.is_empty() {
            return json!({ "erro": "Instrução proposta não pode ser vazia" }).to_string();
        }

        // Filtro arquitetural: voz nunca cria durante a fala (criação é do consolidador pós-sessão)
        let inst_low = instrucao.to_lowercase();
        let pede_criacao_em_voz = [
            "conforme fala",
            "durante a fala",
            "durante a conversa",
            "enquanto fala",
            "em tempo real por voz",
            "em tempo real durante",
            "crie notas enquanto",
            "criar notas enquanto",
            "anote durante",
            "anotar durante",
            "salvar durante a fala",
        ]
        .iter()
        .any(|pat| inst_low.contains(pat));
        if pede_criacao_em_voz {
            return json!({ "sucesso": false, "resumo": "Diretriz rejeitada: voz nunca cria notas durante a fala; criação é exclusiva do consolidador pós-sessão.", "erro": "Viola arquitetura de voz" }).to_string();
        }

        // Dedup: verifica se já existe na memória ou pendente na Inbox (evita duplicatas mesmo se LLM ignorar prompt)
        let normalized = instrucao.to_lowercase();
        let existing = ctx
            .db
            .get_setting("agent_custom_instructions")
            .ok()
            .flatten()
            .unwrap_or_default();
        if existing.to_lowercase().contains(&normalized)
            || normalized.contains(existing.to_lowercase().trim()) && !existing.trim().is_empty()
        {
            return json!({ "sucesso": false, "resumo": "Diretriz já existe na memória persistente, não é necessário repropor.", "erro": "Duplicata na memória" }).to_string();
        }
        let all_instructions: Vec<crate::db::InboxItem> = ctx
            .db
            .list_inbox_items()
            .unwrap_or_default()
            .into_iter()
            .filter(|i| i.item_type == "instruction_improvement")
            .collect();
        let pending: Vec<String> = all_instructions
            .iter()
            .filter(|i| i.status == "unread" || i.status == "pending")
            .filter_map(|i| i.proposed_content.clone())
            .collect();
        let dismissed: Vec<String> = all_instructions
            .iter()
            .filter(|i| i.status == "dismissed")
            .filter_map(|i| i.proposed_content.clone())
            .collect();
        let fuzzy_match = |list: &[String]| {
            list.iter().any(|p| {
                let pn = p.to_lowercase();
                if pn.contains(&normalized) || normalized.contains(&pn) {
                    return true;
                }
                let p_lower = p.to_lowercase();
                let a: std::collections::HashSet<&str> = normalized.split_whitespace().collect();
                let b: std::collections::HashSet<&str> = p_lower.split_whitespace().collect();
                let inter = a.intersection(&b).count();
                let union = a.len() + b.len() - inter;
                union > 0 && (inter as f32 / union as f32) > 0.85
            })
        };
        if fuzzy_match(&pending) {
            return json!({ "sucesso": false, "resumo": "Diretriz similar já pendente na Inbox, aguardando aprovação.", "erro": "Duplicata pendente" }).to_string();
        }
        if fuzzy_match(&dismissed) {
            return json!({ "sucesso": false, "resumo": "Diretriz já rejeitada pelo usuário (dismissed). Não repropor.", "erro": "Rejeitada anteriormente" }).to_string();
        }
        let diff = json!({
            "before": existing,
            "to_add": instrucao,
        })
        .to_string();

        let res = ctx.db.create_inbox_item_full(
            None,
            titulo,
            Some(justificativa),
            &format!(
                "**Motivo da Proposta:** {}\n\n**Instrução Proposta:**\n{}",
                justificativa, instrucao
            ),
            "instruction_improvement",
            true,
            None,
            Some(instrucao),
            Some(&diff),
        );

        match res {
            Ok(item) => {
                json!({
                    "sucesso": true,
                    "inbox_id": item.id,
                    "mensagem": "Proposta de melhoria de diretriz registrada na Inbox do usuário para revisão e aprovação."
                }).to_string()
            }
            Err(e) => {
                json!({
                    "erro": format!("Falha ao criar proposta na Inbox: {}", e)
                }).to_string()
            }
        }
    }
}

// ─── 9. Executar Script de Skill Tool ───────────────────────────────

pub struct ExecutarScriptSkillTool;

#[async_trait]
impl BuiltinTool for ExecutarScriptSkillTool {
    fn name(&self) -> &str {
        "executar_script_skill"
    }

    fn description(&self) -> &str {
        "Executa um script Python determinístico pertencente a uma skill instalada em skills/<skill_id>/scripts/ ou na raiz da skill, passando os argumentos especificados."
    }

    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "skill_id": {
                    "type": "string",
                    "description": "Identificador da skill (ex: 'web-search')"
                },
                "script": {
                    "type": "string",
                    "description": "Nome do arquivo do script (ex: 'search.py')"
                },
                "argumentos": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "Lista de argumentos CLI a serem passados ao script"
                }
            },
            "required": ["skill_id", "script"]
        })
    }

    fn execute(&self, args: &Value, ctx: &ToolContext) -> String {
        let skill_id = args["skill_id"].as_str().unwrap_or("").trim();
        let script = args["script"].as_str().unwrap_or("").trim();
        let empty_vec = vec![];
        let arg_list: Vec<String> = args["argumentos"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or(empty_vec);

        match crate::code_runner::execute_skill_script(&ctx.skills_dir, skill_id, script, &arg_list)
        {
            Ok(stdout) => json!({
                "sucesso": true,
                "skill_id": skill_id,
                "script": script,
                "saida": stdout.trim(),
                "resumo": format!("Executou '{}' da skill '{}' com sucesso.", script, skill_id)
            })
            .to_string(),
            Err(err) => json!({
                "sucesso": false,
                "erro": err,
                "resumo": format!("Falha ao executar '{}' da skill '{}': {}", script, skill_id, err)
            })
            .to_string(),
        }
    }
}

// ─── 10. Executar Código Python Tool ─────────────────────────────

pub struct ExecutarCodigoPythonTool;

#[async_trait]
impl BuiltinTool for ExecutarCodigoPythonTool {
    fn name(&self) -> &str {
        "executar_codigo_python"
    }

    fn description(&self) -> &str {
        "Executa um bloco de código Python no ambiente local para processar dados, realizar cálculos matemáticos ou automações dinâmicas."
    }

    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "codigo": {
                    "type": "string",
                    "description": "Código Python completo a ser executado."
                }
            },
            "required": ["codigo"]
        })
    }

    fn execute(&self, args: &Value, _ctx: &ToolContext) -> String {
        let codigo = args["codigo"].as_str().unwrap_or("").trim();
        match crate::code_runner::execute_python_code(codigo) {
            Ok(stdout) => json!({
                "sucesso": true,
                "saida": stdout.trim(),
                "resumo": "Código Python executado com sucesso."
            })
            .to_string(),
            Err(err) => json!({
                "sucesso": false,
                "erro": err,
                "resumo": format!("Erro na execução Python: {}", err)
            })
            .to_string(),
        }
    }
}

// ─── 11. Registrar Métrica Tabular Tool ─────────────────────────────

pub struct RegistrarMetricaTool;

#[async_trait]
impl BuiltinTool for RegistrarMetricaTool {
    fn name(&self) -> &str {
        "registrar_metrica"
    }

    fn description(&self) -> &str {
        "Registra um dado tabular ou métrica quantitativa no banco analítico local (ex: hábitos, treino, finanças, saúde, produtividade)."
    }

    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "categoria": {
                    "type": "string",
                    "description": "Categoria da métrica (ex: 'habito', 'financeiro', 'saude', 'treino', 'estudo')"
                },
                "data": {
                    "type": "string",
                    "description": "Data do registro no formato do usuário (ex: DD-MM-YY). Se omitido, usa a data atual de hoje."
                },
                "chave": {
                    "type": "string",
                    "description": "Nome/chave da métrica (ex: 'treino', 'paginas_lidas', 'gasto', 'peso', 'copos_agua')"
                },
                "valor": {
                    "type": "number",
                    "description": "Valor numérico da métrica (ex: 1, 15.5, 250.0)"
                },
                "notas": {
                    "type": "string",
                    "description": "Observações ou detalhes adicionais sobre o registro"
                },
                "nota_ref": {
                    "type": "string",
                    "description": "Referência ou wikilink para nota relacionada (ex: '[[Hábitos]]' ou '[[Finanças]]')"
                }
            },
            "required": ["categoria", "chave", "valor"]
        })
    }

    fn execute(&self, args: &Value, ctx: &ToolContext) -> String {
        let categoria = args["categoria"].as_str().unwrap_or("").trim();
        let chave = args["chave"].as_str().unwrap_or("").trim();
        let valor = match args["valor"].as_f64() {
            Some(v) => v,
            None => {
                return json!({
                    "sucesso": false,
                    "erro": "Campo 'valor' numérico é obrigatório",
                    "resumo": "Falha ao registrar métrica: valor numérico ausente ou inválido."
                })
                .to_string();
            }
        };

        if categoria.is_empty() || chave.is_empty() {
            return json!({
                "sucesso": false,
                "erro": "Campos 'categoria' e 'chave' são obrigatórios",
                "resumo": "Falha ao registrar métrica: categoria e chave devem ser preenchidas."
            })
            .to_string();
        }

        // Validação anti-tarefa: métricas tabulares são estritamente analíticas quantitativas.
        let cat_low = categoria.to_lowercase();
        let ch_low = chave.to_lowercase();
        if cat_low == "tarefa"
            || cat_low == "todo"
            || cat_low == "afazer"
            || cat_low == "preferencia"
            || ch_low == "tarefa"
            || ch_low == "todo"
        {
            return json!({
                "sucesso": false,
                "erro": "Métricas tabulares são EXCLUSIVAMENTE para dados analíticos quantitativos contínuos (ex: calorias, treinos, gastos, peso, copos_agua). Tarefas, to-dos e preferências NÃO são métricas e devem ser salvas em notas Markdown com '- [ ]'.",
                "resumo": "Tentativa inválida de registrar tarefa ou preferência como métrica analítica foi rejeitada."
            })
            .to_string();
        }

        let hoje = crate::vault::hoje_ddmmyy();
        let data = args["data"]
            .as_str()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .unwrap_or(&hoje);
        let notas = args["notas"]
            .as_str()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty());
        let nota_ref = args["nota_ref"]
            .as_str()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty());

        match ctx
            .db
            .insert_tabular_metric(categoria, data, chave, valor, notas, nota_ref)
        {
            Ok(id) => {
                let resumo = format!(
                    "Registrou métrica '{}:{}' = {} em {}.",
                    categoria, chave, valor, data
                );
                json!({
                    "sucesso": true,
                    "id": id,
                    "categoria": categoria,
                    "data": data,
                    "chave": chave,
                    "valor": valor,
                    "resumo": resumo
                })
                .to_string()
            }
            Err(e) => json!({
                "sucesso": false,
                "erro": format!("Erro ao inserir métrica tabular: {}", e),
                "resumo": format!("Falha ao registrar métrica '{}:{}': {}", categoria, chave, e)
            })
            .to_string(),
        }
    }
}

// ─── 12. Consultar Métricas Tabulares Tool ─────────────────────────

pub struct ConsultarMetricasTool;

#[async_trait]
impl BuiltinTool for ConsultarMetricasTool {
    fn name(&self) -> &str {
        "consultar_metricas"
    }

    fn description(&self) -> &str {
        "Consulta e agrega métricas tabulares no banco analítico local. Retorna dados estruturados e uma tabela Markdown pronta para ser inserida em notas como [[Hábitos]] ou [[Dashboard]]."
    }

    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "categoria": {
                    "type": "string",
                    "description": "Filtrar por categoria (opcional)"
                },
                "data_inicio": {
                    "type": "string",
                    "description": "Filtrar por data inicial (inclusive, opcional)"
                },
                "data_fim": {
                    "type": "string",
                    "description": "Filtrar por data final (inclusive, opcional)"
                },
                "chave": {
                    "type": "string",
                    "description": "Filtrar por chave da métrica (opcional)"
                }
            }
        })
    }

    fn execute(&self, args: &Value, ctx: &ToolContext) -> String {
        let categoria = args["categoria"]
            .as_str()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty());
        let data_inicio = args["data_inicio"]
            .as_str()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty());
        let data_fim = args["data_fim"]
            .as_str()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty());
        let chave = args["chave"]
            .as_str()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty());

        match ctx
            .db
            .query_tabular_metrics(categoria, data_inicio, data_fim, chave)
        {
            Ok(records) => {
                let count = records.len();
                if count == 0 {
                    return json!({
                        "total": 0,
                        "registros": [],
                        "tabela_markdown": "_Nenhuma métrica encontrada para os filtros especificados._",
                        "resumo": "Nenhum dado tabular encontrado."
                    })
                    .to_string();
                }

                let sum: f64 = records.iter().map(|r| r.metric_value).sum();
                let avg = sum / (count as f64);
                let min = records
                    .iter()
                    .map(|r| r.metric_value)
                    .fold(f64::INFINITY, f64::min);
                let max = records
                    .iter()
                    .map(|r| r.metric_value)
                    .fold(f64::NEG_INFINITY, f64::max);

                let mut md = String::from("| Data | Categoria | Métrica | Valor | Notas | Referência |\n|---|---|---|---|---|---|\n");
                for r in &records {
                    let n = r.notes.as_deref().unwrap_or("—");
                    let rf = r.note_ref.as_deref().unwrap_or("—");
                    md.push_str(&format!(
                        "| {} | {} | {} | {} | {} | {} |\n",
                        r.record_date, r.category, r.metric_key, r.metric_value, n, rf
                    ));
                }

                md.push_str(&format!(
                    "\n**Resumo Estatístico:** Total: {} | Soma: {:.2} | Média: {:.2} | Mín: {:.2} | Máx: {:.2}\n",
                    count, sum, avg, min, max
                ));

                let resumo = format!(
                    "Encontradas {} métricas. Soma: {:.2}, Média: {:.2}.",
                    count, sum, avg
                );

                json!({
                    "total": count,
                    "estatisticas": {
                        "count": count,
                        "sum": sum,
                        "avg": avg,
                        "min": min,
                        "max": max
                    },
                    "registros": records,
                    "tabela_markdown": md,
                    "resumo": resumo
                })
                .to_string()
            }
            Err(e) => json!({
                "sucesso": false,
                "erro": format!("Erro ao consultar métricas: {}", e),
                "resumo": format!("Falha ao consultar métricas: {}", e)
            })
            .to_string(),
        }
    }
}

// ─── 13. Propor Evolução de Nota Tool ──────────────────────────────

pub struct ProporEvolucaoNotaTool;

#[async_trait]
impl BuiltinTool for ProporEvolucaoNotaTool {
    fn name(&self) -> &str {
        "propor_evolucao_nota"
    }

    fn description(&self) -> &str {
        "Propõe uma evolução in-place para uma nota canônica existente com diff side-by-side preciso, registrando a proposta na Inbox do usuário para revisão e aprovação."
    }

    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "identifier": {
                    "type": "string",
                    "description": "Título, nome ou slug da nota canônica alvo a ser evoluída"
                },
                "resumo_mudanca": {
                    "type": "string",
                    "description": "Resumo de 1 linha explicando o motivo e as alterações propostas"
                },
                "conteudo_proposto": {
                    "type": "string",
                    "description": "Conteúdo completo da versão proposta para a nota canônica"
                }
            },
            "required": ["identifier", "resumo_mudanca", "conteudo_proposto"]
        })
    }

    fn execute(&self, args: &Value, ctx: &ToolContext) -> String {
        let identifier = args["identifier"].as_str().unwrap_or("").trim();
        let resumo = args["resumo_mudanca"].as_str().unwrap_or("").trim();
        let proposto = args["conteudo_proposto"].as_str().unwrap_or("").trim();

        if identifier.is_empty() || proposto.is_empty() {
            return json!({
                "sucesso": false,
                "erro": "Campos 'identifier' e 'conteudo_proposto' são obrigatórios."
            })
            .to_string();
        }

        let (original_content, slug) = match ctx.vault.read_note(identifier) {
            Ok(note) => (note.content, note.titulo),
            Err(_) => (String::new(), identifier.to_string()),
        };

        let diff_obj = json!({
            "target": slug,
            "original_len": original_content.len(),
            "proposed_len": proposto.len(),
            "changelog": resumo,
        });

        match ctx.db.create_inbox_item_full(
            None,
            &format!("Evolução de Nota: [[{}]]", slug),
            Some(resumo),
            &original_content,
            "evolution_proposal",
            true,
            Some(&slug),
            Some(proposto),
            Some(&diff_obj.to_string()),
        ) {
            Ok(item) => json!({
                "sucesso": true,
                "inbox_id": item.id,
                "target_base_note_slug": slug,
                "resumo": format!("Proposta de evolução para [[{}]] registrada na Inbox com diff lado a lado.", slug)
            })
            .to_string(),
            Err(e) => json!({
                "sucesso": false,
                "erro": format!("Falha ao criar proposta de evolução: {}", e),
                "resumo": format!("Erro ao propor evolução para '{}': {}", identifier, e)
            })
            .to_string(),
        }
    }
}

// ─── ToolRegistry Unificado ─────────────────────────────────

pub struct ToolRegistry {
    builtin_tools: HashMap<String, Arc<dyn BuiltinTool>>,
    mcp_manager: Arc<McpManager>,
    ctx: ToolContext,
}

impl ToolRegistry {
    pub fn new(
        db: Arc<Database>,
        vault: Arc<VaultManager>,
        indexer: Arc<Indexer>,
        mcp_manager: Arc<McpManager>,
        skills_dir: std::path::PathBuf,
    ) -> Self {
        let mut builtin_tools: HashMap<String, Arc<dyn BuiltinTool>> = HashMap::new();

        let tools: Vec<Arc<dyn BuiltinTool>> = vec![
            Arc::new(BuscarNotasTool),
            Arc::new(LerNotaTool),
            Arc::new(SalvarNotaTool),
            Arc::new(AtualizarNotaTool),
            Arc::new(DeletarNotaTool),
            Arc::new(RenomearNotaTool),
            Arc::new(ConsolidarNotasTool),
            Arc::new(PerguntarAoUsuarioTool),
            Arc::new(EncerrarSessaoTool),
            Arc::new(ProporMelhoriaInstrucaoTool),
            Arc::new(ExecutarScriptSkillTool),
            Arc::new(ExecutarCodigoPythonTool),
            Arc::new(RegistrarMetricaTool),
            Arc::new(ConsultarMetricasTool),
            Arc::new(ProporEvolucaoNotaTool),
        ];

        for t in tools {
            builtin_tools.insert(t.name().to_string(), t);
        }

        let ctx = ToolContext {
            db,
            vault,
            indexer,
            skills_dir,
        };

        Self {
            builtin_tools,
            mcp_manager,
            ctx,
        }
    }

    /// Retorna definições de ferramentas mescladas (Built-in + MCP) com deduplicação
    pub fn get_merged_definitions(&self) -> Value {
        use std::collections::HashSet;
        let mut list = Vec::new();
        let mut seen: HashSet<String> = HashSet::new();

        // Built-in tools
        for t in self.builtin_tools.values() {
            let name = t.name().to_string();
            if seen.insert(name.clone()) {
                list.push(json!({
                    "type": "function",
                    "function": {
                        "name": t.name(),
                        "description": t.description(),
                        "parameters": t.parameters_schema()
                    }
                }));
            }
        }

        // MCP tools (com deduplicação: ignora ferramentas com nome já existente)
        let mcp_tools = self.mcp_manager.get_tool_definitions();
        for tool_val in mcp_tools {
            if let Some(name) = tool_val
                .get("function")
                .and_then(|f| f.get("name"))
                .and_then(|n| n.as_str())
            {
                if seen.contains(name) {
                    eprintln!("[TOOL_REGISTRY] Ferramenta MCP duplicada '{}' ignorada (conflito com built-in ou outro servidor)", name);
                    continue;
                }
                seen.insert(name.to_string());
            }
            list.push(tool_val);
        }

        Value::Array(list)
    }

    /// Retorna definições filtradas por nomes permitidos (usado por Skills)
    pub fn get_filtered_definitions(&self, allowed_names: &[String]) -> Value {
        let all = self.get_merged_definitions();
        if let Some(arr) = all.as_array() {
            let filtered: Vec<Value> = arr
                .iter()
                .filter(|item| {
                    if let Some(name) = item
                        .get("function")
                        .and_then(|f| f.get("name"))
                        .and_then(|n| n.as_str())
                    {
                        allowed_names.iter().any(|allowed| allowed == name)
                    } else {
                        false
                    }
                })
                .cloned()
                .collect();
            Value::Array(filtered)
        } else {
            Value::Array(vec![])
        }
    }

    /// Executa uma ferramenta (built-in ou MCP)
    pub fn execute(&self, name: &str, args_json: &str) -> String {
        let args: Value = serde_json::from_str(args_json).unwrap_or(json!({}));

        // 1. Tenta executar como built-in tool
        if let Some(tool) = self.builtin_tools.get(name) {
            return tool.execute(&args, &self.ctx);
        }

        // 2. Tenta executar via MCP
        match self.mcp_manager.call_tool(name, args) {
            Ok(res) => res,
            Err(err) => json!({
                "erro": format!("Falha ao executar ferramenta MCP '{}': {}", name, err),
                "resumo": format!("Tentou executar '{}', mas ocorreu um erro.", name)
            })
            .to_string(),
        }
    }

    /// Retorna a referência ao McpManager
    pub fn mcp_manager(&self) -> Arc<McpManager> {
        self.mcp_manager.clone()
    }

    /// Retorna o caminho do diretório de skills
    pub fn skills_dir(&self) -> &std::path::Path {
        &self.ctx.skills_dir
    }
}
