use crate::db::Database;
use crate::indexer::Indexer;
use crate::llm::{
    strip_markdown_for_tts, ChatMessage, ToolCall, DEFAULT_VOICE_SYSTEM_PROMPT, SYSTEM_PROMPT,
};
use crate::providers::LlmProvider;
use crate::tool_registry::ToolRegistry;
use crate::vault::VaultManager;
use std::sync::{Arc, RwLock};
use tauri::AppHandle;
use tokio::task;

pub struct AgentCore {
    llm: Arc<dyn LlmProvider>,
    tool_registry: Arc<ToolRegistry>,
    db: Arc<Database>,
    #[allow(dead_code)]
    vault: Arc<VaultManager>,
    #[allow(dead_code)]
    indexer: Arc<Indexer>,
    app_handle: Arc<RwLock<Option<AppHandle>>>,
}

impl AgentCore {
    pub fn new(
        llm: Arc<dyn LlmProvider>,
        tool_registry: Arc<ToolRegistry>,
        db: Arc<Database>,
        vault: Arc<VaultManager>,
        indexer: Arc<Indexer>,
    ) -> Self {
        Self {
            llm,
            tool_registry,
            db,
            vault,
            indexer,
            app_handle: Arc::new(RwLock::new(None)),
        }
    }

    pub fn set_app_handle(&self, handle: AppHandle) {
        let mut app_opt = self.app_handle.write().unwrap();
        *app_opt = Some(handle);
    }

    pub fn execute_tool(&self, name: &str, args_json: &str) -> String {
        self.tool_registry.execute(name, args_json)
    }

    /// Retorna referência ao ToolRegistry
    pub fn tool_registry(&self) -> Arc<ToolRegistry> {
        self.tool_registry.clone()
    }

    pub fn llm(&self) -> Arc<dyn LlmProvider> {
        self.llm.clone()
    }

    pub fn vault(&self) -> Arc<VaultManager> {
        self.vault.clone()
    }

    pub fn indexer(&self) -> Arc<Indexer> {
        self.indexer.clone()
    }

