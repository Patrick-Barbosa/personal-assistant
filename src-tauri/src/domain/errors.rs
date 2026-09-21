use thiserror::Error;

/// Unified domain error type for Copernico.
/// Services and domain logic use this internally.
/// At the Tauri bridge boundary, convert via `.map_err(|e| e.to_string())`.
#[derive(Debug, Error)]
pub enum DomainError {
    #[error("Não encontrado: {0}")]
    NotFound(String),

    #[error("O cofre Obsidian é somente leitura")]
    VaultReadOnly,

    #[error("Entrada inválida: {0}")]
    InvalidInput(String),

    #[error("Erro de banco de dados: {0}")]
    DatabaseError(String),

    #[error("Erro de LLM: {0}")]
    LlmError(String),

    #[error("Erro de STT: {0}")]
    SttError(String),

    #[error("Erro de TTS: {0}")]
    TtsError(String),

    #[error("Erro de embedding: {0}")]
    EmbeddingError(String),

    #[error("Erro de I/O: {0}")]
    IoError(#[from] std::io::Error),

    #[error("Erro de configuração: {0}")]
    ConfigError(String),

    #[error("Erro de provider: {0}")]
    ProviderError(#[from] crate::domain::traits::ProviderError),

    #[error("{0}")]
    Other(String),
}

impl From<String> for DomainError {
    fn from(s: String) -> Self {
        DomainError::Other(s)
    }
}

impl From<&str> for DomainError {
    fn from(s: &str) -> Self {
        DomainError::Other(s.to_string())
    }
}
