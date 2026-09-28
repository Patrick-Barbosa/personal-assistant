use crate::domain::errors::DomainError;
use crate::domain::models::{EntityIndexEntry, EntitySubtipo};
use crate::domain::traits::vault::VaultIndexStore;
use crate::infra::sqlite::pool::DbPool;
use async_trait::async_trait;
use chrono::Utc;
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
    let len = std::mem::size_of_val(slice);
    unsafe { std::slice::from_raw_parts(ptr, len) }
}

fn bytes_to_f32_vec(bytes: &[u8], dim: usize) -> Vec<f32> {
    if bytes.len() != dim * 4 {
        return Vec::new();
    }
    let mut vec = Vec::with_capacity(dim);
    for chunk in bytes.as_chunks::<4>().0 {
        vec.push(f32::from_le_bytes(*chunk));
    }
    vec
}

// ─── Índice derivado de entities ─────────────────────────────

fn map_entity(row: &rusqlite::Row<'_>) -> rusqlite::Result<EntityIndexEntry> {
    let subtipo_raw: String = row.get(1)?;
    Ok(EntityIndexEntry {
        id: row.get(0)?,
        subtipo: EntitySubtipo::from_db(&subtipo_raw),
        titulo: row.get(2)?,
        note_path: row.get(3)?,
        metadata: row.get(4)?,
        created_at: row.get(5)?,
    })
}

#[async_trait]
impl crate::domain::traits::stores::EntityIndexStore for SqliteVaultIndexRepo {
    fn upsert_entity(&self, entry: &EntityIndexEntry) -> Result<(), DomainError> {
        let conn = self
            .pool
            .get()
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        conn.execute(
            "INSERT INTO entities_index (id, subtipo, titulo, note_path, metadata, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(note_path) DO UPDATE SET
                subtipo = excluded.subtipo,
                titulo = excluded.titulo,
                metadata = excluded.metadata",
            params![
                entry.id,
                entry.subtipo.as_db(),
                entry.titulo,
                entry.note_path,
                entry.metadata,
                entry.created_at,
            ],
        )
        .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        Ok(())
    }

    fn get_entity(&self, id: &str) -> Result<Option<EntityIndexEntry>, DomainError> {
        let conn = self
            .pool
            .get()
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        let mut stmt = conn
            .prepare(
                "SELECT id, subtipo, titulo, note_path, metadata, created_at
                 FROM entities_index WHERE id = ?1",
            )
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        let mut rows = stmt
            .query_map(params![id], map_entity)
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        match rows.next() {
            Some(row) => Ok(Some(
                row.map_err(|e| DomainError::DatabaseError(e.to_string()))?,
            )),
            None => Ok(None),
        }
    }

    fn list_entities(
        &self,
        subtipo: Option<&str>,
        query: Option<&str>,
    ) -> Result<Vec<EntityIndexEntry>, DomainError> {
        let conn = self
            .pool
            .get()
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        let mut sql = String::from(
            "SELECT id, subtipo, titulo, note_path, metadata, created_at FROM entities_index WHERE 1=1",
        );
        let mut binds: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        if let Some(st) = subtipo.map(str::trim).filter(|s| !s.is_empty()) {
            sql.push_str(" AND subtipo = ?");
            binds.push(Box::new(st.to_string()));
        }
        if let Some(q) = query.map(str::trim).filter(|s| !s.is_empty()) {
            sql.push_str(" AND titulo LIKE ? ESCAPE '\\'");
            binds.push(Box::new(format!(
                "%{}%",
                q.replace('%', "\\%").replace('_', "\\_")
            )));
        }
        sql.push_str(" ORDER BY titulo COLLATE NOCASE ASC");

        let mut stmt = conn
            .prepare(&sql)
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        let params_ref: Vec<&dyn rusqlite::ToSql> = binds.iter().map(|b| b.as_ref()).collect();
        let rows = stmt
            .query_map(params_ref.as_slice(), map_entity)
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| DomainError::DatabaseError(e.to_string()))?);
        }
        Ok(out)
    }

    fn delete_entity_by_id(&self, id: &str) -> Result<bool, DomainError> {
        let conn = self
            .pool
            .get()
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        let affected = conn
            .execute("DELETE FROM entities_index WHERE id = ?1", params![id])
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        Ok(affected > 0)
    }

    /// Só desvincula do índice — a nota `.md` permanece no cofre.
    fn delete_entity_by_path(&self, note_path: &str) -> Result<bool, DomainError> {
        let conn = self
            .pool
            .get()
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        let affected = conn
            .execute(
                "DELETE FROM entities_index WHERE note_path = ?1",
                params![note_path],
            )
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        Ok(affected > 0)
    }

    fn clear_entities_index(&self) -> Result<usize, DomainError> {
        let conn = self
            .pool
            .get()
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        let affected = conn
            .execute("DELETE FROM entities_index", [])
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        Ok(affected)
    }
}

impl SqliteVaultIndexRepo {
    /// Remove do índice as entradas cuja nota canônica não existe mais.
    /// Chamado no rebuild — `entities_index` é sempre descartável.
    pub fn prune_missing_entities(
        &self,
        exists: impl Fn(&str) -> bool,
    ) -> Result<usize, DomainError> {
        let conn = self
            .pool
            .get()
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        let mut stmt = conn
            .prepare("SELECT id, note_path FROM entities_index")
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
        let mut stale = Vec::new();
        for row in rows {
            let (id, note_path) = row.map_err(|e| DomainError::DatabaseError(e.to_string()))?;
            if !exists(&note_path) {
                stale.push(id);
            }
        }
        // Usa a MESMA conexão já em uso: o pool `:memory:` tem max_size=1 e
        // um segundo `pool.get()` aqui mortearia (timeout de 30s).
        drop(stmt);
        let mut removed = 0usize;
        for id in stale {
            let affected = conn
                .execute("DELETE FROM entities_index WHERE id = ?1", params![id])
                .map_err(|e| DomainError::DatabaseError(e.to_string()))?;
            removed += usize::from(affected > 0);
        }
        Ok(removed)
    }

    /// Timestamp canônico para `created_at` de uma linha nova do índice.
    pub fn entity_now() -> String {
        Utc::now().to_rfc3339()
    }
}
