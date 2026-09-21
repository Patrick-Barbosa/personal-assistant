use crate::llm::strip_markdown_for_tts;
use msedge_tts::tts::client::tokio_runtime::connect_async;
use msedge_tts::tts::SpeechConfig;
use msedge_tts::voice::tokio_runtime::get_voices_list_async;
use rodio::{Decoder, OutputStream, Sink};
use std::io::Cursor;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

pub use crate::domain::models::{TtsBenchmarkResult, VoiceInfo};

pub const DEFAULT_TTS_VOICE: &str = "pt-BR-ThalitaNeural";

/// Divide o texto em blocos naturais de fala (sentenças), permitindo síntese e reprodução incremental (pipelined)
pub fn split_text_into_speech_chunks(text: &str) -> Vec<String> {
    let clean = strip_markdown_for_tts(text);
    let trimmed = clean.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }

    // Se o texto for curto, mantém como bloco único
    if trimmed.len() <= 90 {
        return vec![trimmed.to_string()];
    }

    let mut chunks = Vec::new();
    let mut current = String::new();
    let chars: Vec<char> = trimmed.chars().collect();
    let total = chars.len();
    let mut i = 0;

    while i < total {
        let ch = chars[i];
        current.push(ch);

        let is_sentence_end = match ch {
            '.' => {
                let prev_digit = i > 0 && chars[i - 1].is_ascii_digit();
                let next_digit = i + 1 < total && chars[i + 1].is_ascii_digit();
                let next_dot = i + 1 < total && chars[i + 1] == '.';
                !prev_digit && !next_digit && !next_dot
            }
            '!' | '?' | '\n' => true,
            ':' | ';' if current.len() >= 40 => true,
            _ => false,
        };

        if is_sentence_end {
            let part = current.trim();
            if part.len() >= 18 || i + 1 == total {
                chunks.push(part.to_string());
                current.clear();
            }
        }

        i += 1;
    }

    let remainder = current.trim();
    if !remainder.is_empty() {
        if let Some(last) = chunks.last_mut() {
            if remainder.len() < 20 {
                last.push(' ');
                last.push_str(remainder);
            } else {
                chunks.push(remainder.to_string());
            }
        } else {
            chunks.push(remainder.to_string());
        }
    }

    chunks
}

