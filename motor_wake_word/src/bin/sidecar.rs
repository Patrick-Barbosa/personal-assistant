//! Sidecar de Inferência e Captura Contínua de Wake Word para o Copernico
//! Detecta "copernico" -> inicia gravação -> detecta "zefiro" -> emite buffer WAV em Base64
//! Também emite scores em tempo real para visualização e calibração na aba de Debug

use base64::prelude::*;
use crossbeam_channel::bounded;
use inferencia::{start_mic_capture, WakeWordModel};
use serde::{Deserialize, Serialize};
use std::io::{self, BufRead, Cursor, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};


#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum SidecarEvent {
    Ready {
        sample_rate: u32,
        threshold: f32,
    },
    DebugScores {
        copernico: f32,
        zefiro: f32,
        lich: f32,
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

#[derive(Deserialize, Debug)]
#[serde(tag = "cmd", rename_all = "snake_case")]
enum SidecarCommand {
    SetThreshold { threshold: f32 },
    SetDetectionActive { active: bool },
    Cancel,
    Ping,
    StartFollowup { timeout_secs: Option<f32> },
}

fn emit(ev: &SidecarEvent) {
    if let Ok(serialized) = serde_json::to_string(ev) {
        let stdout = io::stdout();
        let mut handle = stdout.lock();
        let _ = writeln!(handle, "{}", serialized);
        let _ = handle.flush();
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Resolve caminhos dos modelos ONNX
    let (copernico_path, zefiro_path) = match find_models() {
        Some(pair) => pair,
        None => {
            emit(&SidecarEvent::Error {
                message: "Modelos copernico.onnx e zefiro.onnx não foram encontrados.".into(),
            });
            return Ok(());
        }
    };

    let running = Arc::new(AtomicBool::new(true));
    let r = running.clone();
    let _ = ctrlc::set_handler(move || {
        r.store(false, Ordering::Relaxed);
    });

    let (pcm_tx, pcm_rx) = bounded::<Vec<i16>>(50);

    // Inicia microfone cpal normalizado a 16kHz (1600 amostras = 100ms)
    let (_mic_handle, sample_rate) = match start_mic_capture(pcm_tx, 1600) {
        Ok(res) => res,
        Err(err) => {
            emit(&SidecarEvent::Error {
                message: format!("Falha ao iniciar captura de microfone: {}", err),
            });
            return Ok(());
        }
    };

    let current_threshold = Arc::new(RwLock::new(0.50f32));
    let current_threshold_clone = current_threshold.clone();

    let detection_active = Arc::new(AtomicBool::new(true));
    let detection_active_clone = detection_active.clone();

    let cancel_requested = Arc::new(AtomicBool::new(false));
    let cancel_requested_clone = cancel_requested.clone();

    let followup_requested = Arc::new(std::sync::Mutex::new(None::<f32>));
    let followup_requested_clone = followup_requested.clone();

    // Thread para receber comandos via STDIN (ex: ajuste de threshold, pausa ou cancelamento)
    std::thread::spawn(move || {
        let stdin = io::stdin();
        for line in stdin.lock().lines() {
            if let Ok(line_str) = line {
                let trimmed = line_str.trim();
                if trimmed.is_empty() {
                    continue;
                }
                if let Ok(cmd) = serde_json::from_str::<SidecarCommand>(trimmed) {
                    match cmd {
                        SidecarCommand::SetThreshold { threshold } => {
                            if let Ok(mut th) = current_threshold_clone.write() {
                                *th = threshold.clamp(0.10, 0.95);
                            }
                        }
                        SidecarCommand::SetDetectionActive { active } => {
                            detection_active_clone.store(active, Ordering::Relaxed);
                        }
                        SidecarCommand::Cancel => {
                            cancel_requested_clone.store(true, Ordering::SeqCst);
                        }
                        SidecarCommand::StartFollowup { timeout_secs } => {
                            if let Ok(mut lock) = followup_requested_clone.lock() {
                                *lock = Some(timeout_secs.unwrap_or(5.0));
                            }
                        }
                        SidecarCommand::Ping => {}
                    }
                }
            }
        }
    });

    // 3. Inicializa buffer circular de 2.0 segundos (32.000 amostras) e worker assíncrono
    let ring_buffer = Arc::new(RwLock::new(vec![0i16; 32000]));
    let latest_scores = Arc::new(RwLock::new((0.0f32, 0.0f32)));
    let last_speech_time = Arc::new(RwLock::new(Instant::now() - Duration::from_secs(10)));

    // Fase ativa da máquina de estados:
    // 0 = Idle (Apenas Copérnico roda)
    // 1 = Recording (Apenas Zefiro roda)
    let active_phase = Arc::new(AtomicU8::new(0));

    // Inicia worker desacoplado de inferência ONNX em background
    {
        let ring_worker = ring_buffer.clone();
        let scores_worker = latest_scores.clone();
        let speech_worker = last_speech_time.clone();
        let phase_worker = active_phase.clone();
        let r_worker_loop = running.clone();
        let cop_worker = copernico_path.clone();
        let zefiro_worker = zefiro_path.clone();

        std::thread::spawn(move || {
            let mut model_copernico = match WakeWordModel::new(&[&cop_worker], 16000) {
                Ok(m) => m,
                Err(e) => {
                    emit(&SidecarEvent::Error {
                        message: format!("Falha ao carregar modelo copernico.onnx: {}", e),
                    });
                    return;
                }
            };

            let mut model_zefiro = match WakeWordModel::new(&[&zefiro_worker], 16000) {
                Ok(m) => m,
                Err(e) => {
                    emit(&SidecarEvent::Error {
                        message: format!("Falha ao carregar modelo zefiro.onnx: {}", e),
                    });
                    return;
                }
            };

            while r_worker_loop.load(Ordering::Relaxed) {
                let is_recent_speech = speech_worker.read().unwrap().elapsed() < Duration::from_millis(2200);
                if !is_recent_speech {
                    std::thread::sleep(Duration::from_millis(40));
                    if let Ok(mut sc) = scores_worker.write() {
                        sc.0 = (sc.0 * 0.75).max(0.0);
                        sc.1 = (sc.1 * 0.75).max(0.0);
                    }
                    continue;
                }

                let snapshot = {
                    ring_worker.read().unwrap().clone()
                };

                let phase = phase_worker.load(Ordering::Relaxed);
                if phase == 0 {
                    // FASE 0 (IDLE): Executa exclusivamente copernico.onnx (Zefiro é fixado em 0.0%)
                    if let Ok(sc) = model_copernico.predict(&snapshot) {
                        let c = sc.get("copernico").copied().unwrap_or(0.0);
                        if let Ok(mut lock) = scores_worker.write() {
                            *lock = (c, 0.0);
                        }
                    }
                } else {
                    // FASE 1 (RECORDING): Executa exclusivamente zefiro.onnx (Copérnico é fixado em 0.0%)
                    if let Ok(sc) = model_zefiro.predict(&snapshot) {
                        let z = sc.get("zefiro").copied().unwrap_or(0.0);
                        if let Ok(mut lock) = scores_worker.write() {
                            *lock = (0.0, z);
                        }
                    }
                }
            }
        });
    }


    let initial_th = *current_threshold.read().unwrap();
    emit(&SidecarEvent::Ready {
        sample_rate,
        threshold: initial_th,
    });

    enum Mode {
        Idle,
        Recording {
            buffer: Vec<i16>,
            _start_time: Instant,
            last_voice_time: Instant,
        },
        FollowupListening {
            buffer: Vec<i16>,
            start_time: Instant,
            last_voice_time: Option<Instant>,
            timeout_duration: Duration,
            voice_detected: bool,
        },
    }

    let mut mode = Mode::Idle;
    let silence_timeout_duration = Duration::from_secs(17);
    let mut last_debug_emit = Instant::now();

    // Cooldown obrigatório de 1,5s após Stop ou Cancel para eliminar re-disparos imediatos por áudio residual
    let cooldown_duration = Duration::from_millis(1500);
    let mut cooldown_until = Instant::now();

    while running.load(Ordering::Relaxed) {
        let chunk = match pcm_rx.recv_timeout(Duration::from_millis(200)) {
            Ok(c) => c,
            Err(crossbeam_channel::RecvTimeoutError::Timeout) => continue,
            Err(crossbeam_channel::RecvTimeoutError::Disconnected) => break,
        };

        // Calcula RMS do volume da voz para VU meter
        let sum_sq: f64 = chunk.iter().map(|&s| (s as f64) * (s as f64)).sum();
        let rms = ((sum_sq / chunk.len() as f64).sqrt() / 32768.0).min(1.0) as f32;

        // Detector de fala: se rms >= 0.008, atualiza timestamp de fala recente
        if rms >= 0.008 {
            if let Ok(mut t) = last_speech_time.write() {
                *t = Instant::now();
            }
        }

        // Alimenta buffer circular de 32.000 amostras (2.0 segundos)
        {
            let mut buf = ring_buffer.write().unwrap();
            let to_remove = chunk.len().min(buf.len());
            buf.drain(0..to_remove);
            buf.extend_from_slice(&chunk);
        }

        let active_threshold = *current_threshold.read().unwrap();
        let (raw_copernico, raw_zefiro) = *latest_scores.read().unwrap();

        let in_cooldown = Instant::now() < cooldown_until;
        let (copernico_score, zefiro_score) = if in_cooldown {
            (0.0f32, 0.0f32)
        } else {
            (raw_copernico, raw_zefiro)
        };

        // Emite scores de debug ~12 vezes por segundo para a interface
        if last_debug_emit.elapsed() >= Duration::from_millis(80) {
            emit(&SidecarEvent::DebugScores {
                copernico: copernico_score,
                zefiro: zefiro_score,
                lich: zefiro_score,
                rms,
                threshold: active_threshold,
            });
            last_debug_emit = Instant::now();
        }

        // Se comando de follow-up foi solicitado via STDIN, entra imediatamente em FollowupListening
        let requested_followup = followup_requested.lock().ok().and_then(|mut guard| guard.take());
        if let Some(t_secs) = requested_followup {
            active_phase.store(1, Ordering::Relaxed);
            if let Ok(mut sc) = latest_scores.write() {
                *sc = (0.0, 0.0);
            }
            if let Ok(mut rb) = ring_buffer.write() {
                rb.fill(0);
            }
            mode = Mode::FollowupListening {
                buffer: Vec::new(),
                start_time: Instant::now(),
                last_voice_time: None,
                timeout_duration: Duration::from_secs_f32(t_secs),
                voice_detected: false,
            };
            cooldown_until = Instant::now();
        }

        // Se cancelamento foi solicitado via STDIN, aborta qualquer gravação em andamento imediatamente
        if cancel_requested.swap(false, Ordering::SeqCst) {
            if matches!(mode, Mode::Recording { .. } | Mode::FollowupListening { .. }) {
                active_phase.store(0, Ordering::Relaxed);
                if let Ok(mut sc) = latest_scores.write() {
                    *sc = (0.0, 0.0);
                }
                if let Ok(mut rb) = ring_buffer.write() {
                    rb.fill(0);
                }
                mode = Mode::Idle;
                emit(&SidecarEvent::Cancel {
                    reason: "Cancelado pelo usuário via interface".into(),
                });
                cooldown_until = Instant::now() + cooldown_duration;
            }
        }

        match &mut mode {
            Mode::Idle => {
                if in_cooldown {
                    // Durante o cooldown pós-Stop/Cancel, zera buffers e scores para purgar resíduos
                    if let Ok(mut sc) = latest_scores.write() {
                        *sc = (0.0, 0.0);
                    }
                    if let Ok(mut rb) = ring_buffer.write() {
                        rb.fill(0);
                    }
                } else if detection_active.load(Ordering::Relaxed) && copernico_score >= active_threshold {
                    // Chaveia worker exclusivamente para o modelo ZEFIRO
                    active_phase.store(1, Ordering::Relaxed);

                    // Reseta scores e buffer para evitar re-disparos
                    *latest_scores.write().unwrap() = (0.0, 0.0);
                    ring_buffer.write().unwrap().fill(0);

                    emit(&SidecarEvent::Start {
                        score: copernico_score,
                    });
                    mode = Mode::Recording {
                        buffer: Vec::new(),
                        _start_time: Instant::now(),
                        last_voice_time: Instant::now(),
                    };
                }
            }

            Mode::Recording { buffer, _start_time: _, last_voice_time } => {
                buffer.extend_from_slice(&chunk);

                // Se houver fala perceptível (rms >= 0.008), reseta o temporizador de silêncio
                if rms >= 0.008 {
                    *last_voice_time = Instant::now();
                }

                let is_silence_timeout = last_voice_time.elapsed() >= silence_timeout_duration;
                let zefiro_detected = zefiro_score >= active_threshold;

                if is_silence_timeout {
                    // 17 segundos contínuos de silêncio absoluto: descarta o áudio e volta para idle
                    active_phase.store(0, Ordering::Relaxed);
                    *latest_scores.write().unwrap() = (0.0, 0.0);
                    ring_buffer.write().unwrap().fill(0);
                    buffer.clear();
                    mode = Mode::Idle;

                    emit(&SidecarEvent::Cancel {
                        reason: "17 segundos de silêncio contínuo após ativação".into(),
                    });

                    // Cooldown de 1,5s após cancelamento
                    cooldown_until = Instant::now() + cooldown_duration;
                } else if zefiro_detected {
                    let score = zefiro_score;

                    // Chaveia worker de volta exclusivamente para COPERNICO
                    active_phase.store(0, Ordering::Relaxed);

                    // Reseta scores e buffer
                    *latest_scores.write().unwrap() = (0.0, 0.0);
                    ring_buffer.write().unwrap().fill(0);

                    // Áudio preservado na íntegra sem corte destrutivo de milissegundos
                    let recorded_pcm = std::mem::take(buffer);

                    mode = Mode::Idle;

                    // Codifica o áudio em WAV
                    if let Ok(wav_bytes) = encode_pcm_to_wav(&recorded_pcm, sample_rate) {
                        let wav_b64 = BASE64_STANDARD.encode(&wav_bytes);
                        emit(&SidecarEvent::Stop {
                            score,
                            wav_base64: wav_b64,
                        });
                    }

                    // Cooldown obrigatório de 1,5s após Stop para impedir re-disparos imediatos por áudio residual
                    cooldown_until = Instant::now() + cooldown_duration;
                }
            }

            Mode::FollowupListening {
                buffer,
                start_time,
                last_voice_time,
                timeout_duration,
                voice_detected,
            } => {
                buffer.extend_from_slice(&chunk);

                if rms >= 0.008 {
                    if !*voice_detected {
                        *voice_detected = true;
                        // Emite início de fala sem recarregar tela
                        emit(&SidecarEvent::Start { score: 1.0 });
                    }
                    *last_voice_time = Some(Instant::now());
                }

                if !*voice_detected {
                    // Ainda aguardando o usuário começar a falar
                    if start_time.elapsed() >= *timeout_duration {
                        active_phase.store(0, Ordering::Relaxed);
                        if let Ok(mut sc) = latest_scores.write() {
                            *sc = (0.0, 0.0);
                        }
                        if let Ok(mut rb) = ring_buffer.write() {
                            rb.fill(0);
                        }
                        buffer.clear();
                        mode = Mode::Idle;

                        emit(&SidecarEvent::Cancel {
                            reason: "followup_timeout".into(),
                        });
                        cooldown_until = Instant::now() + cooldown_duration;
                    }
                } else {
                    // Usuário falou! Checa término da fala:
                    // 1) 3 segundos de silêncio natural pós-fala (conforme aprovado no plano)
                    // 2) Ou palavra zefiro detectada
                    let post_speech_silence = last_voice_time
                        .map(|t| t.elapsed() >= Duration::from_millis(3000))
                        .unwrap_or(false);
                    let zefiro_detected = zefiro_score >= active_threshold;

                    if post_speech_silence || zefiro_detected {
                        let score = if zefiro_detected { zefiro_score } else { 1.0 };

                        active_phase.store(0, Ordering::Relaxed);
                        if let Ok(mut sc) = latest_scores.write() {
                            *sc = (0.0, 0.0);
                        }
                        if let Ok(mut rb) = ring_buffer.write() {
                            rb.fill(0);
                        }

                        let recorded_pcm = std::mem::take(buffer);
                        mode = Mode::Idle;

                        if let Ok(wav_bytes) = encode_pcm_to_wav(&recorded_pcm, sample_rate) {
                            let wav_b64 = BASE64_STANDARD.encode(&wav_bytes);
                            emit(&SidecarEvent::Stop {
                                score,
                                wav_base64: wav_b64,
                            });
                        }

                        cooldown_until = Instant::now() + cooldown_duration;
                    }
                }
            }
        }
    }

    Ok(())
}


fn encode_pcm_to_wav(pcm: &[i16], sample_rate: u32) -> Result<Vec<u8>, hound::Error> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    let mut cursor = Cursor::new(Vec::new());
    {
        let mut writer = hound::WavWriter::new(&mut cursor, spec)?;
        for &sample in pcm {
            writer.write_sample(sample)?;
        }
        writer.finalize()?;
    }

    Ok(cursor.into_inner())
}

fn find_models() -> Option<(PathBuf, PathBuf)> {
    let candidates = [
        PathBuf::from("."),
        PathBuf::from("models"),
        PathBuf::from("motor_wake_word"),
        PathBuf::from("motor_wake_word/models"),
        PathBuf::from("../motor_wake_word"),
        PathBuf::from("../motor_wake_word/models"),
    ];

    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let c1 = parent.join("copernico.onnx");
            let z1 = parent.join("zefiro.onnx");
            if c1.exists() && z1.exists() {
                return Some((c1, z1));
            }
        }
    }

    for dir in &candidates {
        let c = dir.join("copernico.onnx");
        let z = dir.join("zefiro.onnx");
        if c.exists() && z.exists() {
            return Some((c, z));
        }
    }

    None
}
