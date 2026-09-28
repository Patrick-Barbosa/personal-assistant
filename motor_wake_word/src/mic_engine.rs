use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, Stream, StreamConfig};
use crossbeam_channel::Sender;

use crate::error::WakeWordError;

/// Handle to a running microphone stream. Drop or call `stop()` to terminate capture.
pub struct MicCaptureHandle {
    #[allow(dead_code)]
    stream: Stream,
    is_running: Arc<AtomicBool>,
}

impl MicCaptureHandle {
    pub fn is_running(&self) -> bool {
        self.is_running.load(Ordering::Relaxed)
    }

    pub fn stop(&self) {
        self.is_running.store(false, Ordering::Relaxed);
    }
}

struct ResamplerTo16k {
    step: f64,
    frac: f64,
    prev_sample: f32,
}

impl ResamplerTo16k {
    fn new(input_rate: u32) -> Self {
        Self {
            step: input_rate as f64 / 16000.0,
            frac: 0.0,
            prev_sample: 0.0,
        }
    }

    #[inline(always)]
    fn push_sample(&mut self, current: f32, output: &mut Vec<i16>) {
        if (self.step - 1.0).abs() < 0.001 {
            let s16 = (current.clamp(-1.0, 1.0) * 32767.0) as i16;
            output.push(s16);
            return;
        }

        while self.frac < 1.0 {
            let interpolated = self.prev_sample + (current - self.prev_sample) * (self.frac as f32);
            let s16 = (interpolated.clamp(-1.0, 1.0) * 32767.0) as i16;
            output.push(s16);
            self.frac += self.step;
        }
        self.frac -= 1.0;
        self.prev_sample = current;
    }
}

#[inline(always)]
fn extract_mono_sample_f32(frame: &[f32]) -> f32 {
    if frame.len() == 1 {
        frame[0]
    } else if frame.len() == 2 {
        let a = frame[0];
        let b = frame[1];
        if a.abs() >= b.abs() {
            a
        } else {
            b
        }
    } else {
        let mut best = 0.0f32;
        let mut max_abs = 0.0f32;
        for &s in frame {
            let abs = s.abs();
            if abs > max_abs {
                max_abs = abs;
                best = s;
            }
        }
        best
    }
}

#[inline(always)]
fn extract_mono_sample_i16(frame: &[i16]) -> f32 {
    if frame.len() == 1 {
        frame[0] as f32 / 32768.0
    } else if frame.len() == 2 {
        let a = frame[0] as f32 / 32768.0;
        let b = frame[1] as f32 / 32768.0;
        if a.abs() >= b.abs() {
            a
        } else {
            b
        }
    } else {
        let mut best = 0.0f32;
        let mut max_abs = 0.0f32;
        for &s in frame {
            let f = s as f32 / 32768.0;
            let abs = f.abs();
            if abs > max_abs {
                max_abs = abs;
                best = f;
            }
        }
        best
    }
}

/// Starts an asynchronous microphone capture stream, delivering mono 16000 Hz `i16` PCM chunks through a channel.
/// Always normalizes hardware input sample rate to 16000 Hz so inference runs with zero latency overhead.
pub fn start_mic_capture(
    pcm_sender: Sender<Vec<i16>>,
    target_output_chunk: usize,
) -> Result<(MicCaptureHandle, u32), WakeWordError> {
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| WakeWordError::Microphone("No default microphone input device found".into()))?;

    let default_config = device
        .default_input_config()
        .map_err(|e| WakeWordError::Microphone(format!("Failed to query default mic config: {}", e)))?;

    let hw_sample_rate = default_config.sample_rate().0;
    let channels = default_config.channels() as usize;
    let sample_format = default_config.sample_format();

    // 1600 amostras a 16kHz = exatamente 100ms
    let chunk_size_16k = if target_output_chunk == 0 { 1600 } else { target_output_chunk };

    let config: StreamConfig = default_config.into();
    let is_running = Arc::new(AtomicBool::new(true));
    let is_running_clone = Arc::clone(&is_running);

    let mut resampler = ResamplerTo16k::new(hw_sample_rate);
    let mut buffer: Vec<i16> = Vec::with_capacity(chunk_size_16k * 2);

    let err_fn = |err| {
        let s = format!("{:?}", err);
        if !s.contains("Xrun") {
            eprintln!("[Microphone Stream Error]: {}", s);
        }
    };

    let stream = match sample_format {
        SampleFormat::F32 => {
            let sender = pcm_sender.clone();
            let running = Arc::clone(&is_running_clone);

            device.build_input_stream(
                &config,
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    if !running.load(Ordering::Relaxed) {
                        return;
                    }

                    for frame in data.chunks_exact(channels) {
                        let sample = extract_mono_sample_f32(frame);
                        resampler.push_sample(sample, &mut buffer);

                        if buffer.len() >= chunk_size_16k {
                            let _ = sender.send(buffer.clone());
                            buffer.clear();
                        }
                    }
                },
                err_fn,
                None,
            )
        }
        SampleFormat::I16 => {
            let sender = pcm_sender.clone();
            let running = Arc::clone(&is_running_clone);

            device.build_input_stream(
                &config,
                move |data: &[i16], _: &cpal::InputCallbackInfo| {
                    if !running.load(Ordering::Relaxed) {
                        return;
                    }

                    for frame in data.chunks_exact(channels) {
                        let sample = extract_mono_sample_i16(frame);
                        resampler.push_sample(sample, &mut buffer);

                        if buffer.len() >= chunk_size_16k {
                            let _ = sender.send(buffer.clone());
                            buffer.clear();
                        }
                    }
                },
                err_fn,
                None,
            )
        }
        _ => {
            return Err(WakeWordError::Microphone(format!(
                "Unsupported microphone sample format: {:?}",
                sample_format
            )));
        }
    }
    .map_err(|e| WakeWordError::Microphone(format!("Failed to build input stream: {}", e)))?;

    stream
        .play()
        .map_err(|e| WakeWordError::Microphone(format!("Failed to start microphone stream: {}", e)))?;

    // Retorna 16000 Hz, que é a taxa garantida do fluxo PCM entregue
    Ok((
        MicCaptureHandle {
            stream,
            is_running,
        },
        16000,
    ))
}
