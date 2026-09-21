use copernico_app_lib::agent::build_personalized_system_prompt;
use copernico_app_lib::db::Database;
use copernico_app_lib::llm::strip_markdown_for_tts;
use copernico_app_lib::tts::split_text_into_speech_chunks;
use copernico_app_lib::vault::{sanitize_filename, VaultManager};
use copernico_app_lib::wake_word::{clean_transcript, is_new_wakeup, strip_greeting_echo};
use std::path::Path;
use tempfile::tempdir;

#[test]
fn test_vault_sanitization_and_reserved_names() {
    // Reserved names should be prefixed with _
    let safe_con = sanitize_filename("CON.md");
    assert_eq!(safe_con, "_CON");

    let safe_prn = sanitize_filename("PRN");
    assert_eq!(safe_prn, "_PRN");

    // Invalid characters replaced with _
    let safe_chars = sanitize_filename("nota:importante*sobre?ia.md");
    assert_eq!(safe_chars, "nota_importante_sobre_ia");
}

#[test]
fn test_vault_atomic_write_and_full_read() {
    let dir = tempdir().unwrap();
    let default_vault = dir.path().join("default");
    let obsidian_vault = dir.path().join("obsidian");
    std::fs::create_dir_all(&default_vault).unwrap();
    std::fs::create_dir_all(&obsidian_vault).unwrap();

    let vm = VaultManager::new(default_vault.clone(), obsidian_vault.clone());

    // Create note with frontmatter and large content (>4000 characters to verify no truncation)
    let large_body = "Linha de conteúdo importante para o segundo cérebro.\n".repeat(200);
    assert!(large_body.len() > 8000);

    let created_path = vm
        .create_note(
            "Minha Nota Completa",
            &large_body,
            Some(vec![
                "segundo-cerebro".to_string(),
                "arquitetura".to_string(),
            ]),
            Some(vec!["Trabalho".to_string()]),
        )
        .expect("Falha ao salvar nota");

    assert!(created_path
        .to_string_lossy()
        .ends_with("Minha_Nota_Completa.md"));

    // Read note back
    let note = vm
        .read_note("Minha Nota Completa")
        .expect("Falha ao ler nota");
    assert_eq!(note.titulo, "Minha Nota Completa");
    assert_eq!(note.vault, "default");
    assert_eq!(note.content, large_body.trim());
    assert!(note.content.len() > 8000, "Conteúdo não deve ser truncado");
    assert_eq!(note.frontmatter.topicos, vec!["Trabalho".to_string()]);
}

#[test]
fn test_vault_update_preserves_filename() {
    let dir = tempdir().unwrap();
    let default_vault = dir.path().join("default");
    let obsidian_vault = dir.path().join("obsidian");
    std::fs::create_dir_all(&default_vault).unwrap();
    std::fs::create_dir_all(&obsidian_vault).unwrap();

    let vm = VaultManager::new(default_vault.clone(), obsidian_vault.clone());

    // Save initial note
    let path = vm
        .create_note("Nota Original", "Conteúdo 1", None, None)
        .unwrap();

    // Update note content (replace)
    let updated_path = vm
        .update_note("Nota Original", "Conteúdo 2 Atualizado", "replace")
        .unwrap();

    // File path MUST NOT change (to preserve wikilinks)
    assert_eq!(updated_path, path);

    // Reading note by original filename still works, and content is updated
    let read_back = vm.read_note("Nota Original").unwrap();
    assert_eq!(read_back.content, "Conteúdo 2 Atualizado");
}

#[test]
fn test_vault_path_traversal_prevention() {
    let dir = tempdir().unwrap();
    let default_vault = dir.path().join("default");
    let obsidian_vault = dir.path().join("obsidian");
    std::fs::create_dir_all(&default_vault).unwrap();
    std::fs::create_dir_all(&obsidian_vault).unwrap();

    let vm = VaultManager::new(default_vault.clone(), obsidian_vault.clone());

    // Attempting path traversal should fail safely (not found in vaults)
    let res = vm.read_note("../../../etc/passwd");
    assert!(res.is_err());
}

#[test]
fn test_db_session_and_messages_cascade() {
    let db = Database::init(Path::new(":memory:")).expect("Falha ao criar DB em memória");

    let s1 = db.create_session(Some("Sessão Teste")).unwrap();
    assert_eq!(s1.titulo, "Sessão Teste");

    let sessions = db.list_sessions().unwrap();
    assert_eq!(sessions.len(), 1);

    // Add user and assistant messages
    let msg1 = db
        .add_message(&s1.id, "user", "Olá assistente", None, None)
        .unwrap();
    let msg2 = db
        .add_message(&s1.id, "assistant", "Olá! Em que posso ajudar?", None, None)
        .unwrap();

    let msgs = db.get_messages(&s1.id).unwrap();
    assert_eq!(msgs.len(), 2);
    assert_eq!(msgs[0].id, msg1);
    assert_eq!(msgs[1].id, msg2);

    // Delete session - foreign key cascade should delete messages
    db.delete_session(&s1.id).unwrap();
    let sessions_after = db.list_sessions().unwrap();
    assert_eq!(sessions_after.len(), 0);

    let msgs_after = db.get_messages(&s1.id).unwrap();
    assert_eq!(msgs_after.len(), 0);
}

#[test]
fn test_db_delete_message_and_time_travel_truncate() {
    let db = Database::init(Path::new(":memory:")).expect("Falha ao criar DB em memória");
    let s = db.create_session(Some("Sessão Time Travel")).unwrap();

    let m1 = db
        .add_message(&s.id, "user", "Mensagem 1", None, None)
        .unwrap();
    let m2 = db
        .add_message(&s.id, "assistant", "Resposta 1", None, None)
        .unwrap();
    let m3 = db
        .add_message(&s.id, "user", "Mensagem 2", None, None)
        .unwrap();
    let _m4 = db
        .add_message(&s.id, "assistant", "Resposta 2", None, None)
        .unwrap();

    assert_eq!(db.get_messages(&s.id).unwrap().len(), 4);

    // Test individual message delete (e.g. delete assistant response m2)
    let deleted = db.delete_message(m2).unwrap();
    assert!(deleted);
    let msgs_after_delete = db.get_messages(&s.id).unwrap();
    assert_eq!(msgs_after_delete.len(), 3);
    assert!(msgs_after_delete.iter().all(|m| m.id != m2));

    // Test Time Travel truncate from m3 forward (should delete m3 and m4)
    let truncated_count = db.truncate_messages_from(&s.id, m3).unwrap();
    assert_eq!(truncated_count, 2);

    let msgs_after_truncate = db.get_messages(&s.id).unwrap();
    assert_eq!(msgs_after_truncate.len(), 1);
    assert_eq!(msgs_after_truncate[0].id, m1);
}

#[test]
fn test_strip_markdown_for_tts() {
    let md = "# Título Principal\n\nEste é um texto com **negrito**, *itálico* e [link](https://example.com).\n\n```python\nprint('hello')\n```\n\n- Item 1\n- Item 2";
    let cleaned = strip_markdown_for_tts(md);

    assert!(!cleaned.contains('#'));
    assert!(!cleaned.contains("**"));
    assert!(!cleaned.contains("```"));
    assert!(!cleaned.contains("https://"));
    assert!(cleaned.contains("Título Principal"));
    assert!(cleaned.contains("negrito"));
    assert!(cleaned.contains("itálico"));
    assert!(cleaned.contains("link"));
}

#[test]
fn test_prompts_settings_persistence() {
    let db = Database::init(Path::new(":memory:")).expect("Falha ao criar DB em memória");

    // Ambos devem ser None inicialmente
    assert_eq!(db.get_setting("system_prompt").unwrap(), None);
    assert_eq!(db.get_setting("voice_system_prompt").unwrap(), None);

    // Salva prompt visual
    db.set_setting("system_prompt", "Prompt Visual Customizado")
        .unwrap();
    assert_eq!(
        db.get_setting("system_prompt").unwrap().as_deref(),
        Some("Prompt Visual Customizado")
    );
    assert_eq!(db.get_setting("voice_system_prompt").unwrap(), None);

    // Salva prompt de voz
    db.set_setting("voice_system_prompt", "Prompt de Voz Curto")
        .unwrap();
    assert_eq!(
        db.get_setting("system_prompt").unwrap().as_deref(),
        Some("Prompt Visual Customizado")
    );
    assert_eq!(
        db.get_setting("voice_system_prompt").unwrap().as_deref(),
        Some("Prompt de Voz Curto")
    );

    // Deleta prompt visual (restaura padrão)
    db.delete_setting("system_prompt").unwrap();
    assert_eq!(db.get_setting("system_prompt").unwrap(), None);
    assert_eq!(
        db.get_setting("voice_system_prompt").unwrap().as_deref(),
        Some("Prompt de Voz Curto")
    );
}

#[test]
fn test_wake_word_threshold_persistence() {
    let db = Database::init(Path::new(":memory:")).expect("Falha ao criar DB em memória");

    assert_eq!(db.get_setting("wake_word_threshold").unwrap(), None);

    db.set_setting("wake_word_threshold", "0.35").unwrap();
    assert_eq!(
        db.get_setting("wake_word_threshold").unwrap().as_deref(),
        Some("0.35")
    );

    let parsed: f32 = db
        .get_setting("wake_word_threshold")
        .unwrap()
        .unwrap()
        .parse()
        .unwrap();
    assert!((parsed - 0.35).abs() < 0.001);
}

#[test]
fn test_clean_transcript_variants() {
    // Caso real relatado pelo usuário: pergunta terminada em "Leach?"
    assert_eq!(clean_transcript("Como vai você, Leach?"), "Como vai você?");

    // Pergunta com interrogação antes da palavra de ativação
    assert_eq!(
        clean_transcript("O que é um buraco negro? Leach"),
        "O que é um buraco negro?"
    );

    // Frase afirmativa terminada em "lich."
    assert_eq!(
        clean_transcript("Crie um componente React, lich."),
        "Crie um componente React"
    );

    // Frase com variação fonética "leech"
    assert_eq!(
        clean_transcript("Explique a relatividade leech"),
        "Explique a relatividade"
    );

    // Frase sem nenhuma palavra-chave (ex: timeout) não perde nenhuma palavra
    assert_eq!(
        clean_transcript("Qual a velocidade da luz no vácuo?"),
        "Qual a velocidade da luz no vácuo?"
    );
    assert_eq!(
        clean_transcript("Qual a distância da Terra até o Sol? Litchie"),
        "Qual a distância da Terra até o Sol?"
    );

    // Casos com o novo modelo de finalização "Zefiro"
    assert_eq!(clean_transcript("Como vai você, Zefiro?"), "Como vai você?");
    assert_eq!(
        clean_transcript("Crie uma nota sobre arquitetura, zefiro."),
        "Crie uma nota sobre arquitetura"
    );
    assert_eq!(
        clean_transcript("Qual a distância da Terra até o Sol? Zéfiro"),
        "Qual a distância da Terra até o Sol?"
    );
    assert_eq!(
        clean_transcript("Resuma o projeto zephiro"),
        "Resuma o projeto"
    );

    // Apenas a palavra-chave isolada retorna string vazia (ignora envio)
    assert_eq!(clean_transcript("Leach"), "");
    assert_eq!(clean_transcript("Lich."), "");
    assert_eq!(clean_transcript("Litchie"), "");
    assert_eq!(clean_transcript("  litchie?  "), "");
    assert_eq!(clean_transcript("  leech?  "), "");
    assert_eq!(clean_transcript("Zefiro"), "");
    assert_eq!(clean_transcript("  zéfiro?  "), "");
    assert_eq!(clean_transcript("zephiro."), "");
    assert_eq!(clean_transcript(""), "");
}

