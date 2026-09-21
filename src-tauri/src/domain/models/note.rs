use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct NoteFrontmatter {
    pub id: Option<String>,
    pub titulo: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    pub data: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub topicos: Vec<String>,
    #[serde(default)]
    pub tipo: Option<String>,
    #[serde(default)]
    pub base_origem: Option<String>,
    #[serde(default)]
    pub data_evolucao: Option<String>,
    #[serde(default)]
    pub sessao_origem: Option<String>,
    #[serde(default, flatten)]
    pub extra: HashMap<String, serde_yaml::Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Note {
    pub path: String,
    pub titulo: String,
    pub frontmatter: NoteFrontmatter,
    pub content: String,
    pub categoria: Option<String>,
    pub vault: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NoteTitleItem {
    pub title: String,
    pub vault: String,
    pub path: String,
}

/// Representação parseada de um arquivo `.base` do Obsidian (recurso de Bases/Databases).
/// Cada `.base` é um YAML puro que define uma visualização tabular apontando para uma pasta de notas filhas.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BaseFile {
    /// Caminho absoluto do arquivo `.base`
    pub path: PathBuf,
    /// Título derivado do stem do arquivo
    pub title: String,
    /// Caminho relativo da pasta alvo extraído de `file.inFolder(...)`
    pub folder_filter: String,
    /// Nomes das colunas definidas no `.base`
    pub columns: Vec<String>,
    /// Categoria extraída da pasta pai do `.base`
    pub category: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct GraphNode {
    pub id: String,
    pub title: String,
    pub vault: String,
    pub path: String,
    pub tags: Vec<String>,
    pub category: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct GraphLink {
    pub source: String,
    pub target: String,
    #[serde(default)]
    pub is_lineage: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct GraphData {
    pub nodes: Vec<GraphNode>,
    pub links: Vec<GraphLink>,
}

/// Relatório de renomeação com reapontamento de wikilinks.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RenameReport {
    pub old_path: PathBuf,
    pub new_path: PathBuf,
    pub old_title: String,
    pub new_title: String,
    pub repointed_files: Vec<PathBuf>,
    pub obsidian_blocked: Vec<PathBuf>,
}
