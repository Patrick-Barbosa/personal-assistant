use crate::agent::SharedAgentCore;
use crate::db::SharedDatabase;
use crate::stt::SharedSttClient;
use crate::tts::SharedTtsClient;
use base64::prelude::*;
use serde::Deserialize;
use serde_json::json;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use tauri::{AppHandle, Emitter, Manager};

pub struct WakeWordService {
    active_session_id: Arc<RwLock<Option<String>>>,
    child_process: Arc<Mutex<Option<Child>>>,
    child_stdin: Arc<Mutex<Option<std::process::ChildStdin>>>,
    current_threshold: Arc<RwLock<f32>>,
    is_running: Arc<AtomicBool>,
    pub is_processing_turn: Arc<AtomicBool>,
    /// Janela de interação por voz aberta: do primeiro "copernico" até o fim da sessão.
    /// Usada para manter o Sol visível durante toda a conversa por voz.
    voice_active: Arc<AtomicBool>,
    /// Diagnóstico (só logs, sem efeito no fluxo): instante do último `Start`.
    /// Permite registrar no `Stop` se ele chegou durante a saudação.
    last_start_at: Arc<Mutex<Option<std::time::Instant>>>,
    /// Diagnóstico (só logs, sem efeito no fluxo): saudação em reprodução.
    /// Armada no spawn da thread de greeting, desarmada ao fim dela.
    greeting_playing: Arc<AtomicBool>,
    /// Marca local de continuação esperada: armada quando o app pede follow-up de 10s ao
    /// sidecar, consumida no próximo Start. Evita classificar um "copernico" real com
    /// score 1.0 como continuação (o score sintético do follow-up também é 1.0).
    expect_followup_until: Arc<Mutex<Option<std::time::Instant>>>,
}

pub type SharedWakeWordService = Arc<WakeWordService>;