#[test]
fn test_strip_greeting_echo() {
    let greeting = "Oi Patrick, estou te ouvindo. Do que precisa hoje?";
    // Eco + fala real: remove só o prefixo da saudação
    assert_eq!(
        strip_greeting_echo(
            "Oi Patrick estou te ouvindo do que precisa hoje qual a lista de afazeres?",
            greeting
        ),
        "qual a lista de afazeres?"
    );
    // Só o eco (usuário ficou em silêncio): retorna vazio
    assert_eq!(
        strip_greeting_echo("Oi Patrick estou te ouvindo do que precisa hoje", greeting),
        ""
    );
    // Sem eco: mantém intacto (não corta fala real que começa com "oi")
    assert_eq!(
        strip_greeting_echo("qual a previsão do tempo?", greeting),
        "qual a previsão do tempo?"
    );
    // Saudação vazia: mantém intacto
    assert_eq!(strip_greeting_echo("olá, tudo bem?", ""), "olá, tudo bem?");
}

#[test]
fn test_is_new_wakeup_distinguishes_copernico_from_followup() {
    // Heurística legada mantida por compatibilidade (classificação real usa expectativa local).
    assert!(is_new_wakeup(0.55));
    assert!(is_new_wakeup(0.87));
    assert!(is_new_wakeup(0.0));
    assert!(!is_new_wakeup(1.0));
    assert!(!is_new_wakeup(0.999));
}

#[test]
fn test_followup_expectation_classifies_real_wake_with_score_1() {
    use copernico_app_lib::wake_word::WakeWordService;
    let svc = WakeWordService::new();
    // Sem follow-up pedido: Start com score 1.0 (copernico confiante) é chamada nova → saúda.
    assert!(!svc.take_followup_expectation());
    // App pede follow-up de 10s: próximo Start é continuação (consome a marca).
    svc.start_followup(10.0);
    assert!(svc.take_followup_expectation());
    // Marca de uso único: o seguinte já é chamada nova de novo.
    assert!(!svc.take_followup_expectation());
    // Cancelar limpa a marca: próximo Start saúda.
    svc.start_followup(10.0);
    svc.cancel_recording();
    assert!(!svc.take_followup_expectation());
}

#[test]
fn test_tts_speech_chunking() {
    // Frase curta não deve ser fragmentada
    let short_text = "Olá! Como posso te ajudar?";
    let chunks = split_text_into_speech_chunks(short_text);
    assert_eq!(chunks.len(), 1);
    assert_eq!(chunks[0], "Olá! Como posso te ajudar?");

    // Frase longa com múltiplas sentenças deve ser fragmentada corretamente
    let multi_sentence = "Copérnico é um assistente pessoal inteligente. Ele organiza suas notas Markdown locais com busca vetorial. Você pode pesquisar tudo em tempo real!";
    let chunks = split_text_into_speech_chunks(multi_sentence);
    assert!(
        chunks.len() >= 2,
        "Deveria ter dividido em pelo menos 2 partes"
    );
    assert!(chunks[0].contains("Copérnico é um assistente"));
    assert!(chunks.iter().any(|c| c.contains("busca vetorial")));

    // Ponto decimal não deve quebrar erroneamente a sentença
    let decimal_text = "A taxa de juros subiu 3.14 por cento neste trimestre fiscal do projeto. Essa alteração afeta os custos gerais.";
    let chunks = split_text_into_speech_chunks(decimal_text);
    assert!(chunks[0].contains("3.14"));

    // Markdown deve ser limpo automaticamente nos chunks
    let md_text = "Aqui está a **resposta** com `código inline` e [link](file:///nota.md). O segundo ponto é igualmente importante para a síntese.";
    let chunks = split_text_into_speech_chunks(md_text);
    assert!(!chunks[0].contains("**"));
    assert!(!chunks[0].contains("`"));
    assert!(!chunks[0].contains("file:///"));
}

#[tokio::test]
async fn test_tts_benchmark_and_latency() {
    use copernico_app_lib::tts::EdgeTtsClient;

    let tts = EdgeTtsClient::new("pt-BR-ThalitaNeural");

    // Frase curta de pensamento imediato
    let start_short = std::time::Instant::now();
    let short_res = tts.synthesize("Peraí, estou pensando.", None).await;
    let short_duration = start_short.elapsed();

    if let Ok(bytes) = short_res {
        println!("\n==========================================");
        println!("[BENCHMARK TTS - FRASE CURTA]");
        println!("Texto: 'Peraí, estou pensando.'");
        println!("Tempo de síntese: {:?}", short_duration);
        println!("Tamanho do áudio MP3: {} bytes", bytes.len());
        assert!(!bytes.is_empty());
    }

    // Benchmark com pipeline de sentenças
    let long_sample = "Copérnico é seu segundo cérebro inteligente. Ele conecta suas anotações com busca vetorial rápida. Em poucos segundos você encontra qualquer ideia.";
    if let Ok(bench) = tts.benchmark(Some(long_sample), None).await {
        println!("\n[BENCHMARK TTS - PIPELINE DE SENTENÇAS]");
        println!("Total de caracteres: {}", bench.total_chars);
        println!("Quantidade de partes divididas: {}", bench.chunks_count);
        println!(
            "Tempo até o primeiro áudio tocar (Time To First Audio): {} ms",
            bench.time_to_first_audio_ms
        );
        println!(
            "Tempo total para sintetizar todas as partes: {} ms",
            bench.total_synthesis_time_ms
        );
        println!(
            "Velocidade média: {:.1} caracteres/segundo",
            bench.chars_per_second
        );
        println!("==========================================\n");
        assert!(bench.time_to_first_audio_ms > 0);
    }
}

#[test]
fn test_wake_word_concurrency_lock() {
    use copernico_app_lib::wake_word::WakeWordService;
    use std::sync::atomic::Ordering;

    let service = WakeWordService::new();
    // Inicialmente a trava de turno deve estar inativa (false)
    assert!(!service.is_processing_turn());

    // Primeiro Stop adquire a trava atômica com sucesso
    let first_acquire = service.is_processing_turn.compare_exchange(
        false,
        true,
        Ordering::SeqCst,
        Ordering::SeqCst,
    );
    assert!(first_acquire.is_ok());
    assert!(service.is_processing_turn());

    // Segundo Stop concorrente tenta adquirir a trava e é rejeitado (evita duplicação)
    let second_acquire = service.is_processing_turn.compare_exchange(
        false,
        true,
        Ordering::SeqCst,
        Ordering::SeqCst,
    );
    assert!(second_acquire.is_err());

    // Ao término do turno (sucesso ou erro), a trava é liberada
    service.is_processing_turn.store(false, Ordering::SeqCst);
    assert!(!service.is_processing_turn());

    // Novo turno pode ser adquirido normalmente após liberação
    let reacquire = service.is_processing_turn.compare_exchange(
        false,
        true,
        Ordering::SeqCst,
        Ordering::SeqCst,
    );
    assert!(reacquire.is_ok());
}

#[test]
fn test_tts_curated_voices_and_default() {
    use copernico_app_lib::tts::{get_curated_ptbr_voices, DEFAULT_TTS_VOICE};

    assert_eq!(DEFAULT_TTS_VOICE, "pt-BR-ThalitaNeural");
    let voices = get_curated_ptbr_voices();
    assert!(!voices.is_empty());
    assert!(voices.iter().any(|v| v.short_name == "pt-BR-ThalitaNeural"));
    assert!(voices
        .iter()
        .any(|v| v.short_name == "pt-BR-FranciscaNeural"));
    assert!(voices.iter().any(|v| v.short_name == "pt-BR-AntonioNeural"));
}

#[test]
fn test_tts_client_voice_switching_and_stop() {
    use copernico_app_lib::tts::{EdgeTtsClient, DEFAULT_TTS_VOICE};

    let client = EdgeTtsClient::new(DEFAULT_TTS_VOICE);
    assert_eq!(client.get_voice(), "pt-BR-ThalitaNeural");

    client.set_voice("pt-BR-FranciscaNeural");
    assert_eq!(client.get_voice(), "pt-BR-FranciscaNeural");

    assert!(!client.is_speaking());
    client.stop(); // Não deve causar pânico
    assert!(!client.is_speaking());
}

#[test]
fn test_tts_voice_setting_persistence() {
    let db = Database::init(Path::new(":memory:")).expect("Falha ao criar DB em memória");
    assert_eq!(db.get_setting("tts_voice").unwrap(), None);

    db.set_setting("tts_voice", "pt-BR-AntonioNeural").unwrap();
    assert_eq!(
        db.get_setting("tts_voice").unwrap().as_deref(),
        Some("pt-BR-AntonioNeural")
    );
}

#[tokio::test]
async fn test_tts_synthesize_no_panic() {
    use copernico_app_lib::tts::{EdgeTtsClient, DEFAULT_TTS_VOICE};

    let client = EdgeTtsClient::new(DEFAULT_TTS_VOICE);
    let res = client.synthesize("Teste", None).await;
    match res {
        Ok(bytes) => {
            println!("Sintetizado com sucesso: {} bytes", bytes.len());
            assert!(!bytes.is_empty());
        }
        Err(err) => {
            println!("Erro (rede/outro, mas sem pânico): {}", err);
            assert!(!err.to_string().contains("CryptoProvider"));
        }
    }
}

#[test]
fn test_plugin_registry_discovery_and_manifest_parsing() {
    use copernico_app_lib::mcp::McpManager;
    use copernico_app_lib::plugin_registry::PluginRegistry;
    use std::sync::Arc;

    let dir = tempdir().unwrap();
    let plugins_dir = dir.path().join("plugins");
    let test_tool_dir = plugins_dir.join("tools").join("screen-capture");
    std::fs::create_dir_all(&test_tool_dir).unwrap();

    let manifest_yaml = r#"
plugin:
  id: screen-capture
  name: Captura de Tela
  version: "1.0.0"
  description: Visualização da tela pelo agente
provides:
  type: tool
runtime:
  engine: mcp
  command: python
  args: ["server.py"]
  auto_start: false
"#;
    std::fs::write(test_tool_dir.join("copernico-plugin.yaml"), manifest_yaml).unwrap();

    let db = Arc::new(Database::init(Path::new(":memory:")).unwrap());
    let mcp = Arc::new(McpManager::new());
    let registry = PluginRegistry::new(plugins_dir, mcp, db.clone());

    registry.scan_and_load_plugins().expect("Falha ao escanear");

    let list = registry.list_plugins();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0]["id"], "screen-capture");
    assert_eq!(list[0]["name"], "Captura de Tela");
    assert_eq!(list[0]["type"], "tool");
    assert_eq!(list[0]["enabled"], true);

    // Testa toggle do plugin
    registry
        .set_plugin_enabled("screen-capture", false)
        .unwrap();
    assert_eq!(registry.is_plugin_enabled("screen-capture"), false);
}