    /// Executa turno normal do chat (compatível com chamadas existentes)
    pub async fn chat(
        &self,
        session_id: &str,
        user_input: &str,
        origin: &str, // "text" ou "voice"
        overlay_visible: bool,
    ) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
        self.chat_with_options(
            session_id,
            user_input,
            origin,
            overlay_visible,
            None,
            None,
            None,
        )
        .await
    }

    /// Executa turno com overrides de prompt, limite de iterações e restrição de ferramentas (para Skills)
    #[allow(clippy::too_many_arguments)]
    pub async fn chat_with_options(
        &self,
        session_id: &str,
        user_input: &str,
        origin: &str, // "text" ou "voice"
        overlay_visible: bool,
        system_prompt_override: Option<&str>,
        max_iterations_override: Option<usize>,
        allowed_tools: Option<&[String]>,
    ) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
        let trimmed_input = user_input.trim();
        if trimmed_input.is_empty() {
            return Err("Mensagem não pode ser vazia".into());
        }

        // Resolução dinâmica de skills instaladas e ativas
        let skill_mgr =
            crate::skills::SkillManager::new(self.tool_registry.skills_dir().to_path_buf());
        let all_skills = skill_mgr.list_skills(&self.db);

        // Suporte inteligente a comando de barra /skill <id> <mensagem>
        let mut active_skill_info: Option<crate::skills::SkillInfo> = None;
        let mut clean_user_input = trimmed_input.to_string();

        if trimmed_input.starts_with("/skill ") || trimmed_input.starts_with("/skills ") {
            let prefix_len = if trimmed_input.starts_with("/skill ") {
                7
            } else {
                8
            };
            let after_cmd = trimmed_input[prefix_len..].trim();
            let after_cmd_lower = after_cmd.to_lowercase();

            // Tenta casar com qualquer skill instalada (por id, id com espaços, ou nome)
            for s in &all_skills {
                let id_exact = s.id.to_lowercase();
                let id_spaced = s.id.replace('-', " ").to_lowercase();
                let id_underscored = s.id.replace('-', "_").to_lowercase();
                let name_lower = s.name.to_lowercase();

                let mut matched_len = 0;
                if after_cmd_lower.starts_with(&id_exact) {
                    matched_len = id_exact.len();
                } else if after_cmd_lower.starts_with(&id_spaced) {
                    matched_len = id_spaced.len();
                } else if after_cmd_lower.starts_with(&id_underscored) {
                    matched_len = id_underscored.len();
                } else if after_cmd_lower.starts_with(&name_lower) {
                    matched_len = name_lower.len();
                }

                if matched_len > 0 {
                    active_skill_info = Some(s.clone());
                    let remainder = after_cmd[matched_len..].trim();
                    if !remainder.is_empty() {
                        clean_user_input = remainder.to_string();
                    } else {
                        clean_user_input =
                            format!("Ative a skill '{}' e apresente suas capacidades.", s.name);
                    }
                    break;
                }
            }

            // Fallback: se não casou pelo início completo, testa a primeira palavra
            if active_skill_info.is_none() {
                let first_word = after_cmd.split_whitespace().next().unwrap_or("").trim();
                if let Some(s) = all_skills
                    .iter()
                    .find(|s| s.id.eq_ignore_ascii_case(first_word))
                {
                    active_skill_info = Some(s.clone());
                    let remainder = after_cmd[first_word.len()..].trim();
                    if !remainder.is_empty() {
                        clean_user_input = remainder.to_string();
                    } else {
                        clean_user_input =
                            format!("Ative a skill '{}' e apresente suas capacidades.", s.name);
                    }
                }
            }
        }

        // Persona Adaptativa e System Prompt Dinâmico (ou override de Skill)
        let mut base_system = if let Some(custom) = system_prompt_override {
            custom.to_string()
        } else if overlay_visible {
            let custom_sys = self.db.get_setting("system_prompt").ok().flatten();
            custom_sys.unwrap_or_else(|| SYSTEM_PROMPT.to_string())
        } else {
            let custom_voice = self.db.get_setting("voice_system_prompt").ok().flatten();
            custom_voice.unwrap_or_else(|| DEFAULT_VOICE_SYSTEM_PROMPT.to_string())
        };

        // Injeta instruções da skill explicitamente ativada
        if let Some(ref skill_info) = active_skill_info {
            base_system.push_str(&format!(
                "\n\n[COMANDO DO USUÁRIO: ATIVAR SKILL '{}' ({})]\nVocê DEVE atender à solicitação do usuário utilizando prioritariamente esta skill.\nInstruções da Skill:\n{}\n",
                skill_info.name, skill_info.id, skill_info.prompt_instructions
            ));
        }

        // Injeta resumo das skills ativas e habilitadas no sistema (com metadados de scripts para tool calling preciso)
        let mut enabled_skills_summary = String::new();
        for s in &all_skills {
            if s.is_enabled {
                let scripts_hint = if s.has_scripts && !s.script_files.is_empty() {
                    format!(" [scripts: {}] -> use executar_script_skill(skill_id=\"{}\", script=\"{}\", argumentos=[...])", s.script_files.join(", "), s.id, s.script_files[0])
                } else if s.has_scripts {
                    format!(" [Python Local] -> use executar_script_skill(skill_id=\"{}\", script=\"<nome>.py\")", s.id)
                } else {
                    " [Cognitiva] -> instruções em português, sem script, responda usando buscar_notas/ler_nota".to_string()
                };
                enabled_skills_summary.push_str(&format!(
                    "- Skill '{}' (id: '{}'): {}{}\n",
                    s.name, s.id, s.description, scripts_hint
                ));
            }
        }
        if !enabled_skills_summary.is_empty() {
            base_system.push_str(&format!(
                "\n\n[EXTENSÕES & SKILLS HABILITADAS NO SISTEMA]\nVocê tem acesso às seguintes skills ativas para resolver tarefas além dos cofres locais:\n{}\nREGRAS DE USO:\n- Para skills com scripts, invoque EXATAMENTE `executar_script_skill` com skill_id e script listados acima.\n- Para skill 'web-search' use script 'search.py' com a query como argumento.\n- Para skills cognitivas, siga as instruções do SKILL.md já injetadas quando ativada via /skill.\n- NUNCA diga que não tem acesso à web ou que só pode ler os cofres locais! Use a ferramenta correspondente.\n",
                enabled_skills_summary
            ));
        }

        let effective_system = build_personalized_system_prompt(&self.db, &base_system);

        // Carrega histórico existente
        let raw_messages = self.db.get_messages(session_id)?;

        let mut messages: Vec<ChatMessage> = Vec::new();
        messages.push(ChatMessage {
            role: "system".to_string(),
            content: Some(effective_system),
            tool_calls: None,
            tool_call_id: None,
            tokens: None,
            reasoning_content: None,
        });

        // Contexto anti-repetição: se acabou de tocar uma saudação (<120s), informa ao modelo para não repetir
        if origin == "voice" {
            if let (Some(greet_text), Some(greet_at)) = (
                self.db.get_setting("last_greeting_text").ok().flatten(),
                self.db.get_setting("last_greeting_at").ok().flatten(),
            ) {
                let fresh = parse_rfc3339_local(&greet_at)
                    .map(|t| (chrono::Local::now() - t).num_seconds() < 120)
                    .unwrap_or(false);
                if fresh && !greet_text.trim().is_empty() {
                    messages.push(ChatMessage {
                        role: "system".to_string(),
                        content: Some(format!(
                            "Você acabou de cumprimentar o usuário com: '{}'. Não repita a saudação, continue naturalmente e sem monotonidade.",
                            greet_text.trim().chars().take(200).collect::<String>()
                        )),
                        tool_calls: None,
                        tool_call_id: None,
                        tokens: None,
                        reasoning_content: None,
                    });
                }
            }
        }

        // Decisões do Inbox da sessão: aprovado/rejeitado/adiado com motivo.
        // Sem isso o agente alega que criou o que foi rejeitado.
        if let Some(decisions_block) = build_inbox_decisions_block(&self.db, session_id) {
            messages.push(ChatMessage {
                role: "system".to_string(),
                content: Some(decisions_block),
                tool_calls: None,
                tool_call_id: None,
                tokens: None,
                reasoning_content: None,
            });
        }

        for m in raw_messages {
            let tc: Option<Vec<ToolCall>> = m
                .tool_calls
                .as_deref()
                .and_then(|s| serde_json::from_str(s).ok());

            // Se houver mensagens consecutivas do mesmo papel ("user") por turnos anteriores abortados,
            // concatena para manter estrita alternância requerida pelo modelo
            if let Some(last) = messages.last_mut() {
                if last.role == "user"
                    && m.role == "user"
                    && tc.is_none()
                    && last.tool_calls.is_none()
                {
                    if let Some(prev) = &mut last.content {
                        prev.push('\n');
                        prev.push_str(&m.content);
                        continue;
                    }
                }
            }

            messages.push(ChatMessage {
                role: m.role,
                content: Some(m.content),
                tool_calls: tc,
                tool_call_id: m.tool_call_id,
                tokens: m.tokens,
                reasoning_content: None,
            });
        }

        // Persiste a mensagem bruta do usuário no banco
        let user_tokens = Some((clean_user_input.len() as i64 / 4).max(1));
        self.db.add_message_with_meta(
            session_id,
            "user",
            trimmed_input,
            None,
            None,
            user_tokens,
            None,
        )?;

        // Se a última mensagem for "user" (turno anterior que falhou antes da resposta),
        // concatena o texto para o LLM não receber mensagens consecutivas do mesmo papel
        let mut coalesced = false;
        if let Some(last) = messages.last_mut() {
            if last.role == "user" && last.tool_calls.is_none() {
                if let Some(prev) = &mut last.content {
                    prev.push('\n');
                    prev.push_str(&clean_user_input);
                    coalesced = true;
                }
            }
        }
        if !coalesced {
            messages.push(ChatMessage {
                role: "user".to_string(),
                content: Some(clean_user_input),
                tool_calls: None,
                tool_call_id: None,
                tokens: user_tokens,
                reasoning_content: None,
            });
        }

        // Obtém ferramentas mescladas (Built-in + MCP) ou filtradas por skill/modo
        let tools = if origin == "voice" {
            // No modo de voz (overlay fechado): baixa latência, só consulta e interação natural por áudio.
            // Permitido: busca/leitura, skills de leitura/visão (ex: screen-capture via executar_script_skill),
            // administração do board kanban (criar/mover tarefa e hábito — escreve só no SQLite do board, nunca no cofre),
            // e encerrar.
            // Perguntas e confirmações em modo de voz são feitas diretamente na fala conversacional, sem poluir a Inbox.
            // PROIBIDO: criar/atualizar/deletar notas, propor_melhoria_instrucao ou qualquer escrita no cofre.
            // Se o usuário pedir para anotar/guardar, NÃO diga "não posso"; diga "vou anotar logo após nossa conversa" — o consolidador fará.
            Some(self.tool_registry.get_filtered_definitions(&[
                "buscar_notas".to_string(),
                "ler_nota".to_string(),
                "executar_script_skill".to_string(),
                "criar_tarefa".to_string(),
                "mover_tarefa".to_string(),
                "criar_habito".to_string(),
                "encerrar_sessao".to_string(),
            ]))
        } else if let Some(allowed) = allowed_tools {
            Some(self.tool_registry.get_filtered_definitions(allowed))
        } else {
            Some(self.tool_registry.get_merged_definitions())
        };

        let max_iterations = max_iterations_override.unwrap_or(6);

        for iteration in 0..max_iterations {
            let is_last_iteration = iteration == max_iterations - 1;

            // Se for a última iteração, omitimos ferramentas e instruímos o modelo a sintetizar
            // para que ele gere uma resposta final conclusiva em vez de ficar em loop infinito
            let current_tools = if is_last_iteration {
                messages.push(ChatMessage {
                    role: "system".to_string(),
                    content: Some("[AVISO DO SISTEMA]: Limite de iterações atingido. NÃO chame nenhuma ferramenta adicional. Sintetize imediatamente suas descobertas, compile o relatório final com os dados coletados até o momento e forneça sua conclusão estruturada.".to_string()),
                    tool_calls: None,
                    tool_call_id: None,
                    tokens: None,
                    reasoning_content: None,
                });
                None
            } else {
                tools.clone()
            };

            let chat_options = if origin == "voice" {
                crate::providers::ChatOptions {
                    temperature: 0.4,
                    top_p: 0.9,
                    max_tokens: Some(4096),
                    enable_thinking: false,
                    json_mode: false,
                }
            } else {
                crate::providers::ChatOptions {
                    temperature: 0.5,
                    top_p: 0.95,
                    max_tokens: Some(4096),
                    enable_thinking: false,
                    json_mode: false,
                }
            };

            let response_msg = self
                .llm
                .chat_completion_with_options(&messages, current_tools, chat_options)
                .await?;

            if let Some(tool_calls) = response_msg.tool_calls.clone() {
                if !tool_calls.is_empty() && !is_last_iteration {
                    // Persiste a mensagem do assistente com as intenções de tool_call
                    let tc_json = serde_json::to_string(&tool_calls).ok();
                    let content_text = response_msg.content.clone().unwrap_or_default();
                    self.db.add_message(
                        session_id,
                        "assistant",
                        &content_text,
                        None,
                        tc_json.as_deref(),
                    )?;

                    messages.push(response_msg);

                    let mut session_ended = false;
                    let mut session_end_farewell: Option<String> = None;

                    // Executa cada ferramenta via ToolRegistry
                    for tc in tool_calls {
                        if tc.function.name == "encerrar_sessao" {
                            session_ended = true;
                            if let Ok(parsed) =
                                serde_json::from_str::<serde_json::Value>(&tc.function.arguments)
                            {
                                if let Some(m) = parsed.get("motivo").and_then(|v| v.as_str()) {
                                    if !m.trim().is_empty() {
                                        session_end_farewell = Some(m.to_string());
                                    }
                                }
                            }
                        }

                        if let Some(ref app) = *self.app_handle.read().unwrap() {
                            use tauri::Emitter;
                            let _ = app.emit(
                                "skill-progress",
                                serde_json::json!({
                                    "session_id": session_id,
                                    "iteration": iteration + 1,
                                    "max_iterations": max_iterations,
                                    "tool_name": tc.function.name,
                                    "arguments": tc.function.arguments,
                                    "requires_decision": false,
                                }),
                            );
                        }

                        let tool_result =
                            self.execute_tool(&tc.function.name, &tc.function.arguments);
                        self.db.add_message(
                            session_id,
                            "tool",
                            &tool_result,
                            Some(&tc.id),
                            None,
                        )?;
                        messages.push(ChatMessage {
                            role: "tool".to_string(),
                            content: Some(tool_result),
                            tool_calls: None,
                            tool_call_id: Some(tc.id),
                            tokens: None,
                            reasoning_content: None,
                        });
                    }

                    if session_ended && origin == "voice" {
                        let has_content = !content_text.trim().is_empty();
                        let farewell = if has_content {
                            content_text
                        } else {
                            session_end_farewell.unwrap_or_else(|| {
                                "Perfeito, sessão finalizada. Até logo!".to_string()
                            })
                        };
                        let clean_farewell = strip_markdown_for_tts(&farewell);
                        let spoken_farewell = if clean_farewell.is_empty() {
                            "Perfeito, sessão finalizada. Até logo!".to_string()
                        } else {
                            clean_farewell
                        };
                        let final_content = format!("[SESSION_END] {}", spoken_farewell);

                        // Se content_text já continha texto, a mensagem do assistente já foi persistida
                        // no banco na linha acima (com os devidos tool_calls). Evita duplicação no chat.
                        if !has_content {
                            let tokens = Some((spoken_farewell.len() as i64 / 4).max(1));
                            self.db.add_message_with_meta(
                                session_id,
                                "assistant",
                                &spoken_farewell,
                                None,
                                None,
                                tokens,
                                None,
                            )?;
                        }
                        return Ok(final_content);
                    }

                    continue;
                }
            }

            // Resposta final do modelo
            let mut final_content = response_msg.content.unwrap_or_default();
            if final_content.trim().is_empty() {
                final_content =
                    "Concluí a análise solicitada com base nas notas e informações disponíveis."
                        .to_string();
            }

            if origin == "voice" && !overlay_visible {
                final_content = strip_markdown_for_tts(&final_content);
            }

            let assistant_tokens = response_msg
                .tokens
                .or_else(|| Some((final_content.len() as i64 / 4).max(1)));
            self.db.add_message_with_meta(
                session_id,
                "assistant",
                &final_content,
                None,
                None,
                assistant_tokens,
                None,
            )?;

            // Auto-titulação: verifica se o título da sessão é genérico e se há mensagem do usuário
            let is_generic_title = self
                .db
                .get_session(session_id)
                .ok()
                .flatten()
                .map(|s| {
                    s.titulo.starts_with("Sessão ")
                        || s.titulo == "Novo Chat"
                        || s.titulo.trim().is_empty()
                })
                .unwrap_or(false);

            if is_generic_title {
                let user_msg_count = self
                    .db
                    .get_messages(session_id)
                    .ok()
                    .map(|msgs| msgs.iter().filter(|m| m.role == "user").count())
                    .unwrap_or(0);

                if user_msg_count >= 1 {
                    let llm_clone = self.llm.clone();
                    let db_clone = self.db.clone();
                    let sid_clone = session_id.to_string();
                    let u_msg = trimmed_input.to_string();
                    let a_resp = final_content.clone();
                    let app_handle_opt = self.app_handle.read().unwrap().clone();

                    task::spawn(async move {
                        if let Ok(title) = llm_clone.generate_title(&u_msg, &a_resp).await {
                            let clean_title = title.trim().trim_matches('"').trim().to_string();
                            if !clean_title.is_empty()
                                && db_clone.rename_session(&sid_clone, &clean_title).is_ok()
                            {
                                println!(
                                    "[AGENT] Sessão '{}' auto-titulada com sucesso: '{}'",
                                    sid_clone, clean_title
                                );
                                if let Some(app) = app_handle_opt {
                                    use tauri::Emitter;
                                    let _ = app.emit(
                                        "session-renamed",
                                        serde_json::json!({
                                            "id": sid_clone,
                                            "title": clean_title,
                                        }),
                                    );
                                }
                            }
                        }
                    });
                }
            }

            return Ok(final_content);
        }

        // Fallback defensivo: se saiu do loop sem retorno explícito, sintetiza resposta com base no que foi feito
        let fallback = format!(
            "Concluí as {} iterações da rotina. Todas as consultas e operações solicitadas foram processadas.",
            max_iterations
        );
        let _ = self
            .db
            .add_message(session_id, "assistant", &fallback, None, None);
        Ok(fallback)
    }
}

