use crate::agent::SharedAgentCore;
use crate::bridge::emitter;
use crate::db::SharedDatabase;
use crate::stt::SharedSttClient;
use crate::tts::SharedTtsClient;
use crossbeam_channel::Sender;
use serde_json::json;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use tauri::{AppHandle, Emitter};

/// Commands sent from `WakeWordService` to the in-process orchestrator thread.
#[derive(Debug)]
pub enum WakeCommand {
    SetThreshold(f32),
    SetDetectionActive(bool),
    Cancel,
    StartFollowup(f32),
    SetMicEnabled(bool),
}

pub struct WakeWordService {
    active_session_id: Arc<RwLock<Option<String>>>,
    /// Channel to send commands to the in-process orchestrator thread.
    command_tx: Mutex<Option<Sender<WakeCommand>>>,
    current_threshold: Arc<RwLock<f32>>,
    is_running: Arc<AtomicBool>,
    pub is_processing_turn: Arc<AtomicBool>,
    /// Diagnóstico (só logs, sem efeito no fluxo): instante do último `Start`.
    /// Permite registrar no `Stop` se ele chegou durante a saudação.
    last_start_at: Arc<Mutex<Option<std::time::Instant>>>,
    /// Diagnóstico (só logs, sem efeito no fluxo): saudação em reprodução.
    /// Armada no spawn da thread de greeting, desarmada ao fim dela.
    greeting_playing: Arc<AtomicBool>,
    /// Marca local de continuação esperada: armada quando o app pede follow-up de 10s ao
    /// orchestrator, consumida no próximo Start. Evita classificar um "copernico" real com
    /// score 1.0 como continuação (o score sintético do follow-up também é 1.0).
    expect_followup_until: Arc<Mutex<Option<std::time::Instant>>>,
}

pub type SharedWakeWordService = Arc<WakeWordService>;

impl Default for WakeWordService {
    fn default() -> Self {
        Self::new()
    }
}

impl WakeWordService {
    pub fn new() -> Self {
        Self {
            active_session_id: Arc::new(RwLock::new(None)),
            command_tx: Mutex::new(None),
            current_threshold: Arc::new(RwLock::new(0.50)),
            is_running: Arc::new(AtomicBool::new(true)),
            is_processing_turn: Arc::new(AtomicBool::new(false)),
            last_start_at: Arc::new(Mutex::new(None)),
            greeting_playing: Arc::new(AtomicBool::new(false)),
            expect_followup_until: Arc::new(Mutex::new(None)),
        }
    }

    /// Connects the command channel from the in-process worker.
    /// Called once during startup by `spawn_inprocess_wake`.
    pub fn set_command_channel(&self, tx: Sender<WakeCommand>) {
        if let Ok(mut lock) = self.command_tx.lock() {
            *lock = Some(tx);
        }
    }

    fn send_command(&self, cmd: WakeCommand) {
        if let Ok(lock) = self.command_tx.lock() {
            if let Some(ref tx) = *lock {
                let _ = tx.try_send(cmd);
            }
        }
    }

    /// Arma a expectativa de continuação (chamado junto ao start_followup).
    /// Margem de +5s além do timeout do sidecar para tolerar latência de IPC.
    pub fn arm_followup_expectation(&self, timeout_secs: f32) {
        let margin = (timeout_secs.max(1.0) + 5.0) as u64;
        if let Ok(mut lock) = self.expect_followup_until.lock() {
            *lock = Some(std::time::Instant::now() + std::time::Duration::from_secs(margin));
        }
    }

    /// Consome a expectativa: true somente se o app pediu follow-up e ainda está na janela.
    /// Qualquer Start fora dessa janela é chamada nova ("copernico" real) e saúda.
    pub fn take_followup_expectation(&self) -> bool {
        if let Ok(mut lock) = self.expect_followup_until.lock() {
            if let Some(until) = *lock {
                if std::time::Instant::now() <= until {
                    *lock = None;
                    return true;
                }
                *lock = None;
            }
        }
        false
    }

    pub fn clear_followup_expectation(&self) {
        if let Ok(mut lock) = self.expect_followup_until.lock() {
            *lock = None;
        }
    }

    /// Diagnóstico (só logs): registra o instante do último `Start`.
    pub fn note_start(&self) {
        if let Ok(mut lock) = self.last_start_at.lock() {
            *lock = Some(std::time::Instant::now());
        }
    }