#[test]
fn test_cron_matcher() {
    use chrono::{Local, TimeZone};
    use copernico_app_lib::skill_runner::SkillRunner;

    // 2026-09-07 14:30:00 (Segunda-feira)
    let dt = Local.with_ymd_and_hms(2026, 9, 7, 14, 30, 0).unwrap();

    // Minuto 30: */5 e */10 devem dar match
    assert!(SkillRunner::matches_cron("*/5 * * * *", &dt));
    assert!(SkillRunner::matches_cron("*/10 * * * *", &dt));
    assert!(SkillRunner::matches_cron("30 14 * * *", &dt));
    assert!(!SkillRunner::matches_cron("*/7 * * * *", &dt));
    assert!(!SkillRunner::matches_cron("0 9 * * *", &dt));
}

#[test]
fn test_tool_registry_builtin_and_filter() {
    use copernico_app_lib::indexer::Indexer;
    use copernico_app_lib::mcp::McpManager;
    use copernico_app_lib::tool_registry::ToolRegistry;
    use copernico_app_lib::vault::VaultManager;
    use std::sync::Arc;

    let dir = tempdir().unwrap();
    let db = Arc::new(Database::init(Path::new(":memory:")).unwrap());
    let vm = Arc::new(VaultManager::new(
        dir.path().join("default"),
        dir.path().join("obsidian"),
    ));
    let idx = Arc::new(Indexer::new(db.get_pool(), vm.clone()).unwrap());
    let mcp = Arc::new(McpManager::new());

    let skills_dir = dir.path().join("skills");
    let registry = ToolRegistry::new(db, vm, idx, mcp, skills_dir);
    let merged = registry.get_merged_definitions();
    let arr = merged.as_array().expect("Deveria ser array de ferramentas");
    assert_eq!(arr.len(), 15);

    // Filtra para 2 ferramentas
    let filtered = registry.get_filtered_definitions(&["buscar_notas".into(), "ler_nota".into()]);
    let filtered_arr = filtered.as_array().unwrap();
    assert_eq!(filtered_arr.len(), 2);
}

#[test]
fn test_shortcut_parsing() {
    use tauri_plugin_global_shortcut::Shortcut;
    let s1 = "ctrl+space".parse::<Shortcut>();
    assert!(s1.is_ok());

    let s2 = "Ctrl+Space".parse::<Shortcut>();
    assert!(s2.is_ok());

    let normalize = |s: &str| {
        s.replace(" ", "")
            .replace("Win+", "Super+")
            .replace("win+", "super+")
            .replace("Windows+", "Super+")
            .replace("windows+", "super+")
            .replace("Cmd+", "Super+")
            .replace("cmd+", "super+")
    };

    let s3 = normalize("Win+Shift+C").parse::<Shortcut>();
    assert!(s3.is_ok());

    let s4 = "Super+Shift+C".parse::<Shortcut>();
    assert!(s4.is_ok());
}

#[test]
fn test_inbox_items_crud_and_status() {
    let db = Database::init(Path::new(":memory:")).unwrap();

    let item = db
        .create_inbox_item(
            None,
            "Curadoria Semanal",
            Some("Relatório de curadoria"),
            "# Relatório de Curadoria\n\nNenhuma nota órfã.",
            "report",
            true,
        )
        .unwrap();

    assert!(!item.id.is_empty());

    let unread = db.get_unread_inbox_count().unwrap();
    assert_eq!(unread, 1);

    let items = db.list_inbox_items().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].title, "Curadoria Semanal");
    assert_eq!(items[0].status, "unread");
    assert_eq!(items[0].item_type, "report");
    assert!(items[0].requires_decision);

    // Marca como aprovado
    db.mark_inbox_item_status(&item.id, "approved").unwrap();
    let updated_items = db.list_inbox_items().unwrap();
    assert_eq!(updated_items[0].status, "approved");

    let unread_after = db.get_unread_inbox_count().unwrap();
    assert_eq!(unread_after, 0);

    // Deleta item
    db.delete_inbox_item(&item.id).unwrap();
    let all_after = db.list_inbox_items().unwrap();
    assert_eq!(all_after.len(), 0);
}

#[test]
fn test_dynamic_metadata_formatting() {
    let yaml_str = r#"
titulo: Teoria da Gravitação
author: Isaac Newton
year: 1687
status: publicado
tags: [fisica, ciencia]
"#;
    let fm: copernico_app_lib::vault::NoteFrontmatter = serde_yaml::from_str(yaml_str).unwrap();
    let formatted = VaultManager::format_dynamic_metadata(&fm);

    assert!(
        formatted.contains("author: Isaac Newton")
            || formatted.contains("author: \"Isaac Newton\"")
    );
    assert!(formatted.contains("year: 1687"));
    assert!(formatted.contains("status: publicado") || formatted.contains("status: \"publicado\""));
}

#[test]
fn test_semantic_chunking_markdown() {
    use copernico_app_lib::indexer::Indexer;

    let doc = r#"# Introdução
Este é o primeiro capítulo sobre o cérebro digital e suas capacidades.

## Seção 1: Memória
Aqui detalhamos como o SQLite armazena as conversas e vetores.

## Seção 2: Raciocínio
Aqui detalhamos a orquestração do LLM com Tool Calling autônomo.
"#;

    let chunks = Indexer::chunk_markdown(doc, 100, 0.10);
    assert!(
        chunks.len() >= 3,
        "Deveria quebrar pelas seções de cabeçalho"
    );
    assert!(chunks[0].contains("Introdução"));
    assert!(chunks.iter().any(|c| c.contains("Memória")));
    assert!(chunks.iter().any(|c| c.contains("Raciocínio")));
}

#[test]
fn test_hybrid_scoring_boost() {
    use copernico_app_lib::indexer::Indexer;

    let raw_cosine = 0.60;
    let query = "Rebeca";
    let title = "Rebeca";
    let path = "C:/cofres/obsidian/Rebeca.md";
    let content = "# Rebeca\nMinha amiga querida que trabalha com IA.";

    let hybrid_score =
        Indexer::calculate_hybrid_score(raw_cosine, query, title, path, Some(content));

    // Com boost de título exato (+0.40) e conteúdo (+0.10): (0.60 * 0.70) + 0.40 + 0.10 = 0.42 + 0.50 = 0.92
    assert!(
        hybrid_score > 0.90,
        "Score híbrido deveria passar de 90%, obteve: {}",
        hybrid_score
    );

    // Sem match léxico:
    let no_match_score = Indexer::calculate_hybrid_score(
        raw_cosine,
        query,
        "Física Quântica",
        "C:/cofres/default/Fisica.md",
        Some("Equações diferenciais"),
    );
    assert_eq!(no_match_score, 0.60 * 0.70);
}

#[test]
fn test_perguntar_ao_usuario_tool_execution() {
    use copernico_app_lib::indexer::Indexer;
    use copernico_app_lib::tool_registry::{BuiltinTool, PerguntarAoUsuarioTool, ToolContext};
    use copernico_app_lib::vault::VaultManager;
    use serde_json::json;
    use std::sync::Arc;

    let dir = tempdir().unwrap();
    let db = Arc::new(Database::init(Path::new(":memory:")).unwrap());
    let vm = Arc::new(VaultManager::new(
        dir.path().join("default"),
        dir.path().join("obsidian"),
    ));
    let idx = Arc::new(Indexer::new(db.get_pool(), vm.clone()).unwrap());

    let ctx = ToolContext {
        db: db.clone(),
        vault: vm,
        indexer: idx,
        skills_dir: dir.path().join("skills"),
    };

    let tool = PerguntarAoUsuarioTool;
    let args = json!({
        "pergunta": "Deseja arquivar as 3 notas obsoletas?",
        "contexto": "Curadoria encontrou notas sem atualização há 6 meses",
        "opcoes": ["Sim, arquivar todas", "Não, manter", "Revisar manualmente"]
    });

    let res_str = tool.execute(&args, &ctx);
    let res: serde_json::Value = serde_json::from_str(&res_str).unwrap();

    assert_eq!(res["status"], "aguardando_resposta");
    assert_eq!(res["pergunta"], "Deseja arquivar as 3 notas obsoletas?");
    assert_eq!(res["opcoes"].as_array().unwrap().len(), 3);

    // Verifica que o item foi inserido na Inbox do SQLite
    let inbox_items = db.list_inbox_items().unwrap();
    assert_eq!(inbox_items.len(), 1);
    assert_eq!(inbox_items[0].item_type, "question");
    assert!(inbox_items[0].requires_decision);
    assert!(inbox_items[0].content.contains("Opções Sugeridas"));
}

#[test]
fn test_skill_config_persistence_and_reset() {
    let db = Database::init(Path::new(":memory:")).unwrap();

    let key = "skill_config::note-curator";
    assert_eq!(db.get_setting(key).unwrap(), None);

    let sample_config = serde_json::json!({
        "custom_goal": "Focar em notas duplicadas sobre tecnologia",
        "max_iterations": 12,
        "system_prompt": "Você é um especialista em desduplicação.",
        "options": {
            "verbalize_searches": true,
            "stream_thoughts": false,
            "ask_clarifications": true
        }
    });

    db.set_setting(key, &sample_config.to_string()).unwrap();

    let saved = db
        .get_setting(key)
        .unwrap()
        .expect("Configuração deveria existir");
    let parsed: serde_json::Value = serde_json::from_str(&saved).unwrap();

    assert_eq!(parsed["max_iterations"], 12);
    assert_eq!(
        parsed["custom_goal"],
        "Focar em notas duplicadas sobre tecnologia"
    );
    assert_eq!(parsed["options"]["verbalize_searches"], true);

    // Reset (deleta a chave)
    db.delete_setting(key).unwrap();
    assert_eq!(db.get_setting(key).unwrap(), None);
}

