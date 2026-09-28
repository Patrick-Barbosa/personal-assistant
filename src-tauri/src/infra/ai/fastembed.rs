use crate::domain::traits::providers::{EmbeddingProvider, ProviderError, ProviderInfo};
use async_trait::async_trait;
use fastembed::{EmbeddingModel, InitOptions, TextEmbedding};
use std::sync::{Arc, Mutex};

pub struct FastEmbedModel {
    model: Arc<Mutex<TextEmbedding>>,
    dimensions: usize,
}

impl FastEmbedModel {
    pub fn new() -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let init_opts =
            InitOptions::new(EmbeddingModel::AllMiniLML6V2).with_show_download_progress(false);

        let model = TextEmbedding::try_new(init_opts)?;

        Ok(Self {
            model: Arc::new(Mutex::new(model)),
            dimensions: 384,
        })
    }
}

#[async_trait]
impl EmbeddingProvider for FastEmbedModel {
    fn info(&self) -> ProviderInfo {
        ProviderInfo {
            id: "fastembed".into(),
            name: "FastEmbed ONNX".into(),
            provider_type: "embedding".into(),
            is_local: true,
            description: "Local CPU embeddings via FastEmbed ONNX (384 dims)".into(),
        }
    }

    fn dimensions(&self) -> usize {
        self.dimensions
    }

    fn embed_query(&self, query: &str) -> Result<Vec<f32>, ProviderError> {
        let mut model = self
            .model
            .lock()
            .map_err(|e| ProviderError::Internal(format!("Lock error: {e}")))?;
        let embeddings = model
            .embed(vec![query], None)
            .map_err(|e| ProviderError::Internal(format!("Embedding error: {e}")))?;
        embeddings
            .into_iter()
            .next()
            .ok_or_else(|| ProviderError::Internal("No embedding produced".into()))
    }

    fn embed_texts(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, ProviderError> {
        let mut model = self
            .model
            .lock()
            .map_err(|e| ProviderError::Internal(format!("Lock error: {e}")))?;
        let text_slices: Vec<&str> = texts.iter().map(|s| s.as_str()).collect();
        model
            .embed(text_slices, None)
            .map_err(|e| ProviderError::Internal(format!("Embedding error: {e}")))
    }
}
