use reqwest::multipart::{Form, Part};
use serde::Deserialize;
use std::sync::Arc;

#[derive(Debug, Deserialize)]
struct TranscriptionResponse {
    text: String,
}

#[derive(Clone)]
pub struct GroqSttClient {
    api_key: String,
    model: String,
    client: reqwest::Client,
}

impl GroqSttClient {
    pub fn new(api_key: &str, model: &str) -> Self {
        Self {
            api_key: api_key.trim().to_string(),
            model: model.trim().to_string(),
            client: reqwest::Client::new(),
        }
    }

    pub async fn transcribe(
        &self,
        audio_bytes: Vec<u8>,
        mime_type: Option<&str>,
    ) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
        if self.api_key.is_empty() {
            return Err("GROQ_API_KEY não configurada no arquivo .env".into());
        }

        if audio_bytes.is_empty() {
            return Err("Buffer de áudio vazio".into());
        }

        let mime = mime_type.unwrap_or("audio/webm");
        let ext = if mime.contains("wav") {
            "wav"
        } else if mime.contains("mp3") || mime.contains("mpeg") {
            "mp3"
        } else if mime.contains("ogg") {
            "ogg"
        } else {
            "webm"
        };
        let filename = format!("audio.{}", ext);

        let part = Part::bytes(audio_bytes)
            .file_name(filename)
            .mime_str(mime)?;

        let form = Form::new()
            .text("model", self.model.clone())
            .text("language", "pt")
            .text("response_format", "json")
            .part("file", part);

        let response = self
            .client
            .post("https://api.groq.com/openai/v1/audio/transcriptions")
            .header("Authorization", format!("Bearer {}", self.api_key))
            .multipart(form)
            .send()
            .await?;

        let status = response.status();
        if !status.is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("Erro na API do Groq ({}): {}", status, error_text).into());
        }

        let result: TranscriptionResponse = response.json().await?;
        Ok(result.text.trim().to_string())
    }
}

#[async_trait::async_trait]
impl crate::providers::SttProvider for GroqSttClient {
    fn info(&self) -> crate::providers::ProviderInfo {
        crate::providers::ProviderInfo {
            id: "groq-whisper".into(),
            name: "Groq Whisper".into(),
            provider_type: "stt".into(),
            is_local: false,
            description: format!(
                "Modelo Groq Whisper ({}) via API em nuvem de alta velocidade",
                self.model
            ),
        }
    }

    async fn transcribe(
        &self,
        audio_bytes: Vec<u8>,
        mime_type: Option<&str>,
    ) -> Result<String, crate::providers::ProviderError> {
        self.transcribe(audio_bytes, mime_type)
            .await
            .map_err(|e| crate::providers::ProviderError::Network(e.to_string()))
    }
}

pub type SharedSttClient = Arc<GroqSttClient>;
