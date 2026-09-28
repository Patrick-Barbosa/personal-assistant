use crossbeam_channel::{bounded, Sender};
use inferencia::{start_mic_capture, MicCaptureHandle, WakeWordError, WakeWordModel};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

/// Events produced by the in-process wake engine state machine.
#[derive(Debug, Clone)]
pub enum InprocessEvent {
    Started {
        score: f32,
    },
    Stopped {
        score: f32,
        wav_bytes: Vec<u8>,
    },
    Cancelled {
        reason: String,
    },
    DebugScores {
        copernico: f32,
        zefiro: f32,
        rms: f32,
        threshold: f32,
    },
}

/// Commands accepted by the engine state machine.
#[derive(Debug, Clone)]
pub enum EngineControl {
    SetThreshold(f32),
    SetDetectionActive(bool),
    Cancel,
    StartFollowup(f32),
    SetMicEnabled(bool),
}

/// Single canonical resolver for model file paths (`copernico.onnx` and `zefiro.onnx`).
pub fn resolve_model_paths(models_dir: &Path) -> Result<(PathBuf, PathBuf), WakeWordError> {
    let direct_c = models_dir.join("copernico.onnx");
    let direct_z = models_dir.join("zefiro.onnx");
    if direct_c.exists() && direct_z.exists() {
        return Ok((direct_c, direct_z));
    }

    let sub_c = models_dir.join("models").join("copernico.onnx");
    let sub_z = models_dir.join("models").join("zefiro.onnx");
    if sub_c.exists() && sub_z.exists() {
        return Ok((sub_c, sub_z));
    }

    // If models_dir is absolute and models were not found inside it, do not fall back to working dir
    if models_dir.is_absolute() {
        return Err(WakeWordError::ModelLoad(format!(
            "Models copernico.onnx and zefiro.onnx not found in directory {}",
            models_dir.display()
        )));
    }

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
                return Ok((c1, z1));
            }
        }
    }

    for dir in &candidates {
        let c = dir.join("copernico.onnx");
        let z = dir.join("zefiro.onnx");
        if c.exists() && z.exists() {
            return Ok((c, z));
        }
    }

    Err(WakeWordError::ModelLoad(format!(
        "Models copernico.onnx and zefiro.onnx not found in directory {}",
        models_dir.display()
    )))
}

/// Encodes PCM i16 samples (16000 Hz, mono) into WAV binary format.
pub fn encode_pcm_to_wav(pcm: &[i16], sample_rate: u32) -> Result<Vec<u8>, hound::Error> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    let mut cursor = std::io::Cursor::new(Vec::new());
    {
        let mut writer = hound::WavWriter::new(&mut cursor, spec)?;
        for &sample in pcm {
            writer.write_sample(sample)?;
        }
        writer.finalize()?;
    }

    Ok(cursor.into_inner())
}

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

pub struct InprocessWakeEngineHandle {
    is_running: Arc<AtomicBool>,
    control_tx: Sender<EngineControl>,
}

impl InprocessWakeEngineHandle {
    pub fn is_running(&self) -> bool {
        self.is_running.load(Ordering::Relaxed)
    }

    pub fn send_control(&self, cmd: EngineControl) {
        let _ = self.control_tx.try_send(cmd);
    }

    pub fn stop(&self) {
        self.is_running.store(false, Ordering::Relaxed);
    }
}

