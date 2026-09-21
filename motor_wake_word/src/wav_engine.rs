use std::collections::HashMap;
use std::path::Path;
use hound::{WavReader, SampleFormat};
use crate::engine::{DetectionEvent, WakeWordEngine};
use crate::error::WakeWordError;

/// Reads an entire WAV file and converts it into a mono 16-bit PCM vector (`Vec<i16>`).
pub fn read_wav_to_pcm16<P: AsRef<Path>>(path: P) -> Result<(Vec<i16>, u32), WakeWordError> {
    let mut reader = WavReader::open(path.as_ref())
        .map_err(|e| WakeWordError::Audio(format!("Failed to open WAV: {}", e)))?;

    let spec = reader.spec();
    let channels = spec.channels as usize;
    let sample_rate = spec.sample_rate;

    let pcm_mono = match (spec.sample_format, spec.bits_per_sample) {
        (SampleFormat::Int, 16) => {
            let samples: Result<Vec<i16>, _> = reader.samples::<i16>().collect();
            let raw = samples.map_err(|e| WakeWordError::Audio(format!("Error reading i16 samples: {}", e)))?;
            if channels == 1 {
                raw
            } else {
                // Downmix stereo/multichannel to mono
                raw.chunks_exact(channels)
                    .map(|chunk| {
                        let sum: i32 = chunk.iter().map(|&s| s as i32).sum();
                        (sum / channels as i32) as i16
                    })
                    .collect()
            }
        }
        (SampleFormat::Int, 32) => {
            let samples: Result<Vec<i32>, _> = reader.samples::<i32>().collect();
            let raw = samples.map_err(|e| WakeWordError::Audio(format!("Error reading i32 samples: {}", e)))?;
            if channels == 1 {
                raw.into_iter().map(|s| (s >> 16) as i16).collect()
            } else {
                raw.chunks_exact(channels)
                    .map(|chunk| {
                        let sum: i64 = chunk.iter().map(|&s| (s >> 16) as i64).sum();
                        (sum / channels as i64) as i16
                    })
                    .collect()
            }
        }
        (SampleFormat::Float, 32) => {
            let samples: Result<Vec<f32>, _> = reader.samples::<f32>().collect();
            let raw = samples.map_err(|e| WakeWordError::Audio(format!("Error reading float samples: {}", e)))?;
            if channels == 1 {
                raw.into_iter()
                    .map(|f| (f.clamp(-1.0, 1.0) * 32767.0) as i16)
                    .collect()
            } else {
                raw.chunks_exact(channels)
                    .map(|chunk| {
                        let avg: f32 = chunk.iter().sum::<f32>() / channels as f32;
                        (avg.clamp(-1.0, 1.0) * 32767.0) as i16
                    })
                    .collect()
            }
        }
        (fmt, bits) => {
            return Err(WakeWordError::Audio(format!(
                "Unsupported WAV format: {:?} with {} bits per sample",
                fmt, bits
            )));
        }
    };

    Ok((pcm_mono, sample_rate))
}

/// Runs streaming inference over a WAV file in simulated real-time chunks (e.g. 100ms step)
/// with cooldown debouncing across the audio timeline.
pub fn process_wav_file<P: AsRef<Path>>(
    engine: &mut WakeWordEngine,
    wav_path: P,
    chunk_samples: usize,
) -> Result<Vec<(f32, DetectionEvent)>, WakeWordError> {
    let (pcm_data, sample_rate) = read_wav_to_pcm16(wav_path)?;
    let mut detections_with_time = Vec::new();
    let mut last_detection_sec: HashMap<String, f32> = HashMap::new();

    let step = if chunk_samples > 0 { chunk_samples } else { 1600 }; // 100ms at 16kHz
    let mut offset = 0;
    let cooldown_sec = engine.config().cooldown.as_secs_f32();

    engine.reset();

    while offset < pcm_data.len() {
        let end = (offset + step).min(pcm_data.len());
        let chunk = &pcm_data[offset..end];

        let scores = engine.predict_raw(chunk)?;
        let audio_time_sec = offset as f32 / sample_rate as f32;

        for (keyword, score) in scores {
            if score >= engine.config().threshold {
                let is_on_cooldown = if let Some(last_sec) = last_detection_sec.get(&keyword) {
                    (audio_time_sec - last_sec) < cooldown_sec
                } else {
                    false
                };

                if !is_on_cooldown {
                    last_detection_sec.insert(keyword.clone(), audio_time_sec);
                    detections_with_time.push((
                        audio_time_sec,
                        DetectionEvent {
                            keyword,
                            score,
                            timestamp_ms: (audio_time_sec * 1000.0) as u64,
                        },
                    ));
                }
            }
        }

        offset += step;
    }

    Ok(detections_with_time)
}