pub fn get_curated_ptbr_voices() -> Vec<VoiceInfo> {
    vec![
        VoiceInfo {
            name: "Microsoft Server Speech Text to Speech Voice (pt-BR, ThalitaNeural)".into(),
            short_name: "pt-BR-ThalitaNeural".into(),
            gender: "Female".into(),
            locale: "pt-BR".into(),
            friendly_name: "Thalita (Expressiva e Ágil)".into(),
        },
        VoiceInfo {
            name: "Microsoft Server Speech Text to Speech Voice (pt-BR, FranciscaNeural)".into(),
            short_name: "pt-BR-FranciscaNeural".into(),
            gender: "Female".into(),
            locale: "pt-BR".into(),
            friendly_name: "Francisca (Acolhedora e Natural)".into(),
        },
        VoiceInfo {
            name: "Microsoft Server Speech Text to Speech Voice (pt-BR, AntonioNeural)".into(),
            short_name: "pt-BR-AntonioNeural".into(),
            gender: "Male".into(),
            locale: "pt-BR".into(),
            friendly_name: "Antônio (Calmo e Confiante)".into(),
        },
        VoiceInfo {
            name: "Microsoft Server Speech Text to Speech Voice (pt-BR, DonatoNeural)".into(),
            short_name: "pt-BR-DonatoNeural".into(),
            gender: "Male".into(),
            locale: "pt-BR".into(),
            friendly_name: "Donato (Formal e Claro)".into(),
        },
        VoiceInfo {
            name: "Microsoft Server Speech Text to Speech Voice (pt-BR, ElzaNeural)".into(),
            short_name: "pt-BR-ElzaNeural".into(),
            gender: "Female".into(),
            locale: "pt-BR".into(),
            friendly_name: "Elza (Narrativa)".into(),
        },
        VoiceInfo {
            name: "Microsoft Server Speech Text to Speech Voice (pt-BR, FabioNeural)".into(),
            short_name: "pt-BR-FabioNeural".into(),
            gender: "Male".into(),
            locale: "pt-BR".into(),
            friendly_name: "Fábio (Jovem)".into(),
        },
        VoiceInfo {
            name: "Microsoft Server Speech Text to Speech Voice (pt-BR, GiovannaNeural)".into(),
            short_name: "pt-BR-GiovannaNeural".into(),
            gender: "Female".into(),
            locale: "pt-BR".into(),
            friendly_name: "Giovanna (Suave)".into(),
        },
        VoiceInfo {
            name: "Microsoft Server Speech Text to Speech Voice (pt-BR, HumbertoNeural)".into(),
            short_name: "pt-BR-HumbertoNeural".into(),
            gender: "Male".into(),
            locale: "pt-BR".into(),
            friendly_name: "Humberto (Grave)".into(),
        },
        VoiceInfo {
            name: "Microsoft Server Speech Text to Speech Voice (pt-BR, JulioNeural)".into(),
            short_name: "pt-BR-JulioNeural".into(),
            gender: "Male".into(),
            locale: "pt-BR".into(),
            friendly_name: "Júlio (Conversacional)".into(),
        },
        VoiceInfo {
            name: "Microsoft Server Speech Text to Speech Voice (pt-BR, LeilaNeural)".into(),
            short_name: "pt-BR-LeilaNeural".into(),
            gender: "Female".into(),
            locale: "pt-BR".into(),
            friendly_name: "Leila (Direta)".into(),
        },
        VoiceInfo {
            name: "Microsoft Server Speech Text to Speech Voice (pt-BR, LeticiaNeural)".into(),
            short_name: "pt-BR-LeticiaNeural".into(),
            gender: "Female".into(),
            locale: "pt-BR".into(),
            friendly_name: "Letícia (Espontânea)".into(),
        },
        VoiceInfo {
            name: "Microsoft Server Speech Text to Speech Voice (pt-BR, ManuelaNeural)".into(),
            short_name: "pt-BR-ManuelaNeural".into(),
            gender: "Female".into(),
            locale: "pt-BR".into(),
            friendly_name: "Manuela (Moderna)".into(),
        },
        VoiceInfo {
            name: "Microsoft Server Speech Text to Speech Voice (pt-BR, NicolauNeural)".into(),
            short_name: "pt-BR-NicolauNeural".into(),
            gender: "Male".into(),
            locale: "pt-BR".into(),
            friendly_name: "Nicolau (Madura)".into(),
        },
        VoiceInfo {
            name: "Microsoft Server Speech Text to Speech Voice (pt-BR, ValerioNeural)".into(),
            short_name: "pt-BR-ValerioNeural".into(),
            gender: "Male".into(),
            locale: "pt-BR".into(),
            friendly_name: "Valério (Institucional)".into(),
        },
        VoiceInfo {
            name: "Microsoft Server Speech Text to Speech Voice (pt-BR, YaraNeural)".into(),
            short_name: "pt-BR-YaraNeural".into(),
            gender: "Female".into(),
            locale: "pt-BR".into(),
            friendly_name: "Yara (Agradável)".into(),
        },
    ]
}

#[derive(Clone)]
pub struct EdgeTtsClient {
    current_sink: Arc<Mutex<Option<Arc<Sink>>>>,
    default_voice: Arc<Mutex<String>>,
    is_speaking: Arc<AtomicBool>,
    playback_token: Arc<AtomicU64>,
}

impl EdgeTtsClient {
    pub fn new(default_voice: &str) -> Self {
        let _ = rustls::crypto::ring::default_provider().install_default();
        Self {
            current_sink: Arc::new(Mutex::new(None)),
            default_voice: Arc::new(Mutex::new(default_voice.to_string())),
            is_speaking: Arc::new(AtomicBool::new(false)),
            playback_token: Arc::new(AtomicU64::new(0)),
        }
    }

