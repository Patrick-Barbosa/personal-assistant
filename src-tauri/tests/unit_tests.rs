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
fn test_resolve_model_paths_missing_returns_err() {
    use copernico_app_lib::infra::hardware::wake_inprocess::resolve_model_paths;
    let temp_dir = tempfile::tempdir().unwrap();
    let result = resolve_model_paths(temp_dir.path());
    assert!(result.is_err());
}

#[test]
fn test_encode_pcm_to_wav() {
    use copernico_app_lib::infra::hardware::wake_inprocess::encode_pcm_to_wav;
    let pcm = vec![0i16; 1600]; // 100ms silence
    let wav_bytes = encode_pcm_to_wav(&pcm, 16000).unwrap();
    assert!(wav_bytes.len() > 44); // WAV header is 44 bytes
    assert_eq!(&wav_bytes[0..4], b"RIFF");
    assert_eq!(&wav_bytes[8..12], b"WAVE");
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
    ensure_ort_initialized();
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
    let kanban = Arc::new(copernico_app_lib::services::kanban_srv::KanbanService::new(
        db.clone(),
        vm.clone(),
    ));

    let skills_dir = dir.path().join("skills");
    let registry = ToolRegistry::new(db, vm, idx, kanban, mcp, skills_dir);
    let merged = registry.get_merged_definitions();
    let arr = merged.as_array().expect("Deveria ser array de ferramentas");
    assert_eq!(arr.len(), 23);

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

fn ensure_ort_initialized() {
    static ORT_INIT: std::sync::Once = std::sync::Once::new();
    ORT_INIT.call_once(|| {
        let candidates = [
            std::path::PathBuf::from("../motor_wake_word"),
            std::path::PathBuf::from("motor_wake_word"),
            std::path::PathBuf::from("."),
        ];
        for c in &candidates {
            if let Ok((path, _)) =
                copernico_app_lib::infra::hardware::wake_inprocess::resolve_model_paths(c)
            {
                let _ = inferencia::WakeWordModel::new(&[&path], 16000);
                break;
            }
        }
    });
}

#[test]
fn test_perguntar_ao_usuario_tool_execution() {
    ensure_ort_initialized();
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
        vault: vm.clone(),
        indexer: idx,
        skills_dir: dir.path().join("skills"),
        kanban: Arc::new(copernico_app_lib::services::kanban_srv::KanbanService::new(
            db.clone(),
            vm,
        )),
        app: std::sync::RwLock::new(None),
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
    ensure_ort_initialized();
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
        db: db.clone(),
        vault: vm.clone(),
        indexer: idx,
        skills_dir: dir.path().join("skills"),
        kanban: Arc::new(copernico_app_lib::services::kanban_srv::KanbanService::new(
            db, vm,
        )),
        app: std::sync::RwLock::new(None),
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
    ensure_ort_initialized();
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
    ensure_ort_initialized();
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
        db: db.clone(),
        vault: vm.clone(),
        indexer: idx,
        skills_dir: dir.path().join("skills"),
        kanban: Arc::new(copernico_app_lib::services::kanban_srv::KanbanService::new(
            db,
            vm.clone(),
        )),
        app: std::sync::RwLock::new(None),
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
    if config.deepseek_api_key.is_empty()
        || config.deepseek_api_key.contains("sua-chave")
        || config.deepseek_api_key == "sk-xxx"
    {
        println!("Skipping: no valid DEEPSEEK_API_KEY");
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
        Arc::new(copernico_app_lib::services::kanban_srv::KanbanService::new(
            db.clone(),
            vm.clone(),
        )),
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

#[test]
fn test_manual_recorder_stop_without_start_errors() {
    use copernico_app_lib::infra::hardware::ManualRecorder;
    let recorder = ManualRecorder::new();
    assert!(recorder.stop(false).is_err());
    assert!(recorder.stop(true).is_err());
}

#[test]
fn test_manual_recorder_start_stop_never_panics() {
    use copernico_app_lib::infra::hardware::ManualRecorder;
    let recorder = ManualRecorder::new();
    // Without a mic this is Err, with a mic Ok — both must be panic-free.
    let _ = recorder.start();
    let _ = recorder.stop(true);
    // Slot is always cleared: a second stop errors, never panics.
    assert!(recorder.stop(false).is_err());
}

#[test]
fn test_manual_recorder_restart_replaces_session() {
    use copernico_app_lib::infra::hardware::ManualRecorder;
    let recorder = ManualRecorder::new();
    let _ = recorder.start();
    // Starting again must not panic and must replace the previous session.
    let _ = recorder.start();
    let _ = recorder.stop(true);
}

// ─── Kanban Semanal — Fase 1 ────────────────────────────────

fn kanban_fixture() -> (
    std::sync::Arc<Database>,
    copernico_app_lib::services::kanban_srv::KanbanService,
) {
    let db = std::sync::Arc::new(Database::init(Path::new(":memory:")).unwrap());
    let dir = tempdir().unwrap();
    let vault = VaultManager::new(dir.path().join("default"), dir.path().join("obsidian"));
    let srv = copernico_app_lib::services::kanban_srv::KanbanService::new(
        db.clone(),
        std::sync::Arc::new(vault),
    );
    (db, srv)
}

/// Fixture com o `TempDir` mantido vivo — usada nos testes da Fase 2 que
/// leem e escrevem notas reais no vault padrão.
fn kanban_vault_fixture() -> (
    std::sync::Arc<Database>,
    copernico_app_lib::services::kanban_srv::KanbanService,
    tempfile::TempDir,
) {
    let db = std::sync::Arc::new(Database::init(Path::new(":memory:")).unwrap());
    let dir = tempdir().unwrap();
    let vault = VaultManager::new(dir.path().join("default"), dir.path().join("obsidian"));
    let srv = copernico_app_lib::services::kanban_srv::KanbanService::new(
        db.clone(),
        std::sync::Arc::new(vault),
    );
    (db, srv, dir)
}

fn kanban_ghost_task(position: f64) -> copernico_app_lib::domain::models::KanbanTask {
    use copernico_app_lib::domain::models::{KanbanTask, TaskColumn, TaskStatus};
    KanbanTask {
        id: "tarefa-fantasma".to_string(),
        week_id: "2026-W39".to_string(),
        titulo: "fantasma".to_string(),
        note_path: None,
        task_column: TaskColumn::Todo,
        status: TaskStatus::Active,
        carried_to: None,
        position,
        task_kind: copernico_app_lib::domain::models::TaskKind::Normal,
        habit_id: None,
        due_date: None,
        created_at: String::new(),
        updated_at: String::new(),
    }
}

#[test]
fn test_kanban_schema_created_on_init() {
    let db = Database::init(Path::new(":memory:")).unwrap();
    let conn = db.get_pool().get().unwrap();

    for table in [
        "kanban_weeks",
        "kanban_tasks",
        "kanban_task_notes",
        "kanban_task_entities",
        "entities_index",
        "habits",
    ] {
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
                [table],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1, "tabela '{}' ausente no bootstrap", table);
    }

    // Índice parcial único = idempotência da geração de tarefas de hábito.
    let idx: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='uq_kanban_tasks_habit'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(idx, 1, "índice parcial único de hábito ausente");
}

#[test]
fn test_iso_week_calculation_and_year_rollover() {
    use chrono::NaiveDate;
    use copernico_app_lib::services::kanban_srv::{
        is_valid_iso_week, iso_week_bounds, iso_week_of, parse_week_id, week_id_for, week_id_of,
    };

    // Formato canônico: ano + W sempre com 2 dígitos.
    assert_eq!(week_id_for(2026, 9), "2026-W09");
    assert_eq!(week_id_for(2026, 39), "2026-W39");

    assert_eq!(parse_week_id("2026-W39"), Some((2026, 39)));
    assert_eq!(parse_week_id(" 2026-w9 "), Some((2026, 9)));
    assert_eq!(parse_week_id("2026-39"), None);
    assert_eq!(parse_week_id("W39"), None);
    assert_eq!(parse_week_id("2026-W0"), None);
    assert_eq!(parse_week_id("2026-W54"), None);

    // Virada de ano ISO: 28/12/2020 e 01/01/2021 são ambas 2020-W53.
    assert_eq!(
        week_id_of(NaiveDate::from_ymd_opt(2020, 12, 28).unwrap()),
        "2020-W53"
    );
    assert_eq!(
        week_id_of(NaiveDate::from_ymd_opt(2021, 1, 1).unwrap()),
        "2020-W53"
    );
    assert_eq!(
        week_id_of(NaiveDate::from_ymd_opt(2021, 1, 4).unwrap()),
        "2021-W01"
    );
    // 01/01/2015 (quinta-feira) já está na semana 1 de 2015…
    assert_eq!(
        week_id_of(NaiveDate::from_ymd_opt(2015, 1, 1).unwrap()),
        "2015-W01"
    );
    // …enquanto 01/01/2016 (sexta-feira) ainda pertence a 2015-W53.
    assert_eq!(
        week_id_of(NaiveDate::from_ymd_opt(2016, 1, 1).unwrap()),
        "2015-W53"
    );

    // Limites seg→dom; a semana 53 de 2020 atravessa o ano.
    let (start, end) = iso_week_bounds(2020, 53).unwrap();
    assert_eq!(start, NaiveDate::from_ymd_opt(2020, 12, 28).unwrap());
    assert_eq!(end, NaiveDate::from_ymd_opt(2021, 1, 3).unwrap());

    assert!(is_valid_iso_week(2020, 53));
    assert!(!is_valid_iso_week(2014, 53));
    assert_eq!(
        iso_week_of(NaiveDate::from_ymd_opt(2026, 9, 24).unwrap()),
        (2026, 39)
    );
}

#[test]
fn test_kanban_fractional_position_and_move() {
    use copernico_app_lib::domain::models::TaskColumn;
    use copernico_app_lib::services::kanban_srv::{target_position, KanbanService, POSITION_GAP};

    // Cálculo puro da posição-alvo (ponto médio entre vizinhos).
    assert_eq!(target_position(&[], 0), POSITION_GAP);
    let twins = vec![kanban_ghost_task(1024.0), kanban_ghost_task(2048.0)];
    assert_eq!(target_position(&twins, 0), 0.0);
    assert_eq!(target_position(&twins, 1), 1536.0);
    assert_eq!(target_position(&twins, 2), 3072.0);
    // Índice fora de faixa é aparado, nunca panica.
    assert_eq!(target_position(&twins, 99), 3072.0);

    let (_db, srv): (_, KanbanService) = kanban_fixture();
    let a = srv.create_task("A", TaskColumn::Todo, None).unwrap();
    let b = srv.create_task("B", TaskColumn::Todo, None).unwrap();
    let c = srv.create_task("C", TaskColumn::Todo, None).unwrap();

    // Criação empilha no fim da coluna, sempre crescente.
    assert!(a.position < b.position);
    assert!(b.position < c.position);
    let (_pos_a, pos_b, pos_c) = (a.position, b.position, c.position);

    // Mover A para a 2ª casa da própria coluna: fica entre B e C…
    let moved = srv.move_task(&a.id, TaskColumn::Todo, 1).unwrap();
    assert!(moved.position > pos_b && moved.position < pos_c);
    // …sem reescrever a posição de ninguém.
    assert_eq!(srv.get_task(&b.id).unwrap().position, pos_b);
    assert_eq!(srv.get_task(&c.id).unwrap().position, pos_c);

    // Coluna de destino vazia recebe a posição-base.
    let solo = srv.move_task(&c.id, TaskColumn::Doing, 0).unwrap();
    assert_eq!(solo.position, POSITION_GAP);
    assert_eq!(solo.task_column, TaskColumn::Doing);
    // Mover coluna não altera o ciclo de vida.
    assert_eq!(
        copernico_app_lib::domain::traits::stores::KanbanStore::get_task(srv.repo(), &solo.id)
            .unwrap()
            .unwrap()
            .status,
        copernico_app_lib::domain::models::TaskStatus::Active
    );
}

#[test]
fn test_closed_week_rejects_every_mutation() {
    use copernico_app_lib::domain::models::TaskColumn;
    use copernico_app_lib::domain::models::WeekStatus;
    use copernico_app_lib::domain::traits::stores::KanbanStore;

    let (_db, srv) = kanban_fixture();
    let week = srv.ensure_open_week().unwrap();
    let task = srv.create_task("Pendente", TaskColumn::Todo, None).unwrap();

    srv.repo()
        .set_week_status(&week.id, WeekStatus::Closed, Some("2026-09-27T23:00:00Z"))
        .unwrap();

    let expected = format!("semana fechada: {}", week.id);
    assert_eq!(
        srv.create_task("Nova", TaskColumn::Todo, None)
            .unwrap_err()
            .to_string(),
        expected
    );
    assert_eq!(
        srv.move_task(&task.id, TaskColumn::Doing, 0)
            .unwrap_err()
            .to_string(),
        expected
    );
    assert_eq!(
        srv.update_task(&task.id, "Renomeada", None)
            .unwrap_err()
            .to_string(),
        expected
    );
    assert_eq!(srv.delete_task(&task.id).unwrap_err().to_string(), expected);

    // Mutations da Fase 2 (nota da tarefa) caem no mesmo contrato tipado.
    assert_eq!(
        srv.create_task_note(&task.id).unwrap_err().to_string(),
        expected
    );
    assert_eq!(
        srv.save_task_note(&task.id, "corpo")
            .unwrap_err()
            .to_string(),
        expected
    );

    // Leitura segue possível: a semana fechada é somente leitura.
    let board = srv.list_board(None).unwrap();
    assert_eq!(board.week.id, week.id);
    assert_eq!(board.week.status, WeekStatus::Closed);
    assert_eq!(board.tasks.len(), 1);
}

#[test]
fn test_listar_kanban_scope_defaults_to_open_week_only() {
    use chrono::{Local, NaiveDate};
    use copernico_app_lib::domain::errors::DomainError;
    use copernico_app_lib::domain::models::{TaskColumn, WeekStatus};
    use copernico_app_lib::domain::traits::stores::KanbanStore;
    use copernico_app_lib::services::kanban_srv::week_id_of;

    let (_db, srv) = kanban_fixture();

    // Sem semana informada, o default é a semana corrente (aberta).
    let first = srv.list_board(None).unwrap();
    assert_eq!(first.week.status, WeekStatus::Open);
    assert_eq!(first.week.id, week_id_of(Local::now().date_naive()));

    let task = srv
        .create_task("Comprar café", TaskColumn::Todo, None)
        .unwrap();
    assert_eq!(task.week_id, first.week.id);

    // Uma semana antiga fechada existe, mas NUNCA vaza no escopo default.
    let old_date = NaiveDate::from_ymd_opt(2019, 9, 2).unwrap();
    let old = srv.get_or_create_week(old_date).unwrap();
    assert_ne!(old.id, first.week.id);
    srv.repo()
        .set_week_status(&old.id, WeekStatus::Closed, Some("2019-09-08T23:00:00Z"))
        .unwrap();

    let scoped = srv.list_board(None).unwrap();
    assert_eq!(scoped.week.id, first.week.id);
    assert!(scoped.tasks.iter().all(|t| t.week_id == first.week.id));

    // Histórico só com pedido explícito de semana.
    let explicit = srv.list_board(Some(&old.id)).unwrap();
    assert_eq!(explicit.week.id, old.id);
    assert_eq!(explicit.week.status, WeekStatus::Closed);
    assert!(explicit.tasks.is_empty());

    // Semana inexistente ou malformada → erro tipado, nunca semana errada.
    assert!(matches!(
        srv.list_board(Some("1999-W10")).unwrap_err(),
        DomainError::NotFound(_)
    ));
    assert!(matches!(
        srv.list_board(Some("qualquer")).unwrap_err(),
        DomainError::InvalidInput(_)
    ));
    assert!(matches!(
        srv.list_board(Some("2014-W53")).unwrap_err(),
        DomainError::InvalidInput(_)
    ));
}

#[test]
fn test_create_task_validates_input_and_habits_get_no_note() {
    use copernico_app_lib::domain::errors::DomainError;
    use copernico_app_lib::domain::models::{TaskColumn, TaskKind};

    let (_db, srv) = kanban_fixture();

    assert!(matches!(
        srv.create_task("   ", TaskColumn::Todo, None).unwrap_err(),
        DomainError::InvalidInput(_)
    ));
    assert!(matches!(
        srv.create_task("Ok", TaskColumn::Todo, Some("31/12/2026"))
            .unwrap_err(),
        DomainError::InvalidInput(_)
    ));

    let task = srv
        .create_task("  Comprar pão  ", TaskColumn::Todo, Some("2026-09-30"))
        .unwrap();
    assert_eq!(task.titulo, "Comprar pão");
    assert_eq!(task.due_date.as_deref(), Some("2026-09-30"));
    assert_eq!(task.task_kind, TaskKind::Normal);
    // Tarefa normal nasce sem nota: o vínculo só existe após o editor (Fase 2).
    assert_eq!(task.note_path, None);
}

// ─── Kanban Semanal — Fase 2: editor + entities ─────────────

#[test]
fn test_task_note_frontmatter_roundtrip_and_delete_keeps_file() {
    use copernico_app_lib::domain::models::{TaskColumn, WeekStatus};
    use copernico_app_lib::domain::traits::stores::KanbanStore;

    let (_db, srv, dir) = kanban_vault_fixture();

    let task = srv
        .create_task("Preparar reunião", TaskColumn::Todo, None)
        .unwrap();
    let task = srv.create_task_note(&task.id).unwrap();
    let rel = task.note_path.clone().expect("tarefa deveria ter nota");
    let abs = dir.path().join("default").join(&rel);
    assert!(abs.exists(), "nota canônica ausente: {}", abs.display());

    // Frontmatter round-trip: `tipo: tarefa` + chaves extras sobrevivem ao YAML.
    let (fm, _body) = VaultManager::parse_note_file(&abs).unwrap();
    assert_eq!(fm.tipo.as_deref(), Some("tarefa"));
    assert_eq!(
        fm.extra.get("kanban_id").and_then(|v| v.as_str()),
        Some(task.id.as_str())
    );
    assert_eq!(
        fm.extra.get("semana").and_then(|v| v.as_str()),
        Some(task.week_id.as_str())
    );

    // Escrita do editor preserva o frontmatter e devolve o corpo puro.
    srv.save_task_note(&task.id, "- item **forte**\n- [[Alguma Nota]]")
        .unwrap();
    let body = srv.get_task_note(&task.id).unwrap().expect("corpo");
    assert!(body.contains("**forte**"), "corpo não foi salvo: {}", body);
    let (fm_after, body_after) = VaultManager::parse_note_file(&abs).unwrap();
    assert_eq!(fm_after.tipo.as_deref(), Some("tarefa"));
    assert_eq!(body_after, body);

    // Idempotência: segunda criação não duplica nem recria arquivo.
    let again = srv.create_task_note(&task.id).unwrap();
    assert_eq!(again.note_path.as_deref(), Some(rel.as_str()));

    // Excluir a tarefa desvincula do SQLite, mas o `.md` permanece no cofre.
    srv.delete_task(&task.id).unwrap();
    assert!(srv.get_task(&task.id).is_err());
    assert!(abs.exists(), "excluir tarefa nunca apaga a nota do cofre");
    let (fm_final, _) = VaultManager::parse_note_file(&abs).unwrap();
    assert_eq!(fm_final.tipo.as_deref(), Some("tarefa"));

    // Semana fechada também rejeita a criação de nota (contrato tipado).
    let other = srv.create_task("Outra", TaskColumn::Todo, None).unwrap();
    srv.repo()
        .set_week_status(
            &task.week_id,
            WeekStatus::Closed,
            Some("2026-09-27T23:00:00Z"),
        )
        .unwrap();
    assert_eq!(
        srv.create_task_note(&other.id).unwrap_err().to_string(),
        format!("semana fechada: {}", task.week_id)
    );
}

#[test]
fn test_entity_index_links_and_rebuild() {
    use copernico_app_lib::domain::models::{EntitySubtipo, TaskColumn};

    let (_db, srv, dir) = kanban_vault_fixture();
    let task = srv
        .create_task("Planejar viagem", TaskColumn::Todo, None)
        .unwrap();

    // Entity nasce como nota canônica + upsert imediato no índice derivado.
    let entry = srv
        .create_entity("Ana Silva", EntitySubtipo::Pessoa)
        .unwrap();
    let abs = dir.path().join("default").join(&entry.note_path);
    assert!(abs.exists(), "nota canônica da entity ausente");
    let (fm, _) = VaultManager::parse_note_file(&abs).unwrap();
    assert_eq!(fm.tipo.as_deref(), Some("entidade"));
    assert_eq!(
        fm.extra.get("subtipo").and_then(|v| v.as_str()),
        Some("pessoa")
    );
    let listed = srv.list_entities(Some("pessoa"), None).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, entry.id);
    // Busca por título.
    assert_eq!(srv.list_entities(None, Some("silva")).unwrap().len(), 1);
    assert_eq!(
        srv.list_entities(None, Some("inexistente")).unwrap().len(),
        0
    );

    // Entity desconhecida não vincula (anti-alucinação do agente).
    assert!(srv.link_task_entity(&task.id, "nao-existe").is_err());

    // Vincular/desvincular entity reflete nos vínculos da tarefa.
    let links = srv.link_task_entity(&task.id, &entry.id).unwrap();
    assert_eq!(links.entities.len(), 1);
    let links = srv.unlink_task_entity(&task.id, &entry.id).unwrap();
    assert!(links.entities.is_empty());
    let links = srv.link_task_entity(&task.id, &entry.id).unwrap();
    assert_eq!(links.entities.len(), 1);

    // Vincular nota existente do vault padrão (só vínculo — sem escrita nela).
    let note_abs = dir.path().join("default").join("Ideias_de_viagem.md");
    std::fs::write(&note_abs, "# Ideias de viagem\n").unwrap();
    let links = srv.link_task_note(&task.id, "Ideias_de_viagem.md").unwrap();
    assert!(links.notes.contains(&"Ideias_de_viagem.md".to_string()));
    // Nota fora do vault padrão é rejeitada.
    assert!(srv.link_task_note(&task.id, "../fora/cofre.md").is_err());

    // O board devolve os vínculos por tarefa (chips sem N+1 de IPC).
    let board = srv.list_board(None).unwrap();
    let board_links = board
        .links
        .iter()
        .find(|l| l.task_id == task.id)
        .expect("links da tarefa presentes no board");
    assert_eq!(board_links.notes.len(), 1);
    assert_eq!(board_links.entities.len(), 1);

    // Rebuild: índice é derivado — notas existentes sobrevivem ao rebuild…
    let rebuilt = srv.rebuild_entities_index().unwrap();
    assert_eq!(rebuilt, 1);
    assert_eq!(srv.list_entities(None, None).unwrap().len(), 1);

    // …e a linha órfã some quando a nota some (o app nunca apaga `.md` por
    // conta própria; aqui o teste simula o usuário apagando o arquivo).
    std::fs::remove_file(&abs).unwrap();
    srv.rebuild_entities_index().unwrap();
    assert!(srv.list_entities(None, None).unwrap().is_empty());
    // O vínculo da tarefa permanece apenas como histórico vazio na resolução.
    let links = srv.task_links(&task.id).unwrap();
    assert!(links.entities.is_empty());
}

// ─── Kanban Semanal — Fase 3 (tools, fechamento, Inbox) ─────

#[test]
fn test_listar_kanban_scope_default_vs_explicit() {
    ensure_ort_initialized();
    use chrono::Local;
    use copernico_app_lib::domain::models::TaskColumn;
    use copernico_app_lib::indexer::Indexer;
    use copernico_app_lib::mcp::McpManager;
    use copernico_app_lib::services::kanban_srv::KanbanService;
    use copernico_app_lib::tool_registry::ToolRegistry;
    use std::sync::Arc;

    let dir = tempdir().unwrap();
    let db = Arc::new(Database::init(Path::new(":memory:")).unwrap());
    let vm = Arc::new(VaultManager::new(
        dir.path().join("default"),
        dir.path().join("obsidian"),
    ));
    let kanban = Arc::new(KanbanService::new(db.clone(), vm.clone()));
    let idx = Arc::new(Indexer::new(db.get_pool(), vm.clone()).unwrap());
    let mcp = Arc::new(McpManager::new());
    let reg = ToolRegistry::new(db, vm, idx, kanban.clone(), mcp, dir.path().join("skills"));

    // Semana aberta com uma tarefa.
    let task = kanban
        .create_task("Comprar café", TaskColumn::Todo, None)
        .unwrap();

    // Padrão (sem `semana`) ⇒ SOMENTE a semana aberta — nunca histórico.
    let v: serde_json::Value = serde_json::from_str(&reg.execute("listar_kanban", "{}")).unwrap();
    assert_eq!(v["sucesso"], true);
    assert_eq!(v["escopo"], "aberta");
    assert_eq!(v["semana"]["id"].as_str().unwrap(), task.week_id);
    assert_eq!(v["tarefas"].as_array().unwrap().len(), 1);

    // Explícita ⇒ aquela semana exata (histórico sob pedido).
    let past = kanban
        .get_or_create_week(Local::now().date_naive() - chrono::Duration::days(30))
        .unwrap();
    assert_ne!(past.id, task.week_id);
    let args = serde_json::json!({ "semana": past.id }).to_string();
    let v2: serde_json::Value = serde_json::from_str(&reg.execute("listar_kanban", &args)).unwrap();
    assert_eq!(v2["sucesso"], true);
    assert_eq!(v2["escopo"], "explicito");
    assert_eq!(v2["semana"]["id"].as_str().unwrap(), past.id);
    assert_eq!(v2["tarefas"].as_array().unwrap().len(), 0);

    // Escrita via tool: criar_tarefa entra na semana aberta.
    let args = serde_json::json!({ "titulo": "Viajar" }).to_string();
    let v3: serde_json::Value = serde_json::from_str(&reg.execute("criar_tarefa", &args)).unwrap();
    assert_eq!(v3["sucesso"], true);
    assert_eq!(v3["semana"].as_str().unwrap(), task.week_id);
}

#[test]
fn test_close_week_rollover_and_carry_cancel_idempotent() {
    use chrono::Local;
    use copernico_app_lib::domain::models::{
        KanbanTask, TaskColumn, TaskKind, TaskStatus, WeekStatus,
    };
    use copernico_app_lib::domain::traits::KanbanStore;

    let (db, srv, _dir) = kanban_vault_fixture();

    // Semana passada ainda "aberta" (caso de app desligado no fim de semana).
    let past = srv
        .get_or_create_week(Local::now().date_naive() - chrono::Duration::days(30))
        .unwrap();

    let mk_task = |id: &str, titulo: &str, column: TaskColumn, kind: TaskKind| KanbanTask {
        id: id.to_string(),
        week_id: past.id.clone(),
        titulo: titulo.to_string(),
        note_path: None,
        task_column: column,
        status: TaskStatus::Active,
        carried_to: None,
        position: 1024.0,
        task_kind: kind,
        habit_id: if kind == TaskKind::Habit {
            Some("habito-x".to_string())
        } else {
            None
        },
        due_date: None,
        created_at: String::new(),
        updated_at: String::new(),
    };
    srv.repo()
        .insert_task(&mk_task(
            "t-pend-1",
            "Pendência A",
            TaskColumn::Todo,
            TaskKind::Normal,
        ))
        .unwrap();
    srv.repo()
        .insert_task(&mk_task(
            "t-pend-2",
            "Pendência B",
            TaskColumn::Doing,
            TaskKind::Normal,
        ))
        .unwrap();
    srv.repo()
        .insert_task(&mk_task(
            "t-done",
            "Concluída",
            TaskColumn::Done,
            TaskKind::Normal,
        ))
        .unwrap();
    srv.repo()
        .insert_task(&mk_task(
            "t-habit",
            "Hábito pendente",
            TaskColumn::Todo,
            TaskKind::Habit,
        ))
        .unwrap();

    // Fechamento: 1 item por pendência (done e hábito ficam de fora).
    let item_ids = srv.close_week(&past.id).unwrap();
    assert_eq!(item_ids.len(), 2);

    let closed_week = srv.repo().get_week(&past.id).unwrap().unwrap();
    assert_eq!(closed_week.status, WeekStatus::Closed);
    assert!(closed_week.closed_at.is_some());

    // Idempotente: fechar de novo não gera itens novos.
    assert!(srv.close_week(&past.id).unwrap().is_empty());

    // Itens `kanban_rollover` com decisão obrigatória e payload/task_id corretos.
    let items = db.list_inbox_items().unwrap();
    let rollover: Vec<_> = items
        .iter()
        .filter(|i| i.item_type == "kanban_rollover")
        .collect();
    assert_eq!(rollover.len(), 2);
    for item in &rollover {
        assert!(item.requires_decision);
        let (task_id, week_id) =
            copernico_app_lib::services::kanban_srv::KanbanService::parse_rollover_content(
                &item.content,
            )
            .unwrap();
        assert_eq!(week_id, past.id);
        assert!(task_id == "t-pend-1" || task_id == "t-pend-2");
    }

    // Semana fechada é read-only para o board…
    let err = srv
        .move_task("t-pend-1", TaskColumn::Done, 0)
        .unwrap_err()
        .to_string();
    assert_eq!(err, format!("semana fechada: {}", past.id));

    // …mas as decisões do Inbox (carry/cancel) são permitidas.
    let new_task = srv
        .carry_task("t-pend-1")
        .unwrap()
        .expect("aceite cria task nova na semana aberta");
    assert_ne!(new_task.week_id, past.id);
    assert_eq!(new_task.task_column, TaskColumn::Todo);
    assert_eq!(new_task.status, TaskStatus::Active);
    let old = srv.get_task("t-pend-1").unwrap();
    assert_eq!(old.status, TaskStatus::Carried);
    assert_eq!(old.carried_to.as_deref(), Some(new_task.week_id.as_str()));

    // Idempotência: repetir o aceite não duplica nada.
    assert!(srv.carry_task("t-pend-1").unwrap().is_none());
    assert!(srv.carry_task("t-pend-1").unwrap().is_none());

    // Recusa cancela (idempotente: `false` na segunda vez).
    assert!(srv.cancel_task("t-pend-2").unwrap());
    assert!(!srv.cancel_task("t-pend-2").unwrap());
    assert_eq!(
        srv.get_task("t-pend-2").unwrap().status,
        TaskStatus::Cancelled
    );

    // Hábito nunca entra no rollover.
    let err = srv.carry_task("t-habit").unwrap_err().to_string();
    assert!(err.contains("hábito"));
}

#[test]
fn test_ensure_weeks_closed_only_past_deadline() {
    use chrono::Local;
    use copernico_app_lib::domain::models::WeekStatus;
    use copernico_app_lib::domain::traits::KanbanStore;

    let (_db, srv, _dir) = kanban_vault_fixture();
    let past = srv
        .get_or_create_week(Local::now().date_naive() - chrono::Duration::days(30))
        .unwrap();
    // Semana de hoje explícita — sem ela, `ensure_open_week` devolveria a
    // stale passada (ainda aberta) como se fosse a atual.
    let current = srv.get_or_create_week(Local::now().date_naive()).unwrap();
    assert_ne!(past.id, current.id);

    let closed = srv.ensure_weeks_closed().unwrap();
    assert!(
        closed.contains(&past.id),
        "semana vencida (domingo 23h atrás) deve fechar mesmo com o app parado"
    );
    let past_now = srv.repo().get_week(&past.id).unwrap().unwrap();
    assert_eq!(past_now.status, WeekStatus::Closed);

    // A semana atual só fecha se o relógio já passou do domingo 23h dela.
    if !closed.contains(&current.id) {
        let cur = srv.repo().get_week(&current.id).unwrap().unwrap();
        assert_eq!(cur.status, WeekStatus::Open);
    }

    // Idempotente: já-fechada não aparece de novo.
    let closed_again = srv.ensure_weeks_closed().unwrap();
    assert!(!closed_again.contains(&past.id));
}

// ─── Hábitos — Fase 4 ───────────────────────────────────────

#[test]
fn test_habit_cron_day_matching() {
    use copernico_app_lib::domain::models::habit as rules;

    // Calendário de referência: 2026-09-21=Seg … 2026-09-27=Dom.
    let (sy, sm, sd, sw) = (2026, 9, 21, 1u32);
    let (dy, dm, dd, dw) = (2026, 9, 27, 0u32);
    let (ty, tm, td, tw) = (2026, 9, 22, 2u32);
    let (qy, qm, qd, qw) = (2026, 9, 24, 4u32);

    // Segunda apenas.
    assert!(rules::matches_date("0 6 * * 1", sy, sm, sd, sw).unwrap());
    assert!(!rules::matches_date("0 6 * * 1", dy, dm, dd, dw).unwrap());
    // Terças e quintas ("correr terças e quintas" → 0 6 * * 2,4).
    assert!(rules::matches_date("0 6 * * 2,4", ty, tm, td, tw).unwrap());
    assert!(rules::matches_date("0 6 * * 2,4", qy, qm, qd, qw).unwrap());
    assert!(!rules::matches_date("0 6 * * 2,4", sy, sm, sd, sw).unwrap());
    // Alias de domingo (7 ≡ 0).
    assert!(rules::matches_date("0 6 * * 7", dy, dm, dd, dw).unwrap());
    assert!(!rules::matches_date("0 6 * * 7", ty, tm, td, tw).unwrap());
    // dom/dow ambos restringindo ⇒ união (dia 15 OU qualquer segunda).
    assert!(rules::matches_date("0 0 15 * 1", 2026, 9, 15, 2).unwrap());
    assert!(rules::matches_date("0 0 15 * 1", sy, sm, sd, sw).unwrap());
    assert!(!rules::matches_date("0 0 15 * 1", 2026, 9, 16, 3).unwrap());
    // Todo dia (`* *`).
    assert!(rules::matches_date("0 9 * * *", dy, dm, dd, dw).unwrap());
    // Mês restringe.
    assert!(!rules::matches_date("0 9 1 10 *", sy, sm, sd, sw).unwrap());
    // Cron malformado é erro tipado, não pânico.
    assert!(rules::matches_date("não é cron", sy, sm, sd, sw).is_err());
    assert!(rules::matches_date("0 9 * *", sy, sm, sd, sw).is_err());
}

#[test]
fn test_create_habit_validates_cron_and_color() {
    let (_db, srv, _dir) = kanban_vault_fixture();
    let habit_srv = srv.habit();

    assert!(habit_srv.create_habit("  ", "0 9 * * *", None).is_err());
    assert!(habit_srv
        .create_habit("Sem cron", "não-cron", None)
        .is_err());
    assert!(habit_srv
        .create_habit("Cor ruim", "0 9 * * *", Some("#zzz"))
        .is_err());

    let h = habit_srv
        .create_habit("  Beber água  ", " 0 9 * * * ", None)
        .unwrap();
    assert_eq!(h.titulo, "Beber água");
    assert_eq!(h.cron_expr, "0 9 * * *");
    assert_eq!(h.cor, "#22c55e", "cor padrão verde");
    assert!(h.ativo);
    assert_eq!(h.streak_atual, 0);
}

#[test]
fn test_update_habit_edits_fields_and_validates() {
    let (_db, srv, _dir) = kanban_vault_fixture();
    let habit_srv = srv.habit();
    let h = habit_srv
        .create_habit("Beber água", "0 9 * * *", None)
        .unwrap();

    // Inexistente ⇒ NotFound tipado; validações espelham a criação.
    assert!(habit_srv
        .update_habit("nope", "Qualquer", "0 9 * * *", None)
        .is_err());
    assert!(habit_srv
        .update_habit(&h.id, "  ", "0 9 * * *", None)
        .is_err());
    assert!(habit_srv
        .update_habit(&h.id, "Novo", "cron-ruim", None)
        .is_err());
    assert!(habit_srv
        .update_habit(&h.id, "Novo", "0 9 * * *", Some("#zzz"))
        .is_err());

    let updated = habit_srv
        .update_habit(&h.id, "  Alongamento  ", "30 7 * * 1,3", Some("#3b82f6"))
        .unwrap();
    assert_eq!(updated.id, h.id, "edição preserva a identidade");
    assert_eq!(updated.titulo, "Alongamento");
    assert_eq!(updated.cron_expr, "30 7 * * 1,3");
    assert_eq!(updated.cor, "#3b82f6");
    assert!(updated.ativo, "edição não mexe no estado ativo/pausado");

    // Persistência: a listagem enxerga a edição.
    let listed = habit_srv.list_habits().unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].titulo, "Alongamento");
    assert_eq!(listed[0].cron_expr, "30 7 * * 1,3");
    assert_eq!(listed[0].cor, "#3b82f6");
}

