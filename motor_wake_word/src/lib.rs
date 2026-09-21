//! # Módulo e Motores de Inferência para Detecção de Palavras de Ativação (LiveKit WakeWord)
//!
//! Este módulo fornece motores de inferência otimizados e modulares para execução em Rust puro:
//!
//! 1. `WakeWordEngine`: Motor síncrono/reentrante para predição direta com ONNX e debounce de cooldown.
//! 2. `WavEngine`: Utilitário para leitura e streaming de arquivos `.wav`.
//! 3. `MicEngine`: Captura de áudio de microfone em tempo real multiplataforma com `cpal`.
//! 4. `WakeWordWorker`: Template de worker desacoplado em thread separada com canais MPSC,
//!    ideal para integração imediata em servidores assíncronos (Tokio, Axum, Actix, WebSocket).

pub mod error;
pub mod engine;
pub mod wav_engine;
pub mod mic_engine;
pub mod worker;

pub use engine::{DetectionEvent, EngineConfig, WakeWordEngine};
pub use error::WakeWordError;
pub use mic_engine::{start_mic_capture, MicCaptureHandle};
pub use wav_engine::{process_wav_file, read_wav_to_pcm16};
pub use worker::{WakeWordWorker, WorkerCommand};
pub use livekit_wakeword::wakeword::WakeWordModel;

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn resolve_test_models() -> Vec<std::path::PathBuf> {
        ["copernico.onnx", "zefiro.onnx"]
            .iter()
            .map(|name| {
                let in_models = std::path::PathBuf::from("models").join(name);
                if in_models.exists() {
                    in_models
                } else {
                    std::path::PathBuf::from(name)
                }
            })
            .collect()
    }

    #[test]
    fn test_engine_initialization_and_predict() {
        let config = EngineConfig {
            threshold: 0.5,
            cooldown: Duration::from_millis(1000),
            sample_rate: 16000,
            window_duration_ms: 2000,
        };

        let models = resolve_test_models();
        let mut engine = WakeWordEngine::with_config(
            &models,
            config,
        )
        .expect("Failed to initialize engine");

        assert_eq!(engine.model_names(), &["copernico", "zefiro"]);

        let silent_chunk = vec![0i16; 1600];
        let raw = engine.predict_raw(&silent_chunk).expect("predict failed");
        assert!(raw.contains_key("copernico"));
        assert!(raw.contains_key("zefiro"));

        let events = engine.process_audio(&silent_chunk).expect("process failed");
        assert!(events.is_empty(), "Silence should trigger 0 events");
    }

    #[test]
    fn test_worker_thread_lifecycle() {
        let models = resolve_test_models();
        let worker = WakeWordWorker::spawn(models, EngineConfig::default())
            .expect("Failed to spawn worker");

        assert!(worker.is_alive());

        // Send a chunk of audio
        worker.send_audio(vec![0i16; 1600]).expect("send failed");

        // Give a moment for processing
        std::thread::sleep(Duration::from_millis(50));

        let event = worker.try_recv_event();
        assert!(event.is_none());
    }

    #[test]
    fn test_wav_predictions() {
        let path = "../treinamento/2_coleta_dados/dados/positivos/copernico/positivo_0001.wav";
        if !std::path::Path::new(path).exists() {
            println!("Skipping wav prediction test: training file not present");
            return;
        }
        let (pcm, sr) = wav_engine::read_wav_to_pcm16(path)
            .expect("read wav failed");
        println!("Loaded wav: len={}, sr={}", pcm.len(), sr);

        // Test with full wav
        let mut model = WakeWordModel::new(&["copernico.onnx", "lich.onnx"], sr).unwrap();
        let scores_full = model.predict(&pcm).unwrap();
        println!("Full 32000 samples score: {:?}", scores_full);

        // Test streaming in chunks of 1600 (100ms)
        let mut model_stream = WakeWordModel::new(&["copernico.onnx", "lich.onnx"], sr).unwrap();
        for (i, chunk) in pcm.chunks(1600).enumerate() {
            let scores = model_stream.predict(chunk).unwrap();
            let c_score = scores.get("copernico").copied().unwrap_or(0.0);
            if c_score > 0.1 {
                println!("Chunk {} ({}ms): copernico = {}", i, i * 100, c_score);
            }
        }
    }
}
