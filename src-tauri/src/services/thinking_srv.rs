use crate::db::Database;
use crate::domain::models::{
    ThinkingAudioItem, THINKING_FADE_OUT_MS, THINKING_TEMPLATES, TOTAL_THINKING_AUDIOS,
};
use crate::infra::fs::ThinkingFileSystem;
use crate::tts::EdgeTtsClient;
use chrono::Local;
use rodio::{Decoder, OutputStream, Sink};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

#[derive(Clone)]
pub struct ThinkingPlaybackHandle {
    sink: Arc<Sink>,
    is_playing: Arc<AtomicBool>,
}

impl ThinkingPlaybackHandle {
    pub fn new(sink: Arc<Sink>, is_playing: Arc<AtomicBool>) -> Self {
        Self { sink, is_playing }
    }

    pub fn is_playing(&self) -> bool {
        self.is_playing.load(Ordering::SeqCst) && !self.sink.empty()
    }

    pub fn stop(&self) {
        self.is_playing.store(false, Ordering::SeqCst);
        self.sink.stop();
    }

    pub async fn fade_out_and_wait(&self, duration_ms: u64) {
        if !self.is_playing() {
            return;
        }
        let dur = if duration_ms == 0 {
            THINKING_FADE_OUT_MS
        } else {
            duration_ms
        };
        let steps = 10;
        let step_ms = (dur / steps).max(10);
        for i in (0..=steps).rev() {
            let vol = (i as f32) / (steps as f32);
            self.sink.set_volume(vol);
            tokio::time::sleep(tokio::time::Duration::from_millis(step_ms)).await;
        }
        self.stop();
    }
}

pub struct ThinkingAudiosManager {
    fs: ThinkingFileSystem,
    active_playback: Arc<Mutex<Option<ThinkingPlaybackHandle>>>,
    last_picked_id: Arc<Mutex<Option<String>>>,
}

pub type SharedThinkingAudiosManager = Arc<ThinkingAudiosManager>;

impl ThinkingAudiosManager {
    pub fn new(dir: PathBuf) -> Self {
        let fs = ThinkingFileSystem::new(dir);
        Self {
            fs,
            active_playback: Arc::new(Mutex::new(None)),
            last_picked_id: Arc::new(Mutex::new(None)),
        }
    }

    pub fn dir(&self) -> &Path {
        self.fs.dir()
    }

    pub fn fs(&self) -> &ThinkingFileSystem {
        &self.fs
    }

    /// Garante o acervo de 30 fillers no startup em background.
    /// Invalida clipes antigos se a voz atual for diferente do timbre gravado.
    pub async fn ensure_at_startup(
        &self,
        tts: &EdgeTtsClient,
        db: &Database,
    ) -> Result<String, String> {
        let current_voice = db
            .get_setting("tts_voice")
            .ok()
            .flatten()
            .filter(|v| !v.trim().is_empty())
            .unwrap_or_else(|| tts.get_voice());

        let mut list = self.fs.load_manifest();
        let before = list.len();

        // 1. Invalidação por troca de voz
        let mut invalid_files = Vec::new();
        list.retain(|item| {
            if item.voice != current_voice {
                invalid_files.push(item.file.clone());
                false
            } else {
                true
            }
        });
        for file in invalid_files {
            let _ = self.fs.delete_file(&file);
        }
        if list.len() != before {
            println!(
                "[THINKING] Troca de voz detectada: {} clipe(s) antigos removidos (nova voz: {}).",
                before - list.len(),
                current_voice
            );
        }

        // 2. Completa templates faltantes até TOTAL_THINKING_AUDIOS (30)
        let mut synthesized_count = 0;
        for text in THINKING_TEMPLATES {
            if list.len() >= TOTAL_THINKING_AUDIOS {
                break;
            }
            if list
                .iter()
                .any(|item| item.text == text && item.voice == current_voice)
            {
                continue;
            }
            let id = format!("thk_{}", &uuid::Uuid::new_v4().simple().to_string()[..8]);
            let file = format!("{}.mp3", id);

            match tts.synthesize(text, Some(&current_voice)).await {
                Ok(bytes) => {
                    if bytes.is_empty() {
                        eprintln!(
                            "[THINKING] TTS retornou áudio vazio para template '{}'",
                            text
                        );
                        continue;
                    }
                    if let Err(e) = self.fs.write_audio_file_atomic(&file, &bytes) {
                        eprintln!("[THINKING] Falha ao gravar clipe '{}': {}", file, e);
                        continue;
                    }
                    list.push(ThinkingAudioItem {
                        id,
                        text: text.to_string(),
                        file,
                        voice: current_voice.clone(),
                        created_at: Local::now().to_rfc3339(),
                        last_used: None,
                    });
                    synthesized_count += 1;
                }
                Err(e) => {
                    eprintln!("[THINKING] Falha ao sintetizar '{}': {}", text, e);
                    break;
                }
            }
        }

        if let Err(e) = self.fs.save_manifest(&list) {
            eprintln!("[THINKING] Falha ao salvar manifesto: {}", e);
        }

        Ok(format!(
            "Fillers de pensamento prontos: total={}/{} (sintetizados nesta execução: {}, voz: {})",
            list.len(),
            TOTAL_THINKING_AUDIOS,
            synthesized_count,
            current_voice
        ))
    }