#[test]
fn test_message_tokens_and_parent_id_persistence() {
    let db = Database::init(Path::new(":memory:")).unwrap();
    let s = db.create_session(Some("Sessão Tokens")).unwrap();

    let m1 = db
        .add_message_with_meta(&s.id, "user", "Pergunta teste", None, None, Some(15), None)
        .unwrap();
    let _m2 = db
        .add_message_with_meta(
            &s.id,
            "assistant",
            "Resposta teste",
            None,
            None,
            Some(42),
            Some(m1),
        )
        .unwrap();

    let msgs = db.get_messages(&s.id).unwrap();
    assert_eq!(msgs.len(), 2);
    assert_eq!(msgs[0].tokens, Some(15));
    assert_eq!(msgs[0].parent_id, None);
    assert_eq!(msgs[1].tokens, Some(42));
    assert_eq!(msgs[1].parent_id, Some(m1));
}

#[test]
fn test_to_note_slug() {
    use copernico_app_lib::indexer::to_note_slug;
    assert_eq!(
        to_note_slug("Planejamento Viagem 2026"),
        "planejamento_viagem_2026"
    );
    assert_eq!(
        to_note_slug("Arquitetura & Design de Sistemas!"),
        "arquitetura_design_de_sistemas"
    );
    assert_eq!(to_note_slug("Nota_Simples"), "nota_simples");
}

#[test]
fn test_vault_create_inbox_note() {
    let dir = tempdir().unwrap();
    let default_vault = dir.path().join("default");
    let obsidian_vault = dir.path().join("obsidian");
    std::fs::create_dir_all(&default_vault).unwrap();
    std::fs::create_dir_all(&obsidian_vault).unwrap();

    let vm = VaultManager::new(default_vault.clone(), obsidian_vault.clone());

    let created_path = vm
        .create_inbox_note(
            "Ideia Consolidada de Voz",
            "Esta nota resume os principais pontos discutidos por voz.",
            Some(vec!["ia".to_string()]),
            Some(vec!["Projetos".to_string()]),
        )
        .expect("Falha ao salvar nota no Inbox");

    assert!(created_path.starts_with(default_vault.join("Inbox")));
    assert!(created_path.exists());

    let note = vm
        .read_note("Ideia Consolidada de Voz")
        .expect("Falha ao ler nota");
    assert_eq!(note.titulo, "Ideia Consolidada de Voz");
    assert!(note.frontmatter.tags.contains(&"inbox".to_string()));
    assert!(note.frontmatter.tags.contains(&"ia".to_string()));
    assert_eq!(
        note.content,
        "Esta nota resume os principais pontos discutidos por voz."
    );
}

#[test]
fn test_encerrar_sessao_tool() {
    use copernico_app_lib::tool_registry::{BuiltinTool, EncerrarSessaoTool, ToolContext};
    use std::sync::Arc;

    let dir = tempdir().unwrap();
    let db = Arc::new(Database::init(Path::new(":memory:")).unwrap());
    let vm = Arc::new(VaultManager::new(
        dir.path().join("default"),
        dir.path().join("obsidian"),
    ));
    let idx =
        Arc::new(copernico_app_lib::indexer::Indexer::new(db.get_pool(), vm.clone()).unwrap());

    let ctx = ToolContext {
        db,
        vault: vm,
        indexer: idx,
        skills_dir: dir.path().join("skills"),
    };

    let tool = EncerrarSessaoTool;
    assert_eq!(tool.name(), "encerrar_sessao");

    let args = serde_json::json!({
        "motivo": "Obrigado, até a próxima!"
    });
    let result_str = tool.execute(&args, &ctx);
    let parsed: serde_json::Value = serde_json::from_str(&result_str).unwrap();
    assert_eq!(parsed["acao"], "encerrar_sessao");
    assert_eq!(parsed["motivo"], "Obrigado, até a próxima!");
    assert_eq!(parsed["status"], "encerrada");
}

#[test]
fn test_base_file_parsing_and_compilation() {
    let dir = tempdir().unwrap();
    let default_vault = dir.path().join("default");
    let obsidian_vault = dir.path().join("obsidian");
    std::fs::create_dir_all(&default_vault).unwrap();
    std::fs::create_dir_all(obsidian_vault.join("Cinema").join("Titulos")).unwrap();

    let vm = VaultManager::new(default_vault.clone(), obsidian_vault.clone());

    // 1. Cria notas filhas com propriedades no frontmatter
    let bacurau_content = r#"---
Assistido:
  - Assistido
Genero:
  - Drama
  - Suspense
Nota: 9
---
"#;
    std::fs::write(
        obsidian_vault
            .join("Cinema")
            .join("Titulos")
            .join("Bacurau.md"),
        bacurau_content,
    )
    .unwrap();

    let onda_content = r#"---
Assistido:
  - Assistido
Genero:
  - Drama
Nota: 7
---
"#;
    std::fs::write(
        obsidian_vault
            .join("Cinema")
            .join("Titulos")
            .join("A Onda.md"),
        onda_content,
    )
    .unwrap();

    // 2. Cria arquivo .base definindo a visualização tabular
    let base_content = r#"filters:
  and:
    - file.inFolder("Cinema/Titulos")
views:
  - type: table
    name: Tabela
    order:
      - file.name
      - Assistido
      - Genero
      - Nota
"#;
    let base_path = obsidian_vault.join("Cinema").join("Lista de filmes.base");
    std::fs::write(&base_path, base_content).unwrap();

    // 3. Testa detecção e listagem de .base
    let base_files = vm.list_base_files(&obsidian_vault);
    assert_eq!(base_files.len(), 1);
    assert_eq!(base_files[0], base_path);

    // 4. Testa parsing do .base
    let base = VaultManager::parse_base_file(&base_path, &obsidian_vault).unwrap();
    assert_eq!(base.title, "Lista de filmes");
    assert_eq!(base.folder_filter, "Cinema/Titulos");
    assert_eq!(base.category.as_deref(), Some("Cinema"));
    assert!(base.columns.contains(&"Assistido".to_string()));
    assert!(base.columns.contains(&"Genero".to_string()));
    assert!(base.columns.contains(&"Nota".to_string()));

    // 5. Testa compilação da tabela Markdown
    let compiled = vm.compile_base_to_markdown(&base).unwrap();
    assert!(compiled.contains("# Lista de filmes"));
    assert!(compiled.contains("Categoria: Cinema"));
    assert!(compiled.contains("| Item |"));
    assert!(compiled.contains("Bacurau"));
    assert!(compiled.contains("A Onda"));
    assert!(compiled.contains("Suspense"));
    assert!(compiled.contains("Nota"));

    // 6. Testa read_note transparente resolvendo o .base pelo título
    let note = vm.read_note("Lista de filmes").unwrap();
    assert_eq!(note.titulo, "Lista de filmes");
    assert_eq!(note.vault, "obsidian");
    assert!(note.content.contains("| Item |"));
    assert!(note.content.contains("Bacurau"));

    // 7. Testa indexação no FastEmbed e busca semântica
    let db = Database::init(Path::new(":memory:")).unwrap();
    let indexer =
        copernico_app_lib::indexer::Indexer::new(db.get_pool(), std::sync::Arc::new(vm.clone()))
            .unwrap();

    let indexed = indexer.index_single_base(&base_path).unwrap();
    assert!(indexed);

    // Busca por "Bacurau" deve retornar a nota virtual "Lista de filmes"
    let results = indexer.search_notes("Bacurau", 5).unwrap();
    assert!(!results.is_empty());
    assert_eq!(results[0].titulo, "Lista de filmes");
    assert_eq!(results[0].vault, "obsidian");
    assert!(results[0].preview.contains("Bacurau") || results[0].preview.contains("Item"));
}

#[test]
fn test_vault_create_evolved_note_and_lineage_graph() {
    let dir = tempdir().unwrap();
    let default_vault = dir.path().join("default");
    let obsidian_vault = dir.path().join("obsidian");
    std::fs::create_dir_all(&default_vault).unwrap();
    std::fs::create_dir_all(&obsidian_vault).unwrap();

    let vm = VaultManager::new(default_vault.clone(), obsidian_vault.clone());

    // 1. Cria a nota base no cofre Obsidian (R/O)
    let obsidian_note_content = r#"---
aliases: [IA, Modelos]
tags: [arquitetura, rag]
---
# Arquitetura Cognitiva
Nota original armazenada no cofre do Obsidian."#;
    std::fs::write(
        obsidian_vault.join("Arquitetura_Cognitiva.md"),
        obsidian_note_content,
    )
    .unwrap();

    // 2. Cria uma nota de evolução via VaultManager (in-place canonical evolution)
    let proposal = "Adição de camada de RAG local com FastEmbed e grafo de linhagem.";
    let changelog =
        "- Adicionada busca vetorial com boost de recência\n- Links pontilhados no grafo";
    let evolved_path = vm
        .create_evolved_note(
            "Arquitetura_Cognitiva",
            proposal,
            changelog,
            Some("session-test-456"),
            None,
        )
        .expect("Falha ao criar nota de evolução");

    // Deve ser gravado diretamente como a nota canônica no cofre default (sem subpastas evolucoes/)
    assert_eq!(evolved_path, default_vault.join("Arquitetura_Cognitiva.md"));
    assert!(!evolved_path.to_string_lossy().contains("evolucoes"));
    assert_eq!(
        evolved_path.extension().and_then(|e| e.to_str()),
        Some("md")
    );
    assert!(evolved_path.exists());

    // 3. Lê a nota de evolução e valida frontmatter e estrutura in-place
    let evolved_note = vm
        .read_note("Arquitetura_Cognitiva")
        .expect("Falha ao ler nota de evolução");

    assert_eq!(evolved_note.vault, "default");
    assert_eq!(
        evolved_note.frontmatter.base_origem.as_deref(),
        Some("[[Arquitetura_Cognitiva]]")
    );
    assert_eq!(
        evolved_note.frontmatter.sessao_origem.as_deref(),
        Some("session-test-456")
    );
    assert!(evolved_note.content.contains(proposal));
    assert!(evolved_note
        .content
        .contains("## 📜 Histórico de Alterações"));
    assert!(evolved_note.content.contains(changelog));

    // A nota base no Obsidian permaneceu 100% inalterada
    let original_content =
        std::fs::read_to_string(obsidian_vault.join("Arquitetura_Cognitiva.md")).unwrap();
    assert_eq!(original_content, obsidian_note_content);
}

