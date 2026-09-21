use crate::agent::SharedAgentCore;
use crate::config::AppConfig;
use crate::db::{Message, ScheduledRoutine, Session, SharedDatabase};
use crate::indexer::{SearchResult, SharedIndexer};
use crate::skill_runner::SkillRunner;
use crate::skills::{SkillInfo, SkillManager};
use crate::vault::{Note, SharedVaultManager};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

pub use crate::domain::models::SendMessageResponse;

#[cfg(target_os = "windows")]
#[repr(C)]
struct WinPoint {
    x: i32,
    y: i32,
}

#[cfg(target_os = "windows")]
extern "system" {
    fn GetCursorPos(lp_point: *mut WinPoint) -> i32;
}

pub fn get_global_cursor_pos() -> Option<(i32, i32)> {
    #[cfg(target_os = "windows")]
    unsafe {
        let mut pt = WinPoint { x: 0, y: 0 };
        if GetCursorPos(&mut pt) != 0 {
            return Some((pt.x, pt.y));
        }
    }
    None
}

pub fn toggle_overlay_window(app: &AppHandle, visible: Option<bool>) -> Result<bool, String> {
    if let Some(window) = app.get_webview_window("main") {
        let is_vis = window.is_visible().unwrap_or(false);
        let is_focused = window.is_focused().unwrap_or(false);

        // Se o usuário especificou o estado explicitamente, respeita.
        // Se foi acionado pelo atalho (visible == None):
        // Se está visível E focada -> esconde.
        // Se está escondida, ou visível mas em segundo plano (sem foco) -> traz para a frente e foca!
        let target_vis = visible.unwrap_or(if is_vis && is_focused { false } else { true });

        if !target_vis {
            window.hide().map_err(|e| e.to_string())?;
            let _ = app.emit("overlay-toggled", false);
            if let Some(tts) = app.try_state::<crate::tts::SharedTtsClient>() {
                tts.fade_out_and_stop(300);
            }
            Ok(false)
        } else {
            // Posiciona a janela no monitor ativo onde o cursor do mouse estiver no momento exato do atalho
            let cursor_coords = get_global_cursor_pos().or_else(|| {
                window
                    .cursor_position()
                    .ok()
                    .map(|p| (p.x as i32, p.y as i32))
            });

            if let Some((cur_x, cur_y)) = cursor_coords {
                if let Ok(monitors) = window.available_monitors() {
                    for m in monitors {
                        let m_pos = m.position();
                        let m_size = m.size();
                        let mx = m_pos.x;
                        let my = m_pos.y;
                        let mw = m_size.width as i32;
                        let mh = m_size.height as i32;
                        if cur_x >= mx && cur_x < mx + mw && cur_y >= my && cur_y < my + mh {
                            let scale = m.scale_factor();
                            let win_w = (960.0 * scale) as i32;
                            let win_h = (640.0 * scale) as i32;
                            // Clamp para garantir que a janela permaneça visível mesmo com scale/DPI inesperado
                            let mut cx = mx + (mw - win_w) / 2;
                            let mut cy = my + (mh - win_h) / 2;
                            // Se a janela for maior que o monitor, ancora com margem mínima de 10px
                            if win_w >= mw {
                                cx = mx + 10;
                            } else {
                                cx = cx.max(mx + 10).min(mx + mw - win_w - 10);
                            }
                            if win_h >= mh {
                                cy = my + 10;
                            } else {
                                cy = cy.max(my + 10).min(my + mh - win_h - 10);
                            }
                            // Fallback adicional: garante coordenadas não-negativas absurdas
                            cx = cx.max(mx);
                            cy = cy.max(my);
                            let _ = window.set_position(tauri::Position::Physical(
                                tauri::PhysicalPosition { x: cx, y: cy },
                            ));
                            println!("[OVERLAY] Posicionado em monitor ({}, {} {}x{}) -> janela em ({}, {}) scale={}", mx, my, mw, mh, cx, cy, scale);
                            break;
                        }
                    }
                }
            }

            // Ao abrir overlay durante fala, faz fade out (requisito: voz deve abaixar e sumir)
            if let Some(tts) = app.try_state::<crate::tts::SharedTtsClient>() {
                tts.fade_out_and_stop(300);
            }
            window.show().map_err(|e| e.to_string())?;
            window.unminimize().map_err(|e| e.to_string())?;
            window.set_always_on_top(true).map_err(|e| e.to_string())?;
            window.set_focus().map_err(|e| e.to_string())?;
            let _ = app.emit("overlay-toggled", true);
            // Não oculta o Sol no meio de uma interação por voz (janela vai do 1º "copernico" ao encerrar).
            let voice_active = app
                .try_state::<crate::wake_word::SharedWakeWordService>()
                .map(|w| w.voice_active())
                .unwrap_or(false);
            if !voice_active {
                #[cfg(windows)]
                crate::native_overlay::hide();
                if let Some(indicator_win) = app.get_webview_window("indicator") {
                    let _ = indicator_win.hide();
                }
                println!("[SOL] hide indicator (toggle-overlay)");
            } else {
                println!("[SOL] keep indicator (toggle-overlay durante voz)");
            }
            Ok(true)
        }
    } else {
        Err("Janela 'main' não encontrada".into())
    }
}

#[tauri::command]
pub async fn toggle_overlay(app: AppHandle, visible: Option<bool>) -> Result<bool, String> {
    toggle_overlay_window(&app, visible)
}