    /// Invalida e regenera todo o acervo para a nova voz configurada.
    pub async fn invalidate_and_regenerate(
        &self,
        tts: &EdgeTtsClient,
        db: &Database,
    ) -> Result<String, String> {
        self.stop_active();
        let _ = self.fs.clear_all();
        self.ensure_at_startup(tts, db).await
    }

    /// Sorteia um clipe pseudo-aleatório anti-repetição para a voz atual.
    pub fn pick_thinking_audio(&self, db: &Database) -> Option<ThinkingAudioItem> {
        let current_voice = db
            .get_setting("tts_voice")
            .ok()
            .flatten()
            .filter(|v| !v.trim().is_empty())
            .unwrap_or_else(|| crate::tts::DEFAULT_TTS_VOICE.to_string());

        let mut full_list = self.fs.load_manifest();
        if full_list.is_empty() {
            return None;
        }

        // Filtra pela voz atual e arquivo fisicamente existente
        let compatible: Vec<ThinkingAudioItem> = full_list
            .iter()
            .filter(|item| item.voice == current_voice && self.fs.file_path(&item.file).exists())
            .cloned()
            .collect();

        if compatible.is_empty() {
            return None;
        }

        let now = Local::now();
        let last_id = db
            .get_setting("last_thinking_audio_id")
            .ok()
            .flatten()
            .unwrap_or_else(|| {
                self.last_picked_id
                    .lock()
                    .ok()
                    .and_then(|guard| guard.clone())
                    .unwrap_or_default()
            });

        let mut candidates: Vec<ThinkingAudioItem> = compatible
            .iter()
            .filter(|item| item.id != last_id)
            .cloned()
            .collect();

        if candidates.is_empty() {
            candidates = compatible;
        }

        if candidates.is_empty() {
            return None;
        }

        let idx = (now.timestamp_millis().unsigned_abs() as usize) % candidates.len();
        let picked = candidates[idx].clone();

        // Atualiza last_used no manifesto completo preservando todos os itens
        if let Some(entry) = full_list.iter_mut().find(|item| item.id == picked.id) {
            entry.last_used = Some(now.to_rfc3339());
        }
        let _ = self.fs.save_manifest(&full_list);

        if let Ok(mut guard) = self.last_picked_id.lock() {
            *guard = Some(picked.id.clone());
        }
        let _ = db.set_setting("last_thinking_audio_id", &picked.id);

        Some(picked)
    }

    /// Dispara a reprodução bloqueante em thread dedicada com suporte a interrupção suave.
    pub fn play_thinking_audio(&self, db: &Database) -> Option<ThinkingPlaybackHandle> {
        self.stop_active();

        let picked = self.pick_thinking_audio(db)?;
        let audio_path = self.fs.file_path(&picked.file);
        if !audio_path.exists() {
            return None;
        }

        let file_bytes = match std::fs::read(&audio_path) {
            Ok(b) => b,
            Err(e) => {
                eprintln!(
                    "[THINKING] Falha ao ler áudio '{}': {}",
                    audio_path.display(),
                    e
                );
                return None;
            }
        };

        println!(
            "[THINKING] Tocando filler: \"{}\" ({})",
            picked.text, picked.id
        );

        let is_playing = Arc::new(AtomicBool::new(true));
        let is_playing_thread = is_playing.clone();
        let (tx, rx) = std::sync::mpsc::channel::<Arc<Sink>>();

        let thread_spawn = std::thread::Builder::new()
            .name("thinking-audio-playback".to_string())
            .spawn(move || {
                let (_stream, stream_handle) = match OutputStream::try_default() {
                    Ok(res) => res,
                    Err(e) => {
                        eprintln!("[THINKING] Erro ao abrir dispositivo de áudio: {}", e);
                        is_playing_thread.store(false, Ordering::SeqCst);
                        return;
                    }
                };

                let sink = match Sink::try_new(&stream_handle) {
                    Ok(s) => Arc::new(s),
                    Err(e) => {
                        eprintln!("[THINKING] Erro ao inicializar Sink: {}", e);
                        is_playing_thread.store(false, Ordering::SeqCst);
                        return;
                    }
                };

                let cursor = std::io::Cursor::new(file_bytes);
                let source = match Decoder::new(cursor) {
                    Ok(src) => src,
                    Err(e) => {
                        eprintln!("[THINKING] Erro ao decodificar MP3: {}", e);
                        is_playing_thread.store(false, Ordering::SeqCst);
                        return;
                    }
                };

                sink.append(source);
                let _ = tx.send(sink.clone());

                while !sink.empty() && is_playing_thread.load(Ordering::SeqCst) {
                    std::thread::sleep(std::time::Duration::from_millis(20));
                }

                sink.stop();
                is_playing_thread.store(false, Ordering::SeqCst);
            });

        if let Err(e) = thread_spawn {
            eprintln!("[THINKING] Falha ao spawnar thread de áudio: {}", e);
            return None;
        }

        let sink = match rx.recv_timeout(std::time::Duration::from_millis(500)) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[THINKING] Timeout aguardando início do Sink: {}", e);
                return None;
            }
        };

        let handle = ThinkingPlaybackHandle::new(sink, is_playing);

        if let Ok(mut active) = self.active_playback.lock() {
            *active = Some(handle.clone());
        }

        Some(handle)
    }

    /// Para imediatamente a reprodução ativa de qualquer filler.
    pub fn stop_active(&self) {
        if let Ok(mut active) = self.active_playback.lock() {
            if let Some(handle) = active.take() {
                handle.stop();
            }
        }
    }
}
