use crate::config::AppConfig;
use regex::Regex;
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;

pub use crate::domain::models::{ChatMessage, ChatUsage, FunctionCall, ToolCall};
pub use crate::domain::traits::providers::ChatOptions;

pub const SYSTEM_PROMPT: &str = r#"Você é o Copernico (Second Brain) — assistente pessoal local e cognitivo do usuário.

Você tem acesso a:
1. Cofre padrão (cofres/default) — gravável. Notas criadas/editadas/deletadas pelo agente ficam aqui.
2. Cofre Obsidian (cofres/obsidian) — somente leitura. Contém todo o conhecimento pessoal do usuário (projetos, gastronomia, checklists, estudos, livros, reflexões).
3. Extensões e Skills Locais (ferramentas `executar_script_skill` e `executar_codigo_python`) — permitem executar scripts Python locais para pesquisas na web em tempo real (skill `web-search`), automação de navegador (skill `browser-use`), cálculos e processamento dinâmico.

Regras de negócio e comportamento agêntico:
- Consulta a Notas: use buscar_notas e/ou ler_nota para consultar o conhecimento dos cofres. Responda diretamente no chat sem criar novos arquivos desnecessários.
- Pesquisas na Web & Informações Externas: Quando o usuário solicitar informações recentes, notícias, cotações, dados externos ou pedir para pesquisar na internet, NUNCA afirme que não tem acesso à web. Invoque imediatamente a skill de busca usando a ferramenta `executar_script_skill` (com skill_id: "web-search", script: "search.py", argumentos: [query de busca]).
- Automação e Processamento: Utilize `executar_codigo_python` ou a skill correspondente quando solicitado processamento de dados, cálculos ou automações.
- Citação Obrigatória: Sempre cite a fonte ao usar informações das notas. No modo visual, use o formato de footnote interativa [^slug_da_nota] (exemplo: 'conforme planejado na arquitetura[^arquitetura_alpha]').
- Criação de Notas: SÓ use salvar_nota para conteúdo NOVO e autocontido (ex: "crie uma lista de compras com arroz, feijão"). NUNCA use salvar_nota para "adicionar/acrescentar/incluir +N itens (na lista / na nota X)" — isso é sempre atualizar_nota. NUNCA coloque o pedido literal ("adicionar 2 itens a lista") como título ou corpo; o corpo deve ser o conteúdo final com bullets.
  * DIRETRIZ DE NOTAS ATÔMICAS: Crie notas enxutas, focadas em um único conceito e interconectadas com outras notas usando wikilinks [[Nome da Nota]].
- Atualização de Notas: Use atualizar_nota SEMPRE que o usuário disser "adicionar/acrescentar/incluir/coloque" em algo já existente. Fluxo obrigatório: 1) buscar_notas para achar a nota (ex: "lista"), 2) ler_nota para ver o conteúdo atual, 3) atualizar_nota com identifier exato + novo_conteudo com os itens finais em modo append. Se você não sabe QUAL nota ("a lista" ambíguo) ou QUAIS itens (usuário não listou), NÃO invente e NÃO crie nota nova — use perguntar_ao_usuario primeiro (ex: "Qual lista? Quais são os 2 itens?").
- Deleção de Notas: Use deletar_nota apenas mediante solicitação inequívoca do usuário (apenas no cofre padrão).
- NUNCA tente criar, editar ou deletar notas no cofre Obsidian — ele é estritamente somente leitura.
- Interação & Perguntas (HUMAN-IN-THE-LOOP): Quando faltar informação crítica para executar uma ferramenta (ex: cidade para clima, data, arquivo), NUNCA invente. Use `perguntar_ao_usuario` com pergunta direta e opções sugeridas. A pergunta será exibida no chat e, em modo voz, será falada ao usuário para que ele responda.
- Auto-Melhoria & Memória Persistente: Você possui memória persistente via `agent_custom_instructions` injetada no seu system prompt. Quando identificar que o usuário corrigiu um erro seu, ou que há uma preferência sistemática (ex: formato de data, estilo de resposta, cidade padrão), DEVE propor uma melhoria via `propor_melhoria_instrucao` (título, justificativa, instrucao_proposta). Ela vai para a Inbox do usuário para aprovação; após aprovada, torna-se parte permanente do seu comportamento. NUNCA diga que não tem acesso a memória ou que não pode aprender.
- Sempre priorize respostas diretas e completas; fale em português do Brasil (pt-BR)."#;