#[test]
fn test_vault_evolve_note_in_place_default_vault() {
    let dir = tempdir().unwrap();
    let default_vault = dir.path().join("default");
    let obsidian_vault = dir.path().join("obsidian");
    std::fs::create_dir_all(&default_vault).unwrap();
    std::fs::create_dir_all(&obsidian_vault).unwrap();

    let vm = VaultManager::new(default_vault.clone(), obsidian_vault.clone());

    // 1. Cria uma nota original no cofre default
    let original_path = vm
        .create_note(
            "Financas Pessoais",
            "# Finanças Pessoais\n\nControle de gastos mensais.",
            Some(vec!["financeiro".to_string()]),
            None,
        )
        .unwrap();
    assert!(original_path.exists());

    // 2. Primeira evolução in-place
    let updated_path = vm
        .evolve_note_in_place(
            "Financas Pessoais",
            "Adicionada meta de investimentos para 2026",
            "# Finanças Pessoais\n\nControle de gastos mensais e investimentos.",
            Some("session-fin-1"),
            Some(vec!["investimentos".to_string()]),
        )
        .expect("Falha na evolução in-place");

    assert_eq!(updated_path, original_path);

    let read_back = vm.read_note("Financas Pessoais").unwrap();
    assert!(read_back
        .content
        .contains("Controle de gastos mensais e investimentos."));
    assert!(read_back.content.contains("## 📜 Histórico de Alterações"));
    assert!(read_back
        .content
        .contains("Adicionada meta de investimentos para 2026"));
    assert!(read_back
        .frontmatter
        .tags
        .contains(&"investimentos".to_string()));

    // 3. Segunda evolução in-place (deve anexar ao histórico existente)
    vm.evolve_note_in_place(
        "Financas Pessoais",
        "Ajustada meta para aporte mensal",
        "# Finanças Pessoais\n\nControle com meta de aporte mensal atualizada.",
        Some("session-fin-2"),
        None,
    )
    .expect("Falha na 2ª evolução in-place");

    let read_back_2 = vm.read_note("Financas Pessoais").unwrap();
    assert!(read_back_2
        .content
        .contains("Adicionada meta de investimentos para 2026"));
    assert!(read_back_2
        .content
        .contains("Ajustada meta para aporte mensal"));

    // Garante que só existe 1 nota no cofre default (sem proliferação de notas evoluídas)
    let md_files = vm.list_md_files(&default_vault);
    assert_eq!(md_files.len(), 1);
}

#[test]
fn test_tabular_data_storage_and_queries() {
    let db = Database::init(Path::new(":memory:")).unwrap();

    // 1. Inserção de métricas
    let id1 = db
        .insert_tabular_metric(
            "finance",
            "2026-03-15",
            "gasto_diario",
            45.50,
            Some("Almoço com equipe"),
            Some("Financas_Marco"),
        )
        .expect("Falha ao inserir métrica 1");
    assert!(!id1.is_empty());

    let id2 = db
        .insert_tabular_metric(
            "finance",
            "2026-03-16",
            "gasto_diario",
            120.00,
            Some("Combustível"),
            Some("Financas_Marco"),
        )
        .expect("Falha ao inserir métrica 2");
    assert!(!id2.is_empty());

    let id3 = db
        .insert_tabular_metric(
            "saude",
            "2026-03-16",
            "peso_kg",
            78.4,
            Some("Pesagem matinal"),
            None,
        )
        .expect("Falha ao inserir métrica 3");
    assert!(!id3.is_empty());

    // 2. Consulta sem filtros
    let all = db.query_tabular_metrics(None, None, None, None).unwrap();
    assert_eq!(all.len(), 3);

    // 3. Consulta por categoria
    let fin = db
        .query_tabular_metrics(Some("finance"), None, None, None)
        .unwrap();
    assert_eq!(fin.len(), 2);
    assert!(fin.iter().all(|m| m.category == "finance"));

    // 4. Consulta por metric_key (4º parâmetro)
    let peso = db
        .query_tabular_metrics(None, None, None, Some("peso_kg"))
        .unwrap();
    assert_eq!(peso.len(), 1);
    assert_eq!(peso[0].metric_value, 78.4);
    assert_eq!(peso[0].notes.as_deref(), Some("Pesagem matinal"));

    // 5. Consulta por data (2º e 3º parâmetros)
    let on_16 = db
        .query_tabular_metrics(None, Some("2026-03-16"), Some("2026-03-16"), None)
        .unwrap();
    assert_eq!(on_16.len(), 2);
}

#[test]
fn test_dynamic_date_formats_and_vault_formatting() {
    use copernico_app_lib::vault::{get_active_date_format, hoje_ddmmyy, set_active_date_format};

    // 1. Padrão YYYY-MM-DD
    set_active_date_format("YYYY-MM-DD");
    assert_eq!(get_active_date_format(), "YYYY-MM-DD");
    let d_iso = hoje_ddmmyy();
    assert_eq!(d_iso.len(), 10);
    assert_eq!(&d_iso[4..5], "-");
    assert_eq!(&d_iso[7..8], "-");

    // 2. Padrão DD-MM-YYYY
    set_active_date_format("DD-MM-YYYY");
    assert_eq!(get_active_date_format(), "DD-MM-YYYY");
    let d_full = hoje_ddmmyy();
    assert_eq!(d_full.len(), 10);
    assert_eq!(&d_full[2..3], "-");
    assert_eq!(&d_full[5..6], "-");

    // 3. Padrão DD-MM-YY
    set_active_date_format("DD-MM-YY");
    assert_eq!(get_active_date_format(), "DD-MM-YY");
    let d_short = hoje_ddmmyy();
    assert_eq!(d_short.len(), 8);
    assert_eq!(&d_short[2..3], "-");
    assert_eq!(&d_short[5..6], "-");
}

#[test]
fn test_db_inbox_items_lifecycle_and_proposals() {
    let db = Database::init(Path::new(":memory:")).unwrap();

    // 1. Cria item de inbox com proposta de evolução
    let item = db
        .create_inbox_item_full(
            Some("session-999"),
            "Evolução de Nota de Redes Neurais",
            Some("Identificado padrão emergente"),
            "Conteúdo explicativo da proposta",
            "evolution_proposal",
            true,
            Some("Redes_Neurais"),
            Some("Nova formulação com transformers"),
            Some("{\"type\":\"diff\",\"chunks\":[]}"),
        )
        .expect("Falha ao criar item de inbox");

    assert_eq!(item.item_type, "evolution_proposal");
    assert_eq!(item.status, "unread");
    assert_eq!(item.target_base_note_slug.as_deref(), Some("Redes_Neurais"));
    assert_eq!(
        item.proposed_content.as_deref(),
        Some("Nova formulação com transformers")
    );
    assert!(item.diff_data.is_some());

    // 2. Testa contagem de não lidos (deve incluir 'pending')
    let unread_count = db.get_unread_inbox_count().unwrap();
    assert_eq!(unread_count, 1);

    // 3. Atualiza proposta refinada
    db.update_inbox_proposal(&item.id, "Conteúdo ainda mais refinado", None)
        .expect("Falha ao atualizar proposta");

    // 4. Lista itens e verifica alteração
    let items = db.list_inbox_items().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(
        items[0].proposed_content.as_deref(),
        Some("Conteúdo ainda mais refinado")
    );

    // 5. Atualiza status para snoozed
    db.mark_inbox_item_status(&item.id, "snoozed").unwrap();
    let unread_after_snooze = db.get_unread_inbox_count().unwrap();
    assert_eq!(
        unread_after_snooze, 0,
        "Item em 'snoozed' não deve contar como unread"
    );

    // 6. Atualiza status para applied
    db.mark_inbox_item_status(&item.id, "applied").unwrap();
    let updated_items = db.list_inbox_items().unwrap();
    assert_eq!(updated_items[0].status, "applied");
}

#[test]
fn test_personalized_system_prompt_injection() {
    let db = Database::init(Path::new(":memory:")).unwrap();
    let base_prompt = "Você é o copiloto do usuário.";

    // 1. Sem personalização definida (mas com padrão de data injetado)
    let prompt_default = build_personalized_system_prompt(&db, base_prompt);
    assert!(prompt_default.contains(base_prompt));
    assert!(prompt_default.contains("[PADRÃO DE DATA E TEMPO ATUAL]"));
    assert!(!prompt_default.contains("[PERFIL DO USUÁRIO & PERSONALIZAÇÃO]"));
    assert!(!prompt_default.contains("[DIRETRIZES E REGRAS APRENDIDAS"));

    // 2. Com nome, estilo e instruções customizadas
    db.set_setting("user_name", "Patrick").unwrap();
    db.set_setting("communication_style", "direto").unwrap();
    db.set_setting(
        "agent_custom_instructions",
        "- Sempre formate consultas temporais no padrão YYYY-MM-DD\n- Evite introduções prolixas",
    )
    .unwrap();

    let personalized = build_personalized_system_prompt(&db, base_prompt);
    assert!(personalized.contains(base_prompt));
    assert!(personalized.contains("[PERFIL DO USUÁRIO & PERSONALIZAÇÃO]"));
    assert!(personalized.contains("- Nome do Usuário: Patrick"));
    assert!(personalized.contains("Você está interagindo diretamente com Patrick"));
    assert!(personalized.contains("Estilo de Comunicação Adotado: Direto e conciso."));
    assert!(personalized.contains("[DIRETRIZES E REGRAS APRENDIDAS (Aprovadas pelo Usuário)]"));
    assert!(personalized.contains("- Sempre formate consultas temporais no padrão YYYY-MM-DD"));
    assert!(personalized.contains("- Evite introduções prolixas"));
}

#[test]
fn test_instruction_improvement_inbox_lifecycle() {
    let db = Database::init(Path::new(":memory:")).unwrap();

    // 1. Criar proposta de melhoria de instrução operacional
    let item = db
        .create_inbox_item_full(
            Some("session-test-instruction"),
            "Melhoria de Busca Temporal",
            Some("Identificada falha em queries com nomes de meses por extenso"),
            "O agente identificou que queries de data funcionam melhor com ISO 8601.",
            "instruction_improvement",
            true,
            None,
            Some("- Sempre utilize o padrão ISO 8601 (YYYY-MM-DD) para filtrar notas por data."),
            Some("{\"diff\": \"+ - Sempre utilize o padrão ISO 8601 (YYYY-MM-DD)\"}"),
        )
        .expect("Falha ao criar item de melhoria de instrução");

    assert_eq!(item.item_type, "instruction_improvement");
    assert_eq!(item.status, "unread");
    assert_eq!(db.get_unread_inbox_count().unwrap(), 1);

    // 2. Simula aprovação de instrução pelo usuário
    let current_instructions = db
        .get_setting("agent_custom_instructions")
        .unwrap()
        .unwrap_or_default();
    let proposed = item.proposed_content.as_deref().unwrap();
    let updated_instructions = if current_instructions.trim().is_empty() {
        proposed.to_string()
    } else {
        format!("{}\n\n{}", current_instructions.trim(), proposed.trim())
    };

    db.set_setting("agent_custom_instructions", &updated_instructions)
        .unwrap();
    db.mark_inbox_item_status(&item.id, "applied").unwrap();

    // 3. Valida se a instrução foi incorporada e o status mudou
    let saved_instructions = db
        .get_setting("agent_custom_instructions")
        .unwrap()
        .unwrap_or_default();
    assert!(saved_instructions.contains("ISO 8601 (YYYY-MM-DD)"));

    let items = db.list_inbox_items().unwrap();
    assert_eq!(items[0].status, "applied");
    assert_eq!(db.get_unread_inbox_count().unwrap(), 0);
}

