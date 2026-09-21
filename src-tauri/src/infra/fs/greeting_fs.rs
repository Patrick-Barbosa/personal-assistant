use crate::domain::errors::DomainError;
use crate::domain::models::GreetingItem;
use std::path::PathBuf;

#[derive(Clone)]
pub struct GreetingFileSystem {
    dir: PathBuf,
}

impl GreetingFileSystem {
    pub fn new(dir: PathBuf) -> Self {
        if !dir.exists() {
            let _ = std::fs::create_dir_all(&dir);
        }
        Self { dir }
    }

    pub fn manifest_path(&self) -> PathBuf {
        self.dir.join("manifest.json")
    }

    pub fn load_manifest(&self) -> Vec<GreetingItem> {
        let p = self.manifest_path();
        if !p.exists() {
            return Vec::new();
        }
        if let Ok(content) = std::fs::read_to_string(&p) {
            if let Ok(list) = serde_json::from_str::<Vec<GreetingItem>>(&content) {
                return list
                    .into_iter()
                    .filter(|g| self.dir.join(&g.file).exists())
                    .collect();
            }
        }
        Vec::new()
    }

    pub fn save_manifest(&self, list: &[GreetingItem]) -> Result<(), DomainError> {
        let json = serde_json::to_string_pretty(list)
            .map_err(|e| DomainError::Other(format!("JSON error: {e}")))?;
        std::fs::write(self.manifest_path(), json).map_err(DomainError::IoError)
    }

    pub fn file_path(&self, file_name: &str) -> PathBuf {
        self.dir.join(file_name)
    }

    pub fn delete_file(&self, file_name: &str) -> Result<(), DomainError> {
        let path = self.dir.join(file_name);
        if path.exists() {
            std::fs::remove_file(path).map_err(DomainError::IoError)?;
        }
        Ok(())
    }
}
