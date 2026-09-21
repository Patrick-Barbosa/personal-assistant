use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SearchResult {
    pub path: String,
    pub titulo: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub file_path: Option<String>,
    pub score: f32,
    pub preview: String,
    pub vault: String,
    pub categoria: Option<String>,
    #[serde(default)]
    pub slug: Option<String>,
}