pub const DEFAULT_VOICE_SYSTEM_PROMPT: &str = r#"Você é o Copernico (Second Brain) — assistente pessoal local do usuário respondendo por voz em segundo plano (overlay fechado).

Você tem acesso a:
1. Cofre padrão (cofres/default) e Cofre Obsidian (cofres/obsidian) — conhecimento local (somente leitura em voz).
2. Extensões e Skills de leitura/visão (como `web-search` via `executar_script_skill`, futuro `screen-capture`) — para consultas recentes e ver tela.
3. Ferramenta de interação: `perguntar_ao_usuario` — para pedir cidade, data, confirmação antes de agir.

REGRAS OBRIGATÓRIAS DE VOZ (TTS PURO):
1. O usuário NÃO vê a tela, ele vai OUVIR sua resposta.
2. RESPONDA EM TEXTO CORRIDO FALÁVEL APENAS — PROIBIDO usar **, *, -, •, |, #, >, ```, tabelas, listas ou emojis.
3. Concisão Contextual Adaptativa: Para perguntas pontuais e comandos rápidos, responda em 1 a 2 frases diretas. Para explicações complexas ou dúvidas conceituais, responda com clareza em 3 a 5 frases completas.
4. Cite fontes de forma falada e fluida, ex: 'conforme sua nota X no cofre padrão' ou 'segundo dados recentes da web'.
5. Fale em português do Brasil (pt-BR) com tom calmo, acolhedor e prestativo.
6. Quando FALTAR informação crítica (ex: cidade para clima), NUNCA invente. Use `perguntar_ao_usuario` com pergunta direta e curta — ela será falada ao usuário e a resposta dele virá na próxima mensagem.
7. NUNCA diga "não posso anotar", "não tenho acesso", "não consigo salvar". Se o usuário pedir para anotar/guardar/lembrar, diga naturalmente: "perfeito, vou anotar isso logo após nossa conversa" ou "anotarei para você assim que encerrarmos" — o consolidador pós-sessão efetivamente vai registrar. Você NÃO executa escrita no cofre durante a voz.
8. Quando identificar preferência sistemática ou correção (ex: não me chame pelo nome), NÃO proponha na hora; apenas reconheça brevemente e deixe o consolidador aprender em background.
9. Encerramento: Quando o usuário sinalizar despedida ou fim da conversa (ex: 'obrigado', 'valeu', 'tchau', 'pode encerrar', 'por hoje é só', 'era só isso'), invoque `encerrar_sessao` com breve despedida.
10. PROIBIDO CRIAR OU EDITAR NOTAS/REGRAS EM VOZ: Seu papel por voz é conversar, consultar e perguntar. Criação é exclusiva do consolidador pós-sessão."#;

pub const VOICE_SUFFIX: &str = r#"

[CONTEXTO VOZ - overlay FECHADO - TTS PURO]
O usuário NÃO vê a tela, vai OUVIR sua resposta via voz.
REGRAS OBRIGATÓRIAS:
1. RESPONDA EM TEXTO CORRIDO FALÁVEL APENAS - PROIBIDO usar **, *, -, •, |, #, >, ```, tabelas, listas, emojis.
2. Concisão adaptativa: 1-2 frases para perguntas simples; 3-5 frases para explicações complexas.
3. Cite fonte de forma falada curta, ex: 'nota X do cofre padrão'.
4. NUNCA use markdown, barra vertical, traços ou asteriscos. Escreva como frase natural para ser lida em voz alta.
5. Quando FALTAR dado crítico (cidade, data), use perguntar_ao_usuario — a pergunta será falada.
6. Se pedirem para anotar/guardar, NUNCA diga "não posso" — diga "vou anotar logo após nossa conversa" (consolidador fará).
7. Quando o usuário se despedir ou sinalizar encerramento, chame encerrar_sessao.
8. NUNCA tente salvar, atualizar, deletar notas ou propor regras em voz. Apenas converse, consulte e pergunte."#;

#[derive(Clone, Debug, Default, Deserialize)]
#[allow(dead_code)]
struct ChatChoice {
    message: ChatMessage,
    #[serde(default)]
    finish_reason: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize)]
