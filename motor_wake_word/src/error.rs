use thiserror::Error;

#[derive(Error, Debug)]
pub enum WakeWordError {
    #[error("Failed to load wake word model: {0}")]
    ModelLoad(String),

    #[error("Inference prediction error: {0}")]
    Inference(String),

    #[error("Audio format/decoding error: {0}")]
    Audio(String),

    #[error("Microphone capture error: {0}")]
    Microphone(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}