    pub fn set_voice(&self, voice: &str) {
        if let Ok(mut lock) = self.default_voice.lock() {
            *lock = voice.to_string();
        }
    }

    pub fn get_voice(&self) -> String {
        self.default_voice
            .lock()
            .map(|g| g.clone())
            .unwrap_or_else(|_| DEFAULT_TTS_VOICE.to_string())
    }

    pub fn is_speaking(&self) -> bool {
        self.is_speaking.load(Ordering::SeqCst)
    }

    /// Interrompe imediatamente qualquer síntese e reprodução de áudio em andamento.
    pub fn stop(&self) {
        self.playback_token.fetch_add(1, Ordering::SeqCst);
        self.is_speaking.store(false, Ordering::SeqCst);
        if let Ok(mut lock) = self.current_sink.lock() {
            if let Some(sink) = lock.take() {
                sink.stop();
            }
        }
        println!("[TTS] Reprodução de áudio interrompida.");
    }

    /// Interrompe a reprodução com um fade out suave de volume (evitando estalos ou interrupções bruscas).
    pub fn fade_out_and_stop(&self, duration_ms: u64) {
        self.playback_token.fetch_add(1, Ordering::SeqCst);
        self.is_speaking.store(false, Ordering::SeqCst);
        let sink_opt = self
            .current_sink
            .lock()
            .ok()
            .and_then(|mut lock| lock.take());
        if let Some(sink) = sink_opt {
            let dur = if duration_ms == 0 { 200 } else { duration_ms };
            std::thread::spawn(move || {
                let steps = 10;
                let step_ms = (dur / steps).max(10);
                for i in (0..=steps).rev() {
                    let vol = (i as f32) / (steps as f32);
                    sink.set_volume(vol);
                    std::thread::sleep(std::time::Duration::from_millis(step_ms));
                }
                sink.stop();
            });
        }
        println!("[TTS] Fade out acionado ({}ms).", duration_ms);
    }

    /// Sintetiza texto para bytes de áudio MP3 utilizando o serviço Edge TTS.
    pub async fn synthesize(
        &self,
        text: &str,
        voice: Option<&str>,
    ) -> Result<Vec<u8>, Box<dyn std::error::Error + Send + Sync>> {
        let voice_name = voice.map(String::from).unwrap_or_else(|| self.get_voice());

        let config = SpeechConfig {
            voice_name,
            audio_format: "audio-24khz-48kbitrate-mono-mp3".to_string(),
            pitch: 0,
            rate: 0,
            volume: 0,
        };

        let mut client = connect_async().await?;
        let audio = client.synthesize(text, &config).await?;
        Ok(audio.audio_bytes)
    }

    /// Executa um teste de velocidade e benchmark da síntese TTS
    pub async fn benchmark(
        &self,
        text: Option<&str>,
        voice: Option<&str>,
    ) -> Result<TtsBenchmarkResult, Box<dyn std::error::Error + Send + Sync>> {
        let sample = text.unwrap_or(
            "Copérnico é um assistente pessoal local e inteligente. Ele organiza suas ideias, conecta seus conhecimentos e ajuda a acelerar suas tarefas diárias com alta velocidade e privacidade."
        );
        let clean = strip_markdown_for_tts(sample);
        let chunks = split_text_into_speech_chunks(&clean);
        let voice_name = voice.unwrap_or(&self.get_voice()).to_string();

        let start = std::time::Instant::now();
        let mut first_audio_ms = 0;
        let mut total_bytes = 0;

        for (idx, chunk) in chunks.iter().enumerate() {
            let bytes = self.synthesize(chunk, Some(&voice_name)).await?;
            if idx == 0 {
                first_audio_ms = start.elapsed().as_millis() as u64;
            }
            total_bytes += bytes.len();
        }

        let total_ms = start.elapsed().as_millis() as u64;
        let chars_per_sec = if total_ms > 0 {
            (clean.len() as f64) / (total_ms as f64 / 1000.0)
        } else {
            0.0
        };

        Ok(TtsBenchmarkResult {
            text: clean,
            voice: voice_name,
            total_chars: sample.len(),
            chunks_count: chunks.len(),
            time_to_first_audio_ms: first_audio_ms,
            total_synthesis_time_ms: total_ms,
            audio_bytes_len: total_bytes,
            chars_per_second: (chars_per_sec * 10.0).round() / 10.0,
        })
    }

