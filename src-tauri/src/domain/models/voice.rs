use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoiceInfo {
    pub name: String,
    pub short_name: String,
    pub gender: String,
    pub locale: String,
    pub friendly_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TtsBenchmarkResult {
    pub text: String,
    pub voice: String,
    pub total_chars: usize,
    pub chunks_count: usize,
    pub time_to_first_audio_ms: u64,
    pub total_synthesis_time_ms: u64,
    pub audio_bytes_len: usize,
    pub chars_per_second: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum GreetingKind {
    Contextual,
    Generic,
    Suggestion,
}

impl GreetingKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            GreetingKind::Contextual => "contextual",
            GreetingKind::Generic => "generico",
            GreetingKind::Suggestion => "sugestao",
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct GreetingItem {
    pub id: String,
    pub kind: GreetingKind,
    pub topic: Option<String>,
    pub text: String,
    pub file: String,
    pub created_at: String,
    pub last_used: Option<String>,
    #[serde(default)]
    pub ref_time: Option<String>,
}

pub const TOTAL_THINKING_AUDIOS: usize = 30;
pub const THINKING_FADE_OUT_MS: u64 = 150;
pub const THINKING_AUDIOS_DIR: &str = "cofres/thinking_audios";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ThinkingAudioItem {
    pub id: String,
    pub text: String,
    pub file: String,
    pub voice: String,
    pub created_at: String,
    #[serde(default)]
    pub last_used: Option<String>,
}

pub const THINKING_TEMPLATES: [&str; 30] = [
    "Hum...",
    "Deixa eu ver...",
    "Analisando...",
    "Só um instante...",
    "Verificando aqui...",
    "Deixa eu pensar...",
    "Certo, verificando...",
    "Buscando aqui...",
    "Um momento...",
    "Processando...",
    "Deixa eu checar...",
    "Só um segundo...",
    "Consultando aqui...",
    "Entendido, vejamos...",
    "Deixa comigo...",
    "Vejamos...",
    "Conferindo...",
    "Olhando aqui...",
    "Hum, vejamos...",
    "Examinando...",
    "Certo, um segundo...",
    "Pensando aqui...",
    "Avaliando...",
    "Hum, deixa eu checar...",
    "Pesquisando...",
    "Ok, verificando...",
    "Deixa eu ver isso...",
    "Checando agora...",
    "Só um momento...",
    "Vamos ver...",
];
