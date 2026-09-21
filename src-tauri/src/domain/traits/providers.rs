use crate::domain::models::{ChatMessage, VoiceInfo};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderInfo {
    pub id: String,
    pub name: String,
    pub provider_type: String,
    pub is_local: bool,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ProviderError {
    Network(String),
    Auth(String),
    RateLimit { retry_after_ms: u64 },
    InvalidInput(String),
    Internal(String),
}

impl std::fmt::Display for ProviderError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Network(e) => write!(f, "Erro de rede: {e}"),
            Self::Auth(e) => write!(f, "Erro de autenticação: {e}"),
            Self::RateLimit { retry_after_ms } => {
                write!(f, "Rate limit, retry em {retry_after_ms}ms")
            }
            Self::InvalidInput(e) => write!(f, "Entrada inválida: {e}"),
            Self::Internal(e) => write!(f, "Erro interno: {e}"),
        }
    }
}

impl std::error::Error for ProviderError {}

// ─── LLM Provider Trait ─────────────────────────────────────

#[derive(Clone, Debug)]
pub struct ChatOptions {
    pub temperature: f32,
    pub top_p: f32,
    pub max_tokens: Option<u32>,
    pub enable_thinking: bool,
    pub json_mode: bool,
}

impl Default for ChatOptions {
    fn default() -> Self {
        Self {
            temperature: 0.4,
            top_p: 0.9,
            max_tokens: Some(4096),
            enable_thinking: false,
            json_mode: false,
        }
    }
}

#[async_trait]
pub trait LlmProvider: Send + Sync {
    fn info(&self) -> ProviderInfo;

    async fn chat_completion(
        &self,
        messages: &[ChatMessage],
        tools: Option<serde_json::Value>,
    ) -> Result<ChatMessage, ProviderError>;

    async fn chat_completion_with_options(
        &self,
        messages: &[ChatMessage],
        tools: Option<serde_json::Value>,
        _options: ChatOptions,
    ) -> Result<ChatMessage, ProviderError> {
        self.chat_completion(messages, tools).await
    }

    async fn generate_title(
        &self,
        user_msg: &str,
        assistant_resp: &str,
    ) -> Result<String, ProviderError>;

    fn supports_tool_calling(&self) -> bool {
        true
    }

    fn supports_streaming(&self) -> bool {
        false
    }
}

// ─── STT Provider Trait ─────────────────────────────────────

#[async_trait]
pub trait SttProvider: Send + Sync {
    fn info(&self) -> ProviderInfo;

    async fn transcribe(
        &self,
        audio_bytes: Vec<u8>,
        mime_type: Option<&str>,
    ) -> Result<String, ProviderError>;
}

// ─── TTS Provider Trait ─────────────────────────────────────

#[async_trait]
pub trait TtsProvider: Send + Sync {
    fn info(&self) -> ProviderInfo;

    async fn speak_text(&self, text: &str) -> Result<(), ProviderError>;

    fn stop(&self) -> Result<(), ProviderError>;

    async fn list_voices(&self) -> Result<Vec<VoiceInfo>, ProviderError>;

    fn current_voice(&self) -> String;

    fn set_voice(&self, voice: &str) -> Result<(), ProviderError>;

    fn is_speaking(&self) -> bool;
}

// ─── Embedding Provider Trait ───────────────────────────────

#[async_trait]
pub trait EmbeddingProvider: Send + Sync {
    fn info(&self) -> ProviderInfo;

    fn dimensions(&self) -> usize;

    fn embed_query(&self, query: &str) -> Result<Vec<f32>, ProviderError>;

    fn embed_texts(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, ProviderError>;
}
