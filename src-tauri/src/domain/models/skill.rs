use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub has_scripts: bool,
    pub script_files: Vec<String>,
    pub prompt_instructions: String,
    pub folder_path: String,
    pub is_enabled: bool,
}
