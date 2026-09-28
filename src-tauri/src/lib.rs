pub mod agent;
pub mod bridge;
pub mod code_runner;
pub mod commands;
pub mod config;
pub mod consolidation;
pub mod db;
pub mod domain;
pub mod greetings;
pub mod indexer;
pub mod infra;
pub mod llm;
pub mod mcp;
pub mod plugin_registry;
pub mod providers;
pub mod services;
pub mod skill_runner;
pub mod skills;
pub mod stt;
pub mod thinking;
pub mod tool_registry;
pub mod tts;
pub mod vault;
pub mod wake_word;
pub mod workers;

use agent::{AgentCore, SharedAgentCore};
use config::AppConfig;
use db::{Database, SharedDatabase};
use indexer::{Indexer, SharedIndexer};
use llm::{LlmClient, SharedLlmClient};
use mcp::McpManager;
use plugin_registry::PluginRegistry;
use services::kanban_srv::{KanbanService, SharedKanbanService};
use skill_runner::SkillRunner;
use std::sync::Arc;
use stt::{GroqSttClient, SharedSttClient};
use tauri::Manager;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tool_registry::ToolRegistry;
use tts::{EdgeTtsClient, SharedTtsClient, DEFAULT_TTS_VOICE};
use vault::{SharedVaultManager, VaultManager};
use wake_word::{SharedWakeWordService, WakeWordService};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Garante a instalação do provedor criptográfico padrão para o Rustls 0.23+ (evita panic em WSS TLS)
    let _ = rustls::crypto::ring::default_provider().install_default();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive(tracing::Level::INFO.into()),
        )
        .init();

    let config = Arc::new(AppConfig::from_env());

    // Inicializa SQLite
    let database = match Database::init(&config.db_path) {
        Ok(db) => Arc::new(db),
        Err(err) => {
            eprintln!(
                "[ERRO FATAL] Falha ao inicializar banco de dados SQLite: {}",
                err
            );
            std::process::exit(1);
        }
    };

    // Inicializa VaultManager
    let vault_manager = Arc::new(VaultManager::new(
        config.vault_path.clone(),
        config.obsidian_vault_path.clone(),
    ));

    // Inicializa Indexer
    let indexer = match Indexer::new(database.get_pool(), vault_manager.clone()) {
        Ok(idx) => Arc::new(idx),
        Err(err) => {
            eprintln!(
                "[ERRO FATAL] Falha ao inicializar Indexer FastEmbed: {}",
                err
            );
            std::process::exit(1);
        }
    };

    // Carrega padrão de data ativo configurado pelo usuário
    if let Ok(Some(df)) = database.get_setting("date_format") {
        vault::set_active_date_format(&df);
    }

    // Inicializa MCP Manager
    let mcp_manager = Arc::new(McpManager::new());

    // Inicializa Kanban Semanal (quadro ISO + hábitos)
    let kanban_service: SharedKanbanService =
        Arc::new(KanbanService::new(database.clone(), vault_manager.clone()));

    // Inicializa ToolRegistry
    let tool_registry = Arc::new(ToolRegistry::new(
        database.clone(),
        vault_manager.clone(),
        indexer.clone(),
        kanban_service.clone(),
        mcp_manager.clone(),
        config.skills_path.clone(),
    ));

    // Inicializa LLM Client
    let llm_raw = Arc::new(LlmClient::new(config.clone()));
    llm_raw.set_database(database.clone());
    let llm_client: SharedLlmClient = llm_raw;

    // Inicializa AgentCore
    let agent_core: SharedAgentCore = Arc::new(AgentCore::new(
        llm_client.clone(),
        tool_registry.clone(),
        database.clone(),
        vault_manager.clone(),
        indexer.clone(),
    ));

    let groq_raw = Arc::new(GroqSttClient::new(&config.groq_api_key, &config.groq_model));
    groq_raw.set_database(database.clone());
    let stt_client: SharedSttClient = groq_raw;

    // Inicializa WakeWordService
    let wake_word_service: SharedWakeWordService = Arc::new(WakeWordService::new());

    // Gravador manual push-to-talk (mesmo dispositivo cpal do wake engine)
    let manual_recorder = Arc::new(crate::infra::hardware::ManualRecorder::new());

    // Inicializa EdgeTtsClient (Voz padrão: Thalita, ou recuperada do banco)
    let initial_tts_voice = database
        .get_setting("tts_voice")
        .ok()
        .flatten()
        .unwrap_or_else(|| DEFAULT_TTS_VOICE.to_string());
    let tts_client: SharedTtsClient = Arc::new(EdgeTtsClient::new(&initial_tts_voice));

    // Inicializa PluginRegistry
    let plugin_registry = Arc::new(PluginRegistry::new(
        config.plugins_path.clone(),
        mcp_manager.clone(),
        database.clone(),
    ));

    // Escaneia e carrega plugins
    if let Err(err) = plugin_registry.scan_and_load_plugins() {
        eprintln!("[PLUGINS WARN] Falha ao carregar plugins: {}", err);
    }

    // Inicializa SkillRunner
    let skill_runner = Arc::new(SkillRunner::new(
        agent_core.clone(),
        database.clone(),
        plugin_registry.clone(),
    ));
    skill_runner.set_skills_path(config.skills_path.clone());

    // Inicializa GreetingsManager (saudações contextuais com voz)
    let greetings_manager: Arc<greetings::GreetingsManager> = Arc::new(
        greetings::GreetingsManager::new(config.greetings_path.clone()),
    );

    // Inicializa ThinkingAudiosManager (fillers sonoros pré-gerados)
    let thinking_manager: Arc<thinking::ThinkingAudiosManager> = Arc::new(
        thinking::ThinkingAudiosManager::new(config.thinking_audios_path.clone()),
    );

    let hotkey_str = database
        .get_setting("global_shortcut")
        .ok()
        .flatten()
        .unwrap_or_else(|| config.hotkey.clone());
    let indexer_clone = indexer.clone();
    let config_clone = config.clone();
    let agent_core_clone = agent_core.clone();
    let stt_client_clone = stt_client.clone();
    let tts_client_clone = tts_client.clone();
    let database_clone = database.clone();
    let wake_word_service_clone = wake_word_service.clone();
    let skill_runner_clone = skill_runner.clone();
    let tool_registry_clone = tool_registry.clone();
    let kanban_runner_clone = kanban_service.clone();
    let greetings_clone = greetings_manager.clone();
    let greetings_startup = greetings_manager.clone();
    let thinking_clone = thinking_manager.clone();
    let thinking_startup = thinking_manager.clone();
    let tts_startup = tts_client.clone();
    let db_startup = database.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        println!(
                            "[HOTKEY] Atalho global pressionado! Trazendo janela principal..."
                        );
                        let _ = commands::focus_main_window(app);
                    }
                })
                .build(),
        )
        .manage(database as SharedDatabase)
        .manage(vault_manager as SharedVaultManager)
        .manage(indexer as SharedIndexer)
        .manage(agent_core as SharedAgentCore)
        .manage(stt_client as SharedSttClient)
        .manage(tts_client as SharedTtsClient)
        .manage(wake_word_service as SharedWakeWordService)
        .manage(manual_recorder as crate::infra::hardware::SharedManualRecorder)
        .manage(plugin_registry.clone())
        .manage(tool_registry.clone())
        .manage(skill_runner.clone())
        .manage(mcp_manager.clone())
        .manage(kanban_service.clone())
        .manage(greetings_manager.clone())
        .manage(thinking_manager.clone())
        .manage(config.clone())
        .setup(move |app| {
            agent_core_clone.set_app_handle(app.handle().clone());
            tool_registry_clone.set_app_handle(app.handle().clone());
            skill_runner_clone.set_app_handle(app.handle().clone());
            // Fase 3: o tick do scheduler fecha semanas vencidas (domingo 23h).
            skill_runner_clone.set_kanban_service(kanban_runner_clone.clone());
            skill_runner_clone.start_scheduler();

            // Registra atalho global configurado
            let shortcut_parse = hotkey_str.replace(" ", "").parse::<Shortcut>();
            match shortcut_parse {
                Ok(sc) => {
                    if let Err(err) = app.global_shortcut().register(sc) {
                        eprintln!(
                            "[WARN] Falha ao registrar atalho global '{}': {}",
                            hotkey_str, err
                        );
                        use tauri::Emitter;
                        let _ = app.emit(
                            "shortcut-conflict",
                            serde_json::json!({
                                "hotkey": hotkey_str,
                                "error": err.to_string(),
                                "suggestions": ["Alt+Space", "Win+Shift+C"]
                            }),
                        );
                    } else {
                        println!("[OK] Atalho global registrado: {}", hotkey_str);
                    }
                }
                Err(err) => {
                    eprintln!("[WARN] Atalho '{}' inválido: {}", hotkey_str, err);
                }
            }

            // Indexação em background inicial (thread desacoplada)
            std::thread::spawn(move || {
                if let Ok((def_cnt, obs_cnt)) = indexer_clone.reindex_all() {
                    println!(
                        "[INDEX] Reindexação inicial concluída: default={}, obsidian={}",
                        def_cnt, obs_cnt
                    );
                }
            });

            // Purga no startup: dismissed há +72h (tombstone curto para auditoria do chat).
            {
                let db = db_startup.clone();
                std::thread::spawn(move || match db.prune_dismissed_expired() {
                    Ok(n) if n > 0 => {
                        println!("[INBOX] Startup: {} dismissed expirado(s) removidos.", n)
                    }
                    Ok(_) => {}
                    Err(e) => eprintln!("[INBOX] Falha na purga de startup: {}", e),
                });
            }

            // Gera saudações no startup (síncrono no boot, em background para não travar UI)
            {
                let gm = greetings_startup.clone();
                let tts = tts_startup.clone();
                let db = db_startup.clone();
                tauri::async_runtime::spawn(async move {
                    println!("[GREETINGS] Verificando 18 áudios genéricos no startup...");
                    match gm.ensure_at_startup(&tts, &db).await {
                        Ok(msg) => println!("[GREETINGS] {}", msg),
                        Err(e) => eprintln!("[GREETINGS] Falha no startup: {}", e),
                    }
                });
            }

            // Gera fillers de pensamento no startup (em background para não travar boot)
            {
                let tm = thinking_startup.clone();
                let tts = tts_startup.clone();
                let db = db_startup.clone();
                tauri::async_runtime::spawn(async move {
                    println!("[THINKING] Verificando 30 fillers de pensamento no startup...");
                    match tm.ensure_at_startup(&tts, &db).await {
                        Ok(msg) => println!("[THINKING] {}", msg),
                        Err(e) => eprintln!("[THINKING] Falha no startup: {}", e),
                    }
                });
            }

            // Inicia serviço de escuta contínua de wake word em background (in-process)
            workers::spawn_inprocess_wake(
                app.handle().clone(),
                config_clone.wake_word_models_dir.clone(),
                agent_core_clone,
                stt_client_clone,
                tts_client_clone,
                database_clone,
                wake_word_service_clone,
                greetings_clone,
                thinking_clone,
            );

            // Garante que a janela principal seja exibida e focada no lançamento
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::show_main_window,
            commands::list_sessions,
            commands::get_messages,
            commands::new_session,
            commands::rename_session,
            commands::delete_session,
            commands::send_message,
            commands::search_notes,
            commands::read_note,
            commands::reindex_vaults,
            commands::get_notes_graph,
            commands::list_note_titles,
            commands::get_system_prompt,
            commands::set_system_prompt,
            commands::reset_system_prompt,
            commands::get_voice_system_prompt,
            commands::set_voice_system_prompt,
            commands::reset_voice_system_prompt,
            commands::set_active_session_id,
            commands::open_brain_folder,
            commands::transcribe_audio,
            commands::get_wake_word_threshold,
            commands::set_wake_word_threshold,
            commands::set_wake_detection_active,
            commands::set_wake_mic_enabled,
            commands::cancel_wake_recording,
            commands::start_manual_recording,
            commands::stop_manual_recording,
            commands::delete_message,
            commands::time_travel_edit,
            commands::get_tts_voices,
            commands::get_current_tts_voice,
            commands::set_tts_voice,
            commands::test_tts_voice,
            commands::speak_text,
            commands::stop_tts,
            commands::fade_out_tts,
            commands::benchmark_tts,
            commands::list_plugins,
            commands::toggle_plugin,
            commands::list_tools,
            commands::get_mcp_servers_status,
            commands::list_skills,
            commands::run_skill_now,
            commands::list_themes,
            commands::get_active_theme,
            commands::set_active_theme,
            commands::list_inbox_items,
            commands::mark_inbox_item_status,
            commands::delete_inbox_item,
            commands::accept_inbox_item,
            commands::get_unread_inbox_count,
            commands::prune_dismissed_inbox,
            commands::evolve_note,
            commands::refine_inbox_proposal,
            commands::dismiss_inbox_item,
            commands::snooze_inbox_item,
            commands::set_skill_cron,
            commands::reset_skill_cron,
            commands::get_skill_cron_override,
            commands::reload_plugins,
            commands::get_skill_config,
            commands::save_skill_config,
            commands::reset_skill_config,
            commands::get_user_profile,
            commands::save_onboarding_profile,
            commands::save_user_profile,
            commands::get_api_keys,
            commands::save_api_keys,
            commands::reset_onboarding,
            commands::update_global_shortcut,
            commands::apply_instruction_improvement,
            commands::trigger_session_reflection,
            commands::open_skills_folder,
            commands::install_skill_from_source,
            commands::toggle_skill,
            commands::delete_skill,
            commands::list_scheduled_routines,
            commands::save_scheduled_routine,
            commands::delete_scheduled_routine,
            commands::toggle_scheduled_routine,
            commands::trigger_routine_now,
            commands::get_mcp_config,
            commands::save_mcp_config,
            commands::consolidate_session,
            commands::rename_note,
            commands::archive_and_delete_note,
            commands::consolidate_notes,
            commands::list_greetings,
            commands::ensure_greetings,
            commands::preview_greeting,
            commands::list_kanban_week,
            commands::create_kanban_task,
            commands::move_kanban_task,
            commands::update_kanban_task,
            commands::delete_kanban_task,
            commands::create_task_note,
            commands::get_task_note,
            commands::save_task_note,
            commands::link_task_note,
            commands::unlink_task_note,
            commands::list_entities,
            commands::create_entity,
            commands::link_task_entity,
            commands::unlink_task_entity,
            commands::list_habits,
            commands::create_habit,
            commands::update_habit,
            commands::set_habit_active,
            commands::delete_habit,
            commands::list_insights,
        ])
        .run(tauri::generate_context!())
        .expect("erro ao rodar aplicação Tauri Copernico");
}