#[test]
fn test_habit_sync_generates_task_idempotently() {
    let (_db, srv, _dir) = kanban_vault_fixture();
    // Cron que casa com qualquer dia ⇒ gera hoje, seja qual for o dia do teste.
    let habit = srv
        .habit()
        .create_habit("Beber água", "0 9 * * *", None)
        .unwrap();

    assert_eq!(srv.habit().sync_habit_tasks_today().unwrap(), 1);
    // Tick N× = 1 task (checagem prévia + índice único parcial).
    assert_eq!(srv.habit().sync_habit_tasks_today().unwrap(), 0);
    assert_eq!(srv.habit().sync_habit_tasks_today().unwrap(), 0);

    let board = srv.list_board(None).unwrap();
    assert_eq!(board.tasks.len(), 1);
    let task = &board.tasks[0];
    assert_eq!(
        task.task_kind,
        copernico_app_lib::domain::models::TaskKind::Habit
    );
    assert_eq!(task.habit_id.as_deref(), Some(habit.id.as_str()));
    assert!(
        task.note_path.is_none(),
        "task de hábito nunca recebe nota `.md`"
    );
    assert_eq!(
        task.task_column,
        copernico_app_lib::domain::models::TaskColumn::Todo
    );
    assert_eq!(
        task.due_date.as_deref(),
        Some(
            chrono::Local::now()
                .date_naive()
                .format("%Y-%m-%d")
                .to_string()
                .as_str()
        ),
        "due_date = hoje"
    );
    // O quadro carrega os hábitos junto (cor dos cards sem N+1 de IPC).
    assert_eq!(board.habits.len(), 1);
    assert_eq!(board.habits[0].id, habit.id);
    assert_eq!(board.habits[0].cor, habit.cor);
}