struct ChatCompletionResponse {
    #[serde(default)]
    choices: Vec<ChatChoice>,
    #[serde(default)]
    usage: Option<ChatUsage>,
}

#[derive(Clone, Debug, Deserialize)]
#[allow(dead_code)]
struct StreamDelta {
    content: Option<String>,
    tool_calls: Option<Vec<ToolCall>>,
}

#[derive(Clone, Debug, Deserialize)]
#[allow(dead_code)]
struct StreamChoice {
    delta: StreamDelta,
    finish_reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[allow(dead_code)]
struct StreamChunk {
    choices: Vec<StreamChoice>,
}

pub fn strip_markdown_for_tts(text: &str) -> String {
    if text.is_empty() {
        return String::new();
    }
    // Remove code blocks
    let re_code = Regex::new(r"```[\s\S]*?```").unwrap();
    let text = re_code.replace_all(text, " ");

    // Remove inline code
    let re_inline = Regex::new(r"`([^`]+)`").unwrap();
    let text = re_inline.replace_all(&text, "$1");

    // Remove bold and italic
    let re_bold = Regex::new(r"\*\*([^*]+)\*\*").unwrap();
    let text = re_bold.replace_all(&text, "$1");
    let re_italic = Regex::new(r"\*([^*]+)\*").unwrap();
    let text = re_italic.replace_all(&text, "$1");
    let re_under = Regex::new(r"__([^_]+)__").unwrap();
    let text = re_under.replace_all(&text, "$1");

    // Remove links [text](url) -> text
    let re_links = Regex::new(r"\[([^\]]+)\]\([^\)]+\)").unwrap();
    let text = re_links.replace_all(&text, "$1");

    // Remove wikilinks [[text]] -> text
    let re_wikilinks = Regex::new(r"\[\[([^\]]+)\]\]").unwrap();
    let text = re_wikilinks.replace_all(&text, "$1");

    // Remove headings
    let re_head = Regex::new(r"(?m)^#{1,6}\s*").unwrap();
    let text = re_head.replace_all(&text, "");

    // Remove blockquotes
    let re_quote = Regex::new(r"(?m)^>\s*").unwrap();
    let text = re_quote.replace_all(&text, "");

    let re_bullet = Regex::new(r"^\s*[-*•]\s+").unwrap();
    let re_num = Regex::new(r"^\s*\d+\.\s+").unwrap();

    // Remove tables and bullets line by line
    let mut clean_lines = Vec::new();
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.contains('|') && trimmed.matches('|').count() >= 2 {
            let parts: Vec<_> = trimmed
                .split('|')
                .map(|p| p.trim())
                .filter(|p| !p.is_empty() && !p.chars().all(|c| c == '-' || c == ':'))
                .collect();
            if !parts.is_empty() {
                clean_lines.push(parts.join(" "));
            }
            continue;
        }
        let l = re_bullet.replace(trimmed, "").to_string();
        let l = re_num.replace(&l, "").to_string();
        clean_lines.push(l);
    }

    let joined = clean_lines.join("\n");
    let re_multispace = Regex::new(r"\s+").unwrap();
    re_multispace.replace_all(&joined, " ").trim().to_string()
}

