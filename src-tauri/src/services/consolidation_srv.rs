use crate::db::SharedDatabase;
use crate::indexer::SharedIndexer;
use crate::llm::ChatMessage;
use crate::providers::LlmProvider;
use crate::tool_registry::ToolRegistry;
use crate::vault::SharedVaultManager;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

/// Ferramentas disponíveis para o consolidador: leitura + escrita total no cofre padrão.
/// O consolidador é o ÚNICO executor de escrita do fluxo de voz.
fn consolidation_tools(registry: &ToolRegistry) -> serde_json::Value {
    let allowed = [
        "buscar_notas".to_string(),
        "ler_nota".to_string(),
        "salvar_nota".to_string(),
        "atualizar_nota".to_string(),
        "deletar_nota".to_string(),
        "renomear_nota".to_string(),
        "consolidar_notas".to_string(),
        "registrar_metrica".to_string(),
        "consultar_metricas".to_string(),
        "propor_evolucao_nota".to_string(),
    ];
    registry.get_filtered_definitions(&allowed)
}

#[derive(Debug)]
struct Mutation {
    kind: &'static str, // "created" | "updated" | "deleted" | "renamed" | "consolidated"
    title: String,
    #[allow(dead_code)]
    detail: String,
}

pub fn has_explicit_delete_intent(lower_transcript: &str) -> bool {
    let verb = lower_transcript.contains("delet")
        || lower_transcript.contains("apag")
        || lower_transcript.contains("exclu")
        || lower_transcript.contains("remov");
    verb && (lower_transcript.contains("nota") || lower_transcript.contains("lista"))
}

/// Intenção de consolidação em nota única padrão (ex: "concentrado em uma só",
/// "unificar", "consolidar", "juntar", "padrão", "espalhadas", "limpar duplicadas").
/// Autoriza archive-then-delete das fontes já incorporadas, mesmo sem verbo de delete.
pub fn has_consolidation_intent(lower_transcript: &str) -> bool {
    let t = lower_transcript;
    t.contains("concentr")
        || t.contains("uma s")
        || t.contains("unific")
        || t.contains("consolid")
        || t.contains("juntar")
        || t.contains("junta")
        || t.contains("espalhada")
        || t.contains("duplic")
        || (t.contains("padr") && (t.contains("lista") || t.contains("nota")))
        || t.contains("limpar")
}

fn has_explicit_create_intent(lower_transcript: &str) -> bool {
    lower_transcript.contains("crie uma nota")
        || lower_transcript.contains("crie nota")
        || (lower_transcript.contains("salve") && lower_transcript.contains("nota"))
        || lower_transcript.contains("anote ")
        || lower_transcript.contains("guarde ")
        || lower_transcript.contains("registre ")
}

fn has_explicit_append_intent(lower_transcript: &str) -> bool {
    let verb = lower_transcript.contains("adicion")
        || lower_transcript.contains("acrescent")
        || lower_transcript.contains("inclu")
        || lower_transcript.contains("coloque")
        || lower_transcript.contains("colocar")
        || lower_transcript.contains("anexe")
        || lower_transcript.contains("anexar");
    verb && (lower_transcript.contains("lista")
        || lower_transcript.contains("nota")
        || lower_transcript.contains(" a ela")
        || lower_transcript.contains(" nela"))
}

