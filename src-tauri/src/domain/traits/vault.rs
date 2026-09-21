use crate::domain::errors::DomainError;
use async_trait::async_trait;
use std::path::{Path, PathBuf};

#[async_trait]
pub trait VaultFileSystem: Send + Sync {
    fn read_file(&self, path: &Path) -> Result<String, DomainError>;
    fn write_file_atomic(&self, path: &Path, content: &str) -> Result<(), DomainError>;
    fn delete_file(&self, path: &Path) -> Result<(), DomainError>;
    fn move_file(&self, from: &Path, to: &Path) -> Result<(), DomainError>;
    fn list_markdown_files(&self, root: &Path) -> Result<Vec<PathBuf>, DomainError>;
}

#[async_trait]
pub trait VaultIndexStore: Send + Sync {
    fn save_embedding(
        &self,
        vault: &str,
        path: &str,
        hash: &str,
        embedding: &[f32],
        title: Option<&str>,
        mtime: f64,
    ) -> Result<(), DomainError>;
    fn get_indexed_file_mtime(&self, vault: &str, path: &str) -> Result<Option<f64>, DomainError>;
    fn delete_embedding(&self, vault: &str, path: &str) -> Result<(), DomainError>;
    fn get_all_embeddings(
        &self,
        vault: &str,
    ) -> Result<Vec<(String, Vec<f32>, String)>, DomainError>;
}