    /// Limpa o markdown, divide em sentenças e reproduz em streaming sequencial (pipelined).
    /// A reprodução da primeira sentença começa imediatamente enquanto as seguintes são sintetizadas em background.
    pub async fn speak_text(
        &self,
        text: &str,
        voice: Option<&str>,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let chunks = split_text_into_speech_chunks(text);
        if chunks.is_empty() {
            return Ok(());
        }

        let voice_name = voice.unwrap_or(&self.get_voice()).to_string();
        let token = self.playback_token.fetch_add(1, Ordering::SeqCst) + 1;
        self.is_speaking.store(true, Ordering::SeqCst);

        let start_total = std::time::Instant::now();
        println!(
            "[TTS Pipeline] Iniciando reprodução ({} parte(s), voz: {})...",
            chunks.len(),
            voice_name
        );

        // Canal sincronizado para transmitir áudios gerados incrementalmente para a thread de áudio
        let (audio_tx, audio_rx) = std::sync::mpsc::channel::<Option<Vec<u8>>>();

        let sink_slot = self.current_sink.clone();
        let is_speaking = self.is_speaking.clone();
        let playback_token = self.playback_token.clone();

        // Spawn da thread consumidora de áudio Rodio
        let playback_handle = tokio::task::spawn_blocking(
            move || -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
                let (_stream, stream_handle) = OutputStream::try_default()?;
                let sink = Arc::new(Sink::try_new(&stream_handle)?);

                if let Ok(mut lock) = sink_slot.lock() {
                    if playback_token.load(Ordering::SeqCst) != token {
                        is_speaking.store(false, Ordering::SeqCst);
                        return Ok(());
                    }
                    *lock = Some(sink.clone());
                }

                while let Ok(msg) = audio_rx.recv() {
                    if playback_token.load(Ordering::SeqCst) != token {
                        break;
                    }

                    match msg {
                        Some(audio_bytes) => {
                            let cursor = Cursor::new(audio_bytes);
                            if let Ok(source) = Decoder::new(cursor) {
                                sink.append(source);
                            }
                        }
                        None => {
                            break;
                        }
                    }
                }

                // Aguarda o término da reprodução de todas as partes enfileiradas
                if playback_token.load(Ordering::SeqCst) == token {
                    sink.sleep_until_end();
                }

                if let Ok(mut lock) = sink_slot.lock() {
                    *lock = None;
                }
                is_speaking.store(false, Ordering::SeqCst);

                Ok(())
            },
        );

        // Tarefa assíncrona sintetizando chunk a chunk
        let mut first_chunk_sent = false;
        for (idx, chunk) in chunks.iter().enumerate() {
            if self.playback_token.load(Ordering::SeqCst) != token {
                println!(
                    "[TTS Pipeline] Cancelamento detectado antes do chunk {}",
                    idx + 1
                );
                break;
            }

            let start_chunk = std::time::Instant::now();
            match self.synthesize(chunk, Some(&voice_name)).await {
                Ok(bytes) => {
                    let chunk_duration = start_chunk.elapsed();
                    if !first_chunk_sent {
                        first_chunk_sent = true;
                        println!(
                            "[TTS Pipeline] Primeiro áudio pronto em {:?}! ({} caracteres)",
                            start_total.elapsed(),
                            chunk.len()
                        );
                    } else {
                        println!(
                            "[TTS Pipeline] Chunk {}/{} sintetizado em {:?} ({} chars)",
                            idx + 1,
                            chunks.len(),
                            chunk_duration,
                            chunk.len()
                        );
                    }

                    if self.playback_token.load(Ordering::SeqCst) != token {
                        break;
                    }

                    let _ = audio_tx.send(Some(bytes));
                }
                Err(err) => {
                    eprintln!(
                        "[TTS Pipeline] Erro ao sintetizar chunk {}: {}",
                        idx + 1,
                        err
                    );
                    break;
                }
            }
        }

