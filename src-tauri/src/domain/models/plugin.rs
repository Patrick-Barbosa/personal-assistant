use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginMeta {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginProvides {
    #[serde(rename = "type")]
    pub plugin_type: String,
    #[serde(default)]
    pub provider_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginRuntime {
    #[serde(default = "default_mcp_engine")]
    pub engine: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub working_dir: Option<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default = "default_true")]
    pub auto_start: bool,
}

fn default_mcp_engine() -> String {
    "mcp".into()
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillTrigger {
    #[serde(rename = "type")]
    pub trigger_type: String,
    #[serde(default)]
    pub cron: Option<String>,
    #[serde(default)]
    pub event: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillExecution {
    #[serde(default = "default_max_iterations")]
    pub max_iterations: usize,
    #[serde(default = "default_true")]
    pub notify_on_complete: bool,
    #[serde(default = "default_session_prefix")]
    pub session_prefix: String,
}

fn default_max_iterations() -> usize {
    6
}

fn default_session_prefix() -> String {
    "\u{1F916} Skill".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillConfig {
    pub trigger: SkillTrigger,
    pub system_prompt: String,
    pub input_message: Option<String>,
    #[serde(default)]
    pub allowed_tools: Option<Vec<String>>,
    #[serde(default)]
    pub execution: Option<SkillExecution>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeConfig {
    pub file: String,
    #[serde(default)]
    pub preview: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ViewConfig {
    pub label: String,
    #[serde(default)]
    pub icon: Option<String>,
    pub entry: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginManifest {
    pub plugin: PluginMeta,
    pub provides: PluginProvides,
    #[serde(default)]
    pub runtime: Option<PluginRuntime>,
    #[serde(default)]
    pub skill: Option<SkillConfig>,
    #[serde(default)]
    pub theme: Option<ThemeConfig>,
    #[serde(default)]
    pub view: Option<ViewConfig>,
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(skip)]
    pub folder_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerConfig {
    #[serde(default)]
    pub id: String,
    pub name: Option<String>,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    pub working_dir: Option<PathBuf>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default = "default_false")]
    pub auto_start: bool,
}

fn default_false() -> bool {
    false
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpToolInfo {
    pub name: String,
    pub description: Option<String>,
    #[serde(rename = "inputSchema")]
    pub input_schema: serde_json::Value,
    pub server_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExternalMcpConfigFile {
    #[serde(default, alias = "mcpServers")]
    pub servers: HashMap<String, McpServerConfig>,
}
