use chrono::Utc;
use regex::Regex;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use walkdir::WalkDir;

pub use crate::domain::models::{
    BaseFile, GraphData, GraphLink, GraphNode, Note, NoteFrontmatter, NoteTitleItem, RenameReport,
};

const RESERVED_NAMES: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

const HIDDEN_DIR_PREFIXES: &[&str] = &[
    ".obsidian",
    ".trash",
    ".stfolder",
    ".stfolder.removed",
    ".Android",
    ".copilot-index",
    ".thumbcache",
];

pub fn sanitize_filename(name: &str) -> String {
    let mut cleaned = name.trim();
    if cleaned.to_lowercase().ends_with(".md") {
        cleaned = &cleaned[..cleaned.len() - 3];
    }

    let re_invalid = Regex::new(r#"[<>:"/\\|?*\x00-\x1f]"#).unwrap();
    let sanitized = re_invalid.replace_all(cleaned.trim(), "_").to_string();

    let re_spaces = Regex::new(r"[_\s]+").unwrap();
    let mut sanitized = re_spaces.replace_all(&sanitized, "_").to_string();

    sanitized = sanitized
        .trim_matches(|c| c == '.' || c == '_' || c == ' ')
        .to_string();

    if sanitized.is_empty() {
        sanitized = "sem_titulo".to_string();
    }

    if RESERVED_NAMES.contains(&sanitized.to_uppercase().as_str()) {
        sanitized = format!("_{}", sanitized);
    }

    if sanitized.chars().count() > 200 {
        sanitized = sanitized.chars().take(200).collect();
    }

    sanitized
}

static ACTIVE_DATE_FORMAT: std::sync::RwLock<String> = std::sync::RwLock::new(String::new());

pub fn set_active_date_format(fmt: &str) {
    if let Ok(mut lock) = ACTIVE_DATE_FORMAT.write() {
        *lock = fmt.trim().to_string();
    }
}

pub fn get_active_date_format() -> String {
    if let Ok(lock) = ACTIVE_DATE_FORMAT.read() {
        if !lock.is_empty() {
            return lock.clone();
        }
    }
    "DD-MM-YY".to_string()
}

pub fn format_date_with(dt: chrono::DateTime<chrono::Local>, fmt_pattern: &str) -> String {
    match fmt_pattern.to_uppercase().as_str() {
        "YYYY-MM-DD" => dt.format("%Y-%m-%d").to_string(),
        "DD-MM-YYYY" => dt.format("%d-%m-%Y").to_string(),
        _ => dt.format("%d-%m-%y").to_string(),
    }
}

/// Data padrão do Copernico formatada conforme o padrão ativo do usuário.
pub fn hoje_ddmmyy() -> String {
    let fmt = get_active_date_format();
    format_date_with(chrono::Local::now(), &fmt)
}

/// Data + hora padrão para títulos de pendência/fallback no formato ativo.
pub fn agora_ddmmyy_hm() -> String {
    let fmt = get_active_date_format();
    let dt = chrono::Local::now();
    match fmt.to_uppercase().as_str() {
        "YYYY-MM-DD" => dt.format("%Y-%m-%d %H:%M").to_string(),
        "DD-MM-YYYY" => dt.format("%d-%m-%Y %H:%M").to_string(),
        _ => dt.format("%d-%m-%y %H:%M").to_string(),
    }
}

/// Normaliza título/stem para comparação de wikilinks:
/// minúsculas, `_` vira espaço, colapsa espaços.
pub fn normalize_wikilink_target(s: &str) -> String {
    s.trim()
        .to_lowercase()
        .replace('_', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[derive(Clone)]
pub struct VaultManager {
    pub default_vault: PathBuf,
    pub obsidian_vault: PathBuf,
}

impl VaultManager {
    pub fn new(default_vault: PathBuf, obsidian_vault: PathBuf) -> Self {
        let _ = fs::create_dir_all(&default_vault);
        let _ = fs::create_dir_all(default_vault.join("Inbox"));
        let _ = fs::create_dir_all(&obsidian_vault);
        Self {
            default_vault,
            obsidian_vault,
        }
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

    pub fn list_md_files(&self, vault_path: &Path) -> Vec<PathBuf> {
        let mut files = Vec::new();
        for entry in WalkDir::new(vault_path).into_iter().filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.is_file()
                && path.extension().map(|ext| ext == "md").unwrap_or(false)
                && !Self::is_hidden(path, vault_path)
            {
                files.push(path.to_path_buf());
            }
        }
        files.sort();
        files
    }

    pub fn list_all_notes(&self) -> (Vec<PathBuf>, Vec<PathBuf>) {
        (
            self.list_md_files(&self.default_vault),
            self.list_md_files(&self.obsidian_vault),
        )
    }

    /// Lista todos os arquivos `.base` dentro de um cofre, ignorando pastas ocultas.
    pub fn list_base_files(&self, vault_path: &Path) -> Vec<PathBuf> {
        let mut files = Vec::new();
        for entry in WalkDir::new(vault_path).into_iter().filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.is_file()
                && path.extension().map(|ext| ext == "base").unwrap_or(false)
                && !Self::is_hidden(path, vault_path)
            {
                files.push(path.to_path_buf());
            }
        }
        files.sort();
        files
    }

    /// Parseia um arquivo `.base` do Obsidian (YAML puro) e extrai a pasta alvo,
    /// colunas definidas e título derivado do nome do arquivo.
    pub fn parse_base_file(
        path: &Path,
        vault_root: &Path,
    ) -> Result<BaseFile, Box<dyn std::error::Error + Send + Sync>> {
        let raw = fs::read_to_string(path)?;
        let yaml: serde_yaml::Value = serde_yaml::from_str(&raw)?;

        // Extrair file.inFolder(...) do YAML via regex (pode estar em filters.and[] ou na raiz)
        let re_infolder = Regex::new(r#"file\.inFolder\("([^"]+)"\)"#).unwrap();
        let folder_filter = re_infolder
            .captures(&raw)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().to_string())
            .unwrap_or_default();

        // Extrair colunas de views[0].order (a lista de campos mostrados na tabela)
        let mut columns = Vec::new();
        if let Some(views) = yaml.get("views").and_then(|v| v.as_sequence()) {
            if let Some(first_view) = views.first() {
                if let Some(order) = first_view.get("order").and_then(|o| o.as_sequence()) {
                    for col in order {
                        if let Some(col_str) = col.as_str() {
                            // Ignora "file.name" pois usamos o nome do arquivo como primeira coluna automaticamente
                            if col_str != "file.name" {
                                columns.push(col_str.to_string());
                            }
                        }
                    }
                }
            }
        }

        // Extrair colunas de properties (pode ter campos extras não listados em order)
        if let Some(props) = yaml.get("properties").and_then(|p| p.as_mapping()) {
            for (key, _) in props {
                if let Some(key_str) = key.as_str() {
                    if key_str != "file.name" && !columns.contains(&key_str.to_string()) {
                        columns.push(key_str.to_string());
                    }
                }
            }
        }

        let title = path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "Sem Título".to_string());

        let category = Self::extract_category(path, vault_root);

        Ok(BaseFile {
            path: path.to_path_buf(),
            title,
            folder_filter,
            columns,
            category,
        })
    }

    /// Compila um `.base` parseado em um documento Markdown rico e legível contendo
    /// uma tabela com todos os itens filhos e seus atributos extraídos dos frontmatters.
    /// Este texto é usado para gerar embeddings semânticos e para exibição via `ler_nota`.
    pub fn compile_base_to_markdown(
        &self,
        base: &BaseFile,
    ) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
        if base.folder_filter.is_empty() {
            return Err(format!(
                "Base '{}' não possui filtro file.inFolder válido",
                base.title
            )
            .into());
        }

        // Resolve a pasta alvo relativa ao cofre obsidian
        let target_folder = self.obsidian_vault.join(&base.folder_filter);
        if !target_folder.exists() || !target_folder.is_dir() {
            return Err(format!(
                "Base '{}' aponta para pasta inexistente: {}",
                base.title,
                target_folder.display()
            )
            .into());
        }

        // Lista todos os .md na pasta alvo
        let child_files = self.list_md_files(&target_folder);
        if child_files.is_empty() {
            return Ok(format!(
                "# {}\nCategoria: {}\n\n*Nenhum item encontrado na pasta.*\n",
                base.title,
                base.category.as_deref().unwrap_or("—")
            ));
        }

        let mut doc = String::new();
        doc.push_str(&format!("# {}\n", base.title));
        if let Some(ref cat) = base.category {
            doc.push_str(&format!("Categoria: {}\n", cat));
        }
        doc.push_str(&format!("Total de itens: {}\n\n", child_files.len()));

        // Determinar colunas efetivas: nome do item + colunas do .base
        let effective_columns: Vec<&str> = base.columns.iter().map(|s| s.as_str()).collect();

        // Cabeçalho da tabela Markdown
        doc.push_str("| Item |");
        for col in &effective_columns {
            doc.push_str(&format!(" {} |", col));
        }
        doc.push('\n');

        // Separador
        doc.push_str("|---|");
        for _ in &effective_columns {
            doc.push_str("---|");
        }
        doc.push('\n');

        // Linhas da tabela + lista textual para embedding
        let mut item_names = Vec::new();

        for child_path in &child_files {
            let item_name = child_path
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| "—".to_string());

            item_names.push(item_name.clone());

            // Parseia frontmatter do item filho
            let fm_extra = match Self::parse_note_file(child_path) {
                Ok((fm, _)) => fm.extra,
                Err(_) => std::collections::HashMap::new(),
            };

            doc.push_str(&format!("| {} |", item_name));
            for col in &effective_columns {
                let val = fm_extra
                    .get(*col)
                    .map(Self::yaml_value_to_display)
                    .unwrap_or_else(|| "—".to_string());
                doc.push_str(&format!(" {} |", val));
            }
            doc.push('\n');
        }

        // Lista textual plana para fallback semântico (melhora relevância nos embeddings)
        doc.push_str(&format!("\nItens: {}\n", item_names.join(", ")));

        Ok(doc)
    }

    /// Converte um `serde_yaml::Value` para uma string legível para exibição em tabelas.
    fn yaml_value_to_display(v: &serde_yaml::Value) -> String {
        match v {
            serde_yaml::Value::String(s) => {
                let trimmed = s.trim();
                if trimmed.is_empty() {
                    "—".to_string()
                } else {
                    trimmed.to_string()
                }
            }
            serde_yaml::Value::Number(n) => n.to_string(),
            serde_yaml::Value::Bool(b) => {
                if *b {
                    "Sim".to_string()
                } else {
                    "Não".to_string()
                }
            }
            serde_yaml::Value::Sequence(seq) => {
                let items: Vec<String> = seq
                    .iter()
                    .filter_map(|x| match x {
                        serde_yaml::Value::String(s) => Some(s.clone()),
                        serde_yaml::Value::Number(n) => Some(n.to_string()),
                        serde_yaml::Value::Bool(b) => {
                            Some(if *b { "Sim" } else { "Não" }.to_string())
                        }
                        _ => None,
                    })
                    .collect();
                if items.is_empty() {
                    "—".to_string()
                } else {
                    items.join(", ")
                }
            }
            serde_yaml::Value::Null => "—".to_string(),
            _ => "—".to_string(),
        }
    }

    pub fn get_default_vault(&self) -> &Path {
        &self.default_vault
    }

    pub fn list_all_note_titles(&self) -> Vec<NoteTitleItem> {
        let mut result = Vec::new();
        for file in self.list_md_files(&self.default_vault) {
            let (fm, content) = Self::parse_note_file(&file).unwrap_or_default();
            let title = Self::extract_obsidian_title(&file, &content, &fm);
            result.push(NoteTitleItem {
                title,
                vault: "default".to_string(),
                path: file.to_string_lossy().to_string(),
            });
        }
        for file in self.list_md_files(&self.obsidian_vault) {
            let (fm, content) = Self::parse_note_file(&file).unwrap_or_default();
            let title = Self::extract_obsidian_title(&file, &content, &fm);
            result.push(NoteTitleItem {
                title,
                vault: "obsidian".to_string(),
                path: file.to_string_lossy().to_string(),
            });
        }
        for file in self.list_base_files(&self.obsidian_vault) {
            let title = file
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| "Sem Título".to_string());
            result.push(NoteTitleItem {
                title,
                vault: "obsidian".to_string(),
                path: file.to_string_lossy().to_string(),
            });
        }
        result.sort_by_key(|a| a.title.to_lowercase());
        result
    }

    pub fn parse_note_file(
        path: &Path,
    ) -> Result<(NoteFrontmatter, String), Box<dyn std::error::Error + Send + Sync>> {
        let raw = fs::read_to_string(path)?;
        if let Some(rest) = raw.strip_prefix("---") {
            if let Some(second_dash) = rest.find("---") {
                let yaml_slice = rest[..second_dash].trim();
                let body_slice = rest[second_dash + 3..].trim();
                if let Ok(fm) = serde_yaml::from_str::<NoteFrontmatter>(yaml_slice) {
                    return Ok((fm, body_slice.to_string()));
                }
            }
        }
        Ok((NoteFrontmatter::default(), raw.trim().to_string()))
    }

    pub fn extract_obsidian_title(
        path: &Path,
        content: &str,
        frontmatter: &NoteFrontmatter,
    ) -> String {
        if let Some(t) = frontmatter.titulo.as_ref().or(frontmatter.title.as_ref()) {
            if !t.trim().is_empty() {
                return t.trim().to_string();
            }
        }
        for line in content.lines() {
            let trimmed = line.trim();
            if let Some(stripped) = trimmed.strip_prefix("# ") {
                return stripped.trim().to_string();
            }
        }
        path.file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "Sem Título".to_string())
    }

    pub fn format_dynamic_metadata(frontmatter: &NoteFrontmatter) -> String {
        let mut parts = Vec::new();
        for (k, v) in &frontmatter.extra {
            let val_str = match v {
                serde_yaml::Value::String(s) => s.clone(),
                serde_yaml::Value::Sequence(seq) => seq
                    .iter()
                    .filter_map(|x| x.as_str())
                    .collect::<Vec<_>>()
                    .join(", "),
                serde_yaml::Value::Number(n) => n.to_string(),
                serde_yaml::Value::Bool(b) => b.to_string(),
                _ => continue,
            };
            if !val_str.trim().is_empty() {
                parts.push(format!("{}: {}", k, val_str));
            }
        }
        parts.join(" | ")
    }

    pub fn extract_category(path: &Path, vault_root: &Path) -> Option<String> {
        if let Ok(rel) = path.strip_prefix(vault_root) {
            let comps: Vec<_> = rel.components().collect();
            if comps.len() > 1 {
                if let std::path::Component::Normal(os_str) = comps[0] {
                    return Some(os_str.to_string_lossy().to_string());
                }
            }
        }
        None
    }

    pub fn resolve_path(
        &self,
        identifier: &str,
        target_vault: Option<&str>,
    ) -> Option<(PathBuf, String)> {
        let p = Path::new(identifier);

        // 1. Caminho absoluto existente
        if p.is_absolute() && p.exists() {
            let vault_name = if p.starts_with(&self.obsidian_vault) {
                "obsidian"
            } else {
                "default"
            };
            return Some((p.to_path_buf(), vault_name.to_string()));
        }

        // 2. Relativo direto
        let cand_def = self.default_vault.join(p);
        if cand_def.exists() {
            if let (Ok(canon_cand), Ok(canon_root)) =
                (cand_def.canonicalize(), self.default_vault.canonicalize())
            {
                if canon_cand.starts_with(&canon_root) {
                    return Some((cand_def, "default".to_string()));
                }
            }
        }
        let cand_obs = self.obsidian_vault.join(p);
        if cand_obs.exists() {
            if let (Ok(canon_cand), Ok(canon_root)) =
                (cand_obs.canonicalize(), self.obsidian_vault.canonicalize())
            {
                if canon_cand.starts_with(&canon_root) {
                    return Some((cand_obs, "obsidian".to_string()));
                }
            }
        }

        // 3. Sanitizado com .md na raiz
        let stripped = identifier.strip_suffix(".md").unwrap_or(identifier);
        let sanitized = sanitize_filename(stripped);
        let s_def = self.default_vault.join(format!("{}.md", sanitized));
        if s_def.exists() {
            return Some((s_def, "default".to_string()));
        }
        let s_obs = self.obsidian_vault.join(format!("{}.md", sanitized));
        if s_obs.exists() {
            return Some((s_obs, "obsidian".to_string()));
        }

        // 4. Varredura por título ou stem (case-insensitive)
        let target_lower = identifier.trim().to_lowercase();
        let stripped_lower = stripped.trim().to_lowercase();

        // Se target_vault não especificado, varre Obsidian primeiro (leitura), depois Default
        let vaults_to_check = match target_vault {
            Some("obsidian") => vec![(&self.obsidian_vault, "obsidian")],
            Some("default") => vec![(&self.default_vault, "default")],
            _ => vec![
                (&self.obsidian_vault, "obsidian"),
                (&self.default_vault, "default"),
            ],
        };

        for (vpath, vname) in vaults_to_check {
            for file in self.list_md_files(vpath) {
                if let Ok((fm, content)) = Self::parse_note_file(&file) {
                    let title = Self::extract_obsidian_title(&file, &content, &fm).to_lowercase();
                    if title == target_lower || title == stripped_lower {
                        return Some((file, vname.to_string()));
                    }
                }
                if let Some(stem) = file.file_stem() {
                    let stem_lower = stem.to_string_lossy().to_lowercase();
                    if stem_lower == target_lower || stem_lower == stripped_lower {
                        return Some((file, vname.to_string()));
                    }
                }
            }

            // 5. Fallback para arquivos .base (Obsidian Bases/Databases)
            for base_file in self.list_base_files(vpath) {
                if let Some(stem) = base_file.file_stem() {
                    let stem_lower = stem.to_string_lossy().to_lowercase();
                    if stem_lower == target_lower || stem_lower == stripped_lower {
                        return Some((base_file, vname.to_string()));
                    }
                }
            }
        }

        None
    }

    pub fn atomic_write(
        dest: &Path,
        content: &str,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let parent = dest.parent().ok_or("Destino inválido sem pasta pai")?;
        fs::create_dir_all(parent)?;

        // Cria arquivo temporário no mesmo diretório
        let mut temp_file = tempfile::Builder::new()
            .prefix(".tmp_note_")
            .suffix(".tmp")
            .tempfile_in(parent)?;

        temp_file.write_all(content.as_bytes())?;
        temp_file.flush()?;

        // Substituição atômica no mesmo filesystem
        temp_file.persist(dest)?;
        Ok(())
    }

    pub fn create_note(
        &self,
        titulo: &str,
        corpo: &str,
        tags: Option<Vec<String>>,
        topicos: Option<Vec<String>>,
    ) -> Result<PathBuf, Box<dyn std::error::Error + Send + Sync>> {
        self.create_note_with_patch(titulo, corpo, tags, topicos, NoteFrontmatter::default())
    }

    /// Cria uma nota aplicando um **patch de frontmatter** por cima dos valores
    /// padrão. Usado pelo Kanban para gravar `tipo: tarefa`/`tipo: entidade` e
    /// as chaves extras (`kanban_id`, `semana`, `subtipo`) sem duplicar a
    /// lógica de nomeação/escrita atômica de `create_note`.
    ///
    /// Só campos definidos no patch são sobrescritos (`Some`/lista não vazia);
    /// `extra` é mesclado — as chaves do patch vencem as existentes.
    pub fn create_note_with_patch(
        &self,
        titulo: &str,
        corpo: &str,
        tags: Option<Vec<String>>,
        topicos: Option<Vec<String>>,
        patch: NoteFrontmatter,
    ) -> Result<PathBuf, Box<dyn std::error::Error + Send + Sync>> {
        let trimmed_title = titulo.trim();
        if trimmed_title.is_empty() {
            return Err("Título não pode ser vazio".into());
        }

        let now = Utc::now();
        let id_str = now.format("%Y%m%d%H%M%S").to_string();
        // Padrão Copernico: data visível sempre em DD-MM-YY.
        let date_visible = hoje_ddmmyy();

        let base = sanitize_filename(trimmed_title);
        let mut dest = self.default_vault.join(format!("{}.md", base));

        if dest.exists() {
            dest = self.default_vault.join(format!("{}_{}.md", base, id_str));
            let mut counter = 1;
            while dest.exists() {
                dest = self
                    .default_vault
                    .join(format!("{}_{}_{}.md", base, id_str, counter));
                counter += 1;
            }
        }

        let mut fm = NoteFrontmatter {
            id: Some(id_str),
            titulo: Some(trimmed_title.to_string()),
            title: None,
            data: Some(date_visible),
            tags: tags.unwrap_or_default(),
            topicos: topicos.unwrap_or_default(),
            ..Default::default()
        };

        // Aplica o patch por cima dos valores padrão.
        if patch.tipo.is_some() {
            fm.tipo = patch.tipo;
        }
        if patch.id.is_some() {
            fm.id = patch.id;
        }
        if patch.base_origem.is_some() {
            fm.base_origem = patch.base_origem;
        }
        for (key, value) in patch.extra {
            fm.extra.insert(key, value);
        }
        if !patch.tags.is_empty() {
            fm.tags.extend(patch.tags);
        }
        if !patch.topicos.is_empty() {
            fm.topicos.extend(patch.topicos);
        }

        let yaml_header = serde_yaml::to_string(&fm)?;
        let full_text = format!("---\n{}---\n\n{}\n", yaml_header, corpo.trim());

        Self::atomic_write(&dest, &full_text)?;
        Ok(dest)
    }

    pub fn create_inbox_note(
        &self,
        titulo: &str,
        corpo: &str,
        tags: Option<Vec<String>>,
        topicos: Option<Vec<String>>,
    ) -> Result<PathBuf, Box<dyn std::error::Error + Send + Sync>> {
        let trimmed_title = titulo.trim();
        if trimmed_title.is_empty() {
            return Err("Título não pode ser vazio".into());
        }

        let inbox_dir = self.default_vault.join("Inbox");
        let _ = fs::create_dir_all(&inbox_dir);

        let now = Utc::now();
        let id_str = now.format("%Y%m%d%H%M%S").to_string();
        // Padrão Copernico: data visível sempre em DD-MM-YY.
        let date_visible = hoje_ddmmyy();

        let base = sanitize_filename(trimmed_title);
        let mut dest = inbox_dir.join(format!("{}.md", base));

        if dest.exists() {
            dest = inbox_dir.join(format!("{}_{}.md", base, id_str));
            let mut counter = 1;
            while dest.exists() {
                dest = inbox_dir.join(format!("{}_{}_{}.md", base, id_str, counter));
                counter += 1;
            }
        }

        let mut final_tags = tags.unwrap_or_default();
        if !final_tags.iter().any(|t| t.to_lowercase() == "inbox") {
            final_tags.push("inbox".to_string());
        }

        let fm = NoteFrontmatter {
            id: Some(id_str),
            titulo: Some(trimmed_title.to_string()),
            title: None,
            data: Some(date_visible),
            tags: final_tags,
            topicos: topicos.unwrap_or_default(),
            ..Default::default()
        };

        let yaml_header = serde_yaml::to_string(&fm)?;
        let full_text = format!("---\n{}---\n\n{}\n", yaml_header, corpo.trim());

        Self::atomic_write(&dest, &full_text)?;
        Ok(dest)
    }

    /// Evolui uma nota in-place modificando o próprio arquivo canônico no cofre padrão.
    /// Preserva o cofre original do Obsidian como somente-leitura. Se a nota base estiver no Obsidian,
    /// cria/atualiza a versão canônica correspondente no cofre padrão.
    /// Opcionalmente anexa/atualiza no rodapé a seção `## 📜 Histórico de Alterações`.
    pub fn evolve_note_in_place(
        &self,
        base_identifier: &str,
        changelog: &str,
        proposed_content: &str,
        source_session_id: Option<&str>,
        extra_tags: Option<Vec<String>>,
    ) -> Result<PathBuf, Box<dyn std::error::Error + Send + Sync>> {
        let clean_base = base_identifier
            .trim()
            .trim_start_matches("[[")
            .trim_end_matches("]]")
            .trim();
        let base_slug = sanitize_filename(clean_base);
        let date_display = hoje_ddmmyy();

        // 1. Localiza a nota existente no default vault ou obsidian vault
        let (dest_path, mut fm, existing_body) =
            if let Some((path, vault_name)) = self.resolve_path(clean_base, None) {
                if vault_name == "default" {
                    let (fm, body) = Self::parse_note_file(&path)?;
                    (path, fm, Some(body))
                } else {
                    // Se estiver no cofre Obsidian (R/O), a versão canônica editável vive no cofre default!
                    let default_path = self.default_vault.join(format!("{}.md", base_slug));
                    let (mut fm, body) = if default_path.exists() {
                        let (dfm, dbody) = Self::parse_note_file(&default_path)?;
                        (dfm, Some(dbody))
                    } else {
                        let (obs_fm, _) = Self::parse_note_file(&path)?;
                        (obs_fm, None)
                    };
                    if fm.base_origem.is_none() {
                        fm.base_origem = Some(format!("[[{}]]", clean_base));
                    }
                    (default_path, fm, body)
                }
            } else {
                // Nota nova no cofre padrão
                let default_path = self.default_vault.join(format!("{}.md", base_slug));
                (default_path, NoteFrontmatter::default(), None)
            };

        // 2. Atualiza tags e frontmatter
        if fm.titulo.is_none() {
            fm.titulo = Some(clean_base.to_string());
        }
        fm.data = Some(date_display.clone());
        if let Some(sess) = source_session_id {
            if !sess.trim().is_empty() {
                fm.sessao_origem = Some(sess.trim().to_string());
            }
        }
        if let Some(t_list) = extra_tags {
            for t in t_list {
                let cl = t.trim().to_string();
                if !cl.is_empty() && !fm.tags.contains(&cl) {
                    fm.tags.push(cl);
                }
            }
        }

        // 3. Monta o corpo com histórico de alterações no rodapé
        const HIST_HEADER: &str = "## 📜 Histórico de Alterações";
        let trimmed_proposed = proposed_content.trim();
        let new_entry = if !changelog.trim().is_empty() {
            Some(format!("- **{}**: {}", date_display, changelog.trim()))
        } else {
            None
        };

        // Extrai histórico anterior caso a proposta não o inclua
        let existing_history = if !trimmed_proposed.contains(HIST_HEADER) {
            if let Some(ref ebody) = existing_body {
                if let Some(pos) = ebody.find(HIST_HEADER) {
                    let hist_part = &ebody[pos + HIST_HEADER.len()..];
                    hist_part.trim().to_string()
                } else {
                    String::new()
                }
            } else {
                String::new()
            }
        } else {
            String::new()
        };

        let body_with_history = if trimmed_proposed.contains(HIST_HEADER) {
            if let Some(ref entry) = new_entry {
                trimmed_proposed.replace(HIST_HEADER, &format!("{}\n{}", HIST_HEADER, entry))
            } else {
                trimmed_proposed.to_string()
            }
        } else {
            let mut entries = Vec::new();
            if let Some(ref entry) = new_entry {
                entries.push(entry.clone());
            }
            if !existing_history.is_empty() {
                entries.push(existing_history);
            }

            if entries.is_empty() {
                trimmed_proposed.to_string()
            } else {
                format!(
                    "{}\n\n{}\n{}\n",
                    trimmed_proposed,
                    HIST_HEADER,
                    entries.join("\n")
                )
            }
        };

        // 4. Escreve arquivo canônico de forma atômica
        let yaml_header = serde_yaml::to_string(&fm)?;
        let full_text = format!("---\n{}---\n\n{}\n", yaml_header, body_with_history.trim());
        Self::atomic_write(&dest_path, &full_text)?;

        Ok(dest_path)
    }

    /// Executa a evolução da nota in-place na nota canônica (substituindo a proliferação em evolucoes/).
    pub fn create_evolved_note(
        &self,
        base_identifier: &str,
        changelog: &str,
        unified_content: &str,
        source_session_id: Option<&str>,
        extra_tags: Option<Vec<String>>,
    ) -> Result<PathBuf, Box<dyn std::error::Error + Send + Sync>> {
        self.evolve_note_in_place(
            base_identifier,
            changelog,
            unified_content,
            source_session_id,
            extra_tags,
        )
    }

    /// Arquiva uma nota do cofre padrão em snapshot seguro preservando o conteúdo integral
    /// (primeira metade do fluxo archive-then-delete). Não deleta — apenas cria o snapshot.
    pub fn archive_note(
        &self,
        identifier: &str,
        incorporada_em: Option<&str>,
        source_session_id: Option<&str>,
        motivo: &str,
    ) -> Result<PathBuf, Box<dyn std::error::Error + Send + Sync>> {
        let (resolved, vault_name) =
            self.resolve_path(identifier, Some("default"))
                .ok_or_else(|| {
                    format!(
                        "Nota não encontrada no cofre padrão para arquivar: '{}'",
                        identifier
                    )
                })?;

        if vault_name != "default" {
            return Err(
                "O cofre Obsidian é estritamente somente-leitura. Arquivamento proibido.".into(),
            );
        }

        let (mut fm, body) = Self::parse_note_file(&resolved)?;
        let titulo = Self::extract_obsidian_title(&resolved, &body, &fm);
        let stem = resolved
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| titulo.clone());
        let data_arquivo = hoje_ddmmyy();
        let destino = incorporada_em.unwrap_or("—").trim().to_string();

        let archive_dir = self.default_vault.join("arquivo");
        let _ = fs::create_dir_all(&archive_dir);
        let dest = archive_dir.join(format!(
            "{}-arquivada-{}.md",
            stem,
            sanitize_filename(&data_arquivo)
        ));

        fm.titulo = Some(format!("{} (Arquivada)", titulo));
        fm.data = Some(data_arquivo.clone());
        fm.tags.push("copernico/arquivo".to_string());
        if !destino.is_empty() && destino != "—" {
            fm.tags.push("incorporada".to_string());
        }
        if let Some(sid) = source_session_id {
            fm.sessao_origem = Some(sid.to_string());
        }

        let yaml_header = serde_yaml::to_string(&fm)?;
        let full_text = format!(
            "---\n{}---\n\n> [!warning] 📦 Nota Arquivada\n> Arquivada em {} — Motivo: {}. Incorporada em: {}.\n\n{}\n",
            yaml_header,
            data_arquivo,
            motivo.trim(),
            destino,
            body.trim()
        );

        Self::atomic_write(&dest, &full_text)?;
        Ok(dest)
    }

    /// Renomeia uma nota do cofre padrão com reapontamento garantido de `[[wikilinks]]`
    /// em todas as demais notas do cofre padrão (escrita atômica por arquivo).
    /// Notas do cofre Obsidian são somente-leitura: links vindos de lá são apenas
    /// detectados e devolvidos em `obsidian_blocked` para revisão manual.
    pub fn rename_note_with_repoint(
        &self,
        identifier: &str,
        novo_titulo: &str,
    ) -> Result<RenameReport, Box<dyn std::error::Error + Send + Sync>> {
        let novo_limpo = novo_titulo.trim();
        if novo_limpo.is_empty() {
            return Err("Novo título não pode ser vazio".into());
        }

        let (resolved, vault_name) =
            self.resolve_path(identifier, Some("default"))
                .ok_or_else(|| {
                    format!(
                        "Nota não encontrada no cofre padrão para renomear: '{}'",
                        identifier
                    )
                })?;

        if vault_name != "default" {
            return Err(
                "O cofre Obsidian é estritamente somente-leitura. Renomeação proibida.".into(),
            );
        }

        let (mut fm, body) = Self::parse_note_file(&resolved)?;
        let old_title = Self::extract_obsidian_title(&resolved, &body, &fm);
        let old_stem = resolved
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| old_title.clone());

        let new_base = sanitize_filename(novo_limpo);
        let parent = resolved.parent().ok_or("Destino inválido sem pasta pai")?;
        let mut new_path = parent.join(format!("{}.md", new_base));
        if new_path.exists() && new_path != resolved {
            let id_str = chrono::Utc::now().format("%Y%m%d%H%M%S").to_string();
            new_path = parent.join(format!("{}_{}.md", new_base, id_str));
            let mut counter = 1;
            while new_path.exists() {
                new_path = parent.join(format!("{}_{}_{}.md", new_base, id_str, counter));
                counter += 1;
            }
        }

        // Move físico (mesmo filesystem = atômico no Windows para rename).
        if new_path != resolved {
            fs::rename(&resolved, &new_path)?;
        }

        // Atualiza frontmatter do arquivo renomeado (título + data DD-MM-YY + linhagem).
        fm.titulo = Some(novo_limpo.to_string());
        fm.data = Some(hoje_ddmmyy());
        fm.extra.insert(
            "renomeada_de".to_string(),
            serde_yaml::Value::String(old_title.clone()),
        );
        fm.extra.insert(
            "renomeada_em".to_string(),
            serde_yaml::Value::String(hoje_ddmmyy()),
        );
        let yaml_header = serde_yaml::to_string(&fm)?;
        let full_text = format!("---\n{}---\n\n{}\n", yaml_header, body.trim());
        Self::atomic_write(&new_path, &full_text)?;

        // Conjunto de formas antigas aceitas (título, stem, identifier).
        let old_variants = [
            normalize_wikilink_target(&old_title),
            normalize_wikilink_target(&old_stem),
            normalize_wikilink_target(identifier),
        ];

        let re_link = Regex::new(r"\[\[([^\]]+)\]\]").unwrap();
        let mut repointed_files = Vec::new();

        for file in self.list_md_files(&self.default_vault) {
            if file == new_path || file == resolved {
                continue;
            }
            let raw = match fs::read_to_string(&file) {
                Ok(t) => t,
                Err(_) => continue,
            };
            let mut changed = false;
            let replaced = re_link
                .replace_all(&raw, |caps: &regex::Captures| {
                    let inner = caps.get(1).map(|m| m.as_str()).unwrap_or("");
                    // Separa alias `|` e âncora `#`, preservando-os no reapontamento.
                    let (before_pipe, alias) = match inner.find('|') {
                        Some(idx) => (&inner[..idx], Some(&inner[idx..])),
                        None => (inner, None),
                    };
                    let (base, anchor) = match before_pipe.find('#') {
                        Some(idx) => (&before_pipe[..idx], Some(&before_pipe[idx..])),
                        None => (before_pipe, None),
                    };
                    if old_variants.contains(&normalize_wikilink_target(base)) {
                        changed = true;
                        let mut out = String::from(novo_limpo);
                        if let Some(a) = anchor {
                            out.push_str(a);
                        }
                        if let Some(al) = alias {
                            out.push_str(al);
                        }
                        format!("[[{}]]", out)
                    } else {
                        caps.get(0).map(|m| m.as_str()).unwrap_or("").to_string()
                    }
                })
                .to_string();
            if changed && replaced != raw && Self::atomic_write(&file, &replaced).is_ok() {
                repointed_files.push(file);
            }
        }

        // Detecta links vindos do Obsidian (R/O — não reescreve, só reporta).
        let mut obsidian_blocked = Vec::new();
        for file in self.list_md_files(&self.obsidian_vault) {
            let raw = match fs::read_to_string(&file) {
                Ok(t) => t,
                Err(_) => continue,
            };
            for cap in re_link.captures_iter(&raw) {
                if let Some(m) = cap.get(1) {
                    let inner = m.as_str();
                    let base = inner.split('|').next().unwrap_or(inner);
                    let base = base.split('#').next().unwrap_or(base);
                    if old_variants.contains(&normalize_wikilink_target(base)) {
                        obsidian_blocked.push(file.clone());
                        break;
                    }
                }
            }
        }

        Ok(RenameReport {
            old_path: resolved,
            new_path: new_path.clone(),
            old_title,
            new_title: novo_limpo.to_string(),
            repointed_files,
            obsidian_blocked,
        })
    }

    pub fn read_note(
        &self,
        identifier: &str,
    ) -> Result<Note, Box<dyn std::error::Error + Send + Sync>> {
        let (resolved, vault_name) = self
            .resolve_path(identifier, None)
            .ok_or_else(|| format!("Nota não encontrada: '{}'", identifier))?;

        if resolved
            .extension()
            .map(|ext| ext == "base")
            .unwrap_or(false)
        {
            let base = Self::parse_base_file(&resolved, &self.obsidian_vault)?;
            let body = self.compile_base_to_markdown(&base)?;
            let titulo = base.title.clone();
            let categoria = base.category.clone();
            return Ok(Note {
                path: resolved.to_string_lossy().to_string(),
                titulo,
                frontmatter: NoteFrontmatter::default(),
                content: body,
                categoria,
                vault: vault_name,
            });
        }

        let (fm, body) = Self::parse_note_file(&resolved)?;
        let titulo = Self::extract_obsidian_title(&resolved, &body, &fm);
        let categoria = if vault_name == "obsidian" {
            Self::extract_category(&resolved, &self.obsidian_vault)
        } else {
            None
        };

        Ok(Note {
            path: resolved.to_string_lossy().to_string(),
            titulo,
            frontmatter: fm,
            content: body, // RETORNA CONTEÚDO COMPLETO SEM TRUNCAMENTO!
            categoria,
            vault: vault_name,
        })
    }

    pub fn update_note(
        &self,
        identifier: &str,
        novo_conteudo: &str,
        modo: &str, // "append" ou "replace"
    ) -> Result<PathBuf, Box<dyn std::error::Error + Send + Sync>> {
        let (resolved, vault_name) = self
            .resolve_path(identifier, Some("default"))
            .ok_or_else(|| format!("Nota não encontrada no cofre padrão: '{}'", identifier))?;

        if vault_name != "default" {
            return Err("O cofre Obsidian é estritamente somente-leitura. Edição proibida.".into());
        }

        let (fm, current_body) = Self::parse_note_file(&resolved)?;

        let updated_body = if modo == "replace" {
            novo_conteudo.trim().to_string()
        } else {
            // modo append
            let existing = current_body.trim();
            if existing.is_empty() {
                novo_conteudo.trim().to_string()
            } else {
                format!("{}\n\n{}", existing, novo_conteudo.trim())
            }
        };

        let yaml_header = serde_yaml::to_string(&fm)?;
        let full_text = format!("---\n{}---\n\n{}\n", yaml_header, updated_body);

        Self::atomic_write(&resolved, &full_text)?;
        Ok(resolved)
    }

    pub fn delete_note(
        &self,
        identifier: &str,
    ) -> Result<PathBuf, Box<dyn std::error::Error + Send + Sync>> {
        let (resolved, vault_name) =
            self.resolve_path(identifier, Some("default"))
                .ok_or_else(|| {
                    format!(
                        "Nota não encontrada no cofre padrão para deleção: '{}'",
                        identifier
                    )
                })?;

        if vault_name != "default" {
            return Err("O cofre Obsidian é somente-leitura. Deleção proibida.".into());
        }

        fs::remove_file(&resolved)?;
        Ok(resolved)
    }

    pub fn get_graph_data(&self) -> GraphData {
        let (default_files, obsidian_files) = self.list_all_notes();
        let mut nodes = Vec::new();
        let mut note_contents: Vec<(String, String, bool, Option<String>)> = Vec::new(); // (node_id, body, is_evolution, base_origem)
        let mut id_map = std::collections::HashSet::new();

        let all_files = default_files
            .into_iter()
            .map(|f| (f, "default"))
            .chain(obsidian_files.into_iter().map(|f| (f, "obsidian")));

        for (path, vault_name) in all_files {
            if let Ok((fm, body)) = Self::parse_note_file(&path) {
                let title = Self::extract_obsidian_title(&path, &body, &fm);
                let id = title.clone();
                let category = if vault_name == "obsidian" {
                    Self::extract_category(&path, &self.obsidian_vault)
                } else {
                    None
                };

                let is_evolution = fm.tipo.as_deref() == Some("nota_evoluida")
                    || fm.tags.iter().any(|t| t.contains("evolucao"))
                    || path.to_string_lossy().contains("evolucoes")
                    || body.contains("tipo: nota_evoluida")
                    || body.contains("Histórico de Alterações");

                let base_origem = fm.base_origem.as_ref().map(|b| {
                    b.trim()
                        .trim_start_matches("[[")
                        .trim_end_matches("]]")
                        .trim()
                        .to_string()
                });

                if !id_map.contains(&id) {
                    id_map.insert(id.clone());
                    nodes.push(GraphNode {
                        id: id.clone(),
                        title: title.clone(),
                        vault: vault_name.to_string(),
                        path: path.to_string_lossy().to_string(),
                        tags: fm.tags,
                        category,
                    });
                    note_contents.push((id, body, is_evolution, base_origem));
                }
            }
        }

        let re_wikilink = Regex::new(r"\[\[([^\]|#]+)(?:\|[^\]]+)?\]\]").unwrap();
        let mut links = Vec::new();
        let mut seen_links = std::collections::HashSet::new();

        for (source_id, body, source_is_evo, source_base) in note_contents {
            for cap in re_wikilink.captures_iter(&body) {
                if let Some(target_match) = cap.get(1) {
                    let target_name = target_match.as_str().trim();
                    let clean_target = target_name.replace('_', " ");
                    let slug_target = target_name.replace(' ', "_");
                    // Localiza o nó de destino por id exato, case-insensitive, ou alternando espaços/underscores
                    let found_target = nodes.iter().find(|n| {
                        n.id.eq_ignore_ascii_case(target_name)
                            || n.title.eq_ignore_ascii_case(target_name)
                            || n.id.replace('_', " ").eq_ignore_ascii_case(&clean_target)
                            || n.title
                                .replace('_', " ")
                                .eq_ignore_ascii_case(&clean_target)
                            || n.id.replace(' ', "_").eq_ignore_ascii_case(&slug_target)
                            || n.title.replace(' ', "_").eq_ignore_ascii_case(&slug_target)
                    });

                    if let Some(target_node) = found_target {
                        if target_node.id != source_id {
                            let key = if source_id < target_node.id {
                                format!("{}->{}", source_id, target_node.id)
                            } else {
                                format!("{}->{}", target_node.id, source_id)
                            };

                            let is_lineage = if let Some(ref base) = source_base {
                                let clean_base = base.replace('_', " ");
                                let slug_base = base.replace(' ', "_");
                                target_node.id.eq_ignore_ascii_case(base)
                                    || target_node.title.eq_ignore_ascii_case(base)
                                    || target_node
                                        .id
                                        .replace('_', " ")
                                        .eq_ignore_ascii_case(&clean_base)
                                    || target_node
                                        .title
                                        .replace('_', " ")
                                        .eq_ignore_ascii_case(&clean_base)
                                    || target_node
                                        .id
                                        .replace(' ', "_")
                                        .eq_ignore_ascii_case(&slug_base)
                                    || target_node
                                        .title
                                        .replace(' ', "_")
                                        .eq_ignore_ascii_case(&slug_base)
                            } else {
                                source_is_evo
                                    && (target_node.vault == "obsidian"
                                        || target_node.tags.iter().any(|t| t.contains("evolucao")))
                            };

                            if !seen_links.contains(&key) {
                                seen_links.insert(key);
                                links.push(GraphLink {
                                    source: source_id.clone(),
                                    target: target_node.id.clone(),
                                    is_lineage,
                                });
                            }
                        }
                    }
                }
            }
        }

        GraphData { nodes, links }
    }
}

pub type SharedVaultManager = Arc<VaultManager>;
