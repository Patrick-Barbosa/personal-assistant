use crate::db::Database;
use crate::mcp::{McpManager, McpServerConfig};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

pub use crate::domain::models::{
    ExternalMcpConfigFile, PluginManifest, PluginMeta, PluginProvides, PluginRuntime, SkillConfig,
    SkillExecution, SkillTrigger, ThemeConfig, ViewConfig,
};

pub struct PluginRegistry {
    plugins_dir: PathBuf,
    manifests: Arc<RwLock<HashMap<String, PluginManifest>>>,
    mcp_manager: Arc<McpManager>,
    db: Arc<Database>,
}

impl PluginRegistry {
    pub fn new(plugins_dir: PathBuf, mcp_manager: Arc<McpManager>, db: Arc<Database>) -> Self {
        Self {
            plugins_dir,
            manifests: Arc::new(RwLock::new(HashMap::new())),
            mcp_manager,
            db,
        }
    }

    /// Escaneia todo o diretório plugins/ e carrega os manifestos
    pub fn scan_and_load_plugins(&self) -> Result<(), String> {
        if !self.plugins_dir.exists() {
            let _ = fs::create_dir_all(&self.plugins_dir);
        }

        println!("[PLUGINS] Escaneando plugins em {:?}...", self.plugins_dir);

        let mut found_manifests = HashMap::new();

        // 1. Escaneia subpastas em busca de copernico-plugin.yaml ou copernico-plugin.yml
        self.scan_directory_recursive(&self.plugins_dir, &mut found_manifests);

        println!(
            "[PLUGINS] Encontrados {} plugins no diretório.",
            found_manifests.len()
        );

        // 2. Registra na tabela SQLite de plugins e inicia MCP servers se auto_start
        for (id, manifest) in &found_manifests {
            let is_enabled = self.is_plugin_enabled(id);

            // Salva no banco de dados
            let config_json = serde_json::to_string(&manifest).unwrap_or_default();
            let _ = self.db.save_plugin(
                id,
                &manifest.plugin.name,
                &manifest.plugin.version,
                &manifest.provides.plugin_type,
                is_enabled,
                &config_json,
            );

            if is_enabled
                && manifest.provides.plugin_type == "tool"
                && manifest.runtime.as_ref().is_some_and(|rt| rt.auto_start)
            {
                if let Some(ref rt) = manifest.runtime {
                    let working_dir = manifest.folder_path.clone();
                    let mcp_cfg = McpServerConfig {
                        id: id.clone(),
                        name: Some(manifest.plugin.name.clone()),
                        command: rt.command.clone(),
                        args: rt.args.clone(),
                        working_dir: Some(working_dir),
                        env: rt.env.clone(),
                        auto_start: rt.auto_start,
                    };
                    let _ = self.mcp_manager.start_server(mcp_cfg);
                }
            }
        }

        // 3. Escaneia mcp-servers.yaml e mcp-servers.json para MCP servers externos (Claude-compatible)
        for ext_name in ["mcp-servers.yaml", "mcp-servers.yml", "mcp-servers.json"] {
            let ext_mcp_path = self.plugins_dir.join(ext_name);
            if ext_mcp_path.exists() {
                if let Ok(content) = fs::read_to_string(&ext_mcp_path) {
                    if ext_name.ends_with(".json") {
                        match serde_json::from_str::<ExternalMcpConfigFile>(&content) {
                            Ok(ext_config) => {
                                println!(
                                    "[MCP] Carregando {} servidores de {}...",
                                    ext_config.servers.len(),
                                    ext_name
                                );
                                for (srv_id, mut srv_cfg) in ext_config.servers {
                                    if srv_cfg.id.is_empty() {
                                        srv_cfg.id = srv_id.clone();
                                    } else if srv_cfg.id != srv_id {
                                        eprintln!("[MCP WARN] ID mismatch: chave '{}' vs id '{}', usando chave", srv_id, srv_cfg.id);
                                        srv_cfg.id = srv_id.clone();
                                    }
                                    if srv_cfg.auto_start {
                                        if let Err(e) = self.mcp_manager.start_server(srv_cfg) {
                                            eprintln!(
                                                "[MCP WARN] Falha ao iniciar '{}': {}",
                                                srv_id, e
                                            );
                                        }
                                    }
                                }
                            }
                            Err(e) => eprintln!(
                                "[MCP WARN] Falha ao parsear {}: {}",
                                ext_mcp_path.display(),
                                e
                            ),
                        }
                    } else {
                        match serde_yaml::from_str::<ExternalMcpConfigFile>(&content) {
                            Ok(ext_config) => {
                                println!(
                                    "[MCP] Carregando {} servidores de {}...",
                                    ext_config.servers.len(),
                                    ext_name
                                );
                                for (srv_id, mut srv_cfg) in ext_config.servers {
                                    if srv_cfg.id.is_empty() {
                                        srv_cfg.id = srv_id.clone();
                                    } else if srv_cfg.id != srv_id {
                                        eprintln!("[MCP WARN] ID mismatch: chave '{}' vs id '{}', usando chave", srv_id, srv_cfg.id);
                                        srv_cfg.id = srv_id.clone();
                                    }
                                    if srv_cfg.auto_start {
                                        if let Err(e) = self.mcp_manager.start_server(srv_cfg) {
                                            eprintln!(
                                                "[MCP WARN] Falha ao iniciar '{}': {}",
                                                srv_id, e
                                            );
                                        }
                                    }
                                }
                            }
                            Err(e) => eprintln!(
                                "[MCP WARN] Falha ao parsear {}: {}",
                                ext_mcp_path.display(),
                                e
                            ),
                        }
                    }
                }
            }
        }

        // 4. Carrega configuração MCP salva via UI (SQLite key mcp_servers_config) - unifica com yaml
        if let Ok(Some(cfg_str)) = self.db.get_setting("mcp_servers_config") {
            if !cfg_str.trim().is_empty() {
                if let Ok(val) = serde_json::from_str::<Value>(&cfg_str) {
                    let mut merged_servers: HashMap<String, McpServerConfig> = HashMap::new();
                    if let Some(obj) = val.as_object() {
                        for top_key in ["servers", "mcpServers"] {
                            if let Some(map) = obj.get(top_key).and_then(|v| v.as_object()) {
                                for (srv_id, srv_val) in map {
                                    if let Ok(mut cfg) =
                                        serde_json::from_value::<McpServerConfig>(srv_val.clone())
                                    {
                                        if cfg.id.is_empty() {
                                            cfg.id = srv_id.clone();
                                        }
                                        // Para configs via UI, se auto_start não foi explicitamente definido, assume true
                                        let has_auto_start = srv_val.get("auto_start").is_some();
                                        if !has_auto_start {
                                            cfg.auto_start = true;
                                        }
                                        // Deduplica: se já existe do YAML, DB sobrepõe
                                        merged_servers.insert(srv_id.clone(), cfg);
                                    } else {
                                        eprintln!("[MCP WARN] Servidor '{}' em mcp_servers_config com formato inválido, ignorado", srv_id);
                                    }
                                }
                            }
                        }
                        // Também suporta formato direto {"id": {...}} sem wrapper (fallback)
                        if merged_servers.is_empty()
                            && obj
                                .keys()
                                .any(|k| !["servers", "mcpServers"].contains(&k.as_str()))
                        {
                            // Se o JSON não tem wrapper, tenta tratar cada top-level como servidor
                            for (srv_id, srv_val) in obj {
                                if srv_id == "servers" || srv_id == "mcpServers" {
                                    continue;
                                }
                                if let Ok(mut cfg) =
                                    serde_json::from_value::<McpServerConfig>(srv_val.clone())
                                {
                                    if cfg.id.is_empty() {
                                        cfg.id = srv_id.clone();
                                    }
                                    let has_auto_start = srv_val.get("auto_start").is_some();
                                    if !has_auto_start {
                                        cfg.auto_start = true;
                                    }
                                    merged_servers.insert(srv_id.clone(), cfg);
                                }
                            }
                        }
                    }
                    if !merged_servers.is_empty() {
                        println!(
                            "[MCP] Carregando {} servidores de mcp_servers_config (DB)...",
                            merged_servers.len()
                        );
                        for (srv_id, srv_cfg) in merged_servers {
                            if srv_cfg.auto_start {
                                if let Err(e) = self.mcp_manager.start_server(srv_cfg) {
                                    eprintln!(
                                        "[MCP WARN] Falha ao iniciar servidor DB '{}': {}",
                                        srv_id, e
                                    );
                                }
                            } else {
                                println!("[MCP] Servidor DB '{}' configurado mas auto_start=false, ignorando", srv_id);
                            }
                        }
                    }
                } else {
                    eprintln!("[MCP WARN] mcp_servers_config no DB não é JSON válido");
                }
            }
        }

        {
            let mut manifests = self.manifests.write().unwrap();
            *manifests = found_manifests;
        }

        Ok(())
    }