#[test]
fn test_user_profile_and_onboarding_db_settings() {
    let db = Database::init(Path::new(":memory:")).unwrap();

    // Inicialmente vazio
    assert_eq!(db.get_setting("user_name").unwrap(), None);
    assert_eq!(db.get_setting("communication_style").unwrap(), None);
    assert_eq!(db.get_setting("global_shortcut").unwrap(), None);
    assert_eq!(db.get_setting("onboarding_completed").unwrap(), None);

    // Salva perfil de onboarding
    db.set_setting("user_name", "Lucas").unwrap();
    db.set_setting("communication_style", "tecnico_analitico")
        .unwrap();
    db.set_setting("global_shortcut", "CommandOrControl+Shift+Space")
        .unwrap();
    db.set_setting("onboarding_completed", "true").unwrap();

    // Verifica persistência
    assert_eq!(
        db.get_setting("user_name").unwrap().as_deref(),
        Some("Lucas")
    );
    assert_eq!(
        db.get_setting("communication_style").unwrap().as_deref(),
        Some("tecnico_analitico")
    );
    assert_eq!(
        db.get_setting("global_shortcut").unwrap().as_deref(),
        Some("CommandOrControl+Shift+Space")
    );
    assert_eq!(
        db.get_setting("onboarding_completed").unwrap().as_deref(),
        Some("true")
    );
}

#[test]
fn test_skill_md_parsing_and_auto_detection() {
    use copernico_app_lib::skills::SkillManager;
    use std::fs;

    let dir = tempdir().unwrap();
    let skills_root = dir.path().join("skills");
    fs::create_dir_all(&skills_root).unwrap();

    let my_skill_dir = skills_root.join("analisador-ia");
    fs::create_dir_all(&my_skill_dir.join("scripts")).unwrap();

    let skill_md_content = r#"---
name: Analisador de IA
description: Realiza benchmarking de modelos
---

# Instruções
Execute análises detalhadas.
"#;
    fs::write(my_skill_dir.join("SKILL.md"), skill_md_content).unwrap();
    fs::write(
        my_skill_dir.join("scripts").join("benchmark.py"),
        "print('ok')",
    )
    .unwrap();

    let db = Database::init(Path::new(":memory:")).unwrap();
    let mgr = SkillManager::new(skills_root);
    let skills = mgr.list_skills(&db);

    assert_eq!(skills.len(), 1);
    let s = &skills[0];
    assert_eq!(s.id, "analisador-ia");
    assert_eq!(s.name, "Analisador de IA");
    assert_eq!(s.description, "Realiza benchmarking de modelos");
    assert!(s.has_scripts);
    assert_eq!(s.script_files, vec!["benchmark.py".to_string()]);
    assert!(s
        .prompt_instructions
        .contains("Execute análises detalhadas."));
    assert!(s.is_enabled);
}

#[test]
fn test_code_runner_python_execution() {
    use copernico_app_lib::code_runner::execute_python_code;

    let code = "print(21 * 2)";
    let res = execute_python_code(code);
    assert!(res.is_ok());
    assert_eq!(res.unwrap().trim(), "42");
}

#[test]
fn test_scheduled_routines_db_lifecycle() {
    use copernico_app_lib::db::ScheduledRoutine;

    let db = Database::init(Path::new(":memory:")).unwrap();

    let routine = ScheduledRoutine {
        id: "routine-curadoria-noturna".to_string(),
        titulo: "Curadoria Noturna".to_string(),
        cron_expr: "0 22 * * *".to_string(),
        prompt: "Revise as notas do dia e gere síntese.".to_string(),
        skill_id: Some("humanizador".to_string()),
        ativo: true,
        ultima_execucao: None,
        created_at: "2026-09-10T10:00:00Z".to_string(),
    };

    // 1. Salva rotina
    db.save_scheduled_routine(&routine)
        .expect("Falha ao salvar rotina");

    // 2. Lista rotinas
    let list = db
        .list_scheduled_routines()
        .expect("Falha ao listar rotinas");
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].id, "routine-curadoria-noturna");
    assert_eq!(list[0].titulo, "Curadoria Noturna");
    assert_eq!(list[0].skill_id.as_deref(), Some("humanizador"));
    assert!(list[0].ativo);

    // 3. Atualiza status para inativo
    db.toggle_scheduled_routine(&routine.id, false)
        .expect("Falha ao alternar rotina");
    let list2 = db.list_scheduled_routines().unwrap();
    assert!(!list2[0].ativo);

    // 4. Atualiza última execução
    db.update_routine_last_run(&routine.id, "2026-09-10T22:00:00Z")
        .unwrap();
    let list3 = db.list_scheduled_routines().unwrap();
    assert_eq!(
        list3[0].ultima_execucao.as_deref(),
        Some("2026-09-10T22:00:00Z")
    );

    // 5. Deleta rotina
    let deleted = db
        .delete_scheduled_routine(&routine.id)
        .expect("Falha ao deletar rotina");
    assert!(deleted);
    let list4 = db.list_scheduled_routines().unwrap();
    assert_eq!(list4.len(), 0);
}

#[test]
fn test_promote_subagent_skills_lifecycle() {
    use copernico_app_lib::skills::SkillManager;
    let temp_dir = tempfile::tempdir().unwrap();
    let skills_root = temp_dir.path().join("skills");
    let mgr = SkillManager::new(skills_root.clone());

    // Simula npx criando skill em .agents/skills/dummy-skill
    let agent_dummy = skills_root
        .join(".agents")
        .join("skills")
        .join("dummy-skill");
    std::fs::create_dir_all(&agent_dummy).unwrap();
    std::fs::write(
        agent_dummy.join("SKILL.md"),
        "---\nname: Dummy Skill\n---\nCorpo da skill",
    )
    .unwrap();

    // Executa promote
    mgr.promote_subagent_skills();

    // Verifica que foi promovida para skills/dummy-skill
    let promoted = skills_root.join("dummy-skill").join("SKILL.md");
    assert!(promoted.exists(), "Skill não foi promovida para a raiz");

    // Verifica que list_skills encontra a skill
    let db = Database::init(Path::new(":memory:")).unwrap();
    let list = mgr.list_skills(&db);
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].id, "dummy-skill");
}

#[test]
fn test_tts_fade_out_no_panic() {
    use copernico_app_lib::tts::EdgeTtsClient;
    let client = EdgeTtsClient::new("pt-BR-ThalitaNeural");
    // fade_out_and_stop deve executar de forma não-bloqueante e segura mesmo sem sink ativo
    client.fade_out_and_stop(100);
}

#[test]
fn test_date_format_ddmmyy() {
    use copernico_app_lib::vault::{agora_ddmmyy_hm, hoje_ddmmyy};
    let hoje = hoje_ddmmyy();
    let re = regex::Regex::new(r"^\d{2}-\d{2}-\d{2}$").unwrap();
    assert!(
        re.is_match(&hoje),
        "hoje_ddmmyy deve ser DD-MM-YY, obteve: {}",
        hoje
    );
    let agora = agora_ddmmyy_hm();
    let re2 = regex::Regex::new(r"^\d{2}-\d{2}-\d{2} \d{2}:\d{2}$").unwrap();
    assert!(
        re2.is_match(&agora),
        "agora_ddmmyy_hm deve ser DD-MM-YY HH:MM, obteve: {}",
        agora
    );
}

#[test]
fn test_consolidation_intent_detection() {
    use copernico_app_lib::consolidation::{has_consolidation_intent, has_explicit_delete_intent};
    assert!(has_consolidation_intent(
        &"preciso que fique concentrado em uma só, padrão".to_lowercase()
    ));
    assert!(has_consolidation_intent(
        &"unificar minhas listas espalhadas".to_lowercase()
    ));
    assert!(has_consolidation_intent(
        &"consolidar tudo na lista padrão de hoje".to_lowercase()
    ));
    assert!(!has_consolidation_intent(
        &"qual a previsão do tempo?".to_lowercase()
    ));
    assert!(has_explicit_delete_intent(
        &"delete a nota x".to_lowercase()
    ));
    assert!(!has_explicit_delete_intent(
        &"concentrado em uma só".to_lowercase()
    ));
}

#[test]
fn test_archive_then_delete_flow() {
    use copernico_app_lib::vault::VaultManager;
    let dir = tempdir().unwrap();
    let vm = VaultManager::new(dir.path().join("default"), dir.path().join("obsidian"));
    let p = vm
        .create_inbox_note("Nota Fonte Duplicada", "- item 1", None, None)
        .unwrap();
    assert!(p.exists());
    let snap = vm
        .archive_note(
            "Nota Fonte Duplicada",
            Some("Lista Padrão"),
            Some("sessao-teste"),
            "duplicata incorporada",
        )
        .expect("Falha ao arquivar");
    assert!(snap.exists());
    assert!(snap.to_string_lossy().contains("arquivo"));
    let snap_text = std::fs::read_to_string(&snap).unwrap();
    assert!(snap_text.contains("item 1"));
    assert!(snap_text.contains("Lista Padrão"));
    let re = regex::Regex::new(r"\d{2}-\d{2}-\d{2}").unwrap();
    assert!(
        re.is_match(&snap_text),
        "Snapshot deve conter data DD-MM-YY"
    );
    vm.delete_note("Nota Fonte Duplicada").unwrap();
    assert!(!p.exists());
}

#[test]
fn test_rename_with_repoint() {
    use copernico_app_lib::vault::VaultManager;
    let dir = tempdir().unwrap();
    let vm = VaultManager::new(dir.path().join("default"), dir.path().join("obsidian"));
    vm.create_note("Nota Antiga", "Conteúdo base", None, None)
        .unwrap();
    vm.create_note(
        "Nota Que Cita",
        "Ver [[Nota Antiga]] e [[Nota Antiga|alias]]",
        None,
        None,
    )
    .unwrap();
    let rep = vm
        .rename_note_with_repoint("Nota Antiga", "Nota Nova Padrao")
        .unwrap();
    assert!(rep.new_path.exists());
    assert!(!rep.old_path.exists());
    assert_eq!(rep.new_title, "Nota Nova Padrao");
    assert_eq!(rep.repointed_files.len(), 1);
    let citadora = vm.read_note("Nota Que Cita").unwrap();
    assert!(citadora.content.contains("[[Nota Nova Padrao]]"));
    assert!(citadora.content.contains("[[Nota Nova Padrao|alias]]"));
    assert!(!citadora.content.contains("Nota Antiga"));
    let renomeada = vm.read_note("Nota Nova Padrao").unwrap();
    assert_eq!(
        renomeada.frontmatter.titulo.as_deref(),
        Some("Nota Nova Padrao")
    );
    let re = regex::Regex::new(r"\d{2}-\d{2}-\d{2}").unwrap();
    let raw = std::fs::read_to_string(&rep.new_path).unwrap();
    assert!(
        re.is_match(&raw),
        "Nota renomeada deve ter data DD-MM-YY no frontmatter"
    );
}

