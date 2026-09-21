use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use crossbeam_channel::{bounded, unbounded, Receiver, Sender};

use crate::engine::{DetectionEvent, EngineConfig, WakeWordEngine};
use crate::error::WakeWordError;

/// Commands that can be sent to the background wake word worker thread.
pub enum WorkerCommand {
    AudioChunk(Vec<i16>),
    SetThreshold(f32),
    ResetCooldowns,
    Stop,
}

/// A decoupled background worker thread template.
///
/// Ideal for embedding in asynchronous environments (Tokio, Axum, Actix, gRPC, WebSocket),
/// where inference is offloaded to a dedicated CPU thread without blocking the async runtime.
pub struct WakeWordWorker {
    cmd_sender: Sender<WorkerCommand>,
    event_receiver: Receiver<DetectionEvent>,
    thread_handle: Option<JoinHandle<Result<(), WakeWordError>>>,
    is_alive: Arc<AtomicBool>,
}

impl WakeWordWorker {
    /// Spawns the worker thread with the given ONNX model paths and configuration.
    pub fn spawn(
        model_paths: Vec<PathBuf>,
        config: EngineConfig,
    ) -> Result<Self, WakeWordError> {
        let (cmd_tx, cmd_rx) = unbounded::<WorkerCommand>();
        let (event_tx, event_rx) = bounded::<DetectionEvent>(100);

        let is_alive = Arc::new(AtomicBool::new(true));
        let is_alive_clone = Arc::clone(&is_alive);

        let handle = thread::Builder::new()
            .name("wakeword-inference-worker".into())
            .spawn(move || {
                let mut engine = WakeWordEngine::with_config(&model_paths, config)?;

                while let Ok(cmd) = cmd_rx.recv() {
                    match cmd {
                        WorkerCommand::AudioChunk(pcm) => {
                            let events = engine.process_audio(&pcm)?;
                            for ev in events {
                                let _ = event_tx.try_send(ev);
                            }
                        }
                        WorkerCommand::SetThreshold(th) => {
                            engine.set_threshold(th);
                        }
                        WorkerCommand::ResetCooldowns => {
                            engine.reset_cooldowns();
                        }
                        WorkerCommand::Stop => {
                            break;
                        }
                    }
                }

                is_alive_clone.store(false, Ordering::Relaxed);
                Ok(())
            })
            .map_err(|e| WakeWordError::Inference(format!("Failed to spawn worker thread: {}", e)))?;

        Ok(Self {
            cmd_sender: cmd_tx,
            event_receiver: event_rx,
            thread_handle: Some(handle),
            is_alive,
        })
    }

    /// Enqueue a PCM audio chunk for inference.
    pub fn send_audio(&self, pcm: Vec<i16>) -> Result<(), WakeWordError> {
        self.cmd_sender
            .send(WorkerCommand::AudioChunk(pcm))
            .map_err(|_| WakeWordError::Inference("Worker thread has terminated".into()))
    }

    /// Dynamically adjust the activation threshold.
    pub fn set_threshold(&self, threshold: f32) -> Result<(), WakeWordError> {
        self.cmd_sender
            .send(WorkerCommand::SetThreshold(threshold))
            .map_err(|_| WakeWordError::Inference("Worker thread has terminated".into()))
    }

    /// Check for incoming detection events non-blockingly.
    pub fn try_recv_event(&self) -> Option<DetectionEvent> {
        self.event_receiver.try_recv().ok()
    }

    /// Cloneable receiver to wait or listen for detection events.
    pub fn event_receiver(&self) -> Receiver<DetectionEvent> {
        self.event_receiver.clone()
    }

    /// Checks if the worker thread is currently running.
    pub fn is_alive(&self) -> bool {
        self.is_alive.load(Ordering::Relaxed)
    }

    /// Signals the background thread to stop.
    pub fn stop(&mut self) {
        let _ = self.cmd_sender.send(WorkerCommand::Stop);
        if let Some(handle) = self.thread_handle.take() {
            let _ = handle.join();
        }
    }
}

impl Drop for WakeWordWorker {
    fn drop(&mut self) {
        self.stop();
    }
}