    /// Diagnóstico (só logs): quanto tempo passou desde o último `Start`.
    pub fn elapsed_since_start(&self) -> Option<std::time::Duration> {
        self.last_start_at
            .lock()
            .ok()
            .and_then(|guard| *guard)
            .map(|t| t.elapsed())
    }

    /// Diagnóstico (só logs): marca se há saudação em reprodução.
    pub fn set_greeting_playing(&self, playing: bool) {
        self.greeting_playing.store(playing, Ordering::SeqCst);
    }

    /// Diagnóstico (só logs): há saudação em reprodução agora?
    pub fn is_greeting_playing(&self) -> bool {
        self.greeting_playing.load(Ordering::SeqCst)
    }

    pub fn is_processing_turn(&self) -> bool {
        self.is_processing_turn.load(Ordering::SeqCst)
    }

    pub fn processing_turn_flag(&self) -> Arc<AtomicBool> {
        self.is_processing_turn.clone()
    }

    pub fn set_active_session(&self, session_id: Option<String>) {
        if let Ok(mut lock) = self.active_session_id.write() {
            *lock = session_id;
        }
    }

    pub fn get_active_session(&self) -> Option<String> {
        self.active_session_id.read().ok().and_then(|s| s.clone())
    }

    pub fn set_threshold(&self, threshold: f32) {
        let clamped = threshold.clamp(0.10, 0.95);
        if let Ok(mut lock) = self.current_threshold.write() {
            *lock = clamped;
        }
        self.send_command(WakeCommand::SetThreshold(clamped));
    }

    pub fn set_detection_active(&self, active: bool) {
        self.send_command(WakeCommand::SetDetectionActive(active));
    }

    pub fn set_mic_enabled(&self, enabled: bool) {
        self.send_command(WakeCommand::SetMicEnabled(enabled));
    }

    pub fn cancel_recording(&self) {
        self.is_processing_turn.store(false, Ordering::SeqCst);
        self.clear_followup_expectation();
        self.send_command(WakeCommand::Cancel);
    }

    pub fn start_followup(&self, timeout_secs: f32) {
        self.arm_followup_expectation(timeout_secs);
        self.send_command(WakeCommand::StartFollowup(timeout_secs));
    }

    pub fn get_threshold(&self) -> f32 {
        self.current_threshold
            .read()
            .map(|guard| *guard)
            .unwrap_or(0.50)
    }

    pub fn is_running(&self) -> bool {
        self.is_running.load(Ordering::Relaxed)
    }

    pub fn stop(&self) {
        self.is_running.store(false, Ordering::Relaxed);
        // Drop the command sender to signal the orchestrator thread to exit
        if let Ok(mut lock) = self.command_tx.lock() {
            let _ = lock.take();
        }
    }
}

impl Drop for WakeWordService {
    fn drop(&mut self) {
        self.stop();
    }
}

/// RAII Guard para garantir que `is_processing_turn` seja resetado para `false`
/// e qualquer filler remanescente seja cancelado em qualquer saída (sucesso, erro ou pânico).
struct ProcessingTurnGuard {
    flag: Arc<AtomicBool>,
    thinking: crate::thinking::SharedThinkingAudiosManager,
}

impl Drop for ProcessingTurnGuard {
    fn drop(&mut self) {
        self.flag.store(false, Ordering::SeqCst);
        self.thinking.stop_active();
        println!("[WAKE WORD] Trava de turno de voz liberada (is_processing_turn = false).");
    }
}