#[test]
fn test_habit_not_matching_today_generates_nothing() {
    use chrono::{Datelike, Local};
    let (_db, srv, _dir) = kanban_vault_fixture();
    // Cron cujo mês nunca é o atual ⇒ nunca casa com hoje.
    let wrong_month = (Local::now().month() % 12) + 1;
    srv.habit()
        .create_habit("Anual", &format!("0 9 1 {} *", wrong_month), None)
        .unwrap();
    assert_eq!(srv.habit().sync_habit_tasks_today().unwrap(), 0);
    assert!(srv.list_board(None).unwrap().tasks.is_empty());
}

#[test]
fn test_habit_task_column_syncs_metric() {
    let (db, srv, _dir) = kanban_vault_fixture();
    let habit = srv
        .habit()
        .create_habit("Alongamento", "0 9 * * *", None)
        .unwrap();
    srv.habit().sync_habit_tasks_today().unwrap();

    let board = srv.list_board(None).unwrap();
    assert_eq!(board.tasks.len(), 1);
    let task_id = board.tasks[0].id.clone();
    let due = board.tasks[0].due_date.clone().unwrap();

    let rows_for = |date: &str| -> usize {
        db.query_tabular_metrics(Some("habito"), None, None, Some(&habit.id))
            .unwrap()
            .into_iter()
            .filter(|r| r.record_date == date)
            .count()
    };

    // Ainda em 'todo' ⇒ nenhuma métrica (task é a fonte única).
    assert_eq!(rows_for(&due), 0);

    // Conclui ⇒ linha do dia (value=1, notes=título).
    srv.move_task(
        &task_id,
        copernico_app_lib::domain::models::TaskColumn::Done,
        0,
    )
    .unwrap();
    let rows = db
        .query_tabular_metrics(Some("habito"), None, None, Some(&habit.id))
        .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].record_date, due);
    assert_eq!(rows[0].metric_value, 1.0);
    assert_eq!(rows[0].notes.as_deref(), Some("Alongamento"));
    assert_eq!(rows_for(&due), 1);

    // Re-done é idempotente: upsert substitui, nunca duplica.
    srv.move_task(
        &task_id,
        copernico_app_lib::domain::models::TaskColumn::Done,
        0,
    )
    .unwrap();
    assert_eq!(rows_for(&due), 1);

    // Saiu do 'done' ⇒ remove a linha do dia.
    srv.move_task(
        &task_id,
        copernico_app_lib::domain::models::TaskColumn::Todo,
        0,
    )
    .unwrap();
    assert_eq!(rows_for(&due), 0);

    // Voltou ao 'done' ⇒ regrava.
    srv.move_task(
        &task_id,
        copernico_app_lib::domain::models::TaskColumn::Done,
        0,
    )
    .unwrap();
    assert_eq!(rows_for(&due), 1);
}

