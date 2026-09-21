use crate::domain::errors::DomainError;
use crate::domain::models::ThinkingAudioItem;
use std::io::Write;
use std::path::{Path, PathBuf};
use tempfile::Builder;

#[derive(Clone)]
pub struct ThinkingFileSystem {
    dir: PathBuf,
}

impl ThinkingFileSystem {
    pub fn new(dir: PathBuf) -> Self {
        if !dir.exists() {
            let _ = std::fs::create_dir_all(&dir);
        }
        Self { dir }
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    pub fn manifest_path(&self) -> PathBuf {
        self.dir.join("manifest.json")
    }

    pub fn load_manifest(&self) -> Vec<ThinkingAudioItem> {
        let p = self.manifest_path();
        if !p.exists() {
            return Vec::new();
        }
        if let Ok(content) = std::fs::read_to_string(&p) {
            if let Ok(list) = serde_json::from_str::<Vec<ThinkingAudioItem>>(&content) {
                return list
                    .into_iter()
                    .filter(|item| self.dir.join(&item.file).exists())
                    .collect();
            }
        }
        Vec::new()
    }

    pub fn save_manifest(&self, list: &[ThinkingAudioItem]) -> Result<(), DomainError> {
        let json = serde_json::to_string_pretty(list)
            .map_err(|e| DomainError::Other(format!("JSON serialization error: {e}")))?;

        let manifest = self.manifest_path();
        let mut tmp = Builder::new()
            .prefix(".manifest_tmp_")
            .suffix(".json")
            .tempfile_in(&self.dir)
            .map_err(DomainError::IoError)?;

        tmp.write_all(json.as_bytes())
            .map_err(DomainError::IoError)?;
        tmp.flush().map_err(DomainError::IoError)?;
        tmp.persist(&manifest)
            .map_err(|e| DomainError::Other(format!("Atomic persist error: {e}")))?;

        Ok(())
    }

    pub fn file_path(&self, file_name: &str) -> PathBuf {
        self.dir.join(file_name)
    }

    pub fn write_audio_file_atomic(
        &self,
        file_name: &str,
        bytes: &[u8],
    ) -> Result<(), DomainError> {
        let target = self.dir.join(file_name);
        let mut tmp = Builder::new()
            .prefix(".thk_tmp_")
            .suffix(".mp3")
            .tempfile_in(&self.dir)
            .map_err(DomainError::IoError)?;

        tmp.write_all(bytes).map_err(DomainError::IoError)?;
        tmp.flush().map_err(DomainError::IoError)?;
        tmp.persist(&target)
            .map_err(|e| DomainError::Other(format!("Atomic persist audio error: {e}")))?;

        Ok(())
    }

    pub fn delete_file(&self, file_name: &str) -> Result<(), DomainError> {
        let path = self.dir.join(file_name);
        if path.exists() {
            std::fs::remove_file(path).map_err(DomainError::IoError)?;
        }
        Ok(())
    }

    pub fn clear_all(&self) -> Result<(), DomainError> {
        let p = self.manifest_path();
        if p.exists() {
            let _ = std::fs::remove_file(&p);
        }
        if let Ok(entries) = std::fs::read_dir(&self.dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|ext| ext.to_str()) == Some("mp3") {
                    let _ = std::fs::remove_file(path);
                }
            }
        }
        Ok(())
    }
}