#[allow(clippy::too_many_arguments)]
pub async fn process_voice_turn(
    wav_bytes: Vec<u8>,
    app: AppHandle,
    agent_core: SharedAgentCore,
    stt_client: SharedSttClient,
    tts_client: SharedTtsClient,
    database: SharedDatabase,
    wake_word_service: SharedWakeWordService,
    greetings: crate::greetings::SharedGreetingsManager,
    thinking: crate::thinking::SharedThinkingAudiosManager,
) {
    let _turn_guard = ProcessingTurnGuard {
        flag: wake_word_service.is_processing_turn.clone(),
        thinking: thinking.clone(),
    };

    // 1. Transcreve no Groq Whisper Turbo
    let transcript = match stt_client.transcribe(wav_bytes, Some("audio/wav")).await {
        Ok(t) => t,
        Err(err) => {
            eprintln!("[WAKE WORD] Erro na transcrição STT: {}", err);
            let voice = database
                .get_setting("tts_voice")
                .ok()
                .flatten()
                .unwrap_or_else(|| crate::tts::DEFAULT_TTS_VOICE.to_string());
            let _ = emitter::emit_wake_status_changed(&app, "speaking", None);
            let fallback_msg = "Desculpe, não consegui entender o áudio. Poderia repetir?";
            let _ = tts_client.speak_text(fallback_msg, Some(&voice)).await;

            let _ = emitter::emit_wake_status_changed(&app, "idle", None);
            return;
        }
    };

    let raw_transcript = transcript.trim().to_string();

    println!(
        "[WAKE WORD] Transcrição bruta do Whisper: \"{}\"",
        raw_transcript
    );

    // Remove eco da saudação (o mic captura o áudio do speaker durante o Recording).
    // Sem isso, "Oi Patrick..." entra no prompt e polui o turno.
    let greeting_echo = database
        .get_setting("last_greeting_text")
        .ok()
        .flatten()
        .unwrap_or_default();
    let deechoed = if greeting_echo.trim().is_empty() {
        raw_transcript.clone()
    } else {
        strip_greeting_echo(&raw_transcript, &greeting_echo)
    };
    if deechoed != raw_transcript {
        println!(
            "[WAKE WORD] Eco da saudação removido. Restante: \"{}\"",
            deechoed
        );
    }

    let cleaned_prompt = clean_transcript(&deechoed);
    if cleaned_prompt != raw_transcript {
        println!(
            "[WAKE WORD] Palavra de encerramento detectada e expurgada. Texto limpo para o agente: \"{}\"",
            cleaned_prompt
        );
    }

    if cleaned_prompt.is_empty() {
        // Diagnóstico (só logs): transcrito vazio após remover eco sugere que o
        // Stop foi disparado pelo áudio do speaker (saudação), não pelo usuário.
        println!(
            "[WAKE WORD] Prompt vazio pós-eco? transcrito=\"{}\" saudacao=\"{}\". Ignorando envio.",
            raw_transcript, greeting_echo
        );
        // Fim da ativação sem comando: a sessão é preservada para retomada.
        // O próximo wake real vai saudar mesmo assim.
        let _ = app.emit("wake-status-changed", json!({ "status": "idle" }));
        return;
    }

    println!("[WAKE WORD] Prompt enviado: \"{}\"", cleaned_prompt);

    let _ = app.emit(
        "wake-status-changed",
        json!({ "status": "processing", "prompt": cleaned_prompt }),
    );

    // Dispara filler sonoro de pensamento ("pensamento alto") em background
    let thinking_playback = thinking.play_thinking_audio(&database);

    // 2. Obtém sessão ativa ou cria uma nova persistida
    let session_id = match wake_word_service.get_active_session() {
        Some(id) => id,
        None => match database.create_session(None) {
            Ok(s) => {
                let sid = s.id.clone();
                wake_word_service.set_active_session(Some(sid.clone()));
                let _ = app.emit(
                    "wake-session-created",
                    json!({
                        "session": s,
                        "sessionId": sid,
                    }),
                );
                s.id
            }
            Err(err) => {
                eprintln!("[WAKE WORD] Erro ao criar sessão no banco: {}", err);
                let _ = app.emit("wake-status-changed", json!({ "status": "idle" }));
                return;
            }
        },
    };

    // 3. Voz usa sempre prompt conciso TTS-puro: sem dependência de
    // visibilidade de janela (não há overlay; UI reflete estado via eventos).
    let overlay_visible = false;

    // 4. Executa o chat no AgentCore
    let chat_result = agent_core
        .chat(&session_id, &cleaned_prompt, "voice", overlay_visible)
        .await;

    // Se o filler ainda estiver tocando, aplica fade-out de 150ms e aguarda antes do TTS final
    if let Some(ref handle) = thinking_playback {
        if handle.is_playing() {
            println!(
                "[THINKING] LLM respondeu com filler em reprodução; aplicando fade-out (150ms)..."
            );
            handle
                .fade_out_and_wait(crate::domain::models::THINKING_FADE_OUT_MS)
                .await;
        }
    }

    match chat_result {
        Ok(reply) => {
            if let Ok(msgs) = database.get_messages(&session_id) {
                let user_msg = msgs.iter().rev().find(|m| m.role == "user").cloned();
                let assistant_msg = msgs.iter().rev().find(|m| m.role == "assistant").cloned();
                if let (Some(u_msg), Some(a_msg)) = (user_msg, assistant_msg) {
                    let updated_title = database
                        .get_session(&session_id)
                        .ok()
                        .flatten()
                        .map(|s| s.titulo);

                    let _ = app.emit(
                        "wake-message-result",
                        json!({
                            "sessionId": session_id,
                            "userMessage": u_msg,
                            "assistantMessage": a_msg,
                            "updatedSessionTitle": updated_title,
                        }),
                    );
                }
            }
            println!("[WAKE WORD] Resposta gerada ({} caracteres)", reply.len());

            let session_ended = reply.starts_with("[SESSION_END]");
            let spoken_text = if session_ended {
                reply.trim_start_matches("[SESSION_END]").trim().to_string()
            } else {
                reply.clone()
            };

            // 5. TTS da Resposta Final (Habilitado exclusivamente para invocações por Wake Word)
            let voice = database
                .get_setting("tts_voice")
                .ok()
                .flatten()
                .unwrap_or_else(|| crate::tts::DEFAULT_TTS_VOICE.to_string());

            let _ = app.emit("wake-status-changed", json!({ "status": "speaking" }));

            if let Err(err) = tts_client.speak_text(&spoken_text, Some(&voice)).await {
                eprintln!("[TTS] Erro na reprodução da resposta final: {}", err);
            }

            if session_ended {
                println!(
                    "[WAKE WORD] Sessão '{}' encerrada explicitamente pelo usuário/modelo.",
                    session_id
                );
                wake_word_service.set_active_session(None);
                wake_word_service.clear_followup_expectation();

                let app_clone = app.clone();
                let db_clone = database.clone();
                let llm_clone = agent_core.llm();
                let vault_clone = agent_core.vault();
                let indexer_clone = agent_core.indexer();
                let tools_clone = agent_core.tool_registry();
                let sid_clone = session_id.clone();
                let gm_clone = greetings.clone();

                tauri::async_runtime::spawn(async move {
                    match crate::consolidation::consolidate_voice_session(
                        &sid_clone,
                        Some(app_clone),
                        db_clone.clone(),
                        llm_clone,
                        vault_clone,
                        indexer_clone,
                        tools_clone,
                    )
                    .await
                    {
                        Ok(Some(t)) => println!(
                            "[WAKE WORD] Consolidação de '{}' concluída: {}",
                            sid_clone, t
                        ),
                        Ok(None) => {
                            println!("[WAKE WORD] Consolidação de '{}' sem conteúdo", sid_clone)
                        }
                        Err(e) => {
                            eprintln!("[WAKE WORD] Erro na consolidação de '{}': {}", sid_clone, e)
                        }
                    }
                    println!("[GREETINGS] {}", gm_clone.cleanup_after_session());
                });

                let _ = app.emit("wake-status-changed", json!({ "status": "idle" }));
                return;
            } else {
                // Modo contínuo: abre a escuta ativa pós-fala (follow-up).
                println!("[WAKE WORD] Assistente concluiu fala. Abrindo escuta contínua de 10s...");
                let _ = app.emit("wake-status-changed", json!({ "status": "listening" }));
                let _ = app.emit("wake-play-followup-chime", ());

                // Dispara no sidecar o modo follow-up com timeout de 10s de silêncio
                wake_word_service.start_followup(10.0);
                return;
            }
        }
        Err(err) => {
            eprintln!("[WAKE WORD] Erro no AgentCore: {}", err);
            let voice = database
                .get_setting("tts_voice")
                .ok()
                .flatten()
                .unwrap_or_else(|| crate::tts::DEFAULT_TTS_VOICE.to_string());
            let _ = app.emit("wake-status-changed", json!({ "status": "speaking" }));
            let fallback_msg = "Desculpe, tive uma instabilidade temporária ao conectar com o modelo. Poderia repetir?";
            let _ = tts_client.speak_text(fallback_msg, Some(&voice)).await;
        }
    }

    let _ = app.emit("wake-status-changed", json!({ "status": "idle" }));
}