#[test]
fn test_habit_deactivate_and_delete_rules() {
    use copernico_app_lib::domain::traits::KanbanStore;
    let (_db, srv, _dir) = kanban_vault_fixture();

    let h = srv
        .habit()
        .create_habit("Meditar", "0 9 * * *", None)
        .unwrap();
    assert_eq!(srv.habit().sync_habit_tasks_today().unwrap(), 1);
    let task_id = srv.list_board(None).unwrap().tasks[0].id.clone();

    // Desativar para de gerar (task já gerada permanece).
    srv.habit().set_active(&h.id, false).unwrap();
    // Simula o dia seguinte: apaga a task direto no repo (o serviço bloqueia
    // exclusão de task de hábito — o caminho legítimo é desativar o hábito).
    srv.repo().delete_task(&task_id).unwrap();
    assert_eq!(srv.habit().sync_habit_tasks_today().unwrap(), 0);
    assert!(srv.list_board(None).unwrap().tasks.is_empty());

    // Reativar volta a gerar.
    srv.habit().set_active(&h.id, true).unwrap();
    assert_eq!(srv.habit().sync_habit_tasks_today().unwrap(), 1);

    // Já gerou task ⇒ `delete_habit` desativa (retorna false), não apaga.
    assert!(!srv.habit().delete_habit(&h.id).unwrap());
    let listed = srv.habit().list_habits().unwrap();
    assert_eq!(listed.len(), 1);
    assert!(!listed[0].ativo, "deleção vira ativo=0 quando há histórico");

    // Nunca gerou task ⇒ hard delete de verdade.
    let fresh = srv
        .habit()
        .create_habit("Novato", "0 9 * * *", None)
        .unwrap();
    assert!(srv.habit().delete_habit(&fresh.id).unwrap());
    assert!(srv
        .habit()
        .list_habits()
        .unwrap()
        .iter()
        .all(|x| x.id != fresh.id));
}

