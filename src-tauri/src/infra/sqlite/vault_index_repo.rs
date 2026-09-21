use crate::domain::errors::DomainError;
use crate::domain::traits::vault::VaultIndexStore;
use crate::infra::sqlite::pool::DbPool;
use async_trait::async_trait;
use rusqlite::params;

#[derive(Clone)]
pub struct SqliteVaultIndexRepo {
    pool: DbPool,
}

impl SqliteVaultIndexRepo {
    pub fn new(pool: DbPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl VaultIndexStore for SqliteVaultIndexRepo {
    fn save_embedding(
        &self,
        vault: &str,
        path: &str,
        hash: &str,
        embedding: &[f32],
        title: Option<&str>,
        mtime: f64,
    ) -> Result<(), DomainError> {
        let conn = self
            .pool
            .get()
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        let table = if vault == "obsidian" {
            "obsidian_index"
        } else {
            "vault_index"
        };
        let query = format!(
            "INSERT INTO {table} (path, hash, embedding, dim, titulo, mtime)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(path) DO UPDATE SET
                hash = ?2,
                embedding = ?3,
                dim = ?4,
                titulo = ?5,
                mtime = ?6"
        );

        // Convert f32 slice to bytes
        let bytes: &[u8] = bytemuck_or_transmute_slice(embedding);

        conn.execute(
            &query,
            params![path, hash, bytes, embedding.len() as i64, title, mtime],
        )
        .map_err(|e| DomainError::DatabaseError(e.to_string()))?;

        Ok(())
    }

    fn get_indexed_file_mtime(&self, vault: &str, path: &str) -> Result<Option<f64>, DomainError> {
        let conn = self
            .pool
            .get()
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        let table = if vault == "obsidian" {
            "obsidian_index"
        } else {
            "vault_index"
        };
        let query = format!("SELECT mtime FROM {table} WHERE path = ?1");
        let mut stmt = conn
            .prepare(&query)
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        let mut rows = stmt
            .query(params![path])
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        if let Some(row) = rows
            .next()
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?
        {
            Ok(Some(
                row.get(0)
                    .map_err(|e| DomainError::DatabaseError(e.to_string()))?,
            ))
        } else {
            Ok(None)
        }
    }

    fn delete_embedding(&self, vault: &str, path: &str) -> Result<(), DomainError> {
        let conn = self
            .pool
            .get()
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        let table = if vault == "obsidian" {
            "obsidian_index"
        } else {
            "vault_index"
        };
        let query = format!("DELETE FROM {table} WHERE path = ?1");
        conn.execute(&query, params![path])
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        Ok(())
    }

    fn get_all_embeddings(
        &self,
        vault: &str,
    ) -> Result<Vec<(String, Vec<f32>, String)>, DomainError> {
        let conn = self
            .pool
            .get()
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        let table = if vault == "obsidian" {
            "obsidian_index"
        } else {
            "vault_index"
        };
        let query = format!("SELECT path, embedding, dim, titulo FROM {table}");
        let mut stmt = conn
            .prepare(&query)
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        let rows = stmt
            .query_map([], |row| {
                let path: String = row.get(0)?;
                let blob: Vec<u8> = row.get(1)?;
                let dim: i64 = row.get(2)?;
                let title: Option<String> = row.get(3)?;
                let f32s = bytes_to_f32_vec(&blob, dim as usize);
                Ok((path, f32s, title.unwrap_or_default()))
            })
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;

        let mut results = Vec::new();
        for r in rows {
            results.push(r.map_err(|e| DomainError::DatabaseError(e.to_string()))?);
        }
        Ok(results)
    }
}

fn bytemuck_or_transmute_slice(slice: &[f32]) -> &[u8] {
    let ptr = slice.as_ptr() as *const u8;
    let len = slice.len() * std::mem::size_of::<f32>();
    unsafe { std::slice::from_raw_parts(ptr, len) }
}

fn bytes_to_f32_vec(bytes: &[u8], dim: usize) -> Vec<f32> {
    if bytes.len() != dim * 4 {
        return Vec::new();
    }
    let mut vec = Vec::with_capacity(dim);
    for chunk in bytes.chunks_exact(4) {
        let arr: [u8; 4] = [chunk[0], chunk[1], chunk[2], chunk[3]];
        vec.push(f32::from_le_bytes(arr));
    }
    vec
}