/// Heurística legada de distinção wake-real vs follow-up pelo score.
/// Mantida por compatibilidade (testes): o sidecar emite `Start { score: 1.0 }`
/// sintético no follow-up, mas um "copernico" real e confiante também pode marcar
/// 1.0 — por isso a classificação em produção usa a expectativa local de follow-up
/// (`take_followup_expectation`), não o score. Não usar para decisão nova.
pub fn is_new_wakeup(score: f32) -> bool {
    score < 0.999
}

/// Remove o eco da saudação do início da transcrição.
/// O sidecar começa a gravar no Start e a saudação toca pelo speaker durante o Recording,
/// então o Whisper frequentemente transcreve "Oi Patrick..." + a fala real do usuário.
/// Só remove prefixo (primeiras palavras iguais, tolerando 1 divergência); nunca mexe no resto.
pub fn strip_greeting_echo(transcript: &str, greeting: &str) -> String {
    fn norm_words(s: &str) -> Vec<String> {
        s.to_lowercase()
            .chars()
            .map(|c| {
                if c.is_alphanumeric() || c == ' ' {
                    c
                } else {
                    ' '
                }
            })
            .collect::<String>()
            .split_whitespace()
            .map(|w| w.to_string())
            .collect()
    }
    let t = norm_words(transcript);
    let g = norm_words(greeting);
    if g.len() < 2 || t.is_empty() {
        return transcript.trim().to_string();
    }
    // Exige que as 2 primeiras palavras batam para evitar cortar fala real (ex: usuário que começa com "oi").
    if t.len() < 2 || t[0] != g[0] || t[1] != g[1] {
        return transcript.trim().to_string();
    }
    let mut i = 0;
    let mut mism = 0;
    while i < g.len() && i < t.len() {
        if t[i] == g[i] {
            i += 1;
        } else if mism == 0 {
            mism += 1;
            i += 1;
        } else {
            break;
        }
    }
    if i >= 3 {
        let orig: Vec<&str> = transcript.split_whitespace().collect();
        if i < orig.len() {
            return orig[i..].join(" ").trim().to_string();
        } else {
            return String::new();
        }
    }
    transcript.trim().to_string()
}