#[test]
fn test_habit_delete_task_blocked_and_streak_fills_from_metrics() {
    let (db, srv, _dir) = kanban_vault_fixture();
    let habit = srv.habit().create_habit("Água", "0 9 * * *", None).unwrap();
    srv.habit().sync_habit_tasks_today().unwrap();
    let board = srv.list_board(None).unwrap();
    let task_id = board.tasks[0].id.clone();

    // Task de hábito não some solta no quadro — o caminho é o próprio hábito.
    assert!(srv.delete_task(&task_id).is_err());

    // Conclui ⇒ streak preenchido na listagem (métrica de hoje).
    srv.move_task(
        &task_id,
        copernico_app_lib::domain::models::TaskColumn::Done,
        0,
    )
    .unwrap();
    let listed = srv.habit().list_habits().unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].streak_atual, 1);
    assert_eq!(listed[0].id, habit.id);

    // Streak derivado continua consistente com a métrica persistida.
    let today = chrono::Local::now()
        .date_naive()
        .format("%Y-%m-%d")
        .to_string();
    assert_eq!(srv.habit().streak(&habit.id, &today).unwrap(), 1);
    let _ = db;
}

#[test]
fn test_streak_computation_breaks_on_gap() {
    use copernico_app_lib::domain::models::habit as rules;
    let v = |dates: &[&str]| -> Vec<String> { dates.iter().map(|s| s.to_string()).collect() };

    // Sequência viva até hoje.
    assert_eq!(
        rules::compute_streak(
            &v(&["2026-09-24", "2026-09-23", "2026-09-22"]),
            "2026-09-24"
        ),
        3
    );
    // Viva sem registro de hoje (registrou ontem — pendente de hoje).
    assert_eq!(
        rules::compute_streak(&v(&["2026-09-23", "2026-09-22"]), "2026-09-24"),
        2
    );
    // Pulou ontem ⇒ zerou.
    assert_eq!(rules::compute_streak(&v(&["2026-09-22"]), "2026-09-24"), 0);
    // Gap no meio quebra a sequência.
    assert_eq!(
        rules::compute_streak(
            &v(&["2026-09-24", "2026-09-23", "2026-09-21"]),
            "2026-09-24"
        ),
        2
    );
    // Sem registros.
    assert_eq!(rules::compute_streak(&[], "2026-09-24"), 0);
    // Data malformada não panica.
    assert_eq!(rules::compute_streak(&v(&["xx"]), "2026-09-24"), 0);
}

