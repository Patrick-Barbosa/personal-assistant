use crate::domain::errors::DomainError;
use crate::domain::traits::vault::VaultFileSystem;
use async_trait::async_trait;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

const HIDDEN_DIR_PREFIXES: &[&str] = &[
    ".obsidian",
    ".trash",
    ".stfolder",
    ".stfolder.removed",
    ".Android",
    ".copilot-index",
    ".thumbcache",
];

#[derive(Clone, Default)]
pub struct LocalVaultFileSystem;

impl LocalVaultFileSystem {
    pub fn new() -> Self {
        Self
    }

    fn is_hidden(path: &Path, root: &Path) -> bool {
        if let Ok(rel) = path.strip_prefix(root) {
            for comp in rel.components() {
                if let std::path::Component::Normal(os_str) = comp {
                    let s = os_str.to_string_lossy();
                    if s.starts_with('.')
                        || HIDDEN_DIR_PREFIXES
                            .iter()
                            .any(|prefix| s.starts_with(prefix))
                    {
                        return true;
                    }
                }
            }
        }
        false
    }

    pub fn atomic_write(dest: &Path, content: &str) -> Result<(), DomainError> {
        let parent = dest
            .parent()
            .ok_or_else(|| DomainError::InvalidInput("Destino inválido sem pasta pai".into()))?;
        fs::create_dir_all(parent)?;

        let mut temp_file = tempfile::Builder::new()
            .prefix(".tmp_note_")
            .suffix(".tmp")
            .tempfile_in(parent)?;

        temp_file.write_all(content.as_bytes())?;
        temp_file.flush()?;
        temp_file
            .persist(dest)
            .map_err(|e| DomainError::IoError(e.error))?;
        Ok(())
    }
}

#[async_trait]
impl VaultFileSystem for LocalVaultFileSystem {
    fn read_file(&self, path: &Path) -> Result<String, DomainError> {
        fs::read_to_string(path).map_err(DomainError::IoError)
    }

    fn write_file_atomic(&self, path: &Path, content: &str) -> Result<(), DomainError> {
        Self::atomic_write(path, content)
    }

    fn delete_file(&self, path: &Path) -> Result<(), DomainError> {
        fs::remove_file(path).map_err(DomainError::IoError)
    }

    fn move_file(&self, from: &Path, to: &Path) -> Result<(), DomainError> {
        if let Some(parent) = to.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::rename(from, to).map_err(DomainError::IoError)
    }

    fn list_markdown_files(&self, root: &Path) -> Result<Vec<PathBuf>, DomainError> {
        let mut files = Vec::new();
        for entry in WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.is_file()
                && path.extension().map(|ext| ext == "md").unwrap_or(false)
                && !Self::is_hidden(path, root)
            {
                files.push(path.to_path_buf());
            }
        }
        files.sort();
        Ok(files)
    }
}