pub fn get_tool_definitions() -> serde_json::Value {
    json!([
        {
            "type": "function",
            "function": {
                "name": "buscar_notas",
                "description": "Busca semântica no cofre Markdown. Use para responder perguntas sobre conteúdo já salvo. Retorna notas mais similares com score.",
                "parameters": {
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
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "ler_nota",
                "description": "Lê conteúdo completo + frontmatter de uma nota por título ou caminho. Use após buscar_notas para detalhar.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "identifier": {
                            "type": "string",
                            "description": "Título, nome do arquivo ou caminho da nota"
                        }
                    },
                    "required": ["identifier"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "salvar_nota",
                "description": "Cria nova nota Markdown no cofre padrão. SÓ use quando usuário pedir explicitamente para salvar/registrar/anotar. Mantenha notas enxutas e com [[wikilinks]].",
                "parameters": {
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
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "atualizar_nota",
                "description": "Atualiza nota existente no cofre padrão (append ou replace). SÓ use quando usuário pedir para adicionar/editar nota já salva.",
                "parameters": {
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
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "deletar_nota",
                "description": "Deleta uma nota do cofre padrão. SÓ use quando o usuário pedir explicitamente para deletar/apagar/remover uma nota. NUNCA tente deletar notas do cofre Obsidian.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "identifier": {
                            "type": "string",
                            "description": "Título, nome do arquivo ou caminho da nota a deletar"
                        }
                    },
                    "required": ["identifier"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "encerrar_sessao",
                "description": "Encerra a sessão de voz atual. Use quando o usuário se despedir ou indicar que a conversa acabou (ex: 'obrigado', 'valeu', 'tchau', 'pode fechar', 'era só isso', 'por hoje é só').",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "motivo": {
                            "type": "string",
                            "description": "Breve frase ou motivo de despedida para falar ao usuário"
                        }
                    }
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "propor_melhoria_instrucao",
                "description": "Propõe uma nova regra ou melhoria de diretriz para suas próprias instruções (autoaprendizado), quando você cometer um erro corrigido pelo usuário ou observar uma preferência operacional clara. Registra na Inbox para aprovação do usuário.",
                "parameters": {
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
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "executar_script_skill",
                "description": "Executa um script Python determinístico pertencente a uma skill instalada em skills/<skill_id>/scripts/ ou na raiz da skill, passando argumentos.",
                "parameters": {
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
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "executar_codigo_python",
                "description": "Executa um bloco de código Python no ambiente local para processar dados, realizar cálculos matemáticos ou automações dinâmicas.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "codigo": {
                            "type": "string",
                            "description": "Código Python completo a ser executado"
                        }
                    },
                    "required": ["codigo"]
                }
            }
        }
    ])
}

pub struct LlmClient {
    config: Arc<AppConfig>,
    http: reqwest::Client,
    db: std::sync::RwLock<Option<crate::db::SharedDatabase>>,
}