#[test]
fn test_criar_habito_tool_builds_cron() {
    ensure_ort_initialized();
    use copernico_app_lib::indexer::Indexer;
    use copernico_app_lib::mcp::McpManager;
    use copernico_app_lib::services::kanban_srv::KanbanService;
    use copernico_app_lib::tool_registry::ToolRegistry;
    use std::sync::Arc;

    let dir = tempdir().unwrap();
    let db = Arc::new(Database::init(Path::new(":memory:")).unwrap());
    let vm = Arc::new(VaultManager::new(
        dir.path().join("default"),
        dir.path().join("obsidian"),
    ));
    let kanban = Arc::new(KanbanService::new(db.clone(), vm.clone()));
    let idx = Arc::new(Indexer::new(db.get_pool(), vm.clone()).unwrap());
    let mcp = Arc::new(McpManager::new());
    let reg = ToolRegistry::new(db, vm, idx, kanban.clone(), mcp, dir.path().join("skills"));

    // Dias naturais + hora ⇒ cron ("correr terças e quintas às 06:00").
    let args = serde_json::json!({ "titulo": "Correr", "dias": [2, 4], "hora": "06:00" });
    let v: serde_json::Value =
        serde_json::from_str(&reg.execute("criar_habito", &args.to_string())).unwrap();
    assert_eq!(v["sucesso"], true, "{}", v);
    assert_eq!(v["cron"], "0 6 * * 2,4");

    // Sem dias/hora ⇒ todo dia às 09:00.
    let args2 = serde_json::json!({ "titulo": "Beber água" });
    let v2: serde_json::Value =
        serde_json::from_str(&reg.execute("criar_habito", &args2.to_string())).unwrap();
    assert_eq!(v2["sucesso"], true, "{}", v2);
    assert_eq!(v2["cron"], "0 9 * * *");

    // Dia inválido ⇒ erro tipado, sem pânico.
    let args3 = serde_json::json!({ "titulo": "Inválido", "dias": [9] });
    let v3: serde_json::Value =
        serde_json::from_str(&reg.execute("criar_habito", &args3.to_string())).unwrap();
    assert_eq!(v3["sucesso"], false);
    // Hora malformada ⇒ erro tipado.
    let args4 = serde_json::json!({ "titulo": "Inválido", "hora": "9h" });
    let v4: serde_json::Value =
        serde_json::from_str(&reg.execute("criar_habito", &args4.to_string())).unwrap();
    assert_eq!(v4["sucesso"], false);

    // Os dois criados aparecem no quadro (cor dos cards pronta para o F4 UI).
    let habits = kanban.list_board(None).unwrap().habits;
    assert_eq!(habits.len(), 2);
    assert!(habits.iter().any(|h| h.titulo == "Correr"));
    assert!(habits.iter().any(|h| h.titulo == "Beber água"));
}

