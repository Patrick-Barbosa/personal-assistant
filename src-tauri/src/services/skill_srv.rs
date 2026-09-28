use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};

pub use crate::domain::models::SkillInfo;

static PROMOTE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

pub struct SkillManager {
    skills_dir: PathBuf,
}

impl SkillManager {
    pub fn new(skills_dir: PathBuf) -> Self {
        if !skills_dir.exists() {
            let _ = fs::create_dir_all(&skills_dir);
        }
        Self { skills_dir }
    }

    pub fn get_skills_dir(&self) -> &Path {
        &self.skills_dir
    }

    /// Move/promove skills instaladas pelo npx em subpastas de agentes (como .agents/skills/*) para a raiz de skills/
    pub fn promote_subagent_skills(&self) {
        let lock = PROMOTE_LOCK.get_or_init(|| Mutex::new(()));
        let _guard = lock.lock().unwrap();
        let candidates = [
            self.skills_dir.join(".agents").join("skills"),
            self.skills_dir.join(".claude").join("skills"),
            self.skills_dir.join(".cursor").join("skills"),
            self.skills_dir.join(".windsurf").join("skills"),
            self.skills_dir.join(".qwen").join("skills"),
            self.skills_dir.join(".vibe").join("skills"),
            self.skills_dir.join(".opencode").join("skills"),
            self.skills_dir.join(".codex").join("skills"),
        ];

        for sub_dir in &candidates {
            if sub_dir.exists() && sub_dir.is_dir() {
                if let Ok(entries) = fs::read_dir(sub_dir) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if path.is_dir() {
                            if let Some(folder_name) = path.file_name() {
                                let target = self.skills_dir.join(folder_name);
                                if !target.exists() {
                                    if fs::rename(&path, &target).is_err()
                                        && copy_dir_all(&path, &target).is_ok()
                                    {
                                        let _ = fs::remove_dir_all(&path);
                                    }
                                    println!(
                                        "[SKILLS] Promoveu skill de '{}' para '{}'",
                                        path.display(),
                                        target.display()
                                    );
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    /// Lista todas as skills encontradas na pasta skills/
    pub fn list_skills(&self, db: &crate::db::Database) -> Vec<SkillInfo> {
        self.promote_subagent_skills();
        let mut skills = Vec::new();
        if !self.skills_dir.exists() {
            return skills;
        }

        let entries = match fs::read_dir(&self.skills_dir) {
            Ok(e) => e,
            Err(_) => return skills,
        };

        for entry in entries.flatten() {
            let path = entry.path();
            // Ignora pastas ocultas (.agents, .qwen etc.) e symlinks
            if let Some(fname) = path.file_name().and_then(|n| n.to_str()) {
                if fname.starts_with('.') {
                    continue;
                }
            }
            if path.is_symlink() {
                continue;
            }
            if path.is_dir() {
                if let Some(info) = self.parse_skill_folder(&path, db) {
                    skills.push(info);
                }
            }
        }

        // Ordena por nome
        skills.sort_by_key(|a| a.name.to_lowercase());
        skills
    }

    /// Obtém uma skill específica por ID (slug da pasta)
    pub fn get_skill(&self, skill_id: &str, db: &crate::db::Database) -> Option<SkillInfo> {
        let folder = self.skills_dir.join(skill_id);
        if folder.exists() && folder.is_dir() {
            self.parse_skill_folder(&folder, db)
        } else {
            None
        }
    }

    /// Faz o parse da pasta de uma skill inspecionando SKILL.md e scripts/
    pub fn parse_skill_folder(&self, folder: &Path, db: &crate::db::Database) -> Option<SkillInfo> {
        let folder_name = folder.file_name()?.to_string_lossy().to_string();
        let skill_md_path = folder.join("SKILL.md");
        let legacy_yaml_path = folder.join("copernico-plugin.yaml");

        let mut name = folder_name.clone();
        let mut description = String::new();
        let mut prompt_instructions = String::new();

        if skill_md_path.exists() {
            if let Ok(content) = fs::read_to_string(&skill_md_path) {
                let (parsed_name, parsed_desc, instructions) = Self::parse_skill_md(&content);
                if let Some(n) = parsed_name {
                    name = n;
                }
                if let Some(d) = parsed_desc {
                    description = d;
                }
                prompt_instructions = instructions;
            }
        } else if legacy_yaml_path.exists() {
            if let Ok(content) = fs::read_to_string(&legacy_yaml_path) {
                if let Ok(val) = serde_yaml::from_str::<serde_json::Value>(&content) {
                    if let Some(n) = val
                        .get("plugin")
                        .and_then(|p| p.get("name"))
                        .and_then(|n| n.as_str())
                    {
                        name = n.to_string();
                    }
                    if let Some(d) = val
                        .get("plugin")
                        .and_then(|p| p.get("description"))
                        .and_then(|d| d.as_str())
                    {
                        description = d.to_string();
                    }
                    if let Some(sys) = val
                        .get("skill")
                        .and_then(|s| s.get("system_prompt"))
                        .and_then(|s| s.as_str())
                    {
                        prompt_instructions = sys.to_string();
                    }
                }
            }
        } else {
            return None;
        }

        // Auto-detecção de scripts (filtra apenas .py/.sh e ordena)
        let mut script_files = Vec::new();
        let scripts_dir = folder.join("scripts");
        if scripts_dir.exists() && scripts_dir.is_dir() {
            if let Ok(s_entries) = fs::read_dir(&scripts_dir) {
                for s_entry in s_entries.flatten() {
                    let s_path = s_entry.path();
                    if s_path.is_file() {
                        if let Some(fname) = s_path.file_name().and_then(|f| f.to_str()) {
                            // Apenas considera scripts relevantes
                            if fname.ends_with(".py")
                                || fname.ends_with(".sh")
                                || !fname.contains('.')
                                || s_path.extension().is_some_and(|e| e == "py" || e == "sh")
                            {
                                script_files.push(fname.to_string());
                            }
                        }
                    }
                }
            }
        }

        // Também checa se há scripts .py soltos na raiz da skill
        if let Ok(r_entries) = fs::read_dir(folder) {
            for r_entry in r_entries.flatten() {
                let r_path = r_entry.path();
                if r_path.is_file() {
                    if let Some(ext) = r_path.extension().and_then(|e| e.to_str()) {
                        if ext == "py" {
                            if let Some(fname) = r_path.file_name().and_then(|f| f.to_str()) {
                                if !script_files.contains(&fname.to_string()) {
                                    script_files.push(fname.to_string());
                                }
                            }
                        }
                    }
                }
            }
        }

        script_files.sort();
        let has_scripts = !script_files.is_empty();

        // Checa se a skill está habilitada no SQLite (padrão true)
        let disabled_key = format!("skill_disabled::{}", folder_name);
        let is_disabled = db
            .get_setting(&disabled_key)
            .ok()
            .flatten()
            .map(|v| v == "true")
            .unwrap_or(false);

        Some(SkillInfo {
            id: folder_name,
            name,
            description,
            has_scripts,
            script_files,
            prompt_instructions,
            folder_path: folder.to_string_lossy().to_string(),
            is_enabled: !is_disabled,
        })
    }

    /// Faz o parse do conteúdo de SKILL.md extraindo YAML frontmatter e corpo (robusto a "---" dentro de valores)
    pub fn parse_skill_md(content: &str) -> (Option<String>, Option<String>, String) {
        let trimmed = content.trim();
        if let Some(rest) = trimmed.strip_prefix("---") {
            // Procura o fechamento "---" em linha isolada (evita split dentro de valores como "a --- b")
            // Normaliza quebras de linha para \n
            let rest_normalized = rest.replace("\r\n", "\n");
            if let Some(end_idx) = rest_normalized.find("\n---") {
                let yaml_part = rest_normalized[..end_idx].trim();
                let after = &rest_normalized[end_idx + 4..]; // pula "\n---"
                                                             // Remove possíveis "---" restantes na linha e quebras
                let body_part = after
                    .trim_start_matches(['-', '\n', '\r', ' '])
                    .trim()
                    .to_string();
                let mut name = None;
                let mut desc = None;
                if let Ok(yaml_val) = serde_yaml::from_str::<serde_json::Value>(yaml_part) {
                    if let Some(n) = yaml_val.get("name").and_then(|v| v.as_str()) {
                        name = Some(n.to_string());
                    }
                    if let Some(d) = yaml_val.get("description").and_then(|v| v.as_str()) {
                        desc = Some(d.to_string());
                    }
                }
                return (name, desc, body_part);
            }
            // Fallback legado splitn caso não encontre "\n---"
            let parts: Vec<&str> = trimmed.splitn(3, "---").collect();
            if parts.len() >= 3 {
                let yaml_part = parts[1];
                let body_part = parts[2].trim().to_string();
                let mut name = None;
                let mut desc = None;
                if let Ok(yaml_val) = serde_yaml::from_str::<serde_json::Value>(yaml_part) {
                    if let Some(n) = yaml_val.get("name").and_then(|v| v.as_str()) {
                        name = Some(n.to_string());
                    }
                    if let Some(d) = yaml_val.get("description").and_then(|v| v.as_str()) {
                        desc = Some(d.to_string());
                    }
                }
                return (name, desc, body_part);
            }
        }
        // Caso sem frontmatter formal
        (None, None, content.to_string())
    }

    /// Alterna status ativado/desativado da skill
    pub fn toggle_skill(
        &self,
        skill_id: &str,
        enabled: bool,
        db: &crate::db::Database,
    ) -> Result<(), String> {
        let trimmed = skill_id.trim();
        if trimmed.is_empty()
            || trimmed.contains("..")
            || trimmed.contains('/')
            || trimmed.contains('\\')
            || trimmed.starts_with('.')
        {
            return Err("Identificador de skill inválido".into());
        }
        // Valida existência para evitar poluir DB com chaves órfãs
        let folder = self.skills_dir.join(trimmed);
        if !folder.exists() || !folder.is_dir() {
            return Err(format!("Skill '{}' não encontrada", trimmed));
        }
        let disabled_key = format!("skill_disabled::{}", trimmed);
        if enabled {
            db.delete_setting(&disabled_key)
                .map_err(|e| e.to_string())?;
        } else {
            db.set_setting(&disabled_key, "true")
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    /// Exclui uma pasta de skill (remoção completa e definitiva)
    pub fn delete_skill(
        &self,
        skill_id: &str,
        db: Option<&crate::db::Database>,
    ) -> Result<(), String> {
        // Validação defensiva contra Path Traversal e deleção de pastas sistema (.agents, .qwen)
        let trimmed = skill_id.trim();
        if trimmed.is_empty()
            || trimmed.contains("..")
            || trimmed.contains('/')
            || trimmed.contains('\\')
            || trimmed.starts_with('.')
        {
            return Err("Identificador de skill inválido".into());
        }
        let sanitized = trimmed;

        // 1. Remove pasta principal em skills/<id>
        let target = self.skills_dir.join(sanitized);
        if target.exists() {
            fs::remove_dir_all(&target)
                .map_err(|e| format!("Falha ao remover pasta da skill: {}", e))?;
            println!("[SKILLS] Removida pasta principal: {}", target.display());
        }

        // 2. Remove clones residuais em subpastas de agentes (.agents/.claude/.qwen/.vibe etc) para evitar ressurreição no promote
        let subagent_bases = [
            ".agents",
            ".claude",
            ".cursor",
            ".windsurf",
            ".qwen",
            ".vibe",
            ".opencode",
            ".codex",
        ];
        for base in &subagent_bases {
            let clone_path = self.skills_dir.join(base).join("skills").join(sanitized);
            if clone_path.exists() {
                let _ = fs::remove_dir_all(&clone_path);
                println!("[SKILLS] Removido clone residual: {}", clone_path.display());
            }
        }

        // 3. Remove entrada de skills-lock.json se existir
        let lock_path = self.skills_dir.join("skills-lock.json");
        if lock_path.exists() {
            if let Ok(content) = fs::read_to_string(&lock_path) {
                if let Ok(mut lock_val) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(skills_obj) =
                        lock_val.get_mut("skills").and_then(|v| v.as_object_mut())
                    {
                        if skills_obj.remove(sanitized).is_some() {
                            if let Ok(new_content) = serde_json::to_string_pretty(&lock_val) {
                                let _ = crate::vault::VaultManager::atomic_write(
                                    &lock_path,
                                    &new_content,
                                );
                                println!(
                                    "[SKILLS] Removida entrada de skills-lock.json para '{}'",
                                    sanitized
                                );
                            }
                        }
                    }
                }
            }
        }

        // 4. Limpa configurações persistidas no SQLite (disabled, config, cron override)
        if let Some(database) = db {
            let _ = database.delete_setting(&format!("skill_disabled::{}", sanitized));
            let _ = database.delete_setting(&format!("skill_config::{}", sanitized));
            let _ = database.delete_setting(&format!("skill_cron_override::{}", sanitized));
        }

        // 5. Se a pasta principal não existia e nem clones foram encontrados, ainda retorna Ok para idempotência
        // mas valida que pelo menos houve tentativa
        Ok(())
    }

    /// Abre a pasta no Windows Explorer
    pub fn open_folder_in_explorer(&self) -> Result<(), String> {
        #[cfg(windows)]
        {
            Command::new("explorer.exe")
                .arg(&self.skills_dir)
                .spawn()
                .map_err(|e| format!("Falha ao abrir Explorer: {}", e))?;
            Ok(())
        }
        #[cfg(not(windows))]
        {
            Ok(())
        }
    }

    /// Instala uma skill usando npx skills add <source> --copy
    pub fn install_from_source(&self, source: &str) -> Result<String, String> {
        let clean_source = source.trim();
        if clean_source.is_empty() {
            return Err("Origem da skill não pode ser vazia".into());
        }

        // Normaliza links do skills.sh (ex: https://skills.sh/owner/repo/skill -> owner/repo/skill)
        let mut pkg = clean_source.to_string();
        if pkg.starts_with("https://skills.sh/") || pkg.starts_with("https://www.skills.sh/") {
            let stripped = pkg
                .trim_start_matches("https://skills.sh/")
                .trim_start_matches("https://www.skills.sh/");
            // Remove query e fragment
            let without_query = stripped.split('?').next().unwrap_or(stripped);
            let without_frag = without_query.split('#').next().unwrap_or(without_query);
            let cleaned = without_frag.trim().trim_matches('/').to_string();
            if !cleaned.is_empty() {
                pkg = cleaned;
            }
        } else {
            // Remove query/fragment mesmo para forma curta
            let without_query = pkg.split('?').next().unwrap_or(&pkg).to_string();
            let without_frag = without_query
                .split('#')
                .next()
                .unwrap_or(&without_query)
                .to_string();
            pkg = without_frag.trim().trim_matches('/').to_string();
        }

        // Validação de formato e prevenção de Path Traversal / Injeção
        if pkg.contains("..")
            || pkg.contains('\\')
            || pkg.contains(' ')
            || pkg.contains('&')
            || pkg.contains('|')
            || pkg.contains(';')
            || pkg.contains('`')
            || pkg.contains('$')
            || pkg.contains('>')
            || pkg.contains('<')
        {
            return Err("Formato de pacote inválido: caracteres proibidos detectados".into());
        }
        // Regex: owner/repo ou owner/repo/skill (2 a 3 segmentos)
        let re_pkg =
            regex::Regex::new(r"^[a-zA-Z0-9._\-]+/[a-zA-Z0-9._\-]+(/[a-zA-Z0-9._\-]+)?$").unwrap();
        if !re_pkg.is_match(&pkg) {
            return Err("Formato de pacote inválido. Use 'owner/repo' ou 'owner/repo/skill' ou URL https://skills.sh/owner/repo".into());
        }

        println!("[SKILLS] Instalando skill via npx skills add '{}'...", pkg);

        // Usa npx diretamente (sem cmd.exe /C para evitar RCE)
        let mut cmd = Command::new("npx");
        cmd.args(["-y", "skills", "add", &pkg, "-y", "--copy"]);
        cmd.current_dir(&self.skills_dir);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }

        // Executa com timeout de 90s para evitar hang infinito
        let output = {
            use std::sync::mpsc;
            use std::time::Duration;
            let (tx, rx) = mpsc::channel();
            let mut cmd_clone = cmd;
            std::thread::spawn(move || {
                let res = cmd_clone.output();
                let _ = tx.send(res);
            });
            match rx.recv_timeout(Duration::from_secs(90)) {
                Ok(Ok(out)) => out,
                Ok(Err(e)) => {
                    return Err(format!("Falha ao executar comando de instalação: {}", e))
                }
                Err(_) => return Err(
                    "Timeout (90s) ao instalar skill. Verifique sua conexão ou se o pacote existe."
                        .into(),
                ),
            }
        };
        let stdout_raw = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr_raw = String::from_utf8_lossy(&output.stderr).to_string();

        let stdout = strip_ansi_escapes(&stdout_raw);
        let stderr = strip_ansi_escapes(&stderr_raw);

        if !output.status.success() {
            eprintln!("[SKILLS ERROR] {}", stderr);
            return Err(format!(
                "Erro durante a instalação da skill:\n{}",
                if !stderr.trim().is_empty() {
                    &stderr
                } else {
                    &stdout
                }
            ));
        }

        // Promove somente em caso de sucesso
        self.promote_subagent_skills();

        println!("[SKILLS OK] {}", stdout);
        Ok(stdout)
    }
}

pub fn strip_ansi_escapes(input: &str) -> String {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    let re = RE.get_or_init(|| regex::Regex::new(r"(\x1b\[|\x9b)[0-?]*[ -/]*[@-~]").unwrap());
    re.replace_all(input, "").to_string()
}

fn copy_dir_all(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        if ty.is_dir() {
            copy_dir_all(&entry.path(), &dst.join(entry.file_name()))?;
        } else {
            fs::copy(entry.path(), dst.join(entry.file_name()))?;
        }
    }
    Ok(())
}