/// Spawns the in-process wake engine worker threads:
/// 1. Mic capture thread (cpal -> `pcm_tx`)
/// 2. ONNX inference thread (computes copernico / zefiro scores from 2s ring buffer)
/// 3. State machine orchestrator loop (manages Idle, Recording, Followup modes and emits `InprocessEvent`s)
pub fn spawn_inprocess_engine(
    models_dir: &Path,
    event_tx: Sender<InprocessEvent>,
) -> Result<InprocessWakeEngineHandle, WakeWordError> {
    let (copernico_path, zefiro_path) = resolve_model_paths(models_dir)?;

    let is_running = Arc::new(AtomicBool::new(true));
    let (pcm_tx, pcm_rx) = bounded::<Vec<i16>>(50);
    let (control_tx, control_rx) = bounded::<EngineControl>(32);

    let sample_rate = 16000u32;

    let ring_buffer = Arc::new(RwLock::new(vec![0i16; 32000]));
    let latest_scores = Arc::new(RwLock::new((0.0f32, 0.0f32)));
    let last_speech_time = Arc::new(RwLock::new(Instant::now() - Duration::from_secs(10)));
    let active_phase = Arc::new(AtomicU8::new(0));

    // ONNX Inference Thread
    {
        let ring_worker = Arc::clone(&ring_buffer);
        let scores_worker = Arc::clone(&latest_scores);
        let speech_worker = Arc::clone(&last_speech_time);
        let phase_worker = Arc::clone(&active_phase);
        let r_worker_loop = Arc::clone(&is_running);
        let cop_worker = copernico_path.clone();
        let zefiro_worker = zefiro_path.clone();

        std::thread::Builder::new()
            .name("inprocess-wake-inference".into())
            .spawn(move || {
                let mut model_copernico = match WakeWordModel::new(&[&cop_worker], sample_rate) {
                    Ok(m) => m,
                    Err(e) => {
                        eprintln!("[INPROCESS WAKE] Failed to load copernico.onnx: {:?}", e);
                        return;
                    }
                };

                let mut model_zefiro = match WakeWordModel::new(&[&zefiro_worker], sample_rate) {
                    Ok(m) => m,
                    Err(e) => {
                        eprintln!("[INPROCESS WAKE] Failed to load zefiro.onnx: {:?}", e);
                        return;
                    }
                };

                while r_worker_loop.load(Ordering::Relaxed) {
                    let is_recent_speech = speech_worker
                        .read()
                        .ok()
                        .map(|t| t.elapsed() < Duration::from_millis(2200))
                        .unwrap_or(false);

                    if !is_recent_speech {
                        std::thread::sleep(Duration::from_millis(40));
                        if let Ok(mut sc) = scores_worker.write() {
                            sc.0 = (sc.0 * 0.75).max(0.0);
                            sc.1 = (sc.1 * 0.75).max(0.0);
                        }
                        continue;
                    }

                    let snapshot = match ring_worker.read() {
                        Ok(guard) => guard.clone(),
                        Err(_) => continue,
                    };

                    let phase = phase_worker.load(Ordering::Relaxed);
                    if phase == 0 {
                        if let Ok(sc) = model_copernico.predict(&snapshot) {
                            let c = sc.get("copernico").copied().unwrap_or(0.0);
                            if let Ok(mut lock) = scores_worker.write() {
                                *lock = (c, 0.0);
                            }
                        }
                    } else if let Ok(sc) = model_zefiro.predict(&snapshot) {
                        let z = sc.get("zefiro").copied().unwrap_or(0.0);
                        if let Ok(mut lock) = scores_worker.write() {
                            *lock = (0.0, z);
                        }
                    }
                }
            })
            .map_err(|e| WakeWordError::Io(std::io::Error::other(e)))?;
    }

    // State Machine Orchestrator Thread
    {
        let is_running_orch = Arc::clone(&is_running);
        let ring_buffer_orch = Arc::clone(&ring_buffer);
        let latest_scores_orch = Arc::clone(&latest_scores);
        let last_speech_time_orch = Arc::clone(&last_speech_time);
        let active_phase_orch = Arc::clone(&active_phase);

        std::thread::Builder::new()
            .name("inprocess-wake-orchestrator".into())
            .spawn(move || {
                // Mic handle held as Option so `SetMicEnabled(false)` can drop the
                // cpal stream (releasing the OS device for the browser MediaRecorder)
                // and `SetMicEnabled(true)` can re-acquire it. `pcm_tx` is kept alive
                // in this scope via clone so releasing the mic never disconnects
                // `pcm_rx` (a disconnect would break the loop below).
                let mut mic_handle: Option<MicCaptureHandle> =
                    match start_mic_capture(pcm_tx.clone(), 1600) {
                        Ok((handle, _sr)) => Some(handle),
                        Err(err) => {
                            eprintln!("[INPROCESS WAKE] Microphone capture error: {:?}", err);
                            None
                        }
                    };
                let mut mic_enabled = true;

                let mut current_threshold = 0.50f32;
                let mut detection_active = true;
                let mut cancel_requested = false;
                let mut followup_requested: Option<f32> = None;

                let mut mode = Mode::Idle;
                let silence_timeout_duration = Duration::from_secs(17);
                let cooldown_duration = Duration::from_millis(1500);
                let mut cooldown_until = Instant::now();
                let mut last_debug_emit = Instant::now();

                while is_running_orch.load(Ordering::Relaxed) {
                    // Receive first so control commands arriving during the wait are
                    // still honored even when no audio flows (mic released). `None`
                    // means timeout: drain controls below, then loop again.
                    let chunk_opt = match pcm_rx.recv_timeout(Duration::from_millis(100)) {
                        Ok(c) => Some(c),
                        Err(crossbeam_channel::RecvTimeoutError::Timeout) => None,
                        Err(crossbeam_channel::RecvTimeoutError::Disconnected) => break,
                    };

                    // Process pending control commands
                    while let Ok(cmd) = control_rx.try_recv() {
                        match cmd {
                            EngineControl::SetThreshold(th) => {
                                current_threshold = th.clamp(0.10, 0.95);
                            }
                            EngineControl::SetDetectionActive(active) => {
                                detection_active = active;
                            }
                            EngineControl::Cancel => {
                                cancel_requested = true;
                            }
                            EngineControl::StartFollowup(t_secs) => {
                                followup_requested = Some(t_secs);
                            }
                            EngineControl::SetMicEnabled(enabled) => {
                                mic_enabled = enabled;
                                if !enabled {
                                    // Drop the cpal stream -> OS device released for
                                    // the browser MediaRecorder (push-to-talk).
                                    mic_handle = None;
                                    // Discard audio queued before the release.
                                    while pcm_rx.try_recv().is_ok() {}
                                } else if mic_handle.is_none() {
                                    match start_mic_capture(pcm_tx.clone(), 1600) {
                                        Ok((handle, _sr)) => {
                                            mic_handle = Some(handle);
                                        }
                                        Err(err) => {
                                            eprintln!(
                                                "[INPROCESS WAKE] Microphone re-acquire error: {:?}",
                                                err
                                            );
                                        }
                                    }
                                }
                                // Clear ring buffer + scores so stale audio can
                                // never fire a trigger on pause/resume.
                                if let Ok(mut rb) = ring_buffer_orch.write() {
                                    rb.fill(0);
                                }
                                if let Ok(mut sc) = latest_scores_orch.write() {
                                    *sc = (0.0, 0.0);
                                }
                            }
                        }
                    }

                    let chunk = match chunk_opt {
                        Some(c) => c,
                        None => continue,
                    };

                    // While the mic is released, discard any stale queued audio so
                    // it can never advance detection / recording state.
                    if !mic_enabled {
                        continue;
                    }

                    // Calculate volume RMS
                    let sum_sq: f64 = chunk.iter().map(|&s| (s as f64) * (s as f64)).sum();
                    let rms = ((sum_sq / chunk.len() as f64).sqrt() / 32768.0).min(1.0) as f32;

                    if rms >= 0.008 {
                        if let Ok(mut t) = last_speech_time_orch.write() {
                            *t = Instant::now();
                        }
                    }

                    // Fill 2-second ring buffer
                    if let Ok(mut buf) = ring_buffer_orch.write() {
                        let to_remove = chunk.len().min(buf.len());
                        buf.drain(0..to_remove);
                        buf.extend_from_slice(&chunk);
                    }

                    let active_th = current_threshold;
                    let (raw_copernico, raw_zefiro) = latest_scores_orch
                        .read()
                        .ok()
                        .map(|g| *g)
                        .unwrap_or((0.0, 0.0));

                    let in_cooldown = Instant::now() < cooldown_until;
                    let (copernico_score, zefiro_score) = if in_cooldown {
                        (0.0f32, 0.0f32)
                    } else {
                        (raw_copernico, raw_zefiro)
                    };

                    if last_debug_emit.elapsed() >= Duration::from_millis(80) {
                        let _ = event_tx.try_send(InprocessEvent::DebugScores {
                            copernico: copernico_score,
                            zefiro: zefiro_score,
                            rms,
                            threshold: active_th,
                        });
                        last_debug_emit = Instant::now();
                    }

                    // Handle requested followup mode transition
                    if let Some(t_secs) = followup_requested.take() {
                        active_phase_orch.store(1, Ordering::Relaxed);
                        if let Ok(mut sc) = latest_scores_orch.write() {
                            *sc = (0.0, 0.0);
                        }
                        if let Ok(mut rb) = ring_buffer_orch.write() {
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

                    // Handle cancel command
                    if cancel_requested {
                        cancel_requested = false;
                        if matches!(
                            mode,
                            Mode::Recording { .. } | Mode::FollowupListening { .. }
                        ) {
                            active_phase_orch.store(0, Ordering::Relaxed);
                            if let Ok(mut sc) = latest_scores_orch.write() {
                                *sc = (0.0, 0.0);
                            }
                            if let Ok(mut rb) = ring_buffer_orch.write() {
                                rb.fill(0);
                            }
                            mode = Mode::Idle;
                            let _ = event_tx.send(InprocessEvent::Cancelled {
                                reason: "Cancelado pelo usuário via interface".into(),
                            });
                            cooldown_until = Instant::now() + cooldown_duration;
                        }
                    }

                    match &mut mode {
                        Mode::Idle => {
                            if in_cooldown {
                                if let Ok(mut sc) = latest_scores_orch.write() {
                                    *sc = (0.0, 0.0);
                                }
                                if let Ok(mut rb) = ring_buffer_orch.write() {
                                    rb.fill(0);
                                }
                            } else if detection_active && copernico_score >= active_th {
                                active_phase_orch.store(1, Ordering::Relaxed);

                                if let Ok(mut sc) = latest_scores_orch.write() {
                                    *sc = (0.0, 0.0);
                                }
                                if let Ok(mut rb) = ring_buffer_orch.write() {
                                    rb.fill(0);
                                }

                                let _ = event_tx.send(InprocessEvent::Started {
                                    score: copernico_score,
                                });

                                mode = Mode::Recording {
                                    buffer: Vec::new(),
                                    _start_time: Instant::now(),
                                    last_voice_time: Instant::now(),
                                };
                            }
                        }

                        Mode::Recording {
                            buffer,
                            _start_time: _,
                            last_voice_time,
                        } => {
                            buffer.extend_from_slice(&chunk);

                            if rms >= 0.008 {
                                *last_voice_time = Instant::now();
                            }

                            let is_silence_timeout =
                                last_voice_time.elapsed() >= silence_timeout_duration;
                            let zefiro_detected = zefiro_score >= active_th;

                            if is_silence_timeout {
                                active_phase_orch.store(0, Ordering::Relaxed);
                                if let Ok(mut sc) = latest_scores_orch.write() {
                                    *sc = (0.0, 0.0);
                                }
                                if let Ok(mut rb) = ring_buffer_orch.write() {
                                    rb.fill(0);
                                }
                                buffer.clear();
                                mode = Mode::Idle;

                                let _ = event_tx.send(InprocessEvent::Cancelled {
                                    reason: "17 segundos de silêncio contínuo após ativação".into(),
                                });

                                cooldown_until = Instant::now() + cooldown_duration;
                            } else if zefiro_detected {
                                let score = zefiro_score;

                                active_phase_orch.store(0, Ordering::Relaxed);
                                if let Ok(mut sc) = latest_scores_orch.write() {
                                    *sc = (0.0, 0.0);
                                }
                                if let Ok(mut rb) = ring_buffer_orch.write() {
                                    rb.fill(0);
                                }

                                let recorded_pcm = std::mem::take(buffer);
                                mode = Mode::Idle;

                                if let Ok(wav_bytes) = encode_pcm_to_wav(&recorded_pcm, sample_rate)
                                {
                                    let _ =
                                        event_tx.send(InprocessEvent::Stopped { score, wav_bytes });
                                }

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
                                    let _ = event_tx.send(InprocessEvent::Started { score: 1.0 });
                                }
                                *last_voice_time = Some(Instant::now());
                            }

                            if !*voice_detected {
                                if start_time.elapsed() >= *timeout_duration {
                                    active_phase_orch.store(0, Ordering::Relaxed);
                                    if let Ok(mut sc) = latest_scores_orch.write() {
                                        *sc = (0.0, 0.0);
                                    }
                                    if let Ok(mut rb) = ring_buffer_orch.write() {
                                        rb.fill(0);
                                    }
                                    buffer.clear();
                                    mode = Mode::Idle;

                                    let _ = event_tx.send(InprocessEvent::Cancelled {
                                        reason: "followup_timeout".into(),
                                    });
                                    cooldown_until = Instant::now() + cooldown_duration;
                                }
                            } else {
                                let post_speech_silence = last_voice_time
                                    .map(|t| t.elapsed() >= Duration::from_millis(3000))
                                    .unwrap_or(false);
                                let zefiro_detected = zefiro_score >= active_th;

                                if post_speech_silence || zefiro_detected {
                                    let score = if zefiro_detected { zefiro_score } else { 1.0 };

                                    active_phase_orch.store(0, Ordering::Relaxed);
                                    if let Ok(mut sc) = latest_scores_orch.write() {
                                        *sc = (0.0, 0.0);
                                    }
                                    if let Ok(mut rb) = ring_buffer_orch.write() {
                                        rb.fill(0);
                                    }

                                    let recorded_pcm = std::mem::take(buffer);
                                    mode = Mode::Idle;

                                    if let Ok(wav_bytes) =
                                        encode_pcm_to_wav(&recorded_pcm, sample_rate)
                                    {
                                        let _ = event_tx
                                            .send(InprocessEvent::Stopped { score, wav_bytes });
                                    }

                                    cooldown_until = Instant::now() + cooldown_duration;
                                }
                            }
                        }
                    }
                }
            })
            .map_err(|e| WakeWordError::Io(std::io::Error::other(e)))?;
    }

    Ok(InprocessWakeEngineHandle {
        is_running,
        control_tx,
    })
}