pub async fn consolidate_voice_session(
    session_id: &str,
    app_handle: Option<AppHandle>,
    db: SharedDatabase,
    llm: Arc<dyn LlmProvider>,
    vault: SharedVaultManager,
    indexer: SharedIndexer,
    tool_registry: Arc<ToolRegistry>,
) -> Result<Option<String>, Box<dyn std::error::Error + Send + Sync>> {
    // 1. Carrega mensagens da sessão
    let messages = db.get_messages(session_id)?;

    // Guarda anti-reconsolidação: só avança se houver mensagens do usuário posteriores
    // à última consolidação desta sessão.
    // Ignora mensagens do assistente ou espelhos do sistema (ex: aprovação no Inbox).
    let last_user_msg = messages
        .iter()
        .filter(|m| m.role == "user")
        .max_by_key(|m| m.id);

    let Some(last_user) = last_user_msg else {
        println!(
            "[CONSOLIDATION] Sessão '{}' sem mensagens de usuário. Pulando.",
            session_id
        );
        return Ok(None);
    };

    let last_user_id = last_user.id;
    let last_key = format!("last_consolidated_user_msg_id::{}", session_id);
    if let Ok(Some(prev)) = db.get_setting(&last_key) {
        if let Ok(prev_id) = prev.trim().parse::<i64>() {
            if last_user_id <= prev_id {
                println!(
                    "[CONSOLIDATION] Sessão '{}' sem falas novas do usuário desde a última consolidação (último user msg id: {}, gravado: {}). Pulando.",
                    session_id, last_user_id, prev_id
                );
                return Ok(None);
            }
        }
    }
    let mark_consolidated = |db: &SharedDatabase| {
        let _ = db.set_setting(&last_key, &last_user_id.to_string());
    };

    // Filtra mensagens de user e assistant
    let conversation_turns: Vec<_> = messages
        .iter()
        .filter(|m| m.role == "user" || m.role == "assistant")
        .collect();

    // Se não houver mensagens de usuário ou se forem muito curtas, tenta ainda autoaprendizado antes de descartar
    let user_msgs: Vec<_> = conversation_turns
        .iter()
        .filter(|m| m.role == "user")
        .collect();
    if user_msgs.is_empty() {
        mark_consolidated(&db);
        return Ok(None);
    }

    let total_user_chars: usize = user_msgs.iter().map(|m| m.content.trim().len()).sum();
    if total_user_chars < 8 {
        println!(
            "[CONSOLIDATION] Conteúdo do usuário muito curto ({} caracteres). Pulando notas, mas tentando autoaprendizado.",
            total_user_chars
        );
        let _ =
            analyze_operational_learnings(session_id, app_handle.clone(), db.clone(), llm.clone())
                .await;
        mark_consolidated(&db);
        return Ok(None);
    }

    // 2. Monta histórico estruturado (com desduplicação defensiva de mensagens consecutivas idênticas)
    let mut formatted_transcript = String::new();
    let mut prev_content = "";
    for msg in &conversation_turns {
        let trimmed = msg.content.trim();
        if trimmed == prev_content && !trimmed.is_empty() {
            continue;
        }
        prev_content = trimmed;
        let role_label = if msg.role == "user" {
            "Usuário"
        } else {
            "Copernico"
        };
        formatted_transcript.push_str(&format!("{}: {}\n\n", role_label, trimmed));
    }

    // Carrega instruções já existentes e pendentes para evitar duplicata e para prompt
    let existing_memory = db
        .get_setting("agent_custom_instructions")
        .ok()
        .flatten()
        .unwrap_or_default();
    let pending_instructions: Vec<String> = db
        .list_inbox_items()
        .unwrap_or_default()
        .into_iter()
        .filter(|i| {
            i.item_type == "instruction_improvement"
                && (i.status == "unread" || i.status == "pending")
        })
        .filter_map(|i| i.proposed_content.clone())
        .collect();
    let pending_list = if pending_instructions.is_empty() {
        "Nenhuma pendente.".to_string()
    } else {
        pending_instructions
            .iter()
            .map(|s| format!("- {}", s.trim()))
            .collect::<Vec<_>>()
            .join("\n")
    };

    let date_fmt = db
        .get_setting("date_format")
        .ok()
        .flatten()
        .unwrap_or_else(|| "DD-MM-YY".to_string());
    let hoje_formatada = crate::vault::format_date_with(chrono::Local::now(), &date_fmt);

    // Carrega títulos de notas do cofre padrão para evitar duplicações e incentivar UPDATE
    let existing_note_titles: Vec<String> = vault
        .list_all_note_titles()
        .into_iter()
        .filter(|n| n.vault == "default")
        .map(|n| n.title)
        .collect();
    let existing_titles_str = if existing_note_titles.is_empty() {
        "Nenhuma nota existente no cofre padrão.".to_string()
    } else {
        existing_note_titles
            .iter()
            .take(60)
            .map(|t| format!("- [[{}]]", t))
            .collect::<Vec<_>>()
            .join("\n")
    };

    // 3. FASE 1: Planejamento Estruturado (Checklist de Consolidação)
    let planning_prompt = format!(
        r#"Você é o planejador de consolidação pós-voz do Copernico (Second Brain). Analise o diálogo da sessão de voz e gere um PLANO DE AÇÕES CRUD estruturado em formato de checklist Markdown.

FORMATO OBRIGATÓRIO (use exatamente este padrão):
### Plano de Consolidação
- [ ] UPDATE [[NomeDaNota]] | Motivo: <motivo>
- [ ] CREATE [[NovaIdeia]] | Motivo: <motivo>
- [ ] DELETE [[Rascunho]] | Motivo: <motivo>
- [ ] RECORD_DATA categoria:chave | valor | {}

REGRAS CRÍTICAS:
- Só planeje ações para fatos, tarefas, dados ou decisões duradouras explicitamente mencionadas pelo usuário.
- SEPARAÇÃO OBRIGATÓRIA (TAREFAS vs MÉTRICAS):
  * TAREFAS / TO-DOS / AFAZERES (ex: ler livro, jogar, comprar algo, investir, lição de casa) NUNCA SÃO RECORD_DATA! Devem ser planejadas EXCLUSIVAMENTE como CREATE ou UPDATE em notas de tarefas/listas em Markdown com bullets de tarefa (- [ ]).
  * RECORD_DATA é EXCLUSIVAMENTE para dados analíticos quantitativos numéricos contínuos (ex: calorias, treinos, peso, gastos, finanças numéricas). NUNCA use RECORD_DATA para marcar to-dos com valor 1.
- FRONTEIRA DO COFRE (NUNCA CRIE NOTAS SOBRE O ASSISTENTE):
  * O cofre Markdown é EXCLUSIVAMENTE para conhecimento pessoal do usuário.
  * NUNCA planeje criar notas sobre o assistente, suas diretrizes, regras, estilo ou persona (ex: NUNCA crie [[Diretrizes do Copernico]]). Preferências operacionais do assistente são tratadas automaticamente pelo autoaprendizado do sistema, não pelo cofre.
- Se já existir uma nota de tarefas/lista do dia (ex: [[Lista de Tarefas - {}]]), prefira UPDATE a ela em vez de CREATE repetido.
- Se o usuário apenas conversou casualmente, testou o microfone, ou não há nada a persistir, responda estritamente: NADA_A_PERSISTIR.
- Padrão de Data: {} (Hoje é {}).

NOTAS JÁ EXISTENTES NO COFRE PADRÃO (use para preferir UPDATE quando aplicável):
{}

TRANSCRIÇÃO DO DIÁLOGO:
{}
"#,
        hoje_formatada,
        hoje_formatada,
        date_fmt,
        hoje_formatada,
        existing_titles_str,
        formatted_transcript.trim()
    );

    let plan_messages = vec![
        ChatMessage {
            role: "system".to_string(),
            content: Some("Você é o planejador de consolidação do Copernico. Gere o checklist Markdown estrito ou responda NADA_A_PERSISTIR.".to_string()),
            tool_calls: None,
            tool_call_id: None,
            tokens: None,
            reasoning_content: None,
        },
        ChatMessage {
            role: "user".to_string(),
            content: Some(planning_prompt),
            tool_calls: None,
            tool_call_id: None,
            tokens: None,
            reasoning_content: None,
        },
    ];

    println!(
        "[CONSOLIDATION] Planejando checklist de ações para sessão '{}'...",
        session_id
    );

    let plan_resp = llm
        .chat_completion_with_options(
            &plan_messages,
            None,
            crate::providers::ChatOptions {
                temperature: 0.0,
                top_p: 0.1,
                max_tokens: Some(4096),
                enable_thinking: false,
                json_mode: false,
            },
        )
        .await?;
    let raw_plan = plan_resp.content.unwrap_or_default();
    if raw_plan.trim().to_uppercase().contains("NADA_A_PERSISTIR") || raw_plan.trim().is_empty() {
        println!(
            "[CONSOLIDATION] Sessão '{}' sem conteúdo duradouro a persistir segundo planejamento.",
            session_id
        );
        mark_consolidated(&db);
        return Ok(None);
    }

    let mut checklist_lines: Vec<String> = raw_plan
        .lines()
        .filter(|l| l.trim().starts_with("- [ ]") || l.trim().starts_with("- [x]"))
        .map(|l| l.trim().to_string())
        .collect();

    if checklist_lines.is_empty() {
        checklist_lines.push(format!(
            "- [ ] EXECUTE | Motivo: Consolidar informações da sessão"
        ));
    }

    // 4. FASE 2: Prompt do curador-EXECUTOR com tools (leitura + escrita total).
    // AVISO ARQUITETURAL CENTRAL: nada foi executado durante a conversa de voz
    // (o agente em voz é estritamente só-leitura). Este consolidador é o ÚNICO
    // executor de escrita/edição/deleção do fluxo de voz.
    let consolidation_prompt = format!(
        r#"Você é o curador-executor do Copernico (Second Brain). Você roda APÓS uma conversa por voz e tem acesso total de leitura E escrita ao cofre padrão via ferramentas.

AVISO CRÍTICO — LEIA COM ATENÇÃO:
NADA foi executado durante a conversa de voz. O agente que conversou com o usuário é estritamente só-leitura: ele NÃO criou, NÃO editou e NÃO deletou nenhuma nota. Se o usuário pediu para criar/adicionar/deletar algo, ESSA TAREFA ESTÁ PENDENTE e é VOCÊ quem deve executá-la agora com as ferramentas.

PLANO DE AÇÕES APROVADO PARA EXECUÇÃO:
{}

CONTRATO DE FERRAMENTAS (use exatamente assim):
- Conteúdo NOVO e autocontido (ex: "crie uma nota sobre X") → `salvar_nota` com titulo + corpo final em Markdown (bullets, [[wikilinks]]). NUNCA coloque o pedido literal como corpo.
- FRONTEIRA DO COFRE: NUNCA crie notas sobre diretrizes, regras, persona ou conduta do assistente (ex: NUNCA crie "Diretrizes do Copernico"). O cofre Markdown é exclusivamente para o conhecimento do usuário.
- ACRÉSCIMO a algo existente (ex: "adicionar X à lista", "inclua Y na nota Z") → fluxo OBRIGATÓRIO em ordem: 1) `buscar_notas` para achar a nota alvo, 2) `ler_nota` para ver o conteúdo atual, 3) `atualizar_nota` com o identifier EXATO retornado e novo_conteudo contendo os itens finais em modo append. PROIBIDO criar nota nova para um acréscimo.
- DELEÇÃO (ex: "delete/apague a nota X") → `deletar_nota` com o identifier exato (use buscar_notas antes se precisar).
- DADOS TABULARES / MÉTRICAS (ex: treinos, calorias, peso, valores numéricos de gastos) → `registrar_metrica` com categoria, data ({}), chave e valor numérico. NUNCA registre tarefas ou to-dos como métricas (tarefas vão sempre para o corpo de notas Markdown com - [ ]).
- CONSOLIDAÇÃO EM UMA SÓ PADRÃO (ex: "concentrado em uma só", "unificar", "padrão", "espalhadas", "limpar duplicadas") → fluxo OBRIGATÓRIO: 1) `buscar_notas` + `ler_nota` em TODAS as candidatas, 2) use `consolidar_notas` com nota_padrao + fontes + corpo_final.
- RENOMEAÇÃO (ex: "nome padrão", "novo título") → `renomear_nota` com identifier + novo_titulo.
- DATA: sempre no padrão ativo: {} (Hoje é {}).