    fn scan_directory_recursive(&self, dir: &Path, acc: &mut HashMap<String, PluginManifest>) {
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                // Ignora pastas ocultas (.git, .obsidian etc.)
                if let Some(fname) = path.file_name().and_then(|n| n.to_str()) {
                    if fname.starts_with('.') {
                        continue;
                    }
                }
                if path.is_dir() {
                    // Verifica se tem copernico-plugin.yaml ou copernico-plugin.yml
                    let yaml_path = path.join("copernico-plugin.yaml");
                    let yml_path = path.join("copernico-plugin.yml");
                    let manifest_file = if yaml_path.exists() {
                        Some(yaml_path)
                    } else if yml_path.exists() {
                        Some(yml_path)
                    } else {
                        None
                    };

                    if let Some(mf) = manifest_file {
                        if let Ok(content) = fs::read_to_string(&mf) {
                            match serde_yaml::from_str::<PluginManifest>(&content) {
                                Ok(mut manifest) => {
                                    manifest.folder_path = path.clone();
                                    println!(
                                        "[PLUGINS] Carregou plugin '{}' ({}) de {:?}",
                                        manifest.plugin.id, manifest.provides.plugin_type, path
                                    );
                                    if acc.contains_key(&manifest.plugin.id) {
                                        eprintln!("[PLUGINS WARN] ID duplicado '{}' em {:?} (anterior será sobrescrito)", manifest.plugin.id, path);
                                    }
                                    acc.insert(manifest.plugin.id.clone(), manifest);
                                }
                                Err(err) => {
                                    eprintln!("[PLUGINS WARN] Erro ao parsear {:?}: {}", mf, err);
                                }
                            }
                        }
                    } else {
                        // Continua recursão para pastas filhas (ex: tools/, skills/, themes/, etc.)
                        self.scan_directory_recursive(&path, acc);
                    }
                }
            }
        }
    }

    pub fn is_plugin_enabled(&self, plugin_id: &str) -> bool {
        self.db.is_plugin_enabled(plugin_id).unwrap_or(true)
    }

    pub fn set_plugin_enabled(&self, plugin_id: &str, enabled: bool) -> Result<(), String> {
        self.db
            .set_plugin_enabled(plugin_id, enabled)
            .map_err(|e| e.to_string())?;
        // Sincroniza ciclo de vida do MCP se for plugin do tipo tool
        if let Some(manifest) = self.get_manifest(plugin_id) {
            if manifest.provides.plugin_type == "tool" {
                if let Some(rt) = manifest.runtime {
                    if enabled && rt.auto_start {
                        let cfg = McpServerConfig {
                            id: plugin_id.to_string(),
                            name: Some(manifest.plugin.name.clone()),
                            command: rt.command.clone(),
                            args: rt.args.clone(),
                            working_dir: Some(manifest.folder_path.clone()),
                            env: rt.env.clone(),
                            auto_start: true,
                        };
                        let _ = self.mcp_manager.start_server(cfg);
                    } else if !enabled {
                        let _ = self.mcp_manager.stop_server(plugin_id);
                    }
                } else if !enabled {
                    let _ = self.mcp_manager.stop_server(plugin_id);
                }
            }
        }
        Ok(())
    }

    pub fn list_plugins(&self) -> Vec<Value> {
        let manifests = self.manifests.read().unwrap();
        manifests
            .values()
            .map(|m| {
                let enabled = self.is_plugin_enabled(&m.plugin.id);
                json!({
                    "id": m.plugin.id,
                    "name": m.plugin.name,
                    "version": m.plugin.version,
                    "author": m.plugin.author,
                    "description": m.plugin.description,
                    "type": m.provides.plugin_type,
                    "enabled": enabled,
                    "folder": m.folder_path.to_string_lossy(),
                })
            })
            .collect()
    }

    pub fn list_skills(&self) -> Vec<PluginManifest> {
        let manifests = self.manifests.read().unwrap();
        manifests
            .values()
            .filter(|m| m.provides.plugin_type == "skill" && m.skill.is_some())
            .map(|m| {
                let mut item = m.clone();
                item.enabled = Some(self.is_plugin_enabled(&m.plugin.id));
                item
            })
            .collect()
    }

    pub fn list_themes(&self) -> Vec<Value> {
        let manifests = self.manifests.read().unwrap();
        manifests
            .values()
            .filter(|m| m.provides.plugin_type == "theme" && m.theme.is_some())
            .map(|m| {
                let theme_cfg = m.theme.as_ref().unwrap();
                let css_path = m.folder_path.join(&theme_cfg.file);
                let css_content = fs::read_to_string(&css_path).unwrap_or_default();
                json!({
                    "id": m.plugin.id,
                    "name": m.plugin.name,
                    "description": m.plugin.description,
                    "css": css_content,
                    "preview": theme_cfg.preview,
                })
            })
            .collect()
    }

    pub fn get_manifest(&self, plugin_id: &str) -> Option<PluginManifest> {
        let manifests = self.manifests.read().unwrap();
        manifests.get(plugin_id).cloned()
    }
}
