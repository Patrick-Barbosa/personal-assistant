use crate::agent::SharedAgentCore;
use crate::bridge::emitter;
use crate::db::SharedDatabase;
use crate::greetings::SharedGreetingsManager;
use crate::infra::hardware::wake_inprocess::{
    spawn_inprocess_engine, EngineControl, InprocessEvent,
};
use crate::services::voice_orch::{process_voice_turn, SharedWakeWordService, WakeCommand};
use crate::stt::SharedSttClient;
use crate::thinking::SharedThinkingAudiosManager;
use crate::tts::SharedTtsClient;
use crossbeam_channel::bounded;
use serde_json::json;
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

#[allow(clippy::too_many_arguments)]
pub fn spawn_inprocess_wake(
    app: AppHandle,
    models_dir: PathBuf,
    agent_core: SharedAgentCore,
    stt: SharedSttClient,
    tts: SharedTtsClient,
    db: SharedDatabase,
    wake_service: SharedWakeWordService,
    greetings: SharedGreetingsManager,
    thinking: SharedThinkingAudiosManager,
) {
    let (event_tx, event_rx) = bounded::<InprocessEvent>(64);
    let (cmd_tx, cmd_rx) = bounded::<WakeCommand>(32);

    wake_service.set_command_channel(cmd_tx);

    let engine_handle = match spawn_inprocess_engine(&models_dir, event_tx) {
        Ok(handle) => handle,
        Err(err) => {
            eprintln!(
                "[WAKE WORD] Failed to initialize in-process wake engine: {}. Service inactive.",
                err
            );
            let _ = emitter::emit_wake_status_changed(&app, "error", None);
            return;
        }
    };

    // Restore saved threshold from SQLite if present
    if let Ok(Some(saved_th_str)) = db.get_setting("wake_word_threshold") {
        if let Ok(saved_th) = saved_th_str.parse::<f32>() {
            wake_service.set_threshold(saved_th);
        }
    }

    let _ = emitter::emit_wake_status_changed(&app, "idle", None);

    std::thread::Builder::new()
        .name("copernico-wake-inprocess-worker".into())
        .spawn(move || {
            while wake_service.is_running() && engine_handle.is_running() {
                // Forward commands from WakeWordService to Engine
                while let Ok(cmd) = cmd_rx.try_recv() {
                    match cmd {
                        WakeCommand::SetThreshold(th) => {
                            engine_handle.send_control(EngineControl::SetThreshold(th));
                        }
                        WakeCommand::SetDetectionActive(active) => {
                            engine_handle.send_control(EngineControl::SetDetectionActive(active));
                        }
                        WakeCommand::Cancel => {
                            engine_handle.send_control(EngineControl::Cancel);
                        }
                        WakeCommand::StartFollowup(timeout_secs) => {
                            engine_handle.send_control(EngineControl::StartFollowup(timeout_secs));
                        }
                        WakeCommand::SetMicEnabled(enabled) => {
                            engine_handle.send_control(EngineControl::SetMicEnabled(enabled));
                        }
                    }
                }

                // Process engine events
                let ev = match event_rx.recv_timeout(Duration::from_millis(80)) {
                    Ok(event) => event,
                    Err(crossbeam_channel::RecvTimeoutError::Timeout) => continue,
                    Err(crossbeam_channel::RecvTimeoutError::Disconnected) => break,
                };

                match ev {
                    InprocessEvent::DebugScores { .. } => {
                        // Telemetry for debug UI - status badge uses wake-status-changed
                    }

                    InprocessEvent::Started { score } => {
                        tts.fade_out_and_stop(250);
                        thinking.stop_active();

                        let is_followup_voice = wake_service.take_followup_expectation();
                        println!(
                            "[WAKE WORD] Start event received (score={:.2}, followup_expected={}, active_session={})",
                            score,
                            is_followup_voice,
                            wake_service.get_active_session().as_deref().unwrap_or("-")
                        );

                        wake_service.note_start();

                        if is_followup_voice {
                            println!("[WAKE WORD] >> Voice in follow-up. Direct to recording.");
                            let _ = emitter::emit_wake_status_changed(&app, "recording", None);
                        } else {
                            println!("[WAKE WORD] >> 'copernico' activation detected (score={:.2})", score);

                            match db.create_session(None) {
                                Ok(new_session) => {
                                    println!("[WAKE WORD] New chat session created: '{}'", new_session.id);
                                    let sid = new_session.id.clone();
                                    wake_service.set_active_session(Some(sid.clone()));
                                    let _ = app.emit(
                                        "wake-session-created",
                                        json!({
                                            "session": new_session,
                                            "sessionId": sid,
                                        }),
                                    );
                                }
                                Err(err) => {
                                    eprintln!("[WAKE WORD] Failed to create session: {}", err);
                                }
                            }

                            let _ = emitter::emit_wake_status_changed(&app, "speaking", None);

                            let gm = greetings.clone();
                            let db_clone = db.clone();
                            let app_clone = app.clone();
                            let ww_diag = wake_service.clone();
                            let greet_begin = std::time::Instant::now();

                            std::thread::spawn(move || {
                                ww_diag.set_greeting_playing(true);
                                if let Some(picked) = gm.pick_greeting(&db_clone) {
                                    println!("[WAKE WORD] Greeting started (id={}): {}", picked.id, picked.text);
                                    let wav = gm.dir().join(&picked.file);
                                    if let Err(e) = crate::greetings::play_file_blocking(&wav) {
                                        eprintln!("[GREETINGS] Failed to play greeting: {}", e);
                                    }
                                }
                                ww_diag.set_greeting_playing(false);
                                println!(
                                    "[WAKE WORD] Greeting completed (~{:.1}s).",
                                    greet_begin.elapsed().as_secs_f32()
                                );
                                let _ = emitter::emit_wake_status_changed(&app_clone, "recording", None);
                            });
                        }
                    }

                    InprocessEvent::Stopped { score, wav_bytes } => {
                        wake_service.clear_followup_expectation();

                        if wake_service
                            .is_processing_turn
                            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                            .is_err()
                        {
                            println!(
                                "[WAKE WORD] >> Stop event ignored (score={:.2}): turn already active!",
                                score
                            );
                            continue;
                        }

                        println!("[WAKE WORD] >> 'zefiro' stop detected (score={:.2})", score);
                        let _ = emitter::emit_wake_status_changed(&app, "processing", None);

                        let app_clone = app.clone();
                        let agent_clone = agent_core.clone();
                        let stt_clone = stt.clone();
                        let tts_clone = tts.clone();
                        let db_clone = db.clone();
                        let service_clone = wake_service.clone();
                        let greetings_clone = greetings.clone();
                        let thinking_clone = thinking.clone();

                        tauri::async_runtime::spawn(async move {
                            process_voice_turn(
                                wav_bytes,
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

                    InprocessEvent::Cancelled { reason } => {
                        tts.fade_out_and_stop(250);
                        thinking.stop_active();
                        wake_service.is_processing_turn.store(false, Ordering::SeqCst);
                        wake_service.clear_followup_expectation();
                        println!("[WAKE WORD] >> Recording cancelled: {}", reason);

                        if let Some(sid) = wake_service.get_active_session() {
                            let msgs = db.get_messages(&sid).unwrap_or_default();
                            let user_turns = msgs.iter().filter(|m| m.role == "user").count();
                            let assistant_turns = msgs.iter().filter(|m| m.role == "assistant").count();

                            if user_turns == 0 || assistant_turns == 0 {
                                println!(
                                    "[WAKE WORD] Cancel '{}' on session '{}' without full turns. Discarding.",
                                    reason, sid
                                );
                                if msgs.is_empty() && db.delete_session(&sid).unwrap_or(false) {
                                    let _ = emitter::emit_wake_session_deleted(&app, &sid);
                                }
                                wake_service.set_active_session(None);
                            } else {
                                let app_clone = app.clone();
                                let db_clone = db.clone();
                                let llm_clone = agent_core.llm();
                                let vault_clone = agent_core.vault();
                                let indexer_clone = agent_core.indexer();
                                let tools_clone = agent_core.tool_registry();
                                let sid_clone = sid.clone();
                                let gm_clone = greetings.clone();

                                tauri::async_runtime::spawn(async move {
                                    let _ = crate::consolidation::consolidate_voice_session(
                                        &sid_clone,
                                        Some(app_clone),
                                        db_clone,
                                        llm_clone,
                                        vault_clone,
                                        indexer_clone,
                                        tools_clone,
                                    )
                                    .await;
                                    let _ = gm_clone.cleanup_after_session();
                                });
                            }
                        }

                        let _ = emitter::emit_wake_status_changed(&app, "idle", None);
                    }
                }
            }

            engine_handle.stop();
            println!("[WAKE WORD] In-process wake worker thread exited.");
        })
        .expect("Failed to spawn in-process wake worker thread");
}