impl LlmClient {
    pub fn new(config: Arc<AppConfig>) -> Self {
        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(45))
            .build()
            .unwrap_or_default();
        Self {
            config,
            http,
            db: std::sync::RwLock::new(None),
        }
    }

    pub fn set_database(&self, db: crate::db::SharedDatabase) {
        if let Ok(mut guard) = self.db.write() {
            *guard = Some(db);
        }
    }

    pub fn get_api_key(&self) -> String {
        if let Ok(guard) = self.db.read() {
            if let Some(ref db) = *guard {
                if let Ok(Some(k)) = db.get_setting("deepseek_api_key") {
                    let trimmed = k.trim().to_string();
                    if !trimmed.is_empty() {
                        return trimmed;
                    }
                }
            }
        }
        self.config.deepseek_api_key.clone()
    }

    pub async fn chat_completion(
        &self,
        messages: &[ChatMessage],
        tools: Option<serde_json::Value>,
    ) -> Result<ChatMessage, Box<dyn std::error::Error + Send + Sync>> {
        self.chat_completion_with_options(messages, tools, ChatOptions::default())
            .await
    }

    pub async fn chat_completion_with_options(
        &self,
        messages: &[ChatMessage],
        tools: Option<serde_json::Value>,
        options: ChatOptions,
    ) -> Result<ChatMessage, Box<dyn std::error::Error + Send + Sync>> {
        let api_key = self.get_api_key();
        if api_key.is_empty() {
            return Err("DEEPSEEK_API_KEY não configurada no aplicativo nem no .env".into());
        }

        let url = format!(
            "{}/chat/completions",
            self.config.deepseek_base_url.trim_end_matches('/')
        );
        let mut body = json!({
            "model": self.config.deepseek_model,
            "messages": messages,
            "temperature": options.temperature,
            "top_p": options.top_p,
            "thinking": {
                "type": if options.enable_thinking { "enabled" } else { "disabled" }
            },
            "reasoning_effort": if options.enable_thinking { "low" } else { "none" },
        });

        if let Some(mt) = options.max_tokens {
            body["max_tokens"] = json!(mt);
        }

        if options.json_mode {
            body["response_format"] = json!({ "type": "json_object" });
        }

        if let Some(t) = tools {
            body["tools"] = t;
            body["tool_choice"] = json!("auto");
        }

        let mut last_err = String::new();
        for attempt in 1..=2 {
            let res = match self
                .http
                .post(&url)
                .header("Authorization", format!("Bearer {}", api_key))
                .header("Content-Type", "application/json")
                .json(&body)
                .send()
                .await
            {
                Ok(r) => r,
                Err(err) => {
                    last_err = format!("Falha de conexão com a API DeepSeek: {err}");
                    if attempt < 2 {
                        eprintln!(
                            "[DEEPSEEK] Tentativa {} falhou ({}), tentando novamente em 500ms...",
                            attempt, err
                        );
                        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                        continue;
                    }
                    return Err(last_err.into());
                }
            };

            let status = res.status();
            let raw_text = match res.text().await {
                Ok(t) => t,
                Err(err) => {
                    last_err = format!("Erro de rede ao ler corpo da resposta DeepSeek: {err}");
                    if attempt < 2 {
                        eprintln!("[DEEPSEEK] Tentativa {} falhou ao ler corpo ({}), tentando novamente...", attempt, err);
                        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                        continue;
                    }
                    return Err(last_err.into());
                }
            };

            if !status.is_success() {
                return Err(format!("Erro da API DeepSeek ({}): {}", status, raw_text).into());
            }

            match serde_json::from_str::<ChatCompletionResponse>(&raw_text) {
                Ok(parsed) => {
                    let total_tokens = parsed.usage.as_ref().and_then(|u| u.total_tokens);
                    if let Some(mut choice) = parsed.choices.into_iter().next() {
                        choice.message.tokens = total_tokens;
                        return Ok(choice.message);
                    } else {
                        return Err("Nenhuma resposta retornada pelo modelo".into());
                    }
                }
                Err(err) => {
                    eprintln!(
                        "[DEEPSEEK DESERIALIZE ERROR]: {}\nResposta bruta recebida:\n{}",
                        err, raw_text
                    );
                    return Err(format!(
                        "Erro de decodificação da resposta DeepSeek: {} | Resposta: {}",
                        err, raw_text
                    )
                    .into());
                }
            }
        }

        Err(last_err.into())
    }

    pub async fn generate_title(
        &self,
        user_msg: &str,
        assistant_resp: &str,
    ) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
        let prompt = format!(
            "Crie um título curto (máx 40 caracteres) em português para esta conversa. Responda APENAS com o título, sem aspas, sem pontuação final.\nUsuário: {}\nAssistente: {}",
            user_msg.chars().take(200).collect::<String>(),
            assistant_resp.chars().take(200).collect::<String>()
        );

        let messages = vec![ChatMessage {
            role: "user".to_string(),
            content: Some(prompt),
            tool_calls: None,
            tool_call_id: None,
            tokens: None,
            reasoning_content: None,
        }];

        let msg = self.chat_completion(&messages, None).await?;
        let raw = msg
            .content
            .unwrap_or_default()
            .trim()
            .trim_matches('"')
            .trim_matches('\'')
            .to_string();
        let clean = raw.chars().take(40).collect::<String>();
        Ok(clean)
    }
}

#[async_trait::async_trait]
impl crate::providers::LlmProvider for LlmClient {
    fn info(&self) -> crate::providers::ProviderInfo {
        crate::providers::ProviderInfo {
            id: "deepseek".into(),
            name: "DeepSeek Chat".into(),
            provider_type: "llm".into(),
            is_local: false,
            description: format!(
                "Modelo DeepSeek ({}) via API na nuvem",
                self.config.deepseek_model
            ),
        }
    }

    async fn chat_completion(
        &self,
        messages: &[ChatMessage],
        tools: Option<serde_json::Value>,
    ) -> Result<ChatMessage, crate::providers::ProviderError> {
        self.chat_completion_with_options(messages, tools, ChatOptions::default())
            .await
            .map_err(|e| crate::providers::ProviderError::Network(e.to_string()))
    }

    async fn chat_completion_with_options(
        &self,
        messages: &[ChatMessage],
        tools: Option<serde_json::Value>,
        options: ChatOptions,
    ) -> Result<ChatMessage, crate::providers::ProviderError> {
        self.chat_completion_with_options(messages, tools, options)
            .await
            .map_err(|e| crate::providers::ProviderError::Network(e.to_string()))
    }

    async fn generate_title(
        &self,
        user_msg: &str,
        assistant_resp: &str,
    ) -> Result<String, crate::providers::ProviderError> {
        self.generate_title(user_msg, assistant_resp)
            .await
            .map_err(|e| crate::providers::ProviderError::Network(e.to_string()))
    }
}

pub type SharedLlmClient = Arc<LlmClient>;