#[tauri::command]
pub async fn list_sessions(db: State<'_, SharedDatabase>) -> Result<Vec<Session>, String> {
    db.list_sessions().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_messages(
    session_id: String,
    db: State<'_, SharedDatabase>,
) -> Result<Vec<Message>, String> {
    db.get_messages(&session_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn new_session(
    title: Option<String>,
    db: State<'_, SharedDatabase>,
) -> Result<Session, String> {
    db.create_session(title.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rename_session(
    session_id: String,
    title: Option<String>,
    new_title: Option<String>,
    db: State<'_, SharedDatabase>,
) -> Result<bool, String> {
    let final_title = title
        .or(new_title)
        .ok_or_else(|| "Título não informado".to_string())?;
    db.rename_session(&session_id, &final_title)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_session(
    session_id: String,
    db: State<'_, SharedDatabase>,
) -> Result<bool, String> {
    db.delete_session(&session_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn send_message(
    session_id: String,
    content: String,
    origin: Option<String>,
    app: AppHandle,
    agent: State<'_, SharedAgentCore>,
    db: State<'_, SharedDatabase>,
) -> Result<SendMessageResponse, String> {
    let overlay_visible = app
        .get_webview_window("main")
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(true);

    let origin_str = origin.unwrap_or_else(|| "text".to_string());

    let response = agent
        .chat(&session_id, &content, &origin_str, overlay_visible)
        .await
        .map_err(|e| e.to_string())?;

    let msgs = db.get_messages(&session_id).map_err(|e| e.to_string())?;
    let user_msg = msgs
        .iter()
        .rev()
        .find(|m| m.role == "user")
        .cloned()
        .unwrap_or(Message {
            id: 0,
            session_id: session_id.clone(),
            role: "user".to_string(),
            content: content.clone(),
            tool_call_id: None,
            tool_calls: None,
            created_at: chrono::Utc::now().to_rfc3339(),
            tokens: None,
            parent_id: None,
        });
    let assistant_msg = msgs
        .iter()
        .rev()
        .find(|m| m.role == "assistant")
        .cloned()
        .unwrap_or(Message {
            id: 0,
            session_id: session_id.clone(),
            role: "assistant".to_string(),
            content: response,
            tool_call_id: None,
            tool_calls: None,
            created_at: chrono::Utc::now().to_rfc3339(),
            tokens: None,
            parent_id: None,
        });

    let current_session = db
        .list_sessions()
        .ok()
        .and_then(|list| list.into_iter().find(|s| s.id == session_id));
    let title = current_session.map(|s| s.titulo);

    Ok(SendMessageResponse {
        user_message: user_msg,
        assistant_message: assistant_msg,
        updated_session_title: title,
    })
}

#[tauri::command]
pub async fn search_notes(
    query: String,
    top_k: Option<usize>,
    indexer: State<'_, SharedIndexer>,
) -> Result<Vec<SearchResult>, String> {
    indexer
        .search_notes(&query, top_k.unwrap_or(5))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn read_note(
    identifier: String,
    vault: State<'_, SharedVaultManager>,
) -> Result<Note, String> {
    vault.read_note(&identifier).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn reindex_vaults(indexer: State<'_, SharedIndexer>) -> Result<(usize, usize), String> {
    indexer.reindex_all().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_notes_graph(
    vault: State<'_, SharedVaultManager>,
) -> Result<crate::vault::GraphData, String> {
    Ok(vault.get_graph_data())
}

#[tauri::command]
pub async fn list_note_titles(
    vault: State<'_, SharedVaultManager>,
) -> Result<Vec<crate::vault::NoteTitleItem>, String> {
    Ok(vault.list_all_note_titles())
}

#[tauri::command]
pub async fn get_system_prompt(db: State<'_, SharedDatabase>) -> Result<String, String> {
    let custom = db.get_setting("system_prompt").map_err(|e| e.to_string())?;
    Ok(custom.unwrap_or_else(|| crate::llm::SYSTEM_PROMPT.to_string()))
}

#[tauri::command]
pub async fn set_system_prompt(
    prompt: String,
    db: State<'_, SharedDatabase>,
) -> Result<(), String> {
    db.set_setting("system_prompt", &prompt)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn reset_system_prompt(db: State<'_, SharedDatabase>) -> Result<String, String> {
    db.delete_setting("system_prompt")
        .map_err(|e| e.to_string())?;
    Ok(crate::llm::SYSTEM_PROMPT.to_string())
}

#[tauri::command]
pub async fn get_voice_system_prompt(db: State<'_, SharedDatabase>) -> Result<String, String> {
    let custom = db
        .get_setting("voice_system_prompt")
        .map_err(|e| e.to_string())?;
    Ok(custom.unwrap_or_else(|| crate::llm::DEFAULT_VOICE_SYSTEM_PROMPT.to_string()))
}

#[tauri::command]
pub async fn set_voice_system_prompt(
    prompt: String,
    db: State<'_, SharedDatabase>,
) -> Result<(), String> {
    db.set_setting("voice_system_prompt", &prompt)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn reset_voice_system_prompt(db: State<'_, SharedDatabase>) -> Result<String, String> {
    db.delete_setting("voice_system_prompt")
        .map_err(|e| e.to_string())?;
    Ok(crate::llm::DEFAULT_VOICE_SYSTEM_PROMPT.to_string())
}

#[tauri::command]
pub async fn set_active_session_id(
    session_id: Option<String>,
    wake_service: State<'_, crate::wake_word::SharedWakeWordService>,
) -> Result<(), String> {
    wake_service.set_active_session(session_id);
    Ok(())
}

#[tauri::command]
pub async fn open_brain_folder(vault: State<'_, SharedVaultManager>) -> Result<(), String> {
    let path = vault.get_default_vault();
    let parent = path.parent().unwrap_or(path);

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(parent)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(parent)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn transcribe_audio(
    audio_bytes: Vec<u8>,
    mime_type: Option<String>,
    stt: State<'_, crate::stt::SharedSttClient>,
) -> Result<String, String> {
    stt.transcribe(audio_bytes, mime_type.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_wake_word_threshold(
    db: State<'_, SharedDatabase>,
    wake_service: State<'_, crate::wake_word::SharedWakeWordService>,
) -> Result<f32, String> {
    if let Ok(Some(val)) = db.get_setting("wake_word_threshold") {
        if let Ok(th) = val.parse::<f32>() {
            return Ok(th);
        }
    }
    Ok(wake_service.get_threshold())
}

#[tauri::command]
pub async fn set_wake_word_threshold(
    threshold: f32,
    db: State<'_, SharedDatabase>,
    wake_service: State<'_, crate::wake_word::SharedWakeWordService>,
) -> Result<(), String> {
    wake_service.set_threshold(threshold);
    let _ = db.set_setting("wake_word_threshold", &threshold.to_string());
    Ok(())
}

#[tauri::command]
pub async fn set_wake_detection_active(
    active: bool,
    wake_service: State<'_, crate::wake_word::SharedWakeWordService>,
) -> Result<(), String> {
    wake_service.set_detection_active(active);
    Ok(())
}

#[tauri::command]
pub async fn cancel_wake_recording(
    wake_service: State<'_, crate::wake_word::SharedWakeWordService>,
    tts: State<'_, crate::tts::SharedTtsClient>,
) -> Result<(), String> {
    wake_service.cancel_recording();
    // Descarte explícito pelo usuário encerra a janela de voz (o evento Cancel do sidecar confirma).
    wake_service.set_voice_active(false);
    tts.fade_out_and_stop(250);
    Ok(())
}

/// Diagnóstico temporário: permite ao frontend do indicador despejar sua
/// verdade local ([SOL-FRONT]) no log do backend, correlacionável com [SOL].
/// Será removido (ou posto atrás de flag) quando a causa-raiz for confirmada.
#[tauri::command]
pub async fn report_sun_debug(message: String) -> Result<(), String> {
    println!("[SOL-FRONT] {}", message);
    Ok(())
}

#[tauri::command]
pub async fn consolidate_session(
    session_id: String,
    app: AppHandle,
    db: State<'_, SharedDatabase>,
    agent: State<'_, SharedAgentCore>,
    vault: State<'_, SharedVaultManager>,
    indexer: State<'_, SharedIndexer>,
) -> Result<Option<String>, String> {
    let llm = agent.llm();
    let tools = agent.tool_registry();
    crate::consolidation::consolidate_voice_session(
        &session_id,
        Some(app),
        db.inner().clone(),
        llm,
        vault.inner().clone(),
        indexer.inner().clone(),
        tools,
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rename_note(
    identifier: String,
    novo_titulo: String,
    vault: State<'_, SharedVaultManager>,
    indexer: State<'_, SharedIndexer>,
) -> Result<serde_json::Value, String> {
    let rep = vault
        .rename_note_with_repoint(&identifier, &novo_titulo)
        .map_err(|e| e.to_string())?;
    let old_str = rep.old_path.to_string_lossy().to_string();
    if let Ok(conn) = indexer.vault_pool().get() {
        let _ = conn.execute(
            "DELETE FROM vault_index WHERE path = ?1",
            rusqlite::params![old_str],
        );
    }
    let _ = indexer.index_single_note(&rep.new_path, "default");
    for f in &rep.repointed_files {
        let _ = indexer.index_single_note(f, "default");
    }
    serde_json::to_value(&rep).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn archive_and_delete_note(
    identifier: String,
    incorporada_em: Option<String>,
    motivo: Option<String>,
    vault: State<'_, SharedVaultManager>,
    indexer: State<'_, SharedIndexer>,
) -> Result<String, String> {
    let motivo_txt = motivo.unwrap_or_else(|| "archive-then-delete via comando".to_string());
    let snap = vault
        .archive_note(&identifier, incorporada_em.as_deref(), None, &motivo_txt)
        .map_err(|e| e.to_string())?;
    let _ = indexer.index_single_note(&snap, "default");
    let old = vault.delete_note(&identifier).map_err(|e| e.to_string())?;
    let old_str = old.to_string_lossy().to_string();
    if let Ok(conn) = indexer.vault_pool().get() {
        let _ = conn.execute(
            "DELETE FROM vault_index WHERE path = ?1",
            rusqlite::params![old_str],
        );
    }
    Ok(snap.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn consolidate_notes(
    nota_padrao: String,
    fontes: Vec<String>,
    corpo_final: String,
    vault: State<'_, SharedVaultManager>,
    indexer: State<'_, SharedIndexer>,
) -> Result<serde_json::Value, String> {
    let padrao_path = vault
        .update_note(&nota_padrao, &corpo_final, "replace")
        .map_err(|e| e.to_string())?;
    let _ = indexer.index_single_note(&padrao_path, "default");
    let mut arquivadas = Vec::new();
    let mut falhas = Vec::new();
    for fonte in fontes.iter().filter(|f| *f != &nota_padrao) {
        match vault.archive_note(
            fonte,
            Some(&nota_padrao),
            None,
            "duplicata incorporada em consolidação",
        ) {
            Ok(snap) => {
                let _ = indexer.index_single_note(&snap, "default");
                match vault.delete_note(fonte) {
                    Ok(old) => {
                        let old_str = old.to_string_lossy().to_string();
                        if let Ok(conn) = indexer.vault_pool().get() {
                            let _ = conn.execute(
                                "DELETE FROM vault_index WHERE path = ?1",
                                rusqlite::params![old_str],
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
    Ok(serde_json::json!({
        "padrao": padrao_path.to_string_lossy().to_string(),
        "arquivadas_e_deletadas": arquivadas,
        "falhas": falhas,
    }))
}

#[tauri::command]
pub async fn delete_message(
    message_id: i64,
    db: State<'_, SharedDatabase>,
) -> Result<bool, String> {
    db.delete_message(message_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn time_travel_edit(
    session_id: String,
    message_id: i64,
    new_content: String,
    origin: Option<String>,
    app: AppHandle,
    agent: State<'_, SharedAgentCore>,
    db: State<'_, SharedDatabase>,
) -> Result<SendMessageResponse, String> {
    // Trunca mensagens a partir de message_id inclusive no banco
    db.truncate_messages_from(&session_id, message_id)
        .map_err(|e| e.to_string())?;

    // Executa novo turno com o conteúdo editado
    send_message(session_id, new_content, origin, app, agent, db).await
}

#[tauri::command]
pub async fn get_tts_voices(
    tts: State<'_, crate::tts::SharedTtsClient>,
) -> Result<Vec<crate::tts::VoiceInfo>, String> {
    Ok(tts.get_available_voices().await)
}

#[tauri::command]
pub async fn get_current_tts_voice(
    db: State<'_, SharedDatabase>,
    tts: State<'_, crate::tts::SharedTtsClient>,
) -> Result<String, String> {
    if let Ok(Some(saved)) = db.get_setting("tts_voice") {
        if !saved.trim().is_empty() {
            return Ok(saved.trim().to_string());
        }
    }
    Ok(tts.get_voice())
}

#[tauri::command]
pub async fn set_tts_voice(
    voice: String,
    db: State<'_, SharedDatabase>,
    tts: State<'_, crate::tts::SharedTtsClient>,
    thinking: State<'_, crate::thinking::SharedThinkingAudiosManager>,
) -> Result<(), String> {
    let clean = voice.trim();
    if clean.is_empty() {
        return Err("Nome da voz não informado".into());
    }
    tts.set_voice(clean);
    db.set_setting("tts_voice", clean)
        .map_err(|e| e.to_string())?;
    println!("[TTS] Nova voz padrão definida no banco: {}", clean);

    // Invalida e regenera fillers de pensamento para a nova voz em background
    let tm = thinking.inner().clone();
    let tts_cl = tts.inner().clone();
    let db_cl = db.inner().clone();
    let voice_label = clean.to_string();
    tauri::async_runtime::spawn(async move {
        println!(
            "[THINKING] Regenerando fillers de pensamento para nova voz: {}...",
            voice_label
        );
        if let Err(e) = tm.invalidate_and_regenerate(&tts_cl, &db_cl).await {
            eprintln!(
                "[THINKING] Erro ao regenerar fillers após troca de voz: {}",
                e
            );
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn test_tts_voice(
    voice: Option<String>,
    tts: State<'_, crate::tts::SharedTtsClient>,
) -> Result<(), String> {
    let sample = "Olá! Eu sou o Copérnico, seu segundo cérebro. Esta é uma amostra da minha voz.";
    tts.speak_text(sample, voice.as_deref())
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn speak_text(
    text: String,
    voice: Option<String>,
    tts: State<'_, crate::tts::SharedTtsClient>,
    db: State<'_, SharedDatabase>,
) -> Result<(), String> {
    let clean = text.trim();
    if clean.is_empty() {
        return Ok(());
    }
    let selected_voice = voice.or_else(|| db.get_setting("tts_voice").ok().flatten());
    tts.speak_text(clean, selected_voice.as_deref())
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn stop_tts(tts: State<'_, crate::tts::SharedTtsClient>) -> Result<(), String> {
    tts.stop();
    Ok(())
}

#[tauri::command]
pub async fn fade_out_tts(
    duration_ms: Option<u64>,
    tts: State<'_, crate::tts::SharedTtsClient>,
) -> Result<(), String> {
    tts.fade_out_and_stop(duration_ms.unwrap_or(250));
    Ok(())
}

#[tauri::command]
pub async fn benchmark_tts(
    text: Option<String>,
    voice: Option<String>,
    tts: State<'_, crate::tts::SharedTtsClient>,
    db: State<'_, SharedDatabase>,
) -> Result<crate::tts::TtsBenchmarkResult, String> {
    let selected_voice = voice.or_else(|| db.get_setting("tts_voice").ok().flatten());
    tts.benchmark(text.as_deref(), selected_voice.as_deref())
        .await
        .map_err(|e| e.to_string())
}

// ─── Comandos do Sistema de Plugins, Ferramentas e Skills ───

#[tauri::command]
pub async fn list_plugins(
    registry: State<'_, std::sync::Arc<crate::plugin_registry::PluginRegistry>>,
) -> Result<Vec<serde_json::Value>, String> {
    Ok(registry.list_plugins())
}

#[tauri::command]
pub async fn toggle_plugin(
    plugin_id: String,
    enabled: bool,
    registry: State<'_, std::sync::Arc<crate::plugin_registry::PluginRegistry>>,
) -> Result<(), String> {
    registry.set_plugin_enabled(&plugin_id, enabled)
}

#[tauri::command]
pub async fn list_tools(
    tool_registry: State<'_, std::sync::Arc<crate::tool_registry::ToolRegistry>>,
) -> Result<serde_json::Value, String> {
    Ok(tool_registry.get_merged_definitions())
}

#[tauri::command]
pub async fn get_mcp_servers_status(
    tool_registry: State<'_, std::sync::Arc<crate::tool_registry::ToolRegistry>>,
) -> Result<Vec<serde_json::Value>, String> {
    Ok(tool_registry.mcp_manager().get_servers_status())
}

#[tauri::command]
pub async fn reload_plugins(
    registry: State<'_, std::sync::Arc<crate::plugin_registry::PluginRegistry>>,
) -> Result<Vec<serde_json::Value>, String> {
    registry.scan_and_load_plugins()?;
    Ok(registry.list_plugins())
}

#[tauri::command]
pub async fn get_skill_config(
    skill_id: String,
    db: State<'_, SharedDatabase>,
    registry: State<'_, std::sync::Arc<crate::plugin_registry::PluginRegistry>>,
) -> Result<serde_json::Value, String> {
    let key = format!("skill_config::{}", skill_id);
    if let Ok(Some(saved)) = db.get_setting(&key) {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&saved) {
            return Ok(val);
        }
    }

    let manifest = registry.get_manifest(&skill_id);
    let skill_cfg = manifest.as_ref().and_then(|m| m.skill.as_ref());
    let default_prompt = skill_cfg
        .map(|s| s.system_prompt.clone())
        .unwrap_or_default();
    let default_max_iter = skill_cfg
        .and_then(|s| s.execution.as_ref())
        .map(|e| e.max_iterations)
        .unwrap_or(8);

    Ok(serde_json::json!({
        "skill_id": skill_id,
        "max_iterations": default_max_iter,
        "system_prompt": default_prompt,
        "custom_goal": "",
        "options": {
            "announce_searches": true,
            "announce_thoughts": true,
            "announce_questions": true,
        }
    }))
}

#[tauri::command]
pub async fn save_skill_config(
    skill_id: String,
    config: serde_json::Value,
    db: State<'_, SharedDatabase>,
) -> Result<(), String> {
    let key = format!("skill_config::{}", skill_id);
    let serialized = serde_json::to_string(&config).map_err(|e| e.to_string())?;
    db.set_setting(&key, &serialized).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn reset_skill_config(
    skill_id: String,
    db: State<'_, SharedDatabase>,
    registry: State<'_, std::sync::Arc<crate::plugin_registry::PluginRegistry>>,
) -> Result<serde_json::Value, String> {
    let key = format!("skill_config::{}", skill_id);
    let _ = db.delete_setting(&key);

    let manifest = registry.get_manifest(&skill_id);
    let skill_cfg = manifest.as_ref().and_then(|m| m.skill.as_ref());
    let default_prompt = skill_cfg
        .map(|s| s.system_prompt.clone())
        .unwrap_or_default();
    let default_max_iter = skill_cfg
        .and_then(|s| s.execution.as_ref())
        .map(|e| e.max_iterations)
        .unwrap_or(8);

    Ok(serde_json::json!({
        "skill_id": skill_id,
        "max_iterations": default_max_iter,
        "system_prompt": default_prompt,
        "custom_goal": "",
        "options": {
            "announce_searches": true,
            "announce_thoughts": true,
            "announce_questions": true,
        }
    }))
}

#[tauri::command]
pub async fn run_skill_now(
    skill_id: String,
    manual_input: Option<String>,
    runner: State<'_, std::sync::Arc<crate::skill_runner::SkillRunner>>,
) -> Result<serde_json::Value, String> {
    runner.run_skill(&skill_id, manual_input.as_deref()).await
}

#[tauri::command]
pub async fn list_themes(
    registry: State<'_, std::sync::Arc<crate::plugin_registry::PluginRegistry>>,
) -> Result<Vec<serde_json::Value>, String> {
    Ok(registry.list_themes())
}

#[tauri::command]
pub async fn get_active_theme(db: State<'_, SharedDatabase>) -> Result<Option<String>, String> {
    db.get_setting("active_theme").map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_active_theme(
    theme_id: String,
    db: State<'_, SharedDatabase>,
) -> Result<(), String> {
    db.set_setting("active_theme", &theme_id)
        .map_err(|e| e.to_string())
}

// --- Inbox & Cartas do Agente ---

#[tauri::command]
pub async fn list_inbox_items(
    db: State<'_, SharedDatabase>,
) -> Result<Vec<crate::db::InboxItem>, String> {
    db.list_inbox_items().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mark_inbox_item_status(
    id: String,
    status: String,
    reason: Option<String>,
    app: AppHandle,
    db: State<'_, SharedDatabase>,
) -> Result<(), String> {
    let reason_ref = reason.as_deref();
    db.mark_inbox_item_status_with_reason(&id, &status, reason_ref)
        .map_err(|e| e.to_string())?;
    if let Ok(Some(item)) = db.get_inbox_item(&id) {
        mirror_inbox_decision(Some(&app), &db, &item, &status, reason_ref);
    } else {
        let unread_count = db.get_unread_inbox_count().unwrap_or(0);
        let _ = app.emit(
            "inbox-updated",
            serde_json::json!({ "unread_count": unread_count }),
        );
    }
    Ok(())
}

#[tauri::command]
pub async fn accept_inbox_item(
    id: String,
    reason: Option<String>,
    app: AppHandle,
    db: State<'_, SharedDatabase>,
    vault: State<'_, SharedVaultManager>,
    indexer: State<'_, SharedIndexer>,
) -> Result<String, String> {
    let items = db.list_inbox_items().map_err(|e| e.to_string())?;
    let item = items
        .into_iter()
        .find(|i| i.id == id)
        .ok_or_else(|| format!("Item '{}' não encontrado na Inbox", id))?;

    let clean_title = item.title.trim();
    let base_name = crate::vault::sanitize_filename(clean_title);
    let inbox_path = vault
        .default_vault
        .join("Inbox")
        .join(format!("{}.md", base_name));

    let final_path = if inbox_path.exists() {
        // Se a nota já foi escrita no subdiretório Inbox, move atômica para a raiz de default_vault
        let dest = vault.default_vault.join(format!("{}.md", base_name));
        let dest_final = if dest.exists() && dest != inbox_path {
            // Se já existe com mesmo nome na raiz, apenas remove a cópia da Inbox para não duplicar
            let _ = std::fs::remove_file(&inbox_path);
            dest
        } else {
            // Move fisicamente para a raiz do cofre padrão
            std::fs::rename(&inbox_path, &dest).map_err(|e| e.to_string())?;
            dest
        };

        // Reindexa os cofres para atualizar referências
        let _ = indexer.reindex_all();
        dest_final
    } else {
        // Se só existia no SQLite (ex: relatório de skill/carta), cria diretamente na raiz do cofre
        let path = vault
            .create_note(
                clean_title,
                &item.content,
                Some(vec!["consolidado".to_string()]),
                None,
            )
            .map_err(|e| e.to_string())?;
        let _ = indexer.index_single_note(&path, "default");
        path
    };

    // Marca o item da Inbox como lido/aceito (com motivo opcional + espelho no chat)
    let reason_ref = reason.as_deref();
    let _ = db.mark_inbox_item_status_with_reason(&id, "read", reason_ref);
    if let Ok(Some(item)) = db.get_inbox_item(&id) {
        mirror_inbox_decision(Some(&app), &db, &item, "read", reason_ref);
    }

    Ok(final_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn delete_inbox_item(
    id: String,
    reason: Option<String>,
    app: AppHandle,
    db: State<'_, SharedDatabase>,
    vault: State<'_, SharedVaultManager>,
    indexer: State<'_, SharedIndexer>,
) -> Result<bool, String> {
    let existing = db.get_inbox_item(&id).map_err(|e| e.to_string())?;
    let Some(item) = existing else {
        return Ok(false);
    };
    let base_name = crate::vault::sanitize_filename(&item.title);
    let inbox_path = vault
        .default_vault
        .join("Inbox")
        .join(format!("{}.md", base_name));
    if inbox_path.exists() {
        let _ = std::fs::remove_file(&inbox_path);
        let _ = indexer.reindex_all();
    }
    // Com session_id: converte em dismissed (tombstone 72h) para preservar auditoria no chat,
    // em vez de DELETE físico. Sem session_id: delete físico como antes.
    if let Some(ref sid) = item.session_id {
        if !sid.trim().is_empty() {
            let reason_ref = reason.as_deref();
            let _ = db.mark_inbox_item_status_with_reason(&id, "dismissed", reason_ref);
            if let Ok(Some(updated)) = db.get_inbox_item(&id) {
                mirror_inbox_decision(Some(&app), &db, &updated, "dismissed", reason_ref);
            }
            return Ok(true);
        }
    }
    db.delete_inbox_item(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_unread_inbox_count(db: State<'_, SharedDatabase>) -> Result<i64, String> {
    db.get_unread_inbox_count().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn evolve_note(
    id: String,
    reason: Option<String>,
    app: AppHandle,
    db: State<'_, SharedDatabase>,
    vault: State<'_, SharedVaultManager>,
    indexer: State<'_, SharedIndexer>,
) -> Result<String, String> {
    let items = db.list_inbox_items().map_err(|e| e.to_string())?;
    let item = items
        .into_iter()
        .find(|i| i.id == id)
        .ok_or_else(|| format!("Item '{}' não encontrado na Inbox", id))?;

    let base_identifier = item
        .target_base_note_slug
        .clone()
        .unwrap_or_else(|| crate::vault::sanitize_filename(&item.title));

    let changelog = item
        .summary
        .clone()
        .unwrap_or_else(|| "Evolução e consolidação aprovada pelo usuário via Inbox".to_string());
    let unified = item
        .proposed_content
        .clone()
        .unwrap_or(item.content.clone());

    let path = vault
        .evolve_note_in_place(
            &base_identifier,
            &changelog,
            &unified,
            item.session_id.as_deref(),
            Some(vec!["copernico/evolucao".to_string()]),
        )
        .map_err(|e| e.to_string())?;

    let _ = indexer.index_single_note(&path, "default");
    let reason_ref = reason.as_deref();
    let _ = db.mark_inbox_item_status_with_reason(&id, "applied", reason_ref);
    if let Ok(Some(updated)) = db.get_inbox_item(&id) {
        mirror_inbox_decision(Some(&app), &db, &updated, "applied", reason_ref);
    }

    let unread_count = db.get_unread_inbox_count().unwrap_or(0);
    let _ = app.emit(
        "inbox-updated",
        serde_json::json!({
            "unread_count": unread_count,
            "item_id": id,
            "status": "applied",
            "path": path.to_string_lossy().to_string(),
        }),
    );

    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn refine_inbox_proposal(
    id: String,
    feedback: String,
    app: AppHandle,
    db: State<'_, SharedDatabase>,
    agent: State<'_, SharedAgentCore>,
) -> Result<crate::db::InboxItem, String> {
    let items = db.list_inbox_items().map_err(|e| e.to_string())?;
    let item = items
        .into_iter()
        .find(|i| i.id == id)
        .ok_or_else(|| format!("Item '{}' não encontrado na Inbox", id))?;

    let current_proposal = item
        .proposed_content
        .clone()
        .unwrap_or(item.content.clone());
    let prompt = format!(
        r#"Você é o curador de conhecimento do Copernico.
Ajuste e refine a proposta de nota Markdown abaixo considerando as instruções do usuário.

PROPOSTA ATUAL:
{}

INSTRUÇÕES DE REFINAMENTO DO USUÁRIO:
{}

Retorne EXATAMENTE e APENAS o conteúdo completo do Markdown refinado (sem blocos de código envolventes markdown ou explicações fora do texto)."#,
        current_proposal,
        feedback.trim()
    );

    let chat_input = vec![
        crate::llm::ChatMessage {
            role: "system".to_string(),
            content: Some("Você é um curador de notas em Markdown especializado em Second Brain. Retorne exclusivamente o Markdown ajustado.".to_string()),
            tool_calls: None,
            tool_call_id: None,
            tokens: None,
            reasoning_content: None,
        },
        crate::llm::ChatMessage {
            role: "user".to_string(),
            content: Some(prompt),
            tool_calls: None,
            tool_call_id: None,
            tokens: None,
            reasoning_content: None,
        },
    ];

    let resp = agent
        .llm()
        .chat_completion(&chat_input, None)
        .await
        .map_err(|e| e.to_string())?;

    let new_content = resp.content.unwrap_or_default().trim().to_string();
    let _ = db.update_inbox_proposal(&id, &new_content, item.diff_data.as_deref());

    let unread_count = db.get_unread_inbox_count().unwrap_or(0);
    let _ = app.emit(
        "inbox-updated",
        serde_json::json!({ "unread_count": unread_count }),
    );

    let updated_items = db.list_inbox_items().map_err(|e| e.to_string())?;
    updated_items
        .into_iter()
        .find(|i| i.id == id)
        .ok_or_else(|| "Item atualizado não encontrado".to_string())
}

#[tauri::command]
pub async fn dismiss_inbox_item(
    id: String,
    reason: Option<String>,
    app: AppHandle,
    db: State<'_, SharedDatabase>,
) -> Result<(), String> {
    let reason_ref = reason.as_deref();
    db.mark_inbox_item_status_with_reason(&id, "dismissed", reason_ref)
        .map_err(|e| e.to_string())?;
    if let Ok(Some(item)) = db.get_inbox_item(&id) {
        mirror_inbox_decision(Some(&app), &db, &item, "dismissed", reason_ref);
    } else {
        let unread_count = db.get_unread_inbox_count().unwrap_or(0);
        let _ = app.emit(
            "inbox-updated",
            serde_json::json!({ "unread_count": unread_count }),
        );
    }
    Ok(())
}

#[tauri::command]
pub async fn snooze_inbox_item(
    id: String,
    reason: Option<String>,
    app: AppHandle,
    db: State<'_, SharedDatabase>,
) -> Result<(), String> {
    let reason_ref = reason.as_deref();
    db.mark_inbox_item_status_with_reason(&id, "snoozed", reason_ref)
        .map_err(|e| e.to_string())?;
    if let Ok(Some(item)) = db.get_inbox_item(&id) {
        mirror_inbox_decision(Some(&app), &db, &item, "snoozed", reason_ref);
    } else {
        let unread_count = db.get_unread_inbox_count().unwrap_or(0);
        let _ = app.emit(
            "inbox-updated",
            serde_json::json!({ "unread_count": unread_count }),
        );
    }
    Ok(())
}

// --- Skill Cron Override ---

#[tauri::command]
pub async fn set_skill_cron(
    skill_id: String,
    cron_expr: String,
    db: State<'_, SharedDatabase>,
) -> Result<(), String> {
    let parts: Vec<&str> = cron_expr.trim().split_whitespace().collect();
    if parts.len() != 5 {
        return Err("Expressão cron inválida. Deve conter exatamente 5 campos.".into());
    }
    let key = format!("skill_cron_override::{}", skill_id);
    db.set_setting(&key, cron_expr.trim())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn reset_skill_cron(
    skill_id: String,
    db: State<'_, SharedDatabase>,
) -> Result<(), String> {
    let key = format!("skill_cron_override::{}", skill_id);
    db.delete_setting(&key).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_skill_cron_override(
    skill_id: String,
    db: State<'_, SharedDatabase>,
) -> Result<Option<String>, String> {
    let key = format!("skill_cron_override::{}", skill_id);
    db.get_setting(&key).map_err(|e| e.to_string())
}

// ─── Onboarding, Atalhos & Autoaprendizado (Meta-Instruções) ────────────────

pub fn update_shortcut_internal(app: &AppHandle, shortcut_str: &str) -> Result<(), String> {
    let normalized = shortcut_str
        .replace(" ", "")
        .replace("Win+", "Super+")
        .replace("win+", "super+")
        .replace("Windows+", "Super+")
        .replace("windows+", "super+")
        .replace("Cmd+", "Super+")
        .replace("cmd+", "super+");

    let sc = normalized
        .parse::<Shortcut>()
        .map_err(|e| format!("Atalho '{}' inválido: {}", shortcut_str, e))?;

    let _ = app.global_shortcut().unregister_all();
    app.global_shortcut()
        .register(sc)
        .map_err(|e| format!("Falha ao registrar atalho '{}': {}", shortcut_str, e))?;

    println!(
        "[HOTKEY] Atalho atualizado com sucesso para: {}",
        shortcut_str
    );
    Ok(())
}

#[tauri::command]
pub async fn get_user_profile(db: State<'_, SharedDatabase>) -> Result<serde_json::Value, String> {
    let name = db
        .get_setting("user_name")
        .map_err(|e| e.to_string())?
        .unwrap_or_default();
    let style = db
        .get_setting("communication_style")
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| "direto_conciso".to_string());
    let hotkey = db
        .get_setting("global_shortcut")
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| "Ctrl+Space".to_string());
    let onboarding_completed = db
        .get_setting("onboarding_completed")
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| "false".to_string());
    let custom_instructions = db
        .get_setting("agent_custom_instructions")
        .map_err(|e| e.to_string())?
        .unwrap_or_default();

    let date_format = db
        .get_setting("date_format")
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| "DD-MM-YY".to_string());

    Ok(serde_json::json!({
        "name": name,
        "communication_style": style,
        "hotkey": hotkey,
        "onboarding_completed": onboarding_completed == "true",
        "custom_instructions": custom_instructions,
        "date_format": date_format,
    }))
}

#[tauri::command]
pub async fn save_user_profile(
    name: String,
    communication_style: String,
    hotkey: String,
    custom_instructions: Option<String>,
    date_format: Option<String>,
    app: AppHandle,
    db: State<'_, SharedDatabase>,
) -> Result<(), String> {
    db.set_setting("user_name", name.trim())
        .map_err(|e| e.to_string())?;
    db.set_setting("communication_style", communication_style.trim())
        .map_err(|e| e.to_string())?;
    let clean_hotkey = hotkey.trim();
    db.set_setting("global_shortcut", clean_hotkey)
        .map_err(|e| e.to_string())?;
    db.set_setting("onboarding_completed", "true")
        .map_err(|e| e.to_string())?;
    if let Some(inst) = custom_instructions {
        db.set_setting("agent_custom_instructions", inst.trim())
            .map_err(|e| e.to_string())?;
    }
    let df = date_format.unwrap_or_else(|| "DD-MM-YY".to_string());
    let clean_df = df.trim();
    if !clean_df.is_empty() {
        db.set_setting("date_format", clean_df)
            .map_err(|e| e.to_string())?;
        crate::vault::set_active_date_format(clean_df);
    }

    let _ = update_shortcut_internal(&app, clean_hotkey);
    Ok(())
}

#[tauri::command]
pub async fn save_onboarding_profile(
    name: String,
    communication_style: String,
    hotkey: String,
    date_format: Option<String>,
    app: AppHandle,
    db: State<'_, SharedDatabase>,
) -> Result<(), String> {
    save_user_profile(
        name,
        communication_style,
        hotkey,
        None,
        date_format,
        app,
        db,
    )
    .await
}

#[tauri::command]
pub async fn update_global_shortcut(
    shortcut: String,
    app: AppHandle,
    db: State<'_, SharedDatabase>,
) -> Result<(), String> {
    let clean = shortcut.trim();
    update_shortcut_internal(&app, clean)?;
    db.set_setting("global_shortcut", clean)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn apply_instruction_improvement(
    id: String,
    app: AppHandle,
    db: State<'_, SharedDatabase>,
) -> Result<(), String> {
    let items = db.list_inbox_items().map_err(|e| e.to_string())?;
    let item = items
        .into_iter()
        .find(|i| i.id == id)
        .ok_or_else(|| format!("Item '{}' não encontrado na Inbox", id))?;

    let rule_to_add = item
        .proposed_content
        .ok_or_else(|| "Item da Inbox não contém instrução proposta".to_string())?;

    let existing = db
        .get_setting("agent_custom_instructions")
        .map_err(|e| e.to_string())?
        .unwrap_or_default();

    let updated = if existing.trim().is_empty() {
        format!("- {}", rule_to_add.trim())
    } else {
        format!("{}\n- {}", existing.trim(), rule_to_add.trim())
    };

    db.set_setting("agent_custom_instructions", &updated)
        .map_err(|e| e.to_string())?;
    db.mark_inbox_item_status_with_reason(&id, "applied", None)
        .map_err(|e| e.to_string())?;
    if let Ok(Some(updated_item)) = db.get_inbox_item(&id) {
        mirror_inbox_decision(Some(&app), &db, &updated_item, "applied", None);
    } else {
        let unread_count = db.get_unread_inbox_count().unwrap_or(0);
        let _ = app.emit(
            "inbox-updated",
            serde_json::json!({ "unread_count": unread_count }),
        );
    }

    Ok(())
}

#[tauri::command]
pub async fn trigger_session_reflection(
    session_id: String,
    app: AppHandle,
    db: State<'_, SharedDatabase>,
    agent: State<'_, SharedAgentCore>,
) -> Result<Option<String>, String> {
    crate::consolidation::analyze_operational_learnings(
        &session_id,
        Some(app),
        db.inner().clone(),
        agent.llm(),
    )
    .await
    .map_err(|e| e.to_string())
}

// ─── Skills & Hub IPC ────────────────────────────────────────

#[tauri::command]
pub async fn list_skills(
    db: State<'_, SharedDatabase>,
    config: State<'_, Arc<AppConfig>>,
) -> Result<Vec<SkillInfo>, String> {
    let mgr = SkillManager::new(config.skills_path.clone());
    Ok(mgr.list_skills(&db))
}

#[tauri::command]
pub async fn open_skills_folder(config: State<'_, Arc<AppConfig>>) -> Result<(), String> {
    let mgr = SkillManager::new(config.skills_path.clone());
    mgr.open_folder_in_explorer()
}

#[tauri::command]
pub async fn install_skill_from_source(
    source: String,
    config: State<'_, Arc<AppConfig>>,
) -> Result<String, String> {
    let mgr = SkillManager::new(config.skills_path.clone());
    mgr.install_from_source(&source)
}

#[tauri::command]
pub async fn toggle_skill(
    id: String,
    enabled: bool,
    db: State<'_, SharedDatabase>,
    config: State<'_, Arc<AppConfig>>,
) -> Result<(), String> {
    let mgr = SkillManager::new(config.skills_path.clone());
    mgr.toggle_skill(&id, enabled, &db)
}

#[tauri::command]
pub async fn delete_skill(
    id: String,
    config: State<'_, Arc<AppConfig>>,
    db: State<'_, SharedDatabase>,
) -> Result<(), String> {
    let mgr = SkillManager::new(config.skills_path.clone());
    mgr.delete_skill(&id, Some(&db))
}

// ─── Scheduled Routines IPC ──────────────────────────────────

#[tauri::command]
pub async fn list_scheduled_routines(
    db: State<'_, SharedDatabase>,
) -> Result<Vec<ScheduledRoutine>, String> {
    db.list_scheduled_routines().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_scheduled_routine(
    mut routine: ScheduledRoutine,
    db: State<'_, SharedDatabase>,
) -> Result<(), String> {
    if routine.titulo.trim().is_empty() {
        return Err("Título não pode ser vazio".into());
    }
    if routine.prompt.trim().is_empty() {
        return Err("Prompt não pode ser vazio".into());
    }
    crate::skill_runner::SkillRunner::validate_cron(&routine.cron_expr)
        .map_err(|e| format!("Cron inválido: {}", e))?;
    if let Some(ref sid) = routine.skill_id {
        let s = sid.trim();
        if !s.is_empty()
            && (s.contains("..") || s.contains('/') || s.contains('\\') || s.starts_with('.'))
        {
            return Err("skill_id inválido".into());
        }
        if s.is_empty() {
            routine.skill_id = None;
        }
    }
    // Gera ID se vazio (usa UUID para evitar colisão de Date.now)
    if routine.id.trim().is_empty() {
        routine.id = format!("routine_{}", uuid::Uuid::new_v4().simple().to_string());
    }
    if routine.created_at.trim().is_empty() {
        routine.created_at = chrono::Utc::now().to_rfc3339();
    }
    // Preserva ultima_execucao existente em caso de atualização sem campo
    if let Ok(existing) = db.list_scheduled_routines() {
        if let Some(ex) = existing.iter().find(|r| r.id == routine.id) {
            if routine.ultima_execucao.is_none() && ex.ultima_execucao.is_some() {
                routine.ultima_execucao = ex.ultima_execucao.clone();
            }
        }
    }
    // Limpa last_runs cache se for atualização? O scheduler usa HashMap, mas id reuso precisa resetar
    db.save_scheduled_routine(&routine)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_scheduled_routine(
    id: String,
    db: State<'_, SharedDatabase>,
    runner: State<'_, std::sync::Arc<crate::skill_runner::SkillRunner>>,
) -> Result<bool, String> {
    let res = db
        .delete_scheduled_routine(&id)
        .map_err(|e| e.to_string())?;
    // Limpa cache de dedup e running para evitar vazamento de ids deletados
    runner.remove_last_run(&id);
    Ok(res)
}

#[tauri::command]
pub async fn toggle_scheduled_routine(
    id: String,
    enabled: bool,
    db: State<'_, SharedDatabase>,
) -> Result<(), String> {
    db.toggle_scheduled_routine(&id, enabled)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn trigger_routine_now(
    id: String,
    runner: State<'_, Arc<SkillRunner>>,
) -> Result<serde_json::Value, String> {
    runner.run_scheduled_routine(&id).await
}

// ─── On-Demand MCP Configuration IPC ─────────────────────────

#[tauri::command]
pub async fn get_mcp_config(db: State<'_, SharedDatabase>) -> Result<String, String> {
    let cfg = db
        .get_setting("mcp_servers_config")
        .map_err(|e| e.to_string())?;
    Ok(cfg.unwrap_or_else(|| "{\n  \"servers\": {}\n}".to_string()))
}

#[tauri::command]
pub async fn save_mcp_config(
    config_json: String,
    db: State<'_, SharedDatabase>,
) -> Result<(), String> {
    let val: serde_json::Value = serde_json::from_str(&config_json)
        .map_err(|e| format!("JSON de configuração inválido: {}", e))?;
    // Valida estrutura: deve ter objeto com servers ou mcpServers
    let obj = val
        .as_object()
        .ok_or("Configuração deve ser um objeto JSON")?;
    let mut has_servers = false;
    for key in ["servers", "mcpServers"] {
        if let Some(map) = obj.get(key).and_then(|v| v.as_object()) {
            has_servers = true;
            for (id, srv_val) in map {
                if id.trim().is_empty()
                    || id.contains("..")
                    || id.contains('/')
                    || id.starts_with('.')
                {
                    return Err(format!("ID de servidor inválido: '{}'", id));
                }
                let srv_obj = srv_val
                    .as_object()
                    .ok_or(format!("Servidor '{}' deve ser objeto", id))?;
                let command = srv_obj
                    .get("command")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .trim();
                if command.is_empty() {
                    return Err(format!("Servidor '{}' sem comando", id));
                }
                let forbidden = ["&", "|", ";", "`", "$", ">", "<", "\n"];
                for pat in forbidden {
                    if command.contains(pat) {
                        return Err(format!(
                            "Servidor '{}' comando contém caractere proibido '{}'",
                            id, pat
                        ));
                    }
                }
                if let Some(args) = srv_obj.get("args") {
                    if !args.is_array() {
                        return Err(format!("Servidor '{}' args deve ser array", id));
                    }
                }
            }
        }
    }
    // Permite também formato com top-level direto sem wrapper? Se não tem servers/mcpServers, tenta validar como mapa direto
    if !has_servers && !obj.is_empty() {
        let is_direct_map = obj
            .values()
            .all(|v| v.is_object() && v.get("command").is_some());
        if is_direct_map {
            // formato direto é permitido, mas já validado acima como fallback
        } else if obj.contains_key("servers") || obj.contains_key("mcpServers") {
            // já tratado
        } else {
            // Se não tem wrapper e não é mapa direto, aceita objeto vazio
        }
    }
    db.set_setting("mcp_servers_config", &config_json)
        .map_err(|e| e.to_string())
}

// ─── Greetings (saudações contextuais com voz) ───

#[tauri::command]
pub async fn list_greetings(
    greetings: State<'_, Arc<crate::greetings::GreetingsManager>>,
) -> Result<Vec<crate::greetings::GreetingItem>, String> {
    Ok(greetings.load())
}

#[tauri::command]
pub async fn ensure_greetings(
    greetings: State<'_, Arc<crate::greetings::GreetingsManager>>,
    db: State<'_, SharedDatabase>,
    tts: State<'_, crate::tts::SharedTtsClient>,
) -> Result<String, String> {
    greetings.ensure_at_startup(&tts, &db).await
}

#[tauri::command]
pub async fn preview_greeting(
    id: String,
    greetings: State<'_, Arc<crate::greetings::GreetingsManager>>,
) -> Result<String, String> {
    let list = greetings.load();
    list.into_iter()
        .find(|g| g.id == id)
        .map(|g| g.text)
        .ok_or_else(|| format!("Saudação '{}' não encontrada", id))
}

// ─── Inbox: purga de dismissed expirados (>72h) ───

#[tauri::command]
pub async fn prune_dismissed_inbox(db: State<'_, SharedDatabase>) -> Result<usize, String> {
    db.prune_dismissed_expired().map_err(|e| e.to_string())
}

// ─── Helpers de espelho Inbox → chat (decisões visíveis + agente ciente) ───

/// Texto padrão do espelho no chat para cada transição de decisão.
pub fn mirror_text_for_decision(status: &str, title: &str, reason: Option<&str>) -> String {
    let clean_title = title.trim();
    let reason_suffix = match crate::db::sanitize_decision_reason(reason) {
        Some(r) => format!(" Motivo: {}", r),
        None => String::new(),
    };
    match status {
        "applied" | "read" => format!(
            "✅ Você aprovou '{}' — aplicada e registrada.{}",
            clean_title, reason_suffix
        ),
        "dismissed" => format!(
            "❌ Você rejeitou '{}' — NADA foi criado ou alterado por essa proposta.{}{}",
            clean_title,
            reason_suffix,
            if reason_suffix.is_empty() {
                " Não vou repropor sem você pedir."
            } else {
                ""
            }
        ),
        "snoozed" => format!(
            "⏸️ Você adiou '{}' — não conta como feita, continua pendente.{}",
            clean_title, reason_suffix
        ),
        "unread" | "pending" => format!(
            "↩️ '{}' voltou para pendente.{}",
            clean_title, reason_suffix
        ),
        _ => format!("ℹ️ '{}' → {}.{}", clean_title, status, reason_suffix),
    }
}

/// Insere mensagem assistant de espelho com guard anti-duplo (mesmo texto no último assistant pula).
pub fn append_mirror_message(db: &SharedDatabase, session_id: &str, text: &str) -> bool {
    let clean = text.trim();
    if clean.is_empty() {
        return false;
    }
    if let Ok(msgs) = db.get_messages(session_id) {
        if let Some(last_assistant) = msgs.iter().rev().find(|m| m.role == "assistant") {
            if last_assistant.content.trim() == clean {
                return false;
            }
        }
    }
    db.add_message(session_id, "assistant", clean, None, None)
        .is_ok()
}

/// Emite atualização de chat + inbox para o frontend recarregar a sessão afetada.
pub fn emit_chat_and_inbox(app: &AppHandle, db: &SharedDatabase, session_id: &str) {
    let unread_count = db.get_unread_inbox_count().unwrap_or(0);
    let _ = app.emit(
        "inbox-updated",
        serde_json::json!({ "unread_count": unread_count }),
    );
    if let Ok(msgs) = db.get_messages(session_id) {
        let user_msg = msgs.iter().rev().find(|m| m.role == "user").cloned();
        let assistant_msg = msgs.iter().rev().find(|m| m.role == "assistant").cloned();
        if let (Some(u), Some(a)) = (user_msg, assistant_msg) {
            let _ = app.emit(
                "wake-message-result",
                serde_json::json!({
                    "sessionId": session_id,
                    "userMessage": u,
                    "assistantMessage": a,
                }),
            );
        }
    }
}

/// Espelha decisão de um item do Inbox no chat de origem (se houver session_id).
pub fn mirror_inbox_decision(
    app: Option<&AppHandle>,
    db: &SharedDatabase,
    item: &crate::db::InboxItem,
    status: &str,
    reason: Option<&str>,
) {
    let Some(ref sid) = item.session_id else {
        if let Some(a) = app {
            let unread_count = db.get_unread_inbox_count().unwrap_or(0);
            let _ = a.emit(
                "inbox-updated",
                serde_json::json!({ "unread_count": unread_count }),
            );
        }
        return;
    };
    if sid.trim().is_empty() {
        return;
    }
    // Garante que a sessão ainda existe (pode ter sido deletada).
    if db.get_session(sid).ok().flatten().is_none() {
        return;
    }
    let text = mirror_text_for_decision(status, &item.title, reason);
    append_mirror_message(db, sid, &text);
    if let Some(a) = app {
        emit_chat_and_inbox(a, db, sid);
    }
}