#[test]
fn test_inbox_decision_reason_sanitize_and_mirror_text() {
    use copernico_app_lib::commands::mirror_text_for_decision;
    use copernico_app_lib::db::sanitize_decision_reason;
    assert_eq!(sanitize_decision_reason(None), None);
    assert_eq!(sanitize_decision_reason(Some("   ")), None);
    assert_eq!(
        sanitize_decision_reason(Some("  duplicada  ")).as_deref(),
        Some("duplicada")
    );
    let long = "x".repeat(200);
    assert_eq!(
        sanitize_decision_reason(Some(&long))
            .unwrap()
            .chars()
            .count(),
        140
    );
    let dismissed = mirror_text_for_decision("dismissed", "Nota A", Some("duplicada"));
    assert!(dismissed.contains("rejeitou"));
    assert!(dismissed.contains("NADA foi criado"));
    assert!(dismissed.contains("duplicada"));
    let applied = mirror_text_for_decision("applied", "Nota B", None);
    assert!(applied.contains("aprovou"));
}

#[test]
fn test_inbox_dismissed_retention_prune_72h() {
    use copernico_app_lib::db::Database;
    let db = Database::init(Path::new(":memory:")).unwrap();
    let item = db
        .create_inbox_item(
            Some("sess-1"),
            "Nota A",
            None,
            "conteudo",
            "voice_consolidation",
            true,
        )
        .unwrap();
    db.mark_inbox_item_status_with_reason(&item.id, "dismissed", Some("duplicada"))
        .unwrap();
    // Recém-dispensado: purga de 72h não remove.
    assert_eq!(db.prune_dismissed_expired().unwrap(), 0);
    assert!(db.get_inbox_item(&item.id).unwrap().is_some());
    // Simula dismiss há 73h e purga.
    {
        let conn = db.get_pool().get().unwrap();
        conn.execute(
            "UPDATE inbox_items SET updated_at = '2000-01-01T00:00:00Z' WHERE id = ?1",
            rusqlite::params![item.id],
        )
        .unwrap();
    }
    assert_eq!(db.prune_dismissed_expired().unwrap(), 1);
    assert!(db.get_inbox_item(&item.id).unwrap().is_none());
}

#[test]
fn test_agent_inbox_decisions_block_rejected_not_created() {
    use copernico_app_lib::agent::build_inbox_decisions_block;
    use copernico_app_lib::db::Database;
    let db = Database::init(Path::new(":memory:")).unwrap();
    let s = db.create_session(Some("Sessao Voz")).unwrap();
    let a = db
        .create_inbox_item(
            Some(&s.id),
            "Nota A",
            None,
            "c",
            "voice_consolidation",
            true,
        )
        .unwrap();
    let b = db
        .create_inbox_item(
            Some(&s.id),
            "Nota B",
            None,
            "c",
            "voice_consolidation",
            false,
        )
        .unwrap();
    db.mark_inbox_item_status_with_reason(&a.id, "dismissed", Some("nao preciso"))
        .unwrap();
    db.mark_inbox_item_status_with_reason(&b.id, "applied", None)
        .unwrap();
    let block = build_inbox_decisions_block(&db, &s.id).expect("bloco esperado");
    assert!(block.contains("REJEITADA"));
    assert!(
        block.contains("NÃO reproponha") || block.contains("NÃ£o") || block.contains("reproponha")
    );
    assert!(block.contains("APLICADA"));
    assert!(block.contains("nao preciso"));
}

#[test]
fn test_delete_tool_archives_before_delete() {
    use copernico_app_lib::indexer::Indexer;
    use copernico_app_lib::tool_registry::{BuiltinTool, DeletarNotaTool, ToolContext};
    use copernico_app_lib::vault::VaultManager;
    use serde_json::json;
    use std::sync::Arc;
    let dir = tempdir().unwrap();
    let db = Arc::new(Database::init(Path::new(":memory:")).unwrap());
    let vm = Arc::new(VaultManager::new(
        dir.path().join("default"),
        dir.path().join("obsidian"),
    ));
    let idx = Arc::new(Indexer::new(db.get_pool(), vm.clone()).unwrap());
    let ctx = ToolContext {
        db,
        vault: vm.clone(),
        indexer: idx,
        skills_dir: dir.path().join("skills"),
    };
    vm.create_inbox_note("Nota Para Arquivar", "conteúdo a preservar", None, None)
        .unwrap();
    let tool = DeletarNotaTool;
    let res_str = tool.execute(&json!({"identifier": "Nota Para Arquivar", "incorporada_em": "Lista Padrão", "motivo": "teste"}), &ctx);
    let res: serde_json::Value = serde_json::from_str(&res_str).unwrap();
    assert_eq!(res["ok"], true);
    assert!(res.get("arquivada_em").and_then(|v| v.as_str()).is_some());
    assert!(vm.read_note("Nota Para Arquivar").is_err());
    let snaps: Vec<_> = vm.list_md_files(&vm.default_vault.join("arquivo"));
    assert!(!snaps.is_empty());
}

#[tokio::test]
async fn test_deepseek_live_call() {
    use copernico_app_lib::config::AppConfig;
    use copernico_app_lib::db::Database;
    use copernico_app_lib::indexer::Indexer;
    use copernico_app_lib::llm::{ChatMessage, LlmClient};
    use copernico_app_lib::mcp::McpManager;
    use copernico_app_lib::tool_registry::ToolRegistry;
    use copernico_app_lib::vault::VaultManager;
    use std::path::Path;
    use std::sync::Arc;
    use tempfile::tempdir;

    let config = Arc::new(AppConfig::from_env());
    if config.deepseek_api_key.is_empty() {
        println!("Skipping: no DEEPSEEK_API_KEY");
        return;
    }
    let llm = LlmClient::new(config.clone());
    let dir = tempdir().unwrap();
    let db = Arc::new(Database::init(Path::new(":memory:")).unwrap());
    let vm = Arc::new(VaultManager::new(
        dir.path().join("default"),
        dir.path().join("obsidian"),
    ));
    let idx = Arc::new(Indexer::new(db.get_pool(), vm.clone()).unwrap());

    let mcp = Arc::new(McpManager::new());
    let reg = ToolRegistry::new(
        db.clone(),
        vm.clone(),
        idx.clone(),
        mcp,
        dir.path().join("skills"),
    );
    let tools = reg.get_filtered_definitions(&[
        "buscar_notas".to_string(),
        "ler_nota".to_string(),
        "executar_script_skill".to_string(),
        "perguntar_ao_usuario".to_string(),
        "encerrar_sessao".to_string(),
    ]);
    println!(
        "Tools passed to DeepSeek:\n{}",
        serde_json::to_string_pretty(&tools).unwrap()
    );

    let msgs = vec![
        ChatMessage {
            role: "system".to_string(),
            content: Some("Você é o assistente Copernico respondendo por voz.".to_string()),
            tool_calls: None,
            tool_call_id: None,
            tokens: None,
            reasoning_content: None,
        },
        ChatMessage {
            role: "system".to_string(),
            content: Some("Você acabou de cumprimentar o usuário com: 'Oi Patrick, estou te ouvindo. Do que precisa hoje?'. Não repita a saudação, continue naturalmente e sem monotonidade.".to_string()),
            tool_calls: None,
            tool_call_id: None,
            tokens: None,
            reasoning_content: None,
        },
        ChatMessage {
            role: "user".to_string(),
            content: Some("Fala aí, cara Ai, Deus, eu só queria dar um oi Você tá bem?".to_string()),
            tool_calls: None,
            tool_call_id: None,
            tokens: None,
            reasoning_content: None,
        },
        ChatMessage {
            role: "user".to_string(),
            content: Some("Fala aí, mano, como é que você tá hoje?".to_string()),
            tool_calls: None,
            tool_call_id: None,
            tokens: None,
            reasoning_content: None,
        },
    ];

    let res = llm.chat_completion(&msgs, Some(tools)).await;
    println!("DeepSeek live test with tools result: {:?}", res);
    assert!(
        res.is_ok(),
        "DeepSeek live call with tools failed: {:?}",
        res.err()
    );
}

#[test]
fn test_wake_word_session_routing_isolated_sessions_and_cancel_guards() {
    use copernico_app_lib::wake_word::WakeWordService;

    let db = Database::init(Path::new(":memory:")).expect("Falha ao criar DB em memória");
    let wake_service = WakeWordService::new();

    // 1. Inicialmente, nenhuma sessão ativa
    assert_eq!(wake_service.get_active_session(), None);

    // 2. Primeira chamada de voz cria sessão isolada 1
    let session_1 = db.create_session(None).expect("Deveria criar sessão 1");
    wake_service.set_active_session(Some(session_1.id.clone()));
    let session_1_id = session_1.id;
    assert_eq!(
        wake_service.get_active_session().as_deref(),
        Some(session_1_id.as_str())
    );

    // 3. Segunda chamada de voz (wake word não-followup) cria SEMPRE uma nova sessão isolada 2:
    let session_2 = db.create_session(None).expect("Deveria criar sessão 2");
    wake_service.set_active_session(Some(session_2.id.clone()));
    let session_2_id = session_2.id;
    assert_ne!(
        session_1_id, session_2_id,
        "Cada ativação de voz deve criar uma sessão isolada"
    );

    // 4. Teste de descarte no turno zero em Cancel:
    // Sessão sem mensagens: user_turns == 0
    let msgs = db.get_messages(&session_2_id).unwrap_or_default();
    let user_turns = msgs.iter().filter(|m| m.role == "user").count();
    let assistant_turns = msgs.iter().filter(|m| m.role == "assistant").count();
    assert_eq!(user_turns, 0);
    assert_eq!(assistant_turns, 0);
    // Em turno zero, não consolida e deleta sessão vazia:
    if msgs.is_empty() {
        let _ = db.delete_session(&session_2_id);
    }
    wake_service.set_active_session(None);
    assert_eq!(wake_service.get_active_session(), None);
    assert!(db.get_session(&session_2_id).unwrap().is_none());

    // 5. Teste da guarda anti-reconsolidação por last_consolidated_user_msg_id:
    let session_3 = db.create_session(None).expect("Deveria criar sessão 3");
    let s3_id = session_3.id;

    // Usuário fala primeiro turno
    let msg1_id = db
        .add_message(&s3_id, "user", "Qual a previsão para amanhã?", None, None)
        .expect("salvar user msg");
    let _ = db
        .add_message(&s3_id, "assistant", "Amanhã fará sol.", None, None)
        .expect("salvar assistant msg");

    // Simula primeira consolidação: salva last_consolidated_user_msg_id
    let last_key = format!("last_consolidated_user_msg_id::{}", s3_id);
    db.set_setting(&last_key, &msg1_id.to_string()).unwrap();

    // Sistema insere mensagem de espelho (aprovação no Inbox com role == 'assistant')
    let _ = db
        .add_message(
            &s3_id,
            "assistant",
            "✅ Você aprovou 'Regra de teste'",
            None,
            None,
        )
        .expect("salvar espelho");

    // Verifica guarda: último user msg id continua sendo msg1_id
    let msgs_after_mirror = db.get_messages(&s3_id).unwrap();
    let last_user_after_mirror = msgs_after_mirror
        .iter()
        .filter(|m| m.role == "user")
        .max_by_key(|m| m.id)
        .unwrap();
    let prev_id: i64 = db.get_setting(&last_key).unwrap().unwrap().parse().unwrap();
    assert!(
        last_user_after_mirror.id <= prev_id,
        "Mensagem do assistente/espelho não deve avançar o last_user_id nem rearmar consolidação"
    );

    // Usuário fala novo turno -> aí sim avança a guarda!
    let msg3_id = db
        .add_message(
            &s3_id,
            "user",
            "Obrigado, agora sim pode encerrar.",
            None,
            None,
        )
        .expect("salvar user msg 2");
    let msgs_new_turn = db.get_messages(&s3_id).unwrap();
    let last_user_new = msgs_new_turn
        .iter()
        .filter(|m| m.role == "user")
        .max_by_key(|m| m.id)
        .unwrap();
    assert!(
        last_user_new.id > prev_id,
        "Nova mensagem do usuário deve avançar o ID e permitir consolidação"
    );
    assert_eq!(last_user_new.id, msg3_id);
}

