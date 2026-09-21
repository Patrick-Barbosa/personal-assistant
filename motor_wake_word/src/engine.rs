use std::collections::{HashMap, VecDeque};
use std::path::Path;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use serde::{Deserialize, Serialize};

use livekit_wakeword::wakeword::WakeWordModel;
use crate::error::WakeWordError;

/// Configuration parameters for the wake word inference engine.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineConfig {
    /// Activation score threshold between 0.0 and 1.0 (default: 0.50).
    pub threshold: f32,
    /// Cooldown window after a detection to avoid duplicate triggers for the same word.
    pub cooldown: Duration,
    /// Sample rate of input audio (e.g. 16000). The model resamples internally if necessary.
    pub sample_rate: u32,
    /// Rolling audio window duration in milliseconds for the acoustic model context (default: 2000 ms).
    pub window_duration_ms: u32,
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self {
            threshold: 0.50,
            cooldown: Duration::from_millis(1500),
            sample_rate: 16000,
            window_duration_ms: 2000,
        }
    }
}

/// Information about a detected wake word event.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DetectionEvent {
    /// Name/keyword of the detected model (e.g. "copernico", "lich").
    pub keyword: String,
    /// Confidence probability (0.0 to 1.0).
    pub score: f32,
    /// Unix timestamp in milliseconds when the detection occurred.
    pub timestamp_ms: u64,
}

/// Core Wake Word Inference Engine wrapping the underlying ONNX model(s)
/// with a sliding ring buffer for continuous streaming inference.
pub struct WakeWordEngine {
    model: WakeWordModel,
    config: EngineConfig,
    window_samples: usize,
    audio_buffer: VecDeque<i16>,
    contiguous_window: Vec<i16>,
    last_trigger_times: HashMap<String, Instant>,
    model_names: Vec<String>,
}

impl WakeWordEngine {
    /// Initializes the engine with default configuration and the provided model paths.
    pub fn new<P: AsRef<Path>>(model_paths: &[P], sample_rate: u32) -> Result<Self, WakeWordError> {
        let mut config = EngineConfig::default();
        config.sample_rate = sample_rate;
        Self::with_config(model_paths, config)
    }

    /// Initializes the engine with custom configuration and sliding audio window.
    pub fn with_config<P: AsRef<Path>>(
        model_paths: &[P],
        config: EngineConfig,
    ) -> Result<Self, WakeWordError> {
        if model_paths.empty_or_zero() {
            return Err(WakeWordError::ModelLoad("No model paths provided".into()));
        }

        let mut path_strs: Vec<String> = Vec::new();
        let mut names: Vec<String> = Vec::new();

        for p in model_paths {
            let path = p.as_ref();
            if !path.exists() {
                return Err(WakeWordError::ModelLoad(format!(
                    "Model file not found: {}",
                    path.display()
                )));
            }
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                names.push(stem.to_string());
            }
            path_strs.push(path.to_string_lossy().to_string());
        }

        let str_slices: Vec<&str> = path_strs.iter().map(|s| s.as_str()).collect();

        let model = WakeWordModel::new(&str_slices, config.sample_rate)
            .map_err(|e| WakeWordError::ModelLoad(format!("{:?}", e)))?;

        let window_samples = (config.sample_rate as usize * config.window_duration_ms as usize) / 1000;
        let mut audio_buffer = VecDeque::with_capacity(window_samples);
        audio_buffer.resize(window_samples, 0i16);

        Ok(Self {
            model,
            config,
            window_samples,
            audio_buffer,
            contiguous_window: vec![0i16; window_samples],
            last_trigger_times: HashMap::new(),
            model_names: names,
        })
    }

    /// Feeds PCM audio data into the sliding window and computes raw prediction scores.
    pub fn predict_raw(&mut self, pcm: &[i16]) -> Result<HashMap<String, f32>, WakeWordError> {
        if pcm.len() >= self.window_samples {
            let slice = &pcm[pcm.len() - self.window_samples..];
            self.model
                .predict(slice)
                .map_err(|e| WakeWordError::Inference(format!("{:?}", e)))
        } else {
            for &sample in pcm {
                self.audio_buffer.pop_front();
                self.audio_buffer.push_back(sample);
            }

            let (slice1, slice2) = self.audio_buffer.as_slices();
            self.contiguous_window.clear();
            self.contiguous_window.extend_from_slice(slice1);
            self.contiguous_window.extend_from_slice(slice2);

            self.model
                .predict(&self.contiguous_window)
                .map_err(|e| WakeWordError::Inference(format!("{:?}", e)))
        }
    }

    /// Feeds PCM audio data (any chunk size), evaluates scores against the threshold,
    /// applies cooldown debouncing, and returns any triggered events.
    pub fn process_audio(&mut self, pcm: &[i16]) -> Result<Vec<DetectionEvent>, WakeWordError> {
        let scores = self.predict_raw(pcm)?;
        let now = Instant::now();
        let now_epoch_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        let mut events = Vec::new();

        for (keyword, score) in scores {
            if score >= self.config.threshold {
                let is_on_cooldown = if let Some(last_time) = self.last_trigger_times.get(&keyword) {
                    now.duration_since(*last_time) < self.config.cooldown
                } else {
                    false
                };

                if !is_on_cooldown {
                    self.last_trigger_times.insert(keyword.clone(), now);
                    events.push(DetectionEvent {
                        keyword,
                        score,
                        timestamp_ms: now_epoch_ms,
                    });
                }
            }
        }

        Ok(events)
    }

    /// Returns the list of model keywords handled by this engine.
    pub fn model_names(&self) -> &[String] {
        &self.model_names
    }

    /// Returns the current configuration.
    pub fn config(&self) -> &EngineConfig {
        &self.config
    }

    /// Dynamically update the detection threshold.
    pub fn set_threshold(&mut self, threshold: f32) {
        self.config.threshold = threshold.clamp(0.01, 0.99);
    }

    /// Reset internal debounce timers and audio buffer.
    pub fn reset(&mut self) {
        self.last_trigger_times.clear();
        self.audio_buffer.clear();
        self.audio_buffer.resize(self.window_samples, 0i16);
    }

    /// Reset internal debounce timers only.
    pub fn reset_cooldowns(&mut self) {
        self.last_trigger_times.clear();
    }
}

trait EmptyOrZero {
    fn empty_or_zero(&self) -> bool;
}

impl<T> EmptyOrZero for [T] {
    fn empty_or_zero(&self) -> bool {
        self.is_empty()
    }
}
