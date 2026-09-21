use crate::db::DbPool;
use crate::vault::VaultManager;
use fastembed::{EmbeddingModel, InitOptions, TextEmbedding};
use rusqlite::params;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};

pub use crate::domain::models::SearchResult;

pub fn to_note_slug(title: &str) -> String {
    let mut slug = String::new();
    let mut last_was_under = false;
    for c in title.to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            slug.push(c);
            last_was_under = false;
        } else if !last_was_under {
            slug.push('_');
            last_was_under = true;
        }
    }
    slug.trim_matches('_').to_string()
}

pub struct Indexer {
    model: Arc<Mutex<TextEmbedding>>,
    pool: DbPool,
    vault_manager: Arc<VaultManager>,
}

impl Indexer {
    pub fn new(
        pool: DbPool,
        vault_manager: Arc<VaultManager>,
    ) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        // Tenta carregar o modelo multilíngue do spec (384 dimensões)
        let init_opts = InitOptions::new(EmbeddingModel::ParaphraseMLMiniLML12V2)
            .with_show_download_progress(false);

        let model = match TextEmbedding::try_new(init_opts) {
            Ok(m) => m,
            Err(err) => {
                eprintln!("[WARN] Falha ao carregar ParaphraseMultilingualMiniLML12V2: {}. Tentando AllMiniLML6V2...", err);
                let fallback_opts = InitOptions::new(EmbeddingModel::AllMiniLML6V2)
                    .with_show_download_progress(false);
                TextEmbedding::try_new(fallback_opts)?
            }
        };