impl WakeWordService {
    pub fn new() -> Self {
        Self {
            active_session_id: Arc::new(RwLock::new(None)),
            child_process: Arc::new(Mutex::new(None)),
            child_stdin: Arc::new(Mutex::new(None)),
            current_threshold: Arc::new(RwLock::new(0.50)),
            is_running: Arc::new(AtomicBool::new(true)),
            is_processing_turn: Arc::new(AtomicBool::new(false)),
            voice_active: Arc::new(AtomicBool::new(false)),
            last_start_at: Arc::new(Mutex::new(None)),
            greeting_playing: Arc::new(AtomicBool::new(false)),
            expect_followup_until: Arc::new(Mutex::new(None)),
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

    /// Marca o início/fim da janela de interação por voz (Sol visível).
    pub fn set_voice_active(&self, active: bool) {
        self.voice_active.store(active, Ordering::SeqCst);
    }

    pub fn voice_active(&self) -> bool {
        self.voice_active.load(Ordering::SeqCst)
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
        if let Ok(mut lock) = self.child_stdin.lock() {
            if let Some(ref mut stdin) = *lock {
                use std::io::Write;
                let cmd_json = json!({
                    "cmd": "set_threshold",
                    "threshold": clamped
                });
                let _ = writeln!(stdin, "{}", cmd_json);
                let _ = stdin.flush();
            }
        }
    }

    pub fn set_detection_active(&self, active: bool) {
        if let Ok(mut lock) = self.child_stdin.lock() {
            if let Some(ref mut stdin) = *lock {
                use std::io::Write;
                let cmd_json = json!({
                    "cmd": "set_detection_active",
                    "active": active
                });
                let _ = writeln!(stdin, "{}", cmd_json);
                let _ = stdin.flush();
            }
        }
    }

    pub fn cancel_recording(&self) {
        self.is_processing_turn.store(false, Ordering::SeqCst);
        self.clear_followup_expectation();
        if let Ok(mut lock) = self.child_stdin.lock() {
            if let Some(ref mut stdin) = *lock {
                use std::io::Write;
                let cmd_json = json!({
                    "cmd": "cancel"
                });
                let _ = writeln!(stdin, "{}", cmd_json);
                let _ = stdin.flush();
            }
        }
    }

    pub fn start_followup(&self, timeout_secs: f32) {
        self.arm_followup_expectation(timeout_secs);
        if let Ok(mut lock) = self.child_stdin.lock() {
            if let Some(ref mut stdin) = *lock {
                use std::io::Write;
                let cmd_json = json!({
                    "cmd": "start_followup",
                    "timeout_secs": timeout_secs
                });
                let _ = writeln!(stdin, "{}", cmd_json);
                let _ = stdin.flush();
            }
        }
    }

    pub fn get_threshold(&self) -> f32 {
        self.current_threshold
            .read()
            .map(|guard| *guard)
            .unwrap_or(0.50)
    }

    pub fn stop(&self) {
        self.is_running.store(false, Ordering::Relaxed);
        if let Ok(mut lock) = self.child_stdin.lock() {
            let _ = lock.take();
        }
        if let Ok(mut lock) = self.child_process.lock() {
            if let Some(mut child) = lock.take() {
                let _ = child.kill();
            }
        }
    }
}

impl Drop for WakeWordService {
    fn drop(&mut self) {
        self.stop();
    }
}

#[derive(Deserialize, Debug)]
#[serde(tag = "type", rename_all = "snake_case")]
enum SidecarMessage {
    Ready {
        sample_rate: u32,
        threshold: Option<f32>,
    },
    DebugScores {
        copernico: f32,
        #[serde(default)]
        zefiro: Option<f32>,
        #[serde(default)]
        lich: Option<f32>,
        rms: f32,
        threshold: f32,
    },
    Start {
        score: f32,
    },
    Stop {
        score: f32,
        wav_base64: String,
    },
    Cancel {
        reason: String,
    },
    Error {
        message: String,
    },
}

/// Garante que a janela do indicador esteja visível e no topo sem disparar reloads ou roubar foco
pub(crate) fn ensure_indicator_visible(app: &AppHandle) {
    #[cfg(windows)]
    crate::native_overlay::show(crate::native_overlay::OverlayMode::Listening);
    if let Some(indicator_win) = app.get_webview_window("indicator") {
        if !indicator_win.is_visible().unwrap_or(false) {
            let _ = indicator_win.show();
        }
        let _ = indicator_win.set_always_on_top(true);
    }
}

pub(crate) fn hide_indicator(app: &AppHandle) {
    #[cfg(windows)]
    crate::native_overlay::hide();
    if let Some(indicator_win) = app.get_webview_window("indicator") {
        let _ = indicator_win.hide();
    }
}

/// Inicia o sidecar de wake word em background
#[allow(clippy::too_many_arguments)]
pub fn start_wake_word_service(
    app: AppHandle,
    models_dir: PathBuf,
    agent_core: SharedAgentCore,
    stt_client: SharedSttClient,
    tts_client: SharedTtsClient,
    database: SharedDatabase,
    wake_word_service: SharedWakeWordService,
    greetings: crate::greetings::SharedGreetingsManager,
    thinking: crate::thinking::SharedThinkingAudiosManager,
) {
    std::thread::Builder::new()
        .name("copernico-wake-word-monitor".into())
        .spawn(move || {
            let sidecar_exe = match find_sidecar_binary(&models_dir) {
                Some(bin) => bin,
                None => {
                    eprintln!(
                        "[WARN] Binário do sidecar de Wake Word ('sidecar.exe') não encontrado. Serviço inativo."
                    );
                    return;
                }
            };

            println!("[WAKE WORD] Executando sidecar: {}", sidecar_exe.display());

            let mut cmd = Command::new(&sidecar_exe);
            cmd.current_dir(&models_dir);
            cmd.stdin(Stdio::piped());
            cmd.stdout(Stdio::piped());
            cmd.stderr(Stdio::inherit());

            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                // CREATE_NO_WINDOW = 0x08000000 para não abrir janela de terminal
                cmd.creation_flags(0x08000000);
            }

            let mut child = match cmd.spawn() {
                Ok(c) => c,
                Err(err) => {
                    eprintln!("[WARN] Falha ao iniciar sidecar de Wake Word: {}", err);
                    return;
                }
            };

            let stdout = match child.stdout.take() {
                Some(s) => s,
                None => return,
            };

            let stdin = child.stdin.take();
            if let Ok(mut lock) = wake_word_service.child_stdin.lock() {
                *lock = stdin;
            }

            if let Ok(mut lock) = wake_word_service.child_process.lock() {
                *lock = Some(child);
            }

            // Restaura threshold salvo no SQLite se existir
            if let Ok(Some(saved_th_str)) = database.get_setting("wake_word_threshold") {
                if let Ok(saved_th) = saved_th_str.parse::<f32>() {
                    wake_word_service.set_threshold(saved_th);
                }
            }

            let reader = BufReader::new(stdout);
            let _ = app.emit("wake-status-changed", json!({ "status": "idle" }));

            for line in reader.lines() {
                if !wake_word_service.is_running.load(Ordering::Relaxed) {
                    break;
                }

                let line_str = match line {
                    Ok(l) => l,
                    Err(_) => break,
                };

                let line_trimmed = line_str.trim();
                if line_trimmed.is_empty() {
                    continue;
                }

                if let Ok(msg) = serde_json::from_str::<SidecarMessage>(line_trimmed) {
                    match msg {
                        SidecarMessage::Ready { sample_rate, threshold } => {
                            let th = threshold.unwrap_or(wake_word_service.get_threshold());
                            println!("[WAKE WORD] Sidecar pronto e ouvindo ({} Hz, threshold={:.2})", sample_rate, th);
                            let _ = app.emit("wake-status-changed", json!({
                                "status": "idle",
                                "sampleRate": sample_rate,
                                "threshold": th
                            }));
                        }

                        SidecarMessage::DebugScores { copernico, zefiro, lich, rms, threshold } => {
                            #[cfg(windows)]
                            crate::native_overlay::update_audio_rms(rms);
                            let z_score = zefiro.or(lich).unwrap_or(0.0);
                            let _ = app.emit("wake-debug-scores", json!({
                                "copernico": copernico,
                                "zefiro": z_score,
                                "lich": z_score,
                                "rms": rms,
                                "threshold": threshold
                            }));
                        }

                        SidecarMessage::Start { score } => {
                            // Fade out suave ao detectar wake word durante fala (requisito: mic ativa → voz abaixa e some)
                            tts_client.fade_out_and_stop(250);
                            thinking.stop_active();
                            // Classificação por MEMÓRIA do app (não por score): o sidecar emite
                            // Start sintético com score 1.0 no follow-up, mas um "copernico" real
                            // e confiante também pode marcar 1.0 — o threshold antigo
                            // (score < 0.999) classificava esse caso errado e pulava a saudação.
                            // Regra: só é continuação se o app pediu follow-up e ainda está na
                            // janela; todo o resto é chamada nova e SEMPRE saúda.
                            let is_followup_voice = wake_word_service.take_followup_expectation();
                            println!(
                                "[WAKE WORD] Start recebido (score={:.2}, followup_esperado={}, sessao_ativa={})",
                                score,
                                is_followup_voice,
                                wake_word_service.get_active_session().as_deref().unwrap_or("-")
                            );
                            // Abre a janela de voz: Sol visível do primeiro "copernico" até o fim da sessão de voz.
                            wake_word_service.set_voice_active(true);
                            // Diagnóstico (só logs): marca o instante do Start para
                            // correlacionar um eventual Stop durante a saudação.
                            wake_word_service.note_start();
                            // Durante interação por voz o Sol fica SEMPRE visível (mesmo com overlay aberto).
                            let show_indicator = || {
                                ensure_indicator_visible(&app);
                            };

                            if is_followup_voice {
                                // Follow-up (veio do listening): SEM saudação.
                                // Vai direto para recording (âmbar) — Sol não pisca para speaking.
                                println!("[WAKE WORD] >> Voz no follow-up (score={:.2}). Sem saudação, direto para recording.", score);
                                // Ordem show→emit (mesmo motivo do Start).
                                show_indicator();
                                #[cfg(windows)]
                                crate::native_overlay::set_mode(crate::native_overlay::OverlayMode::Listening);
                                println!("[SOL] show indicator (start-followup)");
                                let _ = app.emit("wake-status-changed", json!({ "status": "recording" }));
                            } else {
                                // "copernico" pós-Idle: Sol em speaking (branco) durante a saudação, depois recording.
                                // Saúda SEMPRE, mesmo com sessão ativa (retoma a conversa existente).
                                println!("[WAKE WORD] >> Ativação 'copernico' detectada! (score={:.2})", score);

                                // Nova ativação de voz via wake word: cria sempre uma nova sessão de chat isolada
                                println!(
                                    "[WAKE WORD] Nova ativação de voz detectada. Criando nova sessão de chat isolada..."
                                );
                                match database.create_session(None) {
                                    Ok(new_session) => {
                                        println!(
                                            "[WAKE WORD] Novo chat de voz criado: '{}'.",
                                            new_session.id
                                        );
                                        let sid = new_session.id.clone();
                                        wake_word_service.set_active_session(Some(sid.clone()));
                                        let _ = app.emit(
                                            "wake-session-created",
                                            json!({
                                                "session": new_session,
                                                "sessionId": sid,
                                            }),
                                        );
                                    }
                                    Err(err) => {
                                        eprintln!("[WAKE WORD] Erro ao criar nova sessão: {}", err);
                                    }
                                }

                                // Ordem show→emit: o evento speaking precisa encontrar a
                                // webview do indicador visível e com listeners montados.
                                // Emitir com a janela oculta perdia o evento todo ciclo.
                                show_indicator();
                                #[cfg(windows)]
                                crate::native_overlay::set_mode(crate::native_overlay::OverlayMode::Speaking);
                                println!("[SOL] show indicator (start-greeting)");
                                let _ = app.emit("wake-status-changed", json!({ "status": "speaking" }));
                                {
                                    let gm = greetings.clone();
                                    let db = database.clone();
                                    let app2 = app.clone();
                                    let ww_diag = wake_word_service.clone();
                                    let greet_begin = std::time::Instant::now();
                                    std::thread::spawn(move || {
                                        // Diagnóstico (só logs): sinaliza saudação em
                                        // reprodução para correlacionar Stop precoce.
                                        ww_diag.set_greeting_playing(true);
                                        // Re-emite speaking com a janela já visível: se o
                                        // primeiro emit se perdeu (listener montando), este chega.
                                        let _ = app2.emit("wake-status-changed", json!({ "status": "speaking" }));
                                        if let Some(picked) = gm.pick_greeting(&db) {
                                            println!("[WAKE WORD] Saudação iniciada (id={}): {}", picked.id, picked.text);
                                            let wav = gm.dir().join(&picked.file);
                                            println!("[GREETINGS] Tocando saudação '{}': {}", picked.id, picked.text);
                                            if let Err(e) = crate::greetings::play_file_blocking(&wav) {
                                                eprintln!("[GREETINGS] Falha ao tocar saudação: {}", e);
                                            } else {
                                                println!("[GREETINGS] Saudação concluída.");
                                            }
                                        } else {
                                            println!("[GREETINGS] Nenhuma saudação disponível, seguindo sem áudio");
                                        }
                                        // Saudação terminou: abre a vez do usuário (âmbar). O sidecar já está em Recording desde o Start.
                                        // Diagnóstico (só logs): fim da janela de saudação.
                                        ww_diag.set_greeting_playing(false);
                                        println!(
                                            "[WAKE WORD] Saudação concluída (~{:.1}s).",
                                            greet_begin.elapsed().as_secs_f32()
                                        );
                                        // SOL-01: transição direta para recording sem mexer nas janelas (evita reload e perda de foco)
                                        println!("[SOL] greeting-done -> emit recording");
                                        #[cfg(windows)]
                                        crate::native_overlay::set_mode(crate::native_overlay::OverlayMode::Listening);
                                        let _ = app2.emit("wake-status-changed", json!({ "status": "recording" }));
                                        // Re-emissão preventiva (idempotente) 60ms depois como rede de segurança
                                        let app_retry = app2.clone();
                                        tauri::async_runtime::spawn(async move {
                                            tokio::time::sleep(tokio::time::Duration::from_millis(60)).await;
                                            let _ = app_retry.emit("wake-status-changed", json!({ "status": "recording" }));
                                        });
                                    });
                                }
                            }
                        }

                        SidecarMessage::Cancel { reason } => {
                            tts_client.fade_out_and_stop(250);
                            thinking.stop_active();
                            wake_word_service.is_processing_turn.store(false, Ordering::SeqCst);
                            wake_word_service.clear_followup_expectation();
                            // Fim da janela de voz: pode ocultar o Sol.
                            wake_word_service.set_voice_active(false);
                            println!("[WAKE WORD] >> Gravação cancelada: {}", reason);

                            // Verifica se a sessão ativa teve turnos reais de conversa antes de tentar consolidar.
                            // Cancelamento no turno zero (ativação acidental, fechar overlay sem falar) NUNCA consolida!
                            if let Some(sid) = wake_word_service.get_active_session() {
                                let msgs = database.get_messages(&sid).unwrap_or_default();
                                let user_turns = msgs.iter().filter(|m| m.role == "user").count();
                                let assistant_turns = msgs.iter().filter(|m| m.role == "assistant").count();

                                if user_turns == 0 || assistant_turns == 0 {
                                    println!(
                                        "[WAKE WORD] Cancel '{}' em sessão '{}' sem turnos completos (user={}, assistant={}). Descartando consolidação.",
                                        reason, sid, user_turns, assistant_turns
                                    );
                                    // Se a sessão ficou vazia (nenhuma mensagem gravada), limpa a sessão órfã do banco
                                    if msgs.is_empty() {
                                        let _ = database.delete_session(&sid);
                                    }
                                    wake_word_service.set_active_session(None);
                                } else {
                                    if reason == "followup_timeout" {
                                        println!("[WAKE WORD] Timeout de 10s de silêncio atingido na sessão '{}'. Consolidando no Inbox...", sid);
                                    } else {
                                        println!("[WAKE WORD] Cancel '{}' com sessão ativa '{}' (user={}, assistant={}). Consolidando no Inbox...", reason, sid, user_turns, assistant_turns);
                                    }

                                    let app_clone = app.clone();
                                    let db_clone = database.clone();
                                    let llm_clone = agent_core.llm();
                                    let vault_clone = agent_core.vault();
                                    let indexer_clone = agent_core.indexer();
                                    let tools_clone = agent_core.tool_registry();
                                    let sid_clone = sid.clone();
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
                                        .await {
                                            Ok(Some(t)) => println!("[WAKE WORD] Consolidação de '{}' concluída: {}", sid_clone, t),
                                            Ok(None) => println!("[WAKE WORD] Consolidação de '{}' sem conteúdo", sid_clone),
                                            Err(e) => eprintln!("[WAKE WORD] Erro na consolidação de '{}': {}", sid_clone, e),
                                        }
                                        println!("[GREETINGS] {}", gm_clone.cleanup_after_session());
                                    });
                                }
                            }

                            let _ = app.emit("wake-status-changed", json!({ "status": "idle" }));

                            // Em idle/cancelado, a janela indicator deve sempre ficar oculta
                            hide_indicator(&app);
                            println!("[SOL] hide indicator (cancel: {})", reason);
                        }

                        SidecarMessage::Stop { score, wav_base64 } => {
                            // Turno vai começar: qualquer expectativa de follow-up pendente expira aqui.
                            wake_word_service.clear_followup_expectation();
                            // Trava atômica de concorrência: se já houver um turno sendo processado, descarta o evento
                            if wake_word_service
                                .is_processing_turn
                                .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                                .is_err()
                            {
                                println!(
                                    "[WAKE WORD] >> Evento Stop descartado (score={:.2}): turno de voz já está ativo!",
                                    score
                                );
                                continue;
                            }

                            println!("[WAKE WORD] >> Parada 'zefiro' detectada! (score={:.2})", score);
                            // Diagnóstico (só logs): um Stop com saudação ainda em
                            // reprodução indica falso-positivo no áudio do speaker.
                            let since_start = wake_word_service
                                .elapsed_since_start()
                                .map(|d| d.as_secs_f32())
                                .unwrap_or(-1.0);
                            println!(
                                "[WAKE WORD] Stop recebido (score={:.2}, greeting_playing={}, elapsed_desde_Start={:.1}s)",
                                score,
                                wake_word_service.is_greeting_playing(),
                                since_start
                            );
                            let _ = app.emit("wake-status-changed", json!({ "status": "processing" }));

                            // Sol permanece visível durante toda a janela de voz.
                            ensure_indicator_visible(&app);
                            #[cfg(windows)]
                            crate::native_overlay::set_mode(crate::native_overlay::OverlayMode::Processing);
                            println!("[SOL] show indicator (stop-processing)");

                            let app_clone = app.clone();
                            let agent_clone = agent_core.clone();
                            let stt_clone = stt_client.clone();
                            let tts_clone = tts_client.clone();
                            let db_clone = database.clone();
                            let service_clone = wake_word_service.clone();
                            let greetings_clone = greetings.clone();
                            let thinking_clone = thinking.clone();

                            tauri::async_runtime::spawn(async move {
                                process_voice_turn(
                                    wav_base64,
                                    app_clone,
                                    agent_clone,
                                    stt_clone,
                                    tts_clone,
                                    db_clone,
                                    service_clone,
                                    greetings_clone,
                                    thinking_clone,
                                )
                                .await;
                            });
                        }

                        SidecarMessage::Error { message } => {
                            eprintln!("[WAKE WORD Erro]: {}", message);
                        }
                    }
                }
            }

            println!("[WAKE WORD] Leitor de eventos finalizado.");
        })
        .expect("Falha ao criar thread monitora de wake word");
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
async fn process_voice_turn(
    wav_base64: String,
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

    let wav_bytes = match BASE64_STANDARD.decode(&wav_base64) {
        Ok(b) => b,
        Err(err) => {
            eprintln!("[WAKE WORD] Falha ao decodificar Base64 do WAV: {}", err);
            wake_word_service.set_voice_active(false);
            let _ = app.emit("wake-status-changed", json!({ "status": "idle" }));
            hide_indicator(&app);
            println!("[SOL] hide indicator (turn-abort)");
            return;
        }
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
            #[cfg(windows)]
            crate::native_overlay::set_mode(crate::native_overlay::OverlayMode::Speaking);
            let _ = app.emit("wake-status-changed", json!({ "status": "speaking" }));
            let fallback_msg = "Desculpe, não consegui entender o áudio. Poderia repetir?";
            let _ = tts_client.speak_text(fallback_msg, Some(&voice)).await;

            wake_word_service.set_voice_active(false);
            let _ = app.emit("wake-status-changed", json!({ "status": "idle" }));
            hide_indicator(&app);
            println!("[SOL] hide indicator (turn-abort)");
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
        // Fim da janela de voz (ativação sem comando): Sol esconde até o próximo "copernico".
        // A sessão é preservada para retomada — e o próximo wake real vai saudar mesmo assim.
        wake_word_service.set_voice_active(false);
        let _ = app.emit("wake-status-changed", json!({ "status": "idle" }));
        hide_indicator(&app);
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
                wake_word_service.set_voice_active(false);
                let _ = app.emit("wake-status-changed", json!({ "status": "idle" }));
                hide_indicator(&app);
                return;
            }
        },
    };

    // 3. Checa estado de visibilidade do Overlay
    let overlay_visible = if let Some(win) = app.get_webview_window("main") {
        win.is_visible().unwrap_or(false)
    } else {
        false
    };

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

            #[cfg(windows)]
            crate::native_overlay::set_mode(crate::native_overlay::OverlayMode::Speaking);
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

                // Fim da sessão (encerrar_sessao): fecha a janela de voz e oculta o Sol.
                wake_word_service.set_voice_active(false);
                let _ = app.emit("wake-status-changed", json!({ "status": "idle" }));
                hide_indicator(&app);
                println!("[SOL] hide indicator (session-end)");
                return;
            } else {
                // Modo contínuo: abre a escuta ativa pós-fala (follow-up). Sol segue visível.
                println!("[WAKE WORD] Assistente concluiu fala. Abrindo escuta contínua de 10s...");
                #[cfg(windows)]
                crate::native_overlay::set_mode(crate::native_overlay::OverlayMode::Listening);
                let _ = app.emit("wake-status-changed", json!({ "status": "listening" }));
                let _ = app.emit("wake-play-followup-chime", ());

                // Dispara no sidecar o modo follow-up com timeout de 10s de silêncio
                wake_word_service.start_followup(10.0);

                ensure_indicator_visible(&app);
                println!("[SOL] show indicator (followup-listening)");
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
            #[cfg(windows)]
            crate::native_overlay::set_mode(crate::native_overlay::OverlayMode::Speaking);
            let _ = app.emit("wake-status-changed", json!({ "status": "speaking" }));
            let fallback_msg = "Desculpe, tive uma instabilidade temporária ao conectar com o modelo. Poderia repetir?";
            let _ = tts_client.speak_text(fallback_msg, Some(&voice)).await;
        }
    }

    wake_word_service.set_voice_active(false);
    let _ = app.emit("wake-status-changed", json!({ "status": "idle" }));
    hide_indicator(&app);
    println!("[SOL] hide indicator (turn-error)");
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
        for i in start..words.len() {
            let raw = words[i];
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
                .trim_end_matches(|c| c == ',' || c == '-' || c == ';' || c == ':')
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
    let cleaned = trimmed
        .trim_end_matches(|c| c == ',' || c == '-' || c == ';' || c == ':')
        .trim();
    if cleaned.is_empty() {
        return String::new();
    }
    let mut result = cleaned.to_string();
    if had_question_mark && !result.ends_with('?') {
        result.push('?');
    }
    result
}

fn find_sidecar_binary(models_dir: &Path) -> Option<PathBuf> {
    let candidates = [
        models_dir
            .join("target")
            .join("release")
            .join("sidecar.exe"),
        models_dir.join("target").join("debug").join("sidecar.exe"),
        PathBuf::from("motor_wake_word")
            .join("target")
            .join("release")
            .join("sidecar.exe"),
        PathBuf::from("motor_wake_word")
            .join("target")
            .join("debug")
            .join("sidecar.exe"),
        PathBuf::from("../motor_wake_word")
            .join("target")
            .join("release")
            .join("sidecar.exe"),
        PathBuf::from("../motor_wake_word")
            .join("target")
            .join("debug")
            .join("sidecar.exe"),
    ];

    for c in &candidates {
        if c.exists() {
            return Some(c.clone());
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let next_to_exe = parent.join("sidecar.exe");
            if next_to_exe.exists() {
                return Some(next_to_exe);
            }
        }
    }

    None
}