#[test]
fn test_thinking_templates_pool() {
    use copernico_app_lib::domain::models::{THINKING_TEMPLATES, TOTAL_THINKING_AUDIOS};

    assert_eq!(
        THINKING_TEMPLATES.len(),
        TOTAL_THINKING_AUDIOS,
        "Deve conter exatamente 30 templates"
    );
    assert_eq!(TOTAL_THINKING_AUDIOS, 30);

    // Valida variedade e unicidade
    let mut unique = std::collections::HashSet::new();
    for t in &THINKING_TEMPLATES {
        assert!(unique.insert(*t), "Template duplicado encontrado: {}", t);
        assert!(!t.contains("  "), "Espaço duplo em: {}", t);
        assert!(
            t.len() <= 40,
            "Template muito longo para clipe rápido (400ms-1.2s): {}",
            t
        );

        // Sem markdown sintético
        for forbidden in ["**", "#", "- ", "•", "|", ">", "```"] {
            assert!(
                !t.contains(forbidden),
                "Formatação inválida '{}' em: {}",
                forbidden,
                t
            );
        }
    }
}

#[test]
fn test_thinking_audio_item_serde() {
    use copernico_app_lib::domain::models::ThinkingAudioItem;

    let item = ThinkingAudioItem {
        id: "thk_12345678".to_string(),
        text: "Deixa eu ver...".to_string(),
        file: "thk_12345678.mp3".to_string(),
        voice: "pt-BR-ThalitaNeural".to_string(),
        created_at: "2026-09-17T00:00:00Z".to_string(),
        last_used: None,
    };

    let json = serde_json::to_string(&item).expect("Serialização deve suceder");
    let deserialized: ThinkingAudioItem =
        serde_json::from_str(&json).expect("Desserialização deve suceder");

    assert_eq!(item, deserialized);
    assert_eq!(deserialized.last_used, None);

    // Com last_used preenchido
    let with_used = ThinkingAudioItem {
        last_used: Some("2026-09-17T00:05:00Z".to_string()),
        ..item
    };
    let json2 = serde_json::to_string(&with_used).expect("Serialização com last_used deve suceder");
    let des2: ThinkingAudioItem =
        serde_json::from_str(&json2).expect("Desserialização deve suceder");
    assert_eq!(des2.last_used.as_deref(), Some("2026-09-17T00:05:00Z"));
}

#[test]
fn test_thinking_fs_crud_and_atomic() {
    use copernico_app_lib::domain::models::ThinkingAudioItem;
    use copernico_app_lib::infra::fs::ThinkingFileSystem;

    let temp = tempfile::tempdir().expect("Deve criar tempdir");
    let fs = ThinkingFileSystem::new(temp.path().to_path_buf());

    // 1. Diretório vazio
    let manifest = fs.load_manifest();
    assert!(manifest.is_empty());

    // 2. Salva manifesto com item cujo arquivo não existe -> load_manifest filtra fora
    let item1 = ThinkingAudioItem {
        id: "thk_item1".to_string(),
        text: "Analisando...".to_string(),
        file: "thk_item1.mp3".to_string(),
        voice: "pt-BR-ThalitaNeural".to_string(),
        created_at: "2026-09-17T00:00:00Z".to_string(),
        last_used: None,
    };
    fs.save_manifest(&[item1.clone()])
        .expect("Salvar manifesto deve funcionar");
    assert!(
        fs.load_manifest().is_empty(),
        "Item sem arquivo físico deve ser ignorado"
    );

    // 3. Grava áudio atomicamente
    fs.write_audio_file_atomic("thk_item1.mp3", b"dummy mp3 data")
        .expect("Gravação atômica deve suceder");
    let loaded = fs.load_manifest();
    assert_eq!(loaded.len(), 1);
    assert_eq!(loaded[0].id, "thk_item1");

    // 4. Deleta arquivo
    fs.delete_file("thk_item1.mp3")
        .expect("Deleção deve suceder");
    assert!(fs.load_manifest().is_empty());

    // 5. Clear all
    fs.write_audio_file_atomic("dummy1.mp3", b"test")
        .expect("Gravação deve funcionar");
    fs.clear_all().expect("Clear all deve funcionar");
    assert!(!fs.manifest_path().exists());
    assert!(!fs.file_path("dummy1.mp3").exists());
}

#[test]
fn test_thinking_manager_anti_repetition_and_db() {
    use copernico_app_lib::db::Database;
    use copernico_app_lib::domain::models::ThinkingAudioItem;
    use copernico_app_lib::services::thinking_srv::ThinkingAudiosManager;

    let temp = tempfile::tempdir().expect("Deve criar tempdir");
    let manager = ThinkingAudiosManager::new(temp.path().to_path_buf());
    let db =
        Database::init(std::path::Path::new(":memory:")).expect("Falha ao criar DB em memória");
    db.set_setting("tts_voice", "pt-BR-ThalitaNeural")
        .expect("Set voice deve funcionar");

    // Cria 3 itens válidos com arquivos físicos
    let items = vec![
        ThinkingAudioItem {
            id: "thk_01".to_string(),
            text: "Hum...".to_string(),
            file: "thk_01.mp3".to_string(),
            voice: "pt-BR-ThalitaNeural".to_string(),
            created_at: "2026-09-17T00:00:00Z".to_string(),
            last_used: None,
        },
        ThinkingAudioItem {
            id: "thk_02".to_string(),
            text: "Deixa eu ver...".to_string(),
            file: "thk_02.mp3".to_string(),
            voice: "pt-BR-ThalitaNeural".to_string(),
            created_at: "2026-09-17T00:00:00Z".to_string(),
            last_used: None,
        },
        ThinkingAudioItem {
            id: "thk_03".to_string(),
            text: "Analisando...".to_string(),
            file: "thk_03.mp3".to_string(),
            voice: "pt-BR-ThalitaNeural".to_string(),
            created_at: "2026-09-17T00:00:00Z".to_string(),
            last_used: None,
        },
    ];

    for item in &items {
        manager
            .fs()
            .write_audio_file_atomic(&item.file, b"test_audio")
            .expect("Deve gravar áudio");
    }
    manager
        .fs()
        .save_manifest(&items)
        .expect("Deve salvar manifesto");

    // Primeiro sorteio
    let first = manager
        .pick_thinking_audio(&db)
        .expect("Deve sortear um clipe");
    let last_db_id = db
        .get_setting("last_thinking_audio_id")
        .expect("Get setting deve suceder")
        .expect("Deve ter last_id");
    assert_eq!(first.id, last_db_id);

    // Segundo sorteio: anti-repetição garante que não é o mesmo ID!
    let second = manager
        .pick_thinking_audio(&db)
        .expect("Deve sortear segundo clipe");
    assert_ne!(
        first.id, second.id,
        "Anti-repetição: não deve sortear o mesmo filler duas vezes seguidas"
    );

    // Terceiro sorteio: não deve ser igual ao segundo
    let third = manager
        .pick_thinking_audio(&db)
        .expect("Deve sortear terceiro clipe");
    assert_ne!(second.id, third.id);
}

#[test]
fn test_thinking_manager_voice_filtering_and_invalidation() {
    use copernico_app_lib::db::Database;
    use copernico_app_lib::domain::models::ThinkingAudioItem;
    use copernico_app_lib::services::thinking_srv::ThinkingAudiosManager;

    let temp = tempfile::tempdir().expect("Deve criar tempdir");
    let manager = ThinkingAudiosManager::new(temp.path().to_path_buf());
    let db =
        Database::init(std::path::Path::new(":memory:")).expect("Falha ao criar DB em memória");

    // Cria 1 clipe com Thalita e 1 clipe com Antonio
    let item_thalita = ThinkingAudioItem {
        id: "thk_thalita".to_string(),
        text: "Só um segundo...".to_string(),
        file: "thk_thalita.mp3".to_string(),
        voice: "pt-BR-ThalitaNeural".to_string(),
        created_at: "2026-09-17T00:00:00Z".to_string(),
        last_used: None,
    };
    let item_antonio = ThinkingAudioItem {
        id: "thk_antonio".to_string(),
        text: "Verificando aqui...".to_string(),
        file: "thk_antonio.mp3".to_string(),
        voice: "pt-BR-AntonioNeural".to_string(),
        created_at: "2026-09-17T00:00:00Z".to_string(),
        last_used: None,
    };

    manager
        .fs()
        .write_audio_file_atomic(&item_thalita.file, b"audio_thalita")
        .expect("Gravação deve funcionar");
    manager
        .fs()
        .write_audio_file_atomic(&item_antonio.file, b"audio_antonio")
        .expect("Gravação deve funcionar");
    manager
        .fs()
        .save_manifest(&[item_thalita.clone(), item_antonio.clone()])
        .expect("Manifesto salvo");

    // 1. Configura voz no banco para AntonioNeural
    db.set_setting("tts_voice", "pt-BR-AntonioNeural")
        .expect("Voz setada");
    let picked = manager
        .pick_thinking_audio(&db)
        .expect("Deve sortear clipe compatível");
    assert_eq!(
        picked.voice, "pt-BR-AntonioNeural",
        "Deve selecionar apenas áudio gravado na voz ativa"
    );
    assert_eq!(picked.id, "thk_antonio");

    // 2. Configura voz no banco para ThalitaNeural
    db.set_setting("tts_voice", "pt-BR-ThalitaNeural")
        .expect("Voz setada");
    let picked_thalita = manager
        .pick_thinking_audio(&db)
        .expect("Deve sortear clipe compatível");
    assert_eq!(picked_thalita.voice, "pt-BR-ThalitaNeural");
    assert_eq!(picked_thalita.id, "thk_thalita");
}