/// Resumo das decisões do usuário no Inbox para a sessão (para o agente não alegar que criou o rejeitado).
/// Inclui applied/read (feitas), dismissed (NÃO feitas), snoozed (adiadas). Últimas 5, mais recentes primeiro.
pub fn build_inbox_decisions_block(db: &crate::db::Database, session_id: &str) -> Option<String> {
    let items = db.list_inbox_items().ok()?;
    let mut relevant: Vec<_> = items
        .into_iter()
        .filter(|i| i.session_id.as_deref() == Some(session_id))
        .filter(|i| {
            matches!(
                i.status.as_str(),
                "applied" | "read" | "dismissed" | "snoozed"
            )
        })
        .collect();
    if relevant.is_empty() {
        return None;
    }
    // list_inbox_items já vem ORDER BY created_at DESC; garante no máx 5.
    relevant.truncate(5);
    let mut lines = Vec::new();
    for it in &relevant {
        let title = it.title.trim().chars().take(80).collect::<String>();
        let reason = it
            .decision_reason
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| format!(" Motivo: {}", s.chars().take(140).collect::<String>()))
            .unwrap_or_default();
        let line = match it.status.as_str() {
            "applied" | "read" => format!("- '{}': APLICADA — já existe/foi registrada. Não duplique.{}", title, reason),
            "dismissed" => format!("- '{}': REJEITADA — NADA foi criado ou alterado. NÃO reproponha sem pedido explícito.{}", title, reason),
            "snoozed" => format!("- '{}': ADIADA — não conta como feita, continua pendente.{}", title, reason),
            _ => continue,
        };
        lines.push(line);
    }
    if lines.is_empty() {
        return None;
    }
    Some(format!(
        "[DECISÕES DO USUÁRIO NO INBOX — RESPEITE ESTRITAMENTE]\n{}\nRegras: dismissed = final (não recrie, não insista). applied = já feita (não duplique). Cite o motivo quando relevante.",
        lines.join("\n")
    ))
}