        Ok(Self {
            model: Arc::new(Mutex::new(model)),
            pool,
            vault_manager,
        })
    }

    pub fn to_note_slug(title: &str) -> String {
        let mut slug = String::new();
        let mut last_was_under = false;
        for c in title.to_lowercase().chars() {
            if c.is_ascii_alphanumeric() {
                slug.push(c);
                last_was_under = false;
            } else if !last_was_under {
                slug.push('_');
                last_was_under = true;
            }
        }
        slug.trim_matches('_').to_string()
    }

    /// Expõe o pool SQLite para comandos que precisam limpar `vault_index`
    /// após rename/archive-then-delete (mantém `PRAGMA foreign_keys = ON` do `Database::init`).
    pub fn vault_pool(&self) -> DbPool {
        self.pool.clone()
    }

    pub fn safe_truncate_chars(s: &str, max_chars: usize, ellipsis: bool) -> String {
        let mut chars = s.chars();
        let prefix: String = chars.by_ref().take(max_chars).collect();
        if ellipsis && chars.next().is_some() {
            format!("{}…", prefix)
        } else {
            prefix
        }
    }

    pub fn build_doc_text_default(
        titulo: &str,
        corpo: &str,
        tags: &[String],
        topicos: &[String],
    ) -> String {
        let mut parts = vec![format!("Título: {}", titulo), corpo.trim().to_string()];
        if !tags.is_empty() {
            parts.push(format!("Tags: {}", tags.join(", ")));
        }
        if !topicos.is_empty() {
            parts.push(format!("Tópicos: {}", topicos.join(", ")));
        }
        let full = parts.join("\n");
        Self::safe_truncate_chars(&full, 8000, false)
    }

    pub fn build_doc_text_obsidian(
        titulo: &str,
        corpo: &str,
        categoria: Option<&str>,
        tags: &[String],
        dynamic_meta: &str,
    ) -> String {
        let mut parts = vec![format!("Título: {}", titulo)];
        if let Some(cat) = categoria {
            parts.push(format!("Categoria: {}", cat));
        }
        if !dynamic_meta.trim().is_empty() {
            parts.push(format!("Propriedades: {}", dynamic_meta.trim()));
        }
        parts.push(corpo.trim().to_string());
        let mut all_tags = Vec::new();
        if let Some(cat) = categoria {
            all_tags.push(cat.to_string());
        }
        all_tags.extend_from_slice(tags);
        if !all_tags.is_empty() {
            parts.push(format!("Tags: {}", all_tags.join(", ")));
        }
        parts.join("\n")
    }

    /// Chunking semântico inteligente baseado em cabeçalhos Markdown com 5% a 10% de overlapping
    pub fn chunk_markdown(text: &str, max_chunk_chars: usize, overlap_ratio: f32) -> Vec<String> {
        let trimmed = text.trim();
        if trimmed.len() <= max_chunk_chars {
            return vec![trimmed.to_string()];
        }

        let overlap_chars = (max_chunk_chars as f32 * overlap_ratio.clamp(0.05, 0.15)) as usize;
        let mut chunks = Vec::new();

        // 1. Tenta quebrar por cabeçalhos Markdown (# , ## , ### )
        let re_headings = regex::Regex::new(r"(?m)^(?P<heading>#{1,3}\s+.+)$").unwrap();
        let mut split_points = vec![0];
        for mat in re_headings.find_iter(trimmed) {
            if mat.start() > 0 && !split_points.contains(&mat.start()) {
                split_points.push(mat.start());
            }
        }
        split_points.push(trimmed.len());

        let mut sections = Vec::new();
        for i in 0..split_points.len() - 1 {
            let start = split_points[i];
            let end = split_points[i + 1];
            let sec = trimmed[start..end].trim();
            if !sec.is_empty() {
                sections.push(sec);
            }
        }

        // 2. Se as seções ainda excederem max_chunk_chars, divide com overlapping usando chars seguros
        for sec in sections {
            let chars: Vec<char> = sec.chars().collect();
            if chars.len() <= max_chunk_chars {
                chunks.push(sec.to_string());
            } else {
                let mut start = 0;
                while start < chars.len() {
                    let end = (start + max_chunk_chars).min(chars.len());
                    let chunk_str: String = chars[start..end].iter().collect();
                    let trimmed_chunk = chunk_str.trim();
                    if !trimmed_chunk.is_empty() {
                        chunks.push(trimmed_chunk.to_string());
                    }

                    if end >= chars.len() {
                        break;
                    }
                    start += max_chunk_chars.saturating_sub(overlap_chars).max(1);
                }
            }
        }

        if chunks.is_empty() {
            chunks.push(trimmed.to_string());
        }

        chunks
    }

    pub fn hash_text(text: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(text.as_bytes());
        format!("{:x}", hasher.finalize())
    }

    pub fn generate_embedding(
        &self,
        text: &str,
    ) -> Result<Vec<f32>, Box<dyn std::error::Error + Send + Sync>> {
        let mut model_lock = self
            .model
            .lock()
            .map_err(|e| format!("Mutex poison error: {}", e))?;
        let embeddings = model_lock.embed(vec![text], None)?;
        if let Some(first) = embeddings.into_iter().next() {
            Ok(first)
        } else {
            Err("Nenhum embedding gerado".into())
        }
    }

    pub fn generate_document_embedding(
        &self,
        doc_text: &str,
    ) -> Result<Vec<f32>, Box<dyn std::error::Error + Send + Sync>> {
        let chunks = Self::chunk_markdown(doc_text, 1200, 0.10);
        if chunks.len() <= 1 {
            return self.generate_embedding(doc_text);
        }

        let mut model_lock = self
            .model
            .lock()
            .map_err(|e| format!("Mutex poison error: {}", e))?;
        let text_refs: Vec<&str> = chunks.iter().map(|s| s.as_str()).collect();
        let chunk_embeddings = model_lock.embed(text_refs, None)?;

        if chunk_embeddings.is_empty() {
            return Err("Nenhum embedding gerado para os chunks".into());
        }

        let dim = chunk_embeddings[0].len();
        let mut pooled = vec![0.0f32; dim];
        let n = chunk_embeddings.len() as f32;

        for emb in &chunk_embeddings {
            for (i, val) in emb.iter().enumerate() {
                pooled[i] += val;
            }
        }

        // Divide por N e normaliza L2
        let mut norm = 0.0f32;
        for val in pooled.iter_mut() {
            *val /= n;
            norm += *val * *val;
        }
        norm = norm.sqrt();
        if norm > 0.0 {
            for val in pooled.iter_mut() {
                *val /= norm;
            }
        }

        Ok(pooled)
    }

    pub fn index_single_note(
        &self,
        path: &Path,
        vault_type: &str,
    ) -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
        if !path.exists() {
            return Err(format!("Arquivo não existe: {:?}", path).into());
        }

        let mtime = fs::metadata(path)?
            .modified()?
            .duration_since(std::time::UNIX_EPOCH)?
            .as_secs_f64();

        let (fm, body) = VaultManager::parse_note_file(path)?;
        let titulo = VaultManager::extract_obsidian_title(path, &body, &fm);
        let dynamic_meta = VaultManager::format_dynamic_metadata(&fm);
        let categoria = if vault_type == "obsidian" {
            VaultManager::extract_category(path, &self.vault_manager.obsidian_vault)
        } else {
            None
        };

        let doc_text = if vault_type == "obsidian" {
            Self::build_doc_text_obsidian(
                &titulo,
                &body,
                categoria.as_deref(),
                &fm.tags,
                &dynamic_meta,
            )
        } else {
            Self::build_doc_text_default(&titulo, &body, &fm.tags, &fm.topicos)
        };

        let file_hash = Self::hash_text(&doc_text);
        let path_str = path.to_string_lossy().to_string();
        let table_name = if vault_type == "obsidian" {
            "obsidian_index"
        } else {
            "vault_index"
        };

        // Verifica cache hit
        let conn = self.pool.get()?;
        let query_check = format!("SELECT hash FROM {} WHERE path = ?1", table_name);
        let mut stmt = conn.prepare(&query_check)?;
        let mut rows = stmt.query(params![path_str])?;
        if let Some(row) = rows.next()? {
            let cached_hash: String = row.get(0)?;
            if cached_hash == file_hash {
                return Ok(false); // Cache hit, nada a fazer
            }
        }

        // Cache miss -> gera embedding com chunking semântico
        let embedding = self.generate_document_embedding(&doc_text)?;
        let dim = embedding.len() as i64;
        let blob: Vec<u8> = embedding.iter().flat_map(|f| f.to_le_bytes()).collect();

        if vault_type == "obsidian" {
            conn.execute(
                r#"
                INSERT INTO obsidian_index (path, hash, embedding, dim, titulo, categoria, mtime)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                ON CONFLICT(path) DO UPDATE SET
                    hash=excluded.hash,
                    embedding=excluded.embedding,
                    dim=excluded.dim,
                    titulo=excluded.titulo,
                    categoria=excluded.categoria,
                    mtime=excluded.mtime
                "#,
                params![path_str, file_hash, blob, dim, titulo, categoria, mtime],
            )?;
        } else {
            conn.execute(
                r#"
                INSERT INTO vault_index (path, hash, embedding, dim, titulo, mtime)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                ON CONFLICT(path) DO UPDATE SET
                    hash=excluded.hash,
                    embedding=excluded.embedding,
                    dim=excluded.dim,
                    titulo=excluded.titulo,
                    mtime=excluded.mtime
                "#,
                params![path_str, file_hash, blob, dim, titulo, mtime],
            )?;
        }

        Ok(true)
    }

    /// Indexa um arquivo `.base` do Obsidian como um documento virtual compilado.
    /// Extrai os itens da pasta alvo, monta uma tabela Markdown com todos os metadados,
    /// e gera embedding semântico vetorial no `obsidian_index`.
    pub fn index_single_base(
        &self,
        path: &Path,
    ) -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
        if !path.exists() {
            return Err(format!("Arquivo .base não existe: {:?}", path).into());
        }

        let mtime = fs::metadata(path)?
            .modified()?
            .duration_since(std::time::UNIX_EPOCH)?
            .as_secs_f64();

        let base = match VaultManager::parse_base_file(path, &self.vault_manager.obsidian_vault) {
            Ok(b) => b,
            Err(err) => {
                eprintln!("[INDEX WARN] Falha ao parsear .base '{:?}': {}", path, err);
                return Ok(false);
            }
        };

        let compiled_doc = match self.vault_manager.compile_base_to_markdown(&base) {
            Ok(doc) => doc,
            Err(err) => {
                eprintln!(
                    "[INDEX WARN] Base '{}' não pôde ser compilada (pasta inexistente ou vazia): {}. Ignorando indexação.",
                    base.title, err
                );
                return Ok(false);
            }
        };

        let file_hash = Self::hash_text(&compiled_doc);
        let path_str = path.to_string_lossy().to_string();

        // Verifica cache hit no obsidian_index
        let conn = self.pool.get()?;
        let mut stmt = conn.prepare("SELECT hash FROM obsidian_index WHERE path = ?1")?;
        let mut rows = stmt.query(params![path_str])?;
        if let Some(row) = rows.next()? {
            let cached_hash: String = row.get(0)?;
            if cached_hash == file_hash {
                return Ok(false); // Cache hit, nada a fazer
            }
        }

        // Cache miss -> gera embedding semântico da tabela compilada
        let embedding = self.generate_document_embedding(&compiled_doc)?;
        let dim = embedding.len() as i64;
        let blob: Vec<u8> = embedding.iter().flat_map(|f| f.to_le_bytes()).collect();

        conn.execute(
            r#"
            INSERT INTO obsidian_index (path, hash, embedding, dim, titulo, categoria, mtime)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            ON CONFLICT(path) DO UPDATE SET
                hash=excluded.hash,
                embedding=excluded.embedding,
                dim=excluded.dim,
                titulo=excluded.titulo,
                categoria=excluded.categoria,
                mtime=excluded.mtime
            "#,
            params![
                path_str,
                file_hash,
                blob,
                dim,
                base.title,
                base.category,
                mtime
            ],
        )?;

        println!(
            "[INDEX] Base virtual indexada com sucesso: '{}' ({})",
            base.title,
            path.display()
        );

        Ok(true)
    }

    pub fn reindex_all(&self) -> Result<(usize, usize), Box<dyn std::error::Error + Send + Sync>> {
        let (default_files, obsidian_files) = self.vault_manager.list_all_notes();

        // 1. Limpa órfãos
        let conn = self.pool.get()?;
        {
            let mut stmt = conn.prepare("SELECT path FROM vault_index")?;
            let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
            let mut to_delete = Vec::new();
            for r in rows {
                let p_str = r?;
                if !Path::new(&p_str).exists() {
                    to_delete.push(p_str);
                }
            }
            for p in to_delete {
                conn.execute("DELETE FROM vault_index WHERE path = ?1", params![p])?;
            }
        }
        {
            let mut stmt = conn.prepare("SELECT path FROM obsidian_index")?;
            let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
            let mut to_delete = Vec::new();
            for r in rows {
                let p_str = r?;
                if !Path::new(&p_str).exists() {
                    to_delete.push(p_str);
                }
            }
            for p in to_delete {
                conn.execute("DELETE FROM obsidian_index WHERE path = ?1", params![p])?;
            }
        }

        // 2. Indexa arquivos
        let mut count_def = 0;
        for file in &default_files {
            if self.index_single_note(file, "default").unwrap_or(false) {
                count_def += 1;
            }
        }

        let mut count_obs = 0;
        for file in &obsidian_files {
            if self.index_single_note(file, "obsidian").unwrap_or(false) {
                count_obs += 1;
            }
        }

        // 3. Indexa bases virtuais (.base)
        let base_files = self
            .vault_manager
            .list_base_files(&self.vault_manager.obsidian_vault);
        for base_path in &base_files {
            if self.index_single_base(base_path).unwrap_or(false) {
                count_obs += 1;
            }
        }

        Ok((count_def, count_obs))
    }

    fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
        if a.len() != b.len() || a.is_empty() {
            return 0.0;
        }
        let mut dot = 0.0;
        let mut norm_a = 0.0;
        let mut norm_b = 0.0;
        for (x, y) in a.iter().zip(b.iter()) {
            dot += x * y;
            norm_a += x * x;
            norm_b += y * y;
        }
        let denom = norm_a.sqrt() * norm_b.sqrt();
        if denom == 0.0 {
            0.0
        } else {
            dot / denom
        }
    }

    pub fn calculate_hybrid_score(
        raw_cosine: f32,
        query: &str,
        titulo: &str,
        path_str: &str,
        content: Option<&str>,
    ) -> f32 {
        let q_lower = query.to_lowercase();
        let tit_lower = titulo.to_lowercase();
        let file_stem = Path::new(path_str)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();

        let mut boost = 0.0f32;

        // 1. Exact match título ou stem do arquivo -> boost altíssimo
        if tit_lower == q_lower || file_stem == q_lower {
            boost += 0.40;
        } else if tit_lower.contains(&q_lower) || file_stem.contains(&q_lower) {
            boost += 0.25;
        } else {
            // Verifica palavras individuais da query no título
            let words: Vec<&str> = q_lower.split_whitespace().collect();
            if !words.is_empty() {
                let match_count = words
                    .iter()
                    .filter(|w| tit_lower.contains(*w) || file_stem.contains(*w))
                    .count();
                if match_count > 0 {
                    boost += 0.15 * (match_count as f32 / words.len() as f32);
                }
            }
        }

        // 2. Termo presente no corpo do arquivo
        if let Some(body) = content {
            let body_lower = body.to_lowercase();
            if body_lower.contains(&q_lower) {
                boost += 0.10;
            }
        }

        // Combina cosseno (peso base 0.70) + boost léxico
        (raw_cosine * 0.70 + boost).min(1.0).max(0.0)
    }

    pub fn search_notes(
        &self,
        query: &str,
        top_k: usize,
    ) -> Result<Vec<SearchResult>, Box<dyn std::error::Error + Send + Sync>> {
        let trimmed_query = query.trim();
        if trimmed_query.is_empty() {
            return Ok(Vec::new());
        }

        // Gera embedding da query
        let query_vec = self.generate_embedding(trimmed_query)?;

        let conn = self.pool.get()?;
        let mut results = Vec::new();

        // 1. Busca no vault_index (default)
        {
            let mut stmt = conn.prepare("SELECT path, embedding, dim, titulo FROM vault_index")?;
            let rows = stmt.query_map([], |row| {
                let path: String = row.get(0)?;
                let blob: Vec<u8> = row.get(1)?;
                let dim: i64 = row.get(2)?;
                let titulo: String = row.get(3)?;
                Ok((path, blob, dim, titulo))
            })?;

            for r in rows {
                let (path_str, blob, dim, titulo) = r?;
                let mut emb = Vec::with_capacity(dim as usize);
                for chunk in blob.chunks_exact(4) {
                    let val = f32::from_le_bytes(chunk.try_into().unwrap());
                    emb.push(val);
                }
                let raw_score = Self::cosine_similarity(&query_vec, &emb);
                let file_content = fs::read_to_string(&path_str).ok();
                let mut score = Self::calculate_hybrid_score(
                    raw_score,
                    trimmed_query,
                    &titulo,
                    &path_str,
                    file_content.as_deref(),
                );

                // Boost de relevância temporal para notas evoluídas (Linhagem de Conhecimento Copernico v2.1)
                let is_evolved = file_content
                    .as_deref()
                    .map(|c| c.contains("tipo: nota_evoluida") || c.contains("copernico/evolucao"))
                    .unwrap_or(false)
                    || path_str.contains("evolucoes");
                if is_evolved {
                    score = (score + 0.12).min(1.0);
                }

                // Preview das primeiras linhas limpas
                let preview = file_content
                    .as_deref()
                    .map(|content| {
                        let lines: Vec<_> = content
                            .lines()
                            .filter(|l| !l.trim().starts_with("---") && !l.trim().is_empty())
                            .collect();
                        let preview_text = lines.join(" ");
                        Self::safe_truncate_chars(&preview_text, 160, true)
                    })
                    .unwrap_or_else(|| titulo.clone());

                results.push(SearchResult {
                    path: path_str.clone(),
                    titulo: titulo.clone(),
                    title: Some(titulo.clone()),
                    file_path: Some(path_str),
                    score,
                    preview,
                    vault: "default".to_string(),
                    categoria: None,
                    slug: Some(Self::to_note_slug(&titulo)),
                });
            }
        }

        // 2. Busca no obsidian_index
        {
            let mut stmt =
                conn.prepare("SELECT path, embedding, dim, titulo, categoria FROM obsidian_index")?;
            let rows = stmt.query_map([], |row| {
                let path: String = row.get(0)?;
                let blob: Vec<u8> = row.get(1)?;
                let dim: i64 = row.get(2)?;
                let titulo: String = row.get(3)?;
                let categoria: Option<String> = row.get(4)?;
                Ok((path, blob, dim, titulo, categoria))
            })?;

            for r in rows {
                let (path_str, blob, dim, titulo, categoria) = r?;
                let mut emb = Vec::with_capacity(dim as usize);
                for chunk in blob.chunks_exact(4) {
                    let val = f32::from_le_bytes(chunk.try_into().unwrap());
                    emb.push(val);
                }
                let raw_score = Self::cosine_similarity(&query_vec, &emb);
                let file_content = if path_str.ends_with(".base") {
                    if let Ok(base) = VaultManager::parse_base_file(
                        Path::new(&path_str),
                        &self.vault_manager.obsidian_vault,
                    ) {
                        self.vault_manager.compile_base_to_markdown(&base).ok()
                    } else {
                        None
                    }
                } else {
                    fs::read_to_string(&path_str).ok()
                };
                let score = Self::calculate_hybrid_score(
                    raw_score,
                    trimmed_query,
                    &titulo,
                    &path_str,
                    file_content.as_deref(),
                );

                let preview = file_content
                    .as_deref()
                    .map(|content| {
                        let lines: Vec<_> = content
                            .lines()
                            .filter(|l| !l.trim().starts_with("---") && !l.trim().is_empty())
                            .collect();
                        let preview_text = lines.join(" ");
                        Self::safe_truncate_chars(&preview_text, 160, true)
                    })
                    .unwrap_or_else(|| titulo.clone());

                results.push(SearchResult {
                    path: path_str.clone(),
                    titulo: titulo.clone(),
                    title: Some(titulo.clone()),
                    file_path: Some(path_str),
                    score,
                    preview,
                    vault: "obsidian".to_string(),
                    categoria,
                    slug: Some(Self::to_note_slug(&titulo)),
                });
            }
        }

        // Ordena por score decrescente
        results.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        if results.len() > top_k {
            results.truncate(top_k);
        }

        Ok(results)
    }
}