REGRAS:
- REGRA DE OURO: Execute os itens do plano de consolidação usando as ferramentas necessárias.
- DEDUP: cada fato/tarefa persiste UMA única vez.
- Ao final, responda um resumo curto do que foi executado.

Memória já existente (para não duplicar):
{}

Instruções pendentes na Inbox (não reproponha):
{}

TRANSCRIÇÃO DO DIÁLOGO:
{}
"#,
        checklist_lines.join("\n"),
        hoje_formatada,
        date_fmt,
        hoje_formatada,
        existing_memory.chars().take(600).collect::<String>(),
        pending_list.chars().take(600).collect::<String>(),
        formatted_transcript.trim()
    );

    let mut messages = vec![
        ChatMessage {
            role: "system".to_string(),
            content: Some(
                "Você é o curador-executor do Copernico. Você tem tools de leitura e escrita e deve executar o plano de consolidação da conversa de voz.".to_string(),
            ),
            tool_calls: None,
            tool_call_id: None,
            tokens: None,
            reasoning_content: None,
        },
        ChatMessage {
            role: "user".to_string(),
            content: Some(consolidation_prompt),
            tool_calls: None,
            tool_call_id: None,
            tokens: None,
            reasoning_content: None,
        },
    ];

    println!(
        "[CONSOLIDATION] Analisando sessão '{}' para curadoria no Inbox...",
        session_id
    );

    let tools = consolidation_tools(&tool_registry);
    let max_iterations = 6usize;
    let mut mutations: Vec<Mutation> = Vec::new();
    let transcript_lower = formatted_transcript.to_lowercase();
    // Rastrea notas lidas via ler_nota para autorizar limpeza pós-incorporação.
    let mut read_identifiers: std::collections::HashSet<String> = std::collections::HashSet::new();

    for iteration in 0..max_iterations {
        let is_last_iteration = iteration == max_iterations - 1;
        let current_tools = if is_last_iteration {
            messages.push(ChatMessage {
                role: "system".to_string(),
                content: Some("[AVISO DO SISTEMA]: Limite de iterações atingido. NÃO chame mais ferramentas. Responda apenas o resumo final do que foi executado (ou NADA_A_PERSISTIR).".to_string()),
                tool_calls: None,
                tool_call_id: None,
                tokens: None,
                reasoning_content: None,
            });
            None
        } else {
            Some(tools.clone())
        };

        let response_msg = llm
            .chat_completion_with_options(
                &messages,
                current_tools,
                crate::providers::ChatOptions {
                    temperature: 0.0,
                    top_p: 0.1,
                    max_tokens: Some(4096),
                    enable_thinking: false,
                    json_mode: false,
                },
            )
            .await?;
        let tool_calls = response_msg.tool_calls.clone().unwrap_or_default();
        if tool_calls.is_empty() || is_last_iteration {
            let final_text = response_msg.content.unwrap_or_default();
            if !final_text.trim().is_empty()
                && final_text.trim().to_uppercase() != "NADA_A_PERSISTIR"
            {
                println!(
                    "[CONSOLIDATION] Resumo final da sessão '{}': {}",
                    session_id,
                    final_text.trim().chars().take(200).collect::<String>()
                );
            } else {
                println!(
                    "[CONSOLIDATION] Sessão '{}' sem conteúdo duradouro a persistir.",
                    session_id
                );
            }
            break;
        }

        messages.push(response_msg);

        for tc in tool_calls {
            let name = tc.function.name.clone();
            let args_str = tc.function.arguments.clone();

            // Trava de segurança: deleção só sob pedido explícito OU intenção de
            // consolidação em nota única padrão (archive-then-delete das fontes
            // já lidas/incorporadas). Consolidação sem leitura prévia continua bloqueada.
            if name == "deletar_nota" || name == "consolidar_notas" {
                let has_delete = has_explicit_delete_intent(&transcript_lower);
                let has_consol = has_consolidation_intent(&transcript_lower);
                let args_json: serde_json::Value =
                    serde_json::from_str(&args_str).unwrap_or(serde_json::json!({}));
                let target_known = if name == "deletar_nota" {
                    let id = args_json
                        .get("identifier")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .trim()
                        .to_lowercase();
                    !id.is_empty() && (has_delete || (has_consol && read_identifiers.contains(&id)))
                } else {
                    // consolidar_notas exige consolidação OU delete explícito; fontes devem ter sido lidas.
                    let fontes: Vec<String> = args_json
                        .get("fontes")
                        .and_then(|v| v.as_array())
                        .map(|a| {
                            a.iter()
                                .filter_map(|x| x.as_str().map(|s| s.trim().to_lowercase()))
                                .collect()
                        })
                        .unwrap_or_default();
                    !fontes.is_empty()
                        && (has_delete || has_consol)
                        && fontes.iter().all(|f| read_identifiers.contains(f))
                };
                if !target_known {
                    eprintln!(
                        "[CONSOLIDATION] Deleção/consolidação bloqueada (sem pedido explícito ou sem leitura prévia): {}",
                        args_str.chars().take(160).collect::<String>()
                    );
                    messages.push(ChatMessage {
                        role: "tool".to_string(),
                        content: Some(
                            serde_json::json!({
                                "erro": "Deleção/consolidação bloqueada: use buscar_notas + ler_nota antes, e só delete com pedido explícito de deletar OU pedido de concentrar/unificar em uma só padrão. Não tente novamente sem cumprir o fluxo.",
                                "resumo": "Tentativa de deleção/consolidação sem pedido ou sem leitura prévia foi bloqueada."
                            })
                            .to_string(),
                        ),
                        tool_calls: None,
                        tool_call_id: Some(tc.id),
                        tokens: None,
                        reasoning_content: None,
                    });
                    continue;
                }
            }

            let result = tool_registry.execute(&name, &args_str);
            println!(
                "[CONSOLIDATION] Tool '{}' executada (sessão '{}')",
                name, session_id
            );
            // Se foi leitura, marca identifier como lido para autorizar limpeza posterior.
            if name == "ler_nota" {
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&result) {
                    if val.get("erro").is_none() {
                        if let Ok(aj) = serde_json::from_str::<serde_json::Value>(&args_str) {
                            if let Some(id) = aj.get("identifier").and_then(|v| v.as_str()) {
                                let norm = id.trim().to_lowercase();
                                if !norm.is_empty() {
                                    read_identifiers.insert(norm.clone());
                                    // Também indexa título/path retornados, para casar com deletes por título.
                                    if let Some(t) = val.get("titulo").and_then(|v| v.as_str()) {
                                        read_identifiers.insert(t.trim().to_lowercase());
                                    }
                                    if let Some(p) = val.get("path").and_then(|v| v.as_str()) {
                                        read_identifiers.insert(p.trim().to_lowercase());
                                        if let Some(stem) = std::path::Path::new(p)
                                            .file_stem()
                                            .and_then(|s| s.to_str())
                                        {
                                            read_identifiers.insert(stem.trim().to_lowercase());
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            messages.push(ChatMessage {
                role: "tool".to_string(),
                content: Some(result.clone()),
                tool_calls: None,
                tool_call_id: Some(tc.id),
                tokens: None,
                reasoning_content: None,
            });

            // Registra mutações bem-sucedidas para espelhar na Inbox e marcar checklist
            if matches!(
                name.as_str(),
                "salvar_nota"
                    | "atualizar_nota"
                    | "deletar_nota"
                    | "renomear_nota"
                    | "consolidar_notas"
                    | "registrar_metrica"
                    | "propor_evolucao_nota"
            ) {
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&result) {
                    let is_ok = val.get("ok").and_then(|b| b.as_bool()).unwrap_or(false)
                        || val
                            .get("sucesso")
                            .and_then(|b| b.as_bool())
                            .unwrap_or(false);
                    if is_ok {
                        let args_json: serde_json::Value =
                            serde_json::from_str(&args_str).unwrap_or(serde_json::json!({}));
                        let (kind, title) = match name.as_str() {
                            "salvar_nota" => {
                                let t = args_json
                                    .get("titulo")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("Nota")
                                    .to_string();
                                for l in checklist_lines.iter_mut() {
                                    if l.starts_with("- [ ]")
                                        && (l.contains("CREATE") || l.contains(&t))
                                    {
                                        *l = l.replacen("- [ ]", "- [x]", 1);
                                        break;
                                    }
                                }
                                ("created", t)
                            }
                            "atualizar_nota" => {
                                let t = args_json
                                    .get("identifier")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("Nota")
                                    .to_string();
                                for l in checklist_lines.iter_mut() {
                                    if l.starts_with("- [ ]")
                                        && (l.contains("UPDATE") || l.contains(&t))
                                    {
                                        *l = l.replacen("- [ ]", "- [x]", 1);
                                        break;
                                    }
                                }
                                ("updated", t)
                            }
                            "renomear_nota" => {
                                let t = format!(
                                    "{} → {}",
                                    args_json
                                        .get("identifier")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("Nota"),
                                    args_json
                                        .get("novo_titulo")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("?")
                                );
                                for l in checklist_lines.iter_mut() {
                                    if l.starts_with("- [ ]")
                                        && (l.contains("RENAME") || l.contains("UPDATE"))
                                    {
                                        *l = l.replacen("- [ ]", "- [x]", 1);
                                        break;
                                    }
                                }
                                ("renamed", t)
                            }
                            "consolidar_notas" => {
                                let t = args_json
                                    .get("nota_padrao")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("Nota padrão")
                                    .to_string();
                                for l in checklist_lines.iter_mut() {
                                    if l.starts_with("- [ ]") {
                                        *l = l.replacen("- [ ]", "- [x]", 1);
                                        break;
                                    }
                                }
                                ("consolidated", t)
                            }
                            "registrar_metrica" => {
                                let cat = args_json
                                    .get("categoria")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("metrica");
                                let ch = args_json
                                    .get("chave")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("dado");
                                let t = format!("{}:{}", cat, ch);
                                for l in checklist_lines.iter_mut() {
                                    if l.starts_with("- [ ]")
                                        && (l.contains("RECORD_DATA")
                                            || l.contains(ch)
                                            || l.contains(cat))
                                    {
                                        *l = l.replacen("- [ ]", "- [x]", 1);
                                        break;
                                    }
                                }
                                ("metric", t)
                            }
                            "propor_evolucao_nota" => {
                                let t = args_json
                                    .get("identifier")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("Nota")
                                    .to_string();
                                for l in checklist_lines.iter_mut() {
                                    if l.starts_with("- [ ]")
                                        && (l.contains("UPDATE") || l.contains(&t))
                                    {
                                        *l = l.replacen("- [ ]", "- [x]", 1);
                                        break;
                                    }
                                }
                                ("updated", t)
                            }
                            _ => {
                                let t = args_json
                                    .get("identifier")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("Nota")
                                    .to_string();
                                for l in checklist_lines.iter_mut() {
                                    if l.starts_with("- [ ]")
                                        && (l.contains("DELETE") || l.contains(&t))
                                    {
                                        *l = l.replacen("- [ ]", "- [x]", 1);
                                        break;
                                    }
                                }
                                ("deleted", t)
                            }
                        };
                        let detail = val
                            .get("resumo")
                            .and_then(|v| v.as_str())
                            .unwrap_or("Operação concluída.")
                            .to_string();
                        let path = val
                            .get("path")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        mutations.push(Mutation {
                            kind,
                            title,
                            detail: if path.is_empty() {
                                detail
                            } else {
                                format!("{} Arquivo: {}", detail, path)
                            },
                        });
                    }
                }
            }
        }
    }

    let finalized_checklist = format!(
        "### Plano de Consolidação\n{}\n",
        checklist_lines.join("\n")
    );

    // Grava o checklist de consolidação no histórico da sessão
    let _ = db.add_message(session_id, "assistant", &finalized_checklist, None, None);

    let mut consolidated_titles = Vec::new();

    // Registra os títulos das mutações executadas para o espelho do chat (sem poluir a Inbox com notificações unitárias)
    for m in &mutations {
        let hoje = crate::vault::hoje_ddmmyy();
        let item_title = match m.kind {
            "updated" => format!("Atualizada: {} [{}]", m.title, hoje),
            "deleted" => format!("Deletada (arquivada): {} [{}]", m.title, hoje),
            "renamed" => format!("Renomeada: {} [{}]", m.title, hoje),
            "consolidated" => format!("Consolidada: {} [{}]", m.title, hoje),
            "metric" => format!("Métrica Registrada: {} [{}]", m.title, hoje),
            _ => format!("{} [{}]", m.title, hoje),
        };
        consolidated_titles.push(item_title);
    }

    // Fallbacks determinísticos (rede de segurança caso o loop com tools não persista nada)
    if mutations.is_empty() {
        let lower = formatted_transcript.to_lowercase();
        let has_explicit = has_explicit_create_intent(&lower);
        let has_append = has_explicit_append_intent(&lower);
        if has_append {
            // Pedido de ACRÉSCIMO não executado: NÃO cria nota órfã nova (esse era o bug).
            // Registra pendência para decisão manual, sem perder o pedido.
            let user_content: String = user_msgs
                .iter()
                .map(|m| m.content.as_str())
                .collect::<Vec<_>>()
                .join(" \n");
            let pending_title = format!(
                "Pendente: adicionar a nota existente ({})",
                crate::vault::agora_ddmmyy_hm()
            );
            let pending_body = format!(
                "O pedido abaixo era um ACRÉSCIMO a uma nota existente, mas a consolidação automática não conseguiu identificar/atualizar a nota alvo. Revise e aplique manualmente (ou peça ao chat com o nome exato da nota):\n\n{}",
                user_content.trim()
            );
            if db
                .create_inbox_item(
                    Some(session_id),
                    &pending_title,
                    Some(&pending_body.chars().take(180).collect::<String>()),
                    &pending_body,
                    "voice_consolidation",
                    true,
                )
                .is_ok()
            {
                println!(
                    "[CONSOLIDATION] Fallback registrou pendência de acréscimo (sem nota órfã): {}",
                    pending_title
                );
                if let Some(ref app) = app_handle {
                    let unread_count = db.get_unread_inbox_count().unwrap_or(0);
                    let _ = app.emit(
                        "inbox-updated",
                        serde_json::json!({"unread_count": unread_count}),
                    );
                }
                consolidated_titles.push(pending_title);
            }
        } else if has_explicit {
            let user_content: String = user_msgs
                .iter()
                .map(|m| m.content.as_str())
                .collect::<Vec<_>>()
                .join(" \n");
            let fallback_body = format!(
                "Pedido explícito do usuário (sem LLM):\n\n{}",
                user_content.trim()
            );
            let fallback_title = format!("Nota de Voz {}", crate::vault::agora_ddmmyy_hm());
            if let Ok(path) = vault.create_inbox_note(
                &fallback_title,
                &fallback_body,
                Some(vec![
                    "inbox".to_string(),
                    "consolidacao-voz".to_string(),
                    "fallback".to_string(),
                ]),
                Some(vec!["Voz".to_string()]),
            ) {
                let _ = indexer.index_single_note(&path, "default");
                let summary = fallback_body.chars().take(180).collect::<String>();
                let _ = db.create_inbox_item(
                    Some(session_id),
                    &fallback_title,
                    Some(&summary),
                    &fallback_body,
                    "voice_consolidation",
                    false,
                );
                consolidated_titles.push(fallback_title.clone());
                println!(
                    "[CONSOLIDATION] Fallback determinístico criou nota para pedido explícito: {}",
                    fallback_title
                );
                if let Some(ref app) = app_handle {
                    let unread_count = db.get_unread_inbox_count().unwrap_or(0);
                    let _ = app.emit(
                        "inbox-updated",
                        serde_json::json!({"unread_count": unread_count}),
                    );
                }
            }
        }
    }

    // Espelho no chat: torna a consolidação visível na sessão + ciente ao agente no próximo turno.
    // Sem isso o chat não mostra de onde vieram as ações do Inbox e o AgentCore não vê as mutações.
    if !consolidated_titles.is_empty() {
        let mirror = format!(
            "✅ Consolidei dessa conversa: {}. Veja os detalhes na Inbox.",
            consolidated_titles
                .join("; ")
                .chars()
                .take(600)
                .collect::<String>()
        );
        let should_insert = db
            .get_messages(session_id)
            .ok()
            .and_then(|msgs| msgs.iter().rev().find(|m| m.role == "assistant").cloned())
            .map(|last| last.content.trim() != mirror.trim())
            .unwrap_or(true);
        if should_insert {
            if db
                .add_message(session_id, "assistant", &mirror, None, None)
                .is_ok()
            {
                println!(
                    "[CONSOLIDATION] Espelho registrado no chat da sessão '{}'.",
                    session_id
                );
                if let Some(ref app) = app_handle {
                    crate::commands::emit_chat_and_inbox(app, &db, session_id);
                }
            }
        }
    }

    // Executa análise de autoaprendizado e reflexão de diretrizes (sempre, mesmo se não houve nota)
    let _ = analyze_operational_learnings(session_id, app_handle.clone(), db.clone(), llm.clone())
        .await;
    mark_consolidated(&db);

    Ok(if consolidated_titles.is_empty() {
        None
    } else {
        Some(consolidated_titles.join(", "))
    })
}

/// Analisa o diálogo recente da sessão para detectar correções do usuário, atritos ou falhas operacionais
/// e propor proativamente melhorias de diretrizes e regras próprias na Inbox com Diff.
pub async fn analyze_operational_learnings(
    session_id: &str,
    app_handle: Option<AppHandle>,
    db: SharedDatabase,
    llm: Arc<dyn LlmProvider>,
) -> Result<Option<String>, Box<dyn std::error::Error + Send + Sync>> {
    let messages = db.get_messages(session_id)?;
    let conversation_turns: Vec<_> = messages
        .iter()
        .filter(|m| m.role == "user" || m.role == "assistant")
        .collect();

    // Requer pelo menos 1 mensagem de usuário (antes era 2, bloqueava preferência de 1 turno)
    let user_msgs_count = conversation_turns
        .iter()
        .filter(|m| m.role == "user")
        .count();
    if user_msgs_count < 1 {
        return Ok(None);
    }

    let mut formatted_transcript = String::new();
    let mut prev_content = "";
    for msg in &conversation_turns {
        let trimmed = msg.content.trim();
        if trimmed == prev_content && !trimmed.is_empty() {
            continue;
        }
        prev_content = trimmed;
        let role_label = if msg.role == "user" {
            "Usuário"
        } else {
            "Copernico"
        };
        formatted_transcript.push_str(&format!("{}: {}\n\n", role_label, trimmed));
    }

    let existing_memory = db
        .get_setting("agent_custom_instructions")
        .ok()
        .flatten()
        .unwrap_or_default();
    let all_instruction_items = db
        .list_inbox_items()
        .unwrap_or_default()
        .into_iter()
        .filter(|i| i.item_type == "instruction_improvement")
        .collect::<Vec<_>>();
    let pending_instructions: Vec<String> = all_instruction_items
        .iter()
        .filter(|i| i.status == "unread" || i.status == "pending")
        .filter_map(|i| i.proposed_content.clone())
        .collect();
    let applied_instructions: Vec<String> = all_instruction_items
        .iter()
        .filter(|i| i.status == "applied")
        .filter_map(|i| i.proposed_content.clone())
        .collect();
    let dismissed_instructions: Vec<String> = all_instruction_items
        .iter()
        .filter(|i| i.status == "dismissed")
        .filter_map(|i| i.proposed_content.clone())
        .collect();
    let pending_str = if pending_instructions.is_empty() {
        "Nenhuma pendente.".to_string()
    } else {
        pending_instructions
            .iter()
            .map(|s| format!("- {}", s.trim()))
            .collect::<Vec<_>>()
            .join("\n")
    };
    let applied_str = if applied_instructions.is_empty() {
        "Nenhuma.".to_string()
    } else {
        applied_instructions
            .iter()
            .map(|s| format!("- {}", s.trim()))
            .collect::<Vec<_>>()
            .join("\n")
    };

    let prompt = format!(
        r#"Você é o módulo de autoaprendizado e meta-reflexão do Copernico (Second Brain).
Analise o diálogo abaixo e verifique se houve alguma situação onde:
1. O assistente errou, se confundiu ou falhou numa busca/resposta e precisou ser corrigido pelo usuário.
2. O usuário expressou uma preferência operacional clara sobre como quer que o assistente busque, organize ou responda (ex: formato de datas numéricas DD-MM-YY em vez de por extenso, termos específicos, critérios de busca, não chamar pelo nome toda hora).
3. Houve atrito que pode ser prevenido no futuro através de uma nova diretriz clara nas instruções do assistente.

ATENÇÃO DEDUP: Uma mesma preferência só deve gerar UMA diretriz, mesmo citada N vezes. Verifique abaixo se já existe.

RESTRIÇÃO ARQUITETURAL INEGOCIÁVEL: Em modo voz o agente NUNCA cria/edita notas durante a fala; a criação é EXCLUSIVA do consolidador pós-sessão. NUNCA proponha regra pedindo para "criar notas conforme fala", "anotar durante a conversa/fala", "salvar em tempo real por voz", "criar notas enquanto fala" ou similar. Se identificar pedido de anotação, a regra correta é sobre o consolidador registrar após a sessão, nunca durante.

Se NÃO houver nenhuma situação de erro, correção ou aprendizado prático, ou se a preferência já existe nas listas abaixo:
Responda APENAS a palavra:
NENHUM

Se HOUVER uma oportunidade clara de melhoria para o assistente e NÃO for duplicata:
Responda EXCLUSIVAMENTE um objeto JSON válido (sem blocos markdown adicionais, sem preâmbulos) no seguinte formato:
{{
  "titulo": "Título curto da diretriz",
  "justificativa": "Explicação do que aconteceu no diálogo e por que esta regra deve ser adotada",
  "regra": "Texto exato da nova regra a ser adicionada às instruções do assistente"
}}

Memória já existente e diretrizes já aplicadas (não reproponha igual):
{}
Diretrizes já aceitas na Inbox:
{}

Instruções pendentes na Inbox (não reproponha):
{}

DIÁLOGO:
{}
"#,
        existing_memory.chars().take(800).collect::<String>(),
        applied_str.chars().take(800).collect::<String>(),
        pending_str.chars().take(800).collect::<String>(),
        formatted_transcript.trim()
    );

    let chat_input = vec![
        ChatMessage {
            role: "system".to_string(),
            content: Some(
                "Você é um avaliador de diretrizes de IA. Responda 'NENHUM' ou um JSON estrito."
                    .to_string(),
            ),
            tool_calls: None,
            tool_call_id: None,
            tokens: None,
            reasoning_content: None,
        },
        ChatMessage {
            role: "user".to_string(),
            content: Some(prompt),
            tool_calls: None,
            tool_call_id: None,
            tokens: None,
            reasoning_content: None,
        },
    ];

    let resp = llm
        .chat_completion_with_options(
            &chat_input,
            None,
            crate::providers::ChatOptions {
                temperature: 0.0,
                top_p: 0.1,
                max_tokens: Some(4096),
                enable_thinking: false,
                json_mode: false,
            },
        )
        .await?;
    let raw = resp.content.unwrap_or_default();
    let trimmed = raw.trim();

    if trimmed.is_empty()
        || trimmed.eq_ignore_ascii_case("NENHUM")
        || (trimmed.contains("NENHUM") && !trimmed.contains('{'))
    {
        return Ok(None);
    }

    let json_str = if let Some(start) = trimmed.find('{') {
        if let Some(end) = trimmed.rfind('}') {
            &trimmed[start..=end]
        } else {
            trimmed
        }
    } else {
        trimmed
    };

    if let Ok(val) = serde_json::from_str::<serde_json::Value>(json_str) {
        if let (Some(titulo), Some(justificativa), Some(regra)) = (
            val.get("titulo").and_then(|v| v.as_str()),
            val.get("justificativa").and_then(|v| v.as_str()),
            val.get("regra").and_then(|v| v.as_str()),
        ) {
            if !regra.trim().is_empty() {
                // Filtro arquitetural: rejeita regra que peça criação durante a fala (contradiz modo voz só-consulta)
                let regra_low = regra.trim().to_lowercase();
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
                .any(|pat| regra_low.contains(pat));
                if pede_criacao_em_voz {
                    println!("[AUTOAPRENDIZADO] Diretriz rejeitada (pede criação durante a fala, arquitetura proíbe): '{}'", titulo);
                    return Ok(None);
                }
                // Dedup em código: verifica se regra já existe em memória ou pendente (evita duplicata mesmo se LLM ignorar prompt)
                // + rejeitadas (dismissed): nunca repropor — decisão do usuário é final.
                let normalized_regra = regra.trim().to_lowercase();
                let fuzzy_match = |list: &[String]| {
                    list.iter().any(|p| {
                        let p_lower = p.to_lowercase();
                        if p_lower.contains(&normalized_regra)
                            || normalized_regra.contains(&p_lower)
                        {
                            return true;
                        }
                        let a: std::collections::HashSet<&str> =
                            normalized_regra.split_whitespace().collect();
                        let b: std::collections::HashSet<&str> =
                            p_lower.split_whitespace().collect();
                        let inter = a.intersection(&b).count();
                        let union = a.len() + b.len() - inter;
                        union > 0 && (inter as f32 / union as f32) > 0.85
                    })
                };
                let is_duplicate = existing_memory.to_lowercase().contains(&normalized_regra)
                    || fuzzy_match(&pending_instructions)
                    || fuzzy_match(&applied_instructions)
                    || all_instruction_items
                        .iter()
                        .any(|i| i.title.trim().eq_ignore_ascii_case(titulo.trim()));
                if is_duplicate {
                    println!("[AUTOAPRENDIZADO] Diretriz duplicada ignorada (já existente/aplicada/pendente): '{}'", titulo);
                    return Ok(None);
                }
                if fuzzy_match(&dismissed_instructions) {
                    println!("[AUTOAPRENDIZADO] Diretriz rejeitada pelo usuário (dismissed), não repropor: '{}'", titulo);
                    return Ok(None);
                }
                let existing = db
                    .get_setting("agent_custom_instructions")
                    .ok()
                    .flatten()
                    .unwrap_or_default();
                let diff = serde_json::json!({
                    "before": existing,
                    "to_add": regra.trim(),
                })
                .to_string();

                let item = db.create_inbox_item_full(
                    Some(session_id),
                    titulo.trim(),
                    Some(justificativa.trim()),
                    &format!(
                        "**Justificativa do Aprendizado:**\n{}\n\n**Nova Diretriz Sugerida:**\n{}",
                        justificativa.trim(),
                        regra.trim()
                    ),
                    "instruction_improvement",
                    true,
                    None,
                    Some(regra.trim()),
                    Some(&diff),
                )?;

                if let Some(ref app) = app_handle {
                    let unread_count = db.get_unread_inbox_count().unwrap_or(0);
                    let _ = app.emit(
                        "inbox-updated",
                        serde_json::json!({
                            "unread_count": unread_count,
                            "item": item,
                        }),
                    );
                }

                println!(
                    "[AUTOAPRENDIZADO] Nova sugestão de diretriz criada na Inbox: '{}'",
                    titulo
                );
                return Ok(Some(titulo.to_string()));
            }
        }
    }

    Ok(None)
}
