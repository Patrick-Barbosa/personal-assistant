use crossbeam_channel::{bounded, unbounded, Receiver, Sender};
use inferencia::start_mic_capture;
use std::sync::Arc;
use std::time::{Duration, Instant};

use super::wake_inprocess::encode_pcm_to_wav;

const MANUAL_SAMPLE_RATE: u32 = 16000;
const MANUAL_CHUNK: usize = 1600;
/// Hard cap so a forgotten recording can never build an unbounded IPC payload
/// (120s * 16kHz * 2B ≈ 3.8MB WAV).
const MANUAL_MAX_SECS: u64 = 120;

type StartReply = Sender<Result<(), String>>;
type StopReply = Sender<Result<Option<Vec<u8>>, String>>;

enum ManualCmd {
    Start { reply: StartReply },
    Stop { discard: bool, reply: StopReply },
    Shutdown,
}

/// Push-to-talk recorder owned by the Rust backend.
///
/// Rationale: the wake engine holds the OS microphone via `cpal`, and the
/// Tauri WebView (WebKitGTK on Linux) cannot reliably open the same device
/// through `getUserMedia` while it is held. Manual recording therefore taps
/// the same `cpal` path instead of the browser `MediaRecorder`. Callers must
/// pause the wake mic first (`set_wake_mic_enabled(false)`); the `start` /
/// `stop` commands in `bridge::commands` do that ordering internally.
///
/// Threading: `cpal::Stream` is `!Send`, so the stream is created, used and
/// dropped inside a dedicated owner thread. This struct (kept in Tauri
/// `State`, which requires `Send + Sync`) only holds channels.
pub struct ManualRecorder {
    cmd_tx: Sender<ManualCmd>,
}

pub type SharedManualRecorder = Arc<ManualRecorder>;

impl ManualRecorder {
    pub fn new() -> Self {
        let (cmd_tx, cmd_rx) = unbounded::<ManualCmd>();
        std::thread::Builder::new()
            .name("copernico-manual-recorder".into())
            .spawn(move || worker_loop(cmd_rx))
            .expect("Manual recorder worker thread must spawn");
        Self { cmd_tx }
    }

    /// Opens the microphone and starts buffering. Errors when a recording is
    /// already in progress or no input device exists. Never panics.
    pub fn start(&self) -> Result<(), String> {
        let (reply_tx, reply_rx) = bounded::<Result<(), String>>(1);
        if self
            .cmd_tx
            .send(ManualCmd::Start { reply: reply_tx })
            .is_err()
        {
            return Err("Gravador manual indisponível".to_string());
        }
        reply_rx
            .recv_timeout(Duration::from_secs(10))
            .unwrap_or(Err("Tempo esgotado ao abrir o microfone".to_string()))
    }

    /// Stops capture and returns WAV bytes (`None` when discarded or empty).
    pub fn stop(&self, discard: bool) -> Result<Option<Vec<u8>>, String> {
        let (reply_tx, reply_rx) = bounded::<Result<Option<Vec<u8>>, String>>(1);
        if self
            .cmd_tx
            .send(ManualCmd::Stop {
                discard,
                reply: reply_tx,
            })
            .is_err()
        {
            return Err("Gravador manual indisponível".to_string());
        }
        reply_rx
            .recv_timeout(Duration::from_secs(15))
            .unwrap_or(Err("Tempo esgotado ao finalizar gravação".to_string()))
    }
}

impl Drop for ManualRecorder {
    fn drop(&mut self) {
        let _ = self.cmd_tx.send(ManualCmd::Shutdown);
    }
}

impl Default for ManualRecorder {
    fn default() -> Self {
        Self::new()
    }
}

/// Currently recording state, owned by the worker thread only.
struct ActiveCapture {
    pcm_rx: Receiver<Vec<i16>>,
    // Stream handle kept alive for the whole capture; dropping it stops cpal.
    _handle: inferencia::MicCaptureHandle,
    chunks: Vec<Vec<i16>>,
    started_at: Instant,
}

fn worker_loop(cmd_rx: Receiver<ManualCmd>) {
    let mut active: Option<ActiveCapture> = None;

    loop {
        if active.is_none() {
            match cmd_rx.recv() {
                Ok(ManualCmd::Start { reply }) => {
                    let (pcm_tx, pcm_rx) = bounded::<Vec<i16>>(100);
                    match start_mic_capture(pcm_tx, MANUAL_CHUNK) {
                        Ok((handle, _sr)) => {
                            active = Some(ActiveCapture {
                                pcm_rx,
                                _handle: handle,
                                chunks: Vec::new(),
                                started_at: Instant::now(),
                            });
                            let _ = reply.send(Ok(()));
                        }
                        Err(e) => {
                            let _ = reply.send(Err(format!("Microfone indisponível: {:?}", e)));
                        }
                    }
                }
                Ok(ManualCmd::Stop { reply, .. }) => {
                    let _ = reply.send(Err("Nenhuma gravação manual em andamento".to_string()));
                }
                Ok(ManualCmd::Shutdown) | Err(_) => break,
            }
            continue;
        }

        // Actively recording: drain audio, watch for Stop / timeout / Shutdown.
        let timed_out = active
            .as_ref()
            .map(|a| a.started_at.elapsed() >= Duration::from_secs(MANUAL_MAX_SECS))
            .unwrap_or(false);
        if timed_out {
            let _ = finish_capture(&mut active, false);
            continue;
        }
        if let Some(a) = active.as_mut() {
            while let Ok(chunk) = a.pcm_rx.try_recv() {
                a.chunks.push(chunk);
            }
        }
        match cmd_rx.try_recv() {
            Ok(ManualCmd::Stop { discard, reply }) => {
                let _ = reply.send(finish_capture(&mut active, discard));
            }
            Ok(ManualCmd::Start { reply }) => {
                let _ = reply.send(Err("Já existe gravação manual em andamento".to_string()));
            }
            Ok(ManualCmd::Shutdown) => {
                let _ = finish_capture(&mut active, true);
                break;
            }
            Err(_) => {
                std::thread::sleep(Duration::from_millis(10));
            }
        }
    }
}

/// Drops the active capture (stopping cpal) and encodes buffered PCM.
/// Returns `Ok(None)` for discarded or empty captures.
fn finish_capture(
    active: &mut Option<ActiveCapture>,
    discard: bool,
) -> Result<Option<Vec<u8>>, String> {
    let mut session = match active.take() {
        Some(s) => s,
        None => return Err("Nenhuma gravação manual em andamento".to_string()),
    };
    // Drain anything that arrived just before the stop.
    while let Ok(chunk) = session.pcm_rx.try_recv() {
        session.chunks.push(chunk);
    }
    // Dropping `session` here stops the cpal stream (releases the device).
    let chunks = std::mem::take(&mut session.chunks);
    drop(session);

    if discard {
        return Ok(None);
    }
    let max_samples = (MANUAL_MAX_SECS as usize) * (MANUAL_SAMPLE_RATE as usize);
    let mut pcm: Vec<i16> = Vec::new();
    for c in &chunks {
        if pcm.len() >= max_samples {
            break;
        }
        let room = max_samples - pcm.len();
        pcm.extend_from_slice(&c[..c.len().min(room)]);
    }
    if pcm.is_empty() {
        return Ok(None);
    }
    encode_pcm_to_wav(&pcm, MANUAL_SAMPLE_RATE)
        .map(Some)
        .map_err(|e| format!("Falha ao codificar áudio: {}", e))
}