/// Monta o System Prompt dinâmico incorporando nome do usuário, estilo de linguagem e regras aprendidas
pub fn build_personalized_system_prompt(db: &crate::db::Database, base_prompt: &str) -> String {
    let mut personalized = base_prompt.to_string();

    let user_name = db.get_setting("user_name").ok().flatten();
    let style = db.get_setting("communication_style").ok().flatten();
    let custom_instructions = db.get_setting("agent_custom_instructions").ok().flatten();

    let mut profile_block = String::new();
    if let Some(ref name) = user_name {
        let clean_name = name.trim();
        if !clean_name.is_empty() {
            profile_block.push_str(&format!(
                "\n- Nome do Usuário: {}\nVocê está interagindo diretamente com {}, seu usuário e interlocutor principal. Chame-o pelo nome preferencialmente apenas na saudação inicial ou despedida; evite repetir o nome dele no meio da conversa.",
                clean_name, clean_name
            ));
        }
    }

    if let Some(ref st) = style {
        let clean_style = match st.as_str() {
            "direto" | "direto_conciso" => "Direto e conciso. Respostas rápidas, sem rodeios ou floreios, priorizando síntese e objetividade.",
            "tecnico" | "tecnico_analitico" => "Técnico e analítico. Forneça raciocínio aprofundado, precisão técnica, fundamentação e estruturação lógica clara.",
            "amigavel" | "amigavel_conversacional" => "Amigável e acolhedor. Tom caloroso, empático, consultivo e prestativo.",
            other => other,
        };
        profile_block.push_str(&format!(
            "\n- Estilo de Comunicação Adotado: {}",
            clean_style
        ));
    }

    if !profile_block.is_empty() {
        personalized.push_str("\n\n[PERFIL DO USUÁRIO & PERSONALIZAÇÃO]");
        personalized.push_str(&profile_block);
    }

    if let Some(ref instructions) = custom_instructions {
        let clean_inst = instructions.trim();
        if !clean_inst.is_empty() {
            personalized
                .push_str("\n\n[DIRETRIZES E REGRAS APRENDIDAS (Aprovadas pelo Usuário)]\n");
            personalized.push_str(clean_inst);
        }
    }

    let date_fmt = db
        .get_setting("date_format")
        .ok()
        .flatten()
        .unwrap_or_else(|| "DD-MM-YY".to_string());
    let hoje_formatada = crate::vault::format_date_with(chrono::Local::now(), &date_fmt);
    personalized.push_str(&format!(
        "\n\n[PADRÃO DE DATA E TEMPO ATUAL]\n- Formato de Data Oficial do Usuário: {}\n- Data Atual de Hoje: {}\nRegra Obrigatória: Sempre use estritamente este formato ({}) para datas em notas, títulos, corpos, links e registros tabulares.",
        date_fmt, hoje_formatada, date_fmt
    ));

    personalized
}

fn parse_rfc3339_local(s: &str) -> Option<chrono::DateTime<chrono::Local>> {
    if let Ok(dt) = s.parse::<chrono::DateTime<chrono::Local>>() {
        return Some(dt);
    }
    if let Ok(dt) = s.parse::<chrono::DateTime<chrono::Utc>>() {
        return Some(dt.with_timezone(&chrono::Local));
    }
    None
}

pub type SharedAgentCore = Arc<AgentCore>;