// ─── Kanban Semanal — Fase 5: Insights ──────────────────────

#[test]
fn test_expected_occurrences_counts_sundays_per_month() {
    use copernico_app_lib::domain::models::habit as rules;

    // Fev/2026 começa num domingo (4 domingos); Mar/2026 também (5 domingos).
    let feb = (
        rules::days_from_civil(2026, 2, 1),
        rules::days_from_civil(2026, 2, 28),
    );
    let mar = (
        rules::days_from_civil(2026, 3, 1),
        rules::days_from_civil(2026, 3, 31),
    );
    assert_eq!(
        rules::expected_occurrences("0 9 * * 0", feb.0, feb.1).unwrap(),
        4
    );
    assert_eq!(
        rules::expected_occurrences("0 9 * * 0", mar.0, mar.1).unwrap(),
        5
    );
    // Todo dia ⇒ uma ocorrência por dia do intervalo.
    assert_eq!(
        rules::expected_occurrences("0 9 * * *", feb.0, feb.1).unwrap(),
        28
    );
    // Intervalo invertido ⇒ 0 (sem pânico); cron inválido ⇒ erro tipado.
    assert_eq!(
        rules::expected_occurrences("0 9 * * *", feb.1, feb.0).unwrap(),
        0
    );
    assert!(rules::expected_occurrences("cron-lixo", feb.0, feb.1).is_err());
}