pub fn clean_transcript(text: &str) -> String {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let had_question_mark = trimmed.contains('?');

    // Heurística simples: últimas 4 palavras, primeiro com inicial 'z' → corta dali pra direita
    // Cobre Zéfiro, Zé filho, Zétoro, zephiro, zefir, etc., sem precisar lista exaustiva
    let words: Vec<&str> = trimmed.split_whitespace().collect();
    if !words.is_empty() {
        // Lista de variantes com 'l' legadas (leach etc.) para retrocompatibilidade, evita falso positivo em "luz"
        const L_VARIANTS: &[&str] = &[
            "leach", "leech", "litchie", "lich", "liche", "litch", "lits", "lix", "lit", "lite",
        ];
        let start = if words.len() > 4 { words.len() - 4 } else { 0 };
        let mut cut_idx: Option<usize> = None;
        for (i, raw) in words.iter().enumerate().skip(start) {
            // Remove pontuação nas bordas e lower
            let cleaned = raw
                .trim_matches(|c: char| !c.is_alphanumeric())
                .to_lowercase();
            if cleaned.is_empty() {
                continue;
            }
            // Checa inicial 'z' (qualquer tamanho >=2 para evitar "z" isolado) ou variante 'l' exata
            let is_z = cleaned.starts_with('z') && cleaned.chars().count() >= 2;
            let is_l_variant = L_VARIANTS.iter().any(|v| &cleaned == v);
            if is_z || is_l_variant {
                cut_idx = Some(i);
                break;
            }
        }
        if let Some(idx) = cut_idx {
            // Se o corte é na primeira palavra e só havia 1-2 palavras e todas são de corte, retorna vazio
            if idx == 0 && words.len() <= 2 {
                // Verifica se todas as palavras são de corte (ex: "Zéfiro" ou "Zé Filho")
                let all_are_cut = words.iter().all(|w| {
                    let c = w
                        .trim_matches(|c: char| !c.is_alphanumeric())
                        .to_lowercase();
                    c.starts_with('z') || L_VARIANTS.contains(&c.as_str())
                });
                if all_are_cut {
                    return String::new();
                }
            }
            let mut cleaned = words[..idx].join(" ");
            cleaned = cleaned
                .trim_end_matches([',', '-', ';', ':'])
                .trim()
                .to_string();
            if cleaned.is_empty() {
                return String::new();
            }
            if had_question_mark && !cleaned.ends_with('?') {
                cleaned.push('?');
            }
            return cleaned;
        }
    }

    // Fallback: se não achou 'z' nas últimas 4, mantém original (remove apenas pontuação órfã)
    let cleaned = trimmed.trim_end_matches([',', '-', ';', ':']).trim();
    if cleaned.is_empty() {
        return String::new();
    }
    let mut result = cleaned.to_string();
    if had_question_mark && !result.ends_with('?') {
        result.push('?');
    }
    result
}