#[async_trait::async_trait]
impl crate::providers::EmbeddingProvider for Indexer {
    fn info(&self) -> crate::providers::ProviderInfo {
        crate::providers::ProviderInfo {
            id: "fastembed-local".into(),
            name: "FastEmbed ONNX".into(),
            provider_type: "embedding".into(),
            is_local: true,
            description: "Embeddings locais de 384 dimensões via FastEmbed ONNX Runtime na CPU"
                .into(),
        }
    }

    fn dimensions(&self) -> usize {
        384
    }

    fn embed_query(&self, query: &str) -> Result<Vec<f32>, crate::providers::ProviderError> {
        self.generate_embedding(query)
            .map_err(|e| crate::providers::ProviderError::Internal(e.to_string()))
    }

    fn embed_texts(
        &self,
        texts: &[String],
    ) -> Result<Vec<Vec<f32>>, crate::providers::ProviderError> {
        let mut model_lock = self.model.lock().map_err(|_| {
            crate::providers::ProviderError::Internal("Lock do modelo falhou".into())
        })?;
        let text_refs: Vec<&str> = texts.iter().map(|s| s.as_str()).collect();
        model_lock
            .embed(text_refs, None)
            .map_err(|e| crate::providers::ProviderError::Internal(e.to_string()))
    }
}

pub type SharedIndexer = Arc<Indexer>;