#[test]
fn test_insights_aggregates_by_week_with_dense_bars() {
    use chrono::{Duration, Local};
    use copernico_app_lib::domain::models::{KanbanTask, TaskColumn, TaskKind, TaskStatus};
    use copernico_app_lib::domain::traits::KanbanStore;

    let (_db, srv, _dir) = kanban_vault_fixture();
    let today = Local::now().date_naive();
    let today_str = today.format("%Y-%m-%d").to_string();
    let bar_start = (today - Duration::days(13)).format("%Y-%m-%d").to_string();

    // Hábito ativo diário ⇒ alimenta o "estimado" das linhas (7/semana).
    let habit = srv
        .habit()
        .create_habit("Alongamento", "0 9 * * *", None)
        .unwrap();

    // Semana passada (ainda aberta) com 3 tasks: 2 concluídas (1 delas de hábito).
    let past = srv.get_or_create_week(today - Duration::days(30)).unwrap();
    let mk_task =
        |id: &str, week: &str, column: TaskColumn, kind: TaskKind, due: Option<&str>| KanbanTask {
            id: id.to_string(),
            week_id: week.to_string(),
            titulo: id.to_string(),
            note_path: None,
            task_column: column,
            status: TaskStatus::Active,
            carried_to: None,
            position: 1024.0,
            task_kind: kind,
            habit_id: if kind == TaskKind::Habit {
                Some(habit.id.clone())
            } else {
                None
            },
            due_date: due.map(str::to_string),
            created_at: String::new(),
            updated_at: String::new(),
        };
    srv.repo()
        .insert_task(&mk_task(
            "t1",
            &past.id,
            TaskColumn::Done,
            TaskKind::Normal,
            None,
        ))
        .unwrap();
    srv.repo()
        .insert_task(&mk_task(
            "t2",
            &past.id,
            TaskColumn::Todo,
            TaskKind::Normal,
            None,
        ))
        .unwrap();
    srv.repo()
        .insert_task(&mk_task(
            "t3",
            &past.id,
            TaskColumn::Done,
            TaskKind::Habit,
            None,
        ))
        .unwrap();

    // Semana aberta atual com 2 tasks de hoje (1 concluída).
    let current = srv.get_or_create_week(today).unwrap();
    srv.repo()
        .insert_task(&mk_task(
            "t4",
            &current.id,
            TaskColumn::Done,
            TaskKind::Normal,
            Some(&today_str),
        ))
        .unwrap();
    srv.repo()
        .insert_task(&mk_task(
            "t5",
            &current.id,
            TaskColumn::Todo,
            TaskKind::Normal,
            Some(&today_str),
        ))
        .unwrap();

    // Fechamento explícito da semana vencida (idempotente).
    srv.close_week(&past.id).unwrap();

    let ins = srv.insights(None).unwrap();
    assert_eq!(ins.periodo, "semana");
    // Semana aberta: 1 de 2 ⇒ 50%.
    assert_eq!(ins.pct_semana, 50.0);

    // Tendência em ordem cronológica, incluindo a semana fechada.
    assert_eq!(ins.trend.len(), 2);
    assert_eq!(ins.trend[0].week_id, past.id);
    assert_eq!(ins.trend[0].pct_conclusao, 66.7); // 2 de 3
    assert_eq!(ins.trend[0].taxa_habitos, 100.0); // 1 de 1
    assert_eq!(ins.trend[1].week_id, current.id);
    assert_eq!(ins.trend[1].pct_conclusao, 50.0);

    // Linhas "estimado vs realizado" por semana, ASC, com cron diário ⇒ 7.
    assert_eq!(ins.lines.len(), 2);
    assert_eq!(ins.lines[0].periodo, past.id);
    assert_eq!(ins.lines[0].estimado_tarefas, 3);
    assert_eq!(ins.lines[0].realizado_tarefas, 2);
    assert_eq!(ins.lines[0].estimado_habitos, 7);
    assert_eq!(ins.lines[0].realizado_habitos, 1);
    assert_eq!(ins.lines[1].periodo, current.id);
    assert_eq!(ins.lines[1].estimado_tarefas, 2);
    assert_eq!(ins.lines[1].realizado_tarefas, 1);
    assert_eq!(ins.lines[1].estimado_habitos, 7);
    assert_eq!(ins.lines[1].realizado_habitos, 0);

    // Barras densas: 14 dias seguidos; só hoje tem task (due_date de hoje).
    assert_eq!(ins.bars.len(), 14);
    assert_eq!(ins.bars[0].date, bar_start);
    assert_eq!(ins.bars[13].date, today_str);
    let hoje = &ins.bars[13];
    assert_eq!(hoje.tarefas_total, 2);
    assert_eq!(hoje.tarefas_feitas, 1);
    assert_eq!(hoje.pct_tarefas, 50.0);
    assert_eq!(hoje.habitos_registrados, 0);
    // Dias sem dado aparecem zerados (série densa para o SVG).
    assert_eq!(ins.bars[0].tarefas_total, 0);
    assert_eq!(ins.bars[0].pct_tarefas, 0.0);

    // Hábito sem métrica ainda: placar de hoje contabiliza, streak zero.
    assert_eq!(ins.habitos_hoje_total, 1);
    assert_eq!(ins.habitos_hoje_feitos, 0);
    assert_eq!(ins.streaks.len(), 1);
    assert_eq!(ins.streaks[0].streak_atual, 0);

    // Granularidade mensal: chaves `AAAA-MM`, agregado pronto no backend.
    let mes = srv.insights(Some("mes")).unwrap();
    assert_eq!(mes.periodo, "mes");
    assert!(!mes.lines.is_empty());
    assert!(mes.lines.iter().all(|p| p.periodo.len() == 7));
    assert!(mes
        .lines
        .iter()
        .all(|p| p.estimado_tarefas >= p.realizado_tarefas));

    // Período inválido ⇒ erro tipado (sem pânico).
    assert!(srv.insights(Some("ano")).is_err());
}

#[test]
fn test_insights_streaks_and_today_score_from_metrics() {
    let (db, srv, _dir) = kanban_vault_fixture();
    let habit = srv
        .habit()
        .create_habit("Beber água", "0 9 * * *", None)
        .unwrap();

    let today = chrono::Local::now().date_naive();
    let today_str = today.format("%Y-%m-%d").to_string();
    let yesterday_str = (today - chrono::Duration::days(1))
        .format("%Y-%m-%d")
        .to_string();
    db.insert_tabular_metric("habito", &today_str, &habit.id, 1.0, None, None)
        .unwrap();
    db.insert_tabular_metric("habito", &yesterday_str, &habit.id, 1.0, None, None)
        .unwrap();

    // Semana aberta para as linhas terem ponto (cron diário ⇒ 7 estimados).
    srv.get_or_create_week(today).unwrap();
    let ins = srv.insights(None).unwrap();

    assert_eq!(ins.streaks.len(), 1);
    let card = &ins.streaks[0];
    assert_eq!(card.habit.id, habit.id);
    assert_eq!(card.streak_atual, 2);
    assert_eq!(card.maior_streak, 2);
    assert!(card.feito_hoje);
    assert_eq!(ins.habitos_hoje_total, 1);
    assert_eq!(ins.habitos_hoje_feitos, 1);

    assert_eq!(ins.lines.len(), 1);
    assert_eq!(ins.lines[0].estimado_habitos, 7);
    assert_eq!(
        ins.lines[0].realizado_habitos, 0,
        "sem task de hábito concluída"
    );

    // Barra de hoje reflete a métrica registrada.
    assert_eq!(ins.bars[13].habitos_registrados, 1);
}

#[test]
fn test_listar_insights_tool_returns_aggregates() {
    ensure_ort_initialized();
    use copernico_app_lib::indexer::Indexer;
    use copernico_app_lib::mcp::McpManager;
    use copernico_app_lib::services::kanban_srv::KanbanService;
    use copernico_app_lib::tool_registry::ToolRegistry;
    use std::sync::Arc;

    let dir = tempdir().unwrap();
    let db = Arc::new(Database::init(Path::new(":memory:")).unwrap());
    let vm = Arc::new(VaultManager::new(
        dir.path().join("default"),
        dir.path().join("obsidian"),
    ));
    let kanban = Arc::new(KanbanService::new(db.clone(), vm.clone()));
    let idx = Arc::new(Indexer::new(db.get_pool(), vm.clone()).unwrap());
    let mcp = Arc::new(McpManager::new());
    let reg = ToolRegistry::new(db, vm, idx, kanban, mcp, dir.path().join("skills"));

    // Padrão ⇒ período "semana" com o relatório embutido (Markdown + JSON).
    let v: serde_json::Value = serde_json::from_str(&reg.execute("listar_insights", "{}")).unwrap();
    assert_eq!(v["sucesso"], true, "{}", v);
    assert_eq!(v["insights"]["periodo"], "semana");
    assert!(v["insights"]["bars"].as_array().is_some());
    assert!(v["resumo"]
        .as_str()
        .unwrap_or_default()
        .contains("## Insights"));

    // Alias mensal é aceito.
    let v2: serde_json::Value = serde_json::from_str(&reg.execute(
        "listar_insights",
        &serde_json::json!({ "periodo": "mensal" }).to_string(),
    ))
    .unwrap();
    assert_eq!(v2["sucesso"], true, "{}", v2);
    assert_eq!(v2["insights"]["periodo"], "mes");

    // Período inválido ⇒ erro tipado, sem pânico.
    let v3: serde_json::Value = serde_json::from_str(&reg.execute(
        "listar_insights",
        &serde_json::json!({ "periodo": "ano" }).to_string(),
    ))
    .unwrap();
    assert_eq!(v3["sucesso"], false, "{}", v3);
}