        // Sinaliza fim dos chunks
        let _ = audio_tx.send(None);

        // Aguarda a reprodução de áudio finalizar
        playback_handle.await??;

        println!(
            "[TTS Pipeline] Reprodução finalizada em {:?}",
            start_total.elapsed()
        );

        Ok(())
    }

    /// Retorna a lista de vozes disponíveis (com fallback confiável para a lista curada)
    pub async fn get_available_voices(&self) -> Vec<VoiceInfo> {
        match get_voices_list_async().await {
            Ok(voices) => {
                let mut pt_voices: Vec<VoiceInfo> = voices
                    .into_iter()
                    .filter(|v| {
                        v.locale
                            .as_deref()
                            .map(|loc| loc.to_lowercase().starts_with("pt"))
                            .unwrap_or(false)
                    })
                    .map(|v| VoiceInfo {
                        name: v.name.clone(),
                        short_name: v.short_name.unwrap_or_else(|| v.name.clone()),
                        gender: v.gender.unwrap_or_else(|| "Unknown".into()),
                        locale: v.locale.unwrap_or_else(|| "pt-BR".into()),
                        friendly_name: v.friendly_name.unwrap_or_else(|| v.name.clone()),
                    })
                    .collect();

                if pt_voices.is_empty() {
                    get_curated_ptbr_voices()
                } else {
                    // Ordena deixando Thalita, Francisca e Antonio no topo
                    pt_voices.sort_by(|a, b| {
                        let score = |s: &str| {
                            if s.contains("Thalita") {
                                0
                            } else if s.contains("Francisca") {
                                1
                            } else if s.contains("Antonio") {
                                2
                            } else {
                                3
                            }
                        };
                        score(&a.short_name).cmp(&score(&b.short_name))
                    });
                    pt_voices
                }
            }
            Err(err) => {
                eprintln!(
                    "[TTS] Falha ao consultar lista remota de vozes (usando curadas): {}",
                    err
                );
                get_curated_ptbr_voices()
            }
        }
    }
}

#[async_trait::async_trait]
impl crate::providers::TtsProvider for EdgeTtsClient {
    fn info(&self) -> crate::providers::ProviderInfo {
        crate::providers::ProviderInfo {
            id: "edge-tts".into(),
            name: "Microsoft Edge TTS".into(),
            provider_type: "tts".into(),
            is_local: false,
            description: "Síntese de voz neural da Microsoft Edge com catálogo curado pt-BR".into(),
        }
    }

    async fn speak_text(&self, text: &str) -> Result<(), crate::providers::ProviderError> {
        self.speak_text(text, None)
            .await
            .map_err(|e| crate::providers::ProviderError::Internal(e.to_string()))
    }

    fn stop(&self) -> Result<(), crate::providers::ProviderError> {
        self.stop();
        Ok(())
    }

    async fn list_voices(&self) -> Result<Vec<VoiceInfo>, crate::providers::ProviderError> {
        Ok(self.get_available_voices().await)
    }

    fn current_voice(&self) -> String {
        self.get_voice()
    }

    fn set_voice(&self, voice: &str) -> Result<(), crate::providers::ProviderError> {
        self.set_voice(voice);
        Ok(())
    }

    fn is_speaking(&self) -> bool {
        self.is_speaking()
    }
}

pub type SharedTtsClient = Arc<EdgeTtsClient>;
