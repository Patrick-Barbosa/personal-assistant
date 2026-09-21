use chrono::Utc;
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::params;
use std::path::Path;
use std::sync::Arc;
use uuid::Uuid;

pub type DbPool = Pool<SqliteConnectionManager>;

pub use crate::domain::models::{InboxItem, Message, ScheduledRoutine, Session};

/// Limite de caracteres do motivo da decisão no Inbox.
pub const INBOX_DECISION_REASON_MAX: usize = 140;
/// Retenção de itens dismissed antes da purga automática.
pub const DISMISSED_RETENTION_HOURS: i64 = 72;

/// Sanitiza motivo de decisão: trim + limite de 140 chars (sem quebrar UTF-8).
pub fn sanitize_decision_reason(reason: Option<&str>) -> Option<String> {
    let r = reason.unwrap_or("").trim();
    if r.is_empty() {
        return None;
    }
    let clean: String = r.chars().take(INBOX_DECISION_REASON_MAX).collect();
    let clean = clean.trim().to_string();
    if clean.is_empty() {
        None
    } else {
        Some(clean)
    }
}

#[derive(Clone)]
pub struct Database {
    pool: DbPool,
}

impl Database {
    pub fn init(db_path: &Path) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let is_memory = db_path.to_str() == Some(":memory:");
        let (manager, max_size) = if is_memory {
            (SqliteConnectionManager::memory(), 1)
        } else {
            if let Some(parent) = db_path.parent() {
                if !parent.as_os_str().is_empty() {
                    std::fs::create_dir_all(parent)?;
                }
            }
            (SqliteConnectionManager::file(db_path), 8)
        };

        let pool = Pool::builder().max_size(max_size).build(manager)?;

        let conn = pool.get()?;
        if is_memory {
            conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        } else {
            conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")?;
        }

        // Executa DDL inicial
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                titulo TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                role TEXT NOT NULL CHECK(role IN ('system', 'user', 'assistant', 'tool')),
                content TEXT NOT NULL,
                tool_call_id TEXT,
                tool_calls TEXT,
                created_at TEXT NOT NULL,
                tokens INTEGER DEFAULT 0,
                parent_id INTEGER REFERENCES messages(id)
            );

            CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
            CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);

            CREATE TABLE IF NOT EXISTS vault_index (
                path TEXT PRIMARY KEY,
                hash TEXT NOT NULL,
                embedding BLOB NOT NULL,
                dim INTEGER NOT NULL,
                titulo TEXT,
                mtime REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS obsidian_index (
                path TEXT PRIMARY KEY,
                hash TEXT NOT NULL,
                embedding BLOB NOT NULL,
                dim INTEGER NOT NULL,
                titulo TEXT,
                categoria TEXT,
                mtime REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS plugins (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                version TEXT NOT NULL,
                plugin_type TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1,
                config_json TEXT,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS inbox_items (
                id TEXT PRIMARY KEY,
                session_id TEXT,
                title TEXT NOT NULL,
                summary TEXT,
                content TEXT NOT NULL,
                item_type TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'unread',
                requires_decision INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                target_base_note_slug TEXT,
                proposed_content TEXT,
                diff_data TEXT,
                updated_at TEXT,
                decision_reason TEXT
            );

            CREATE TABLE IF NOT EXISTS scheduled_routines (
                id TEXT PRIMARY KEY,
                titulo TEXT NOT NULL,
                cron_expr TEXT NOT NULL,
                prompt TEXT NOT NULL,
                skill_id TEXT,
                ativo INTEGER DEFAULT 1,
                ultima_execucao TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS user_tabular_data (
                id TEXT PRIMARY KEY,
                category TEXT NOT NULL,
                record_date TEXT NOT NULL,
                metric_key TEXT NOT NULL,
                metric_value REAL NOT NULL,
                notes TEXT,
                note_ref TEXT,
                created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_inbox_items_created_at ON inbox_items(created_at);
            CREATE INDEX IF NOT EXISTS idx_tabular_cat_date ON user_tabular_data(category, record_date);
            CREATE INDEX IF NOT EXISTS idx_tabular_key_date ON user_tabular_data(metric_key, record_date);
            "#,
        )?;

        // Migrações dinâmicas para tabelas existentes
        let _ = conn.execute(
            "ALTER TABLE messages ADD COLUMN tokens INTEGER DEFAULT 0;",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE messages ADD COLUMN parent_id INTEGER REFERENCES messages(id);",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE inbox_items ADD COLUMN target_base_note_slug TEXT;",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE inbox_items ADD COLUMN proposed_content TEXT;",
            [],
        );
        let _ = conn.execute("ALTER TABLE inbox_items ADD COLUMN diff_data TEXT;", []);
        let _ = conn.execute("ALTER TABLE inbox_items ADD COLUMN updated_at TEXT;", []);
        let _ = conn.execute(
            "ALTER TABLE inbox_items ADD COLUMN decision_reason TEXT;",
            [],
        );
        let _ = conn.execute(
            "UPDATE inbox_items SET updated_at = created_at WHERE updated_at IS NULL;",
            [],
        );
        let _ = conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_inbox_status_updated ON inbox_items(status, updated_at);",
            [],
        );

        Ok(Self { pool })
    }

    pub fn get_pool(&self) -> DbPool {
        self.pool.clone()
    }

    // --- Configurações (Settings) ---

    pub fn get_setting(
        &self,
        key: &str,
    ) -> Result<Option<String>, Box<dyn std::error::Error + Send + Sync>> {
        let conn = self.pool.get()?;
        let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
        let mut rows = stmt.query(params![key])?;
        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }

    pub fn set_setting(
        &self,
        key: &str,
        value: &str,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let conn = self.pool.get()?;
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn delete_setting(
        &self,
        key: &str,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let conn = self.pool.get()?;
        conn.execute("DELETE FROM settings WHERE key = ?1", params![key])?;
        Ok(())
    }

    // --- Sessões ---

    pub fn create_session(
        &self,
        custom_title: Option<&str>,
    ) -> Result<Session, Box<dyn std::error::Error + Send + Sync>> {
        let conn = self.pool.get()?;
        let sid = Uuid::new_v4().simple().to_string()[..16].to_string();
        let now = Utc::now().to_rfc3339();
        let title = custom_title
            .filter(|t| !t.trim().is_empty())
            .map(|t| t.trim().to_string())
            .unwrap_or_else(|| format!("Sessão {}", &now[..16]));

        conn.execute(
            "INSERT INTO sessions (id, titulo, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params![sid, title, now, now],
        )?;

        Ok(Session {
            id: sid,
            titulo: title,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub fn list_sessions(&self) -> Result<Vec<Session>, Box<dyn std::error::Error + Send + Sync>> {
        let conn = self.pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT id, titulo, created_at, updated_at FROM sessions ORDER BY updated_at DESC, rowid DESC",
        )?;

        let rows = stmt.query_map([], |row| {
            Ok(Session {
                id: row.get(0)?,
                titulo: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
            })
        })?;

        let mut sessions = Vec::new();
        for s in rows {
            sessions.push(s?);
        }
        Ok(sessions)
    }

    pub fn get_session(
        &self,
        session_id: &str,
    ) -> Result<Option<Session>, Box<dyn std::error::Error + Send + Sync>> {
        let conn = self.pool.get()?;
        let mut stmt =
            conn.prepare("SELECT id, titulo, created_at, updated_at FROM sessions WHERE id = ?1")?;

        let mut rows = stmt.query(params![session_id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(Session {
                id: row.get(0)?,
                titulo: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn rename_session(
        &self,
        session_id: &str,
        new_title: &str,
    ) -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
        let trimmed = new_title.trim();
        if trimmed.is_empty() {
            return Err("Título não pode ser vazio".into());
        }
        let conn = self.pool.get()?;
        let now = Utc::now().to_rfc3339();
        let affected = conn.execute(
            "UPDATE sessions SET titulo = ?1, updated_at = ?2 WHERE id = ?3",
            params![trimmed, now, session_id],
        )?;
        Ok(affected > 0)
    }

    pub fn delete_session(
        &self,
        session_id: &str,
    ) -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
        let conn = self.pool.get()?;
        let affected = conn.execute("DELETE FROM sessions WHERE id = ?1", params![session_id])?;
        Ok(affected > 0)
    }

    // --- Mensagens ---

    pub fn add_message(
        &self,
        session_id: &str,
        role: &str,
        content: &str,
        tool_call_id: Option<&str>,
        tool_calls: Option<&str>,
    ) -> Result<i64, Box<dyn std::error::Error + Send + Sync>> {
        self.add_message_with_meta(
            session_id,
            role,
            content,
            tool_call_id,
            tool_calls,
            None,
            None,
        )
    }

    pub fn add_message_with_meta(
        &self,
        session_id: &str,
        role: &str,
        content: &str,
        tool_call_id: Option<&str>,
        tool_calls: Option<&str>,
        tokens: Option<i64>,
        parent_id: Option<i64>,
    ) -> Result<i64, Box<dyn std::error::Error + Send + Sync>> {
        if !["system", "user", "assistant", "tool"].contains(&role) {
            return Err(format!("Role inválido: {}", role).into());
        }
        let conn = self.pool.get()?;
        let now = Utc::now().to_rfc3339();

        // Garante que a sessão existe
        let mut check = conn.prepare("SELECT 1 FROM sessions WHERE id = ?1")?;
        if !check.exists(params![session_id])? {
            return Err(format!("Sessão não encontrada: {}", session_id).into());
        }

        conn.execute(
            "INSERT INTO messages (session_id, role, content, tool_call_id, tool_calls, created_at, tokens, parent_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![session_id, role, content, tool_call_id, tool_calls, now, tokens.unwrap_or(0), parent_id],
        )?;

        let id = conn.last_insert_rowid();

        // Atualiza updated_at da sessão
        conn.execute(
            "UPDATE sessions SET updated_at = ?1 WHERE id = ?2",
            params![now, session_id],
        )?;

        Ok(id)
    }

    pub fn get_messages(
        &self,
        session_id: &str,
    ) -> Result<Vec<Message>, Box<dyn std::error::Error + Send + Sync>> {
        let conn = self.pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT id, session_id, role, content, tool_call_id, tool_calls, created_at, tokens, parent_id FROM messages WHERE session_id = ?1 ORDER BY id ASC",
        )?;

        let rows = stmt.query_map(params![session_id], |row| {
            Ok(Message {
                id: row.get(0)?,
                session_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                tool_call_id: row.get(4)?,
                tool_calls: row.get(5)?,
                created_at: row.get(6)?,
                tokens: row.get(7)?,
                parent_id: row.get(8)?,
            })
        })?;

        let mut messages = Vec::new();
        for m in rows {
            messages.push(m?);
        }
        Ok(messages)
    }

    pub fn count_messages(
        &self,
        session_id: &str,
    ) -> Result<i64, Box<dyn std::error::Error + Send + Sync>> {
        let conn = self.pool.get()?;
        let mut stmt = conn.prepare("SELECT COUNT(*) FROM messages WHERE session_id = ?1")?;
        let count: i64 = stmt.query_row(params![session_id], |r| r.get(0))?;
        Ok(count)
    }

    pub fn clear_history(
        &self,
        session_id: &str,
    ) -> Result<usize, Box<dyn std::error::Error + Send + Sync>> {
        let conn = self.pool.get()?;
        let affected = conn.execute(
            "DELETE FROM messages WHERE session_id = ?1",
            params![session_id],
        )?;
        Ok(affected)
    }

    pub fn delete_message(
        &self,
        message_id: i64,
    ) -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
        let conn = self.pool.get()?;
        let affected = conn.execute("DELETE FROM messages WHERE id = ?1", params![message_id])?;
        Ok(affected > 0)
    }

    pub fn truncate_messages_from(
        &self,
        session_id: &str,
        from_message_id: i64,
    ) -> Result<usize, Box<dyn std::error::Error + Send + Sync>> {
        let conn = self.pool.get()?;
        let affected = conn.execute(
            "DELETE FROM messages WHERE session_id = ?1 AND id >= ?2",
            params![session_id, from_message_id],
        )?;
        Ok(affected)
    }

    // --- Plugins ---

    pub fn save_plugin(
        &self,
        id: &str,
        name: &str,
        version: &str,
        plugin_type: &str,
        enabled: bool,
        config_json: &str,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let conn = self.pool.get()?;
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO plugins (id, name, version, plugin_type, enabled, config_json, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET
                name = ?2,
                version = ?3,
                plugin_type = ?4,
                config_json = ?6,
                updated_at = ?7",
            params![
                id,
                name,
                version,
                plugin_type,
                if enabled { 1 } else { 0 },
                config_json,
                now
            ],
        )?;
        Ok(())
    }

    pub fn is_plugin_enabled(
        &self,
        id: &str,
    ) -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
        let conn = self.pool.get()?;
        let mut stmt = conn.prepare("SELECT enabled FROM plugins WHERE id = ?1")?;
        let mut rows = stmt.query(params![id])?;
        if let Some(row) = rows.next()? {
            let enabled: i64 = row.get(0)?;
            Ok(enabled == 1)
        } else {
            Ok(true) // Habilitado por padrão
        }
    }

    pub fn set_plugin_enabled(
        &self,
        id: &str,
        enabled: bool,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let conn = self.pool.get()?;
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE plugins SET enabled = ?1, updated_at = ?2 WHERE id = ?3",
            params![if enabled { 1 } else { 0 }, now, id],
        )?;
        Ok(())
    }

    // --- Inbox & Cartas do Agente ---

    pub fn create_inbox_item(
        &self,
        session_id: Option<&str>,
        title: &str,
        summary: Option<&str>,
        content: &str,
        item_type: &str,
        requires_decision: bool,
    ) -> Result<InboxItem, Box<dyn std::error::Error + Send + Sync>> {
        self.create_inbox_item_full(
            session_id,
            title,
            summary,
            content,
            item_type,
            requires_decision,
            None,
            None,
            None,
        )
    }

    pub fn create_inbox_item_full(
        &self,
        session_id: Option<&str>,
        title: &str,
        summary: Option<&str>,
        content: &str,
        item_type: &str,
        requires_decision: bool,
        target_base_note_slug: Option<&str>,
        proposed_content: Option<&str>,
        diff_data: Option<&str>,
    ) -> Result<InboxItem, Box<dyn std::error::Error + Send + Sync>> {
        let conn = self.pool.get()?;
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();

        conn.execute(
            "INSERT INTO inbox_items (id, session_id, title, summary, content, item_type, status, requires_decision, created_at, target_base_note_slug, proposed_content, diff_data, updated_at, decision_reason)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'unread', ?7, ?8, ?9, ?10, ?11, ?8, NULL)",
            params![
                id,
                session_id,
                title,
                summary,
                content,
                item_type,
                if requires_decision { 1 } else { 0 },
                now,
                target_base_note_slug,
                proposed_content,
                diff_data,
            ],
        )?;

        Ok(InboxItem {
            id,
            session_id: session_id.map(|s| s.to_string()),
            title: title.to_string(),
            summary: summary.map(|s| s.to_string()),
            content: content.to_string(),
            item_type: item_type.to_string(),
            status: "unread".to_string(),
            requires_decision,
            created_at: now.clone(),
            target_base_note_slug: target_base_note_slug.map(|s| s.to_string()),
            proposed_content: proposed_content.map(|s| s.to_string()),
            diff_data: diff_data.map(|s| s.to_string()),
            updated_at: Some(now),
            decision_reason: None,
        })
    }

    pub fn update_inbox_proposal(
        &self,
        id: &str,
        proposed_content: &str,
        diff_data: Option<&str>,
    ) -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
        let conn = self.pool.get()?;
        let affected = conn.execute(
            "UPDATE inbox_items SET proposed_content = ?1, diff_data = ?2 WHERE id = ?3",
            params![proposed_content, diff_data, id],
        )?;
        Ok(affected > 0)
    }

    pub fn list_inbox_items(
        &self,
    ) -> Result<Vec<InboxItem>, Box<dyn std::error::Error + Send + Sync>> {
        let conn = self.pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT id, session_id, title, summary, content, item_type, status, requires_decision, created_at, target_base_note_slug, proposed_content, diff_data, updated_at, decision_reason
             FROM inbox_items
             ORDER BY created_at DESC"
        )?;

        let rows = stmt.query_map([], |row| {
            let req_dec_int: i64 = row.get(7)?;
            Ok(InboxItem {
                id: row.get(0)?,
                session_id: row.get(1)?,
                title: row.get(2)?,
                summary: row.get(3)?,
                content: row.get(4)?,
                item_type: row.get(5)?,
                status: row.get(6)?,
                requires_decision: req_dec_int == 1,
                created_at: row.get(8)?,
                target_base_note_slug: row.get(9)?,
                proposed_content: row.get(10)?,
                diff_data: row.get(11)?,
                updated_at: row.get(12)?,
                decision_reason: row.get(13)?,
            })
        })?;

        let mut items = Vec::new();
        for r in rows {
            items.push(r?);
        }
        Ok(items)
    }

    pub fn get_inbox_item(
        &self,
        id: &str,
    ) -> Result<Option<InboxItem>, Box<dyn std::error::Error + Send + Sync>> {
        let conn = self.pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT id, session_id, title, summary, content, item_type, status, requires_decision, created_at, target_base_note_slug, proposed_content, diff_data, updated_at, decision_reason
             FROM inbox_items WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(params![id], |row| {
            let req_dec_int: i64 = row.get(7)?;
            Ok(InboxItem {
                id: row.get(0)?,
                session_id: row.get(1)?,
                title: row.get(2)?,
                summary: row.get(3)?,
                content: row.get(4)?,
                item_type: row.get(5)?,
                status: row.get(6)?,
                requires_decision: req_dec_int == 1,
                created_at: row.get(8)?,
                target_base_note_slug: row.get(9)?,
                proposed_content: row.get(10)?,
                diff_data: row.get(11)?,
                updated_at: row.get(12)?,
                decision_reason: row.get(13)?,
            })
        })?;
        if let Some(r) = rows.next() {
            Ok(Some(r?))
        } else {
            Ok(None)
        }
    }

    pub fn mark_inbox_item_status(
        &self,
        id: &str,
        status: &str,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.mark_inbox_item_status_with_reason(id, status, None)
    }

    /// Transição de status com carimbo updated_at + motivo opcional (140 chars).
    pub fn mark_inbox_item_status_with_reason(
        &self,
        id: &str,
        status: &str,
        reason: Option<&str>,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let conn = self.pool.get()?;
        let now = Utc::now().to_rfc3339();
        let clean_reason = sanitize_decision_reason(reason);
        conn.execute(
            "UPDATE inbox_items SET status = ?1, updated_at = ?2, decision_reason = COALESCE(?3, decision_reason) WHERE id = ?4",
            params![status, now, clean_reason, id],
        )?;
        // Se motivo vazio e status é decisão final, limpa motivo anterior? Não — preserva.
        // Se motivo informado como string vazia explícita, mantém anterior (evita apagar sem querer).
        Ok(())
    }

    /// Purga itens dismissed há mais de `DISMISSED_RETENTION_HOURS` (72h).
    /// Conta a partir de updated_at (momento do dismiss), com fallback para created_at em linhas legadas.
    pub fn prune_dismissed_older_than_hours(
        &self,
        hours: i64,
    ) -> Result<usize, Box<dyn std::error::Error + Send + Sync>> {
        let conn = self.pool.get()?;
        let cutoff = (Utc::now() - chrono::Duration::hours(hours)).to_rfc3339();
        let affected = conn.execute(
            "DELETE FROM inbox_items WHERE status = 'dismissed' AND COALESCE(updated_at, created_at) < ?1",
            params![cutoff],
        )?;
        Ok(affected as usize)
    }

    pub fn prune_dismissed_expired(
        &self,
    ) -> Result<usize, Box<dyn std::error::Error + Send + Sync>> {
        self.prune_dismissed_older_than_hours(DISMISSED_RETENTION_HOURS)
    }

    pub fn delete_inbox_item(
        &self,
        id: &str,
    ) -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
        let conn = self.pool.get()?;
        let affected = conn.execute("DELETE FROM inbox_items WHERE id = ?1", params![id])?;
        Ok(affected > 0)
    }

    pub fn get_unread_inbox_count(&self) -> Result<i64, Box<dyn std::error::Error + Send + Sync>> {
        let conn = self.pool.get()?;
        let mut stmt =
            conn.prepare("SELECT COUNT(*) FROM inbox_items WHERE status IN ('unread', 'pending')")?;
        let count: i64 = stmt.query_row([], |r| r.get(0))?;
        Ok(count)
    }

    // --- Rotinas Agendadas (Scheduled Routines) ---

    pub fn list_scheduled_routines(
        &self,
    ) -> Result<Vec<ScheduledRoutine>, Box<dyn std::error::Error + Send + Sync>> {
        let conn = self.pool.get()?;
        let mut stmt = conn.prepare("SELECT id, titulo, cron_expr, prompt, skill_id, ativo, ultima_execucao, created_at FROM scheduled_routines ORDER BY created_at DESC")?;
        let rows = stmt.query_map([], |row| {
            let ativo_int: i64 = row.get(5)?;
            Ok(ScheduledRoutine {
                id: row.get(0)?,
                titulo: row.get(1)?,
                cron_expr: row.get(2)?,
                prompt: row.get(3)?,
                skill_id: row.get(4)?,
                ativo: ativo_int == 1,
                ultima_execucao: row.get(6)?,
                created_at: row.get(7)?,
            })
        })?;
        let mut list = Vec::new();
        for r in rows {
            list.push(r?);
        }
        Ok(list)
    }

    pub fn save_scheduled_routine(
        &self,
        routine: &ScheduledRoutine,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let conn = self.pool.get()?;
        conn.execute(
            "INSERT INTO scheduled_routines (id, titulo, cron_expr, prompt, skill_id, ativo, ultima_execucao, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(id) DO UPDATE SET
                titulo = excluded.titulo,
                cron_expr = excluded.cron_expr,
                prompt = excluded.prompt,
                skill_id = excluded.skill_id,
                ativo = excluded.ativo,
                ultima_execucao = excluded.ultima_execucao",
            params![
                routine.id,
                routine.titulo,
                routine.cron_expr,
                routine.prompt,
                routine.skill_id,
                if routine.ativo { 1 } else { 0 },
                routine.ultima_execucao,
                routine.created_at,
            ],
        )?;
        Ok(())
    }

    pub fn delete_scheduled_routine(
        &self,
        id: &str,
    ) -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
        let conn = self.pool.get()?;
        let affected = conn.execute("DELETE FROM scheduled_routines WHERE id = ?1", params![id])?;
        Ok(affected > 0)
    }

    pub fn toggle_scheduled_routine(
        &self,
        id: &str,
        ativo: bool,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let conn = self.pool.get()?;
        conn.execute(
            "UPDATE scheduled_routines SET ativo = ?1 WHERE id = ?2",
            params![if ativo { 1 } else { 0 }, id],
        )?;
        Ok(())
    }

    pub fn update_routine_last_run(
        &self,
        id: &str,
        timestamp: &str,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let conn = self.pool.get()?;
        conn.execute(
            "UPDATE scheduled_routines SET ultima_execucao = ?1 WHERE id = ?2",
            params![timestamp, id],
        )?;
        Ok(())
    }

    pub fn insert_tabular_metric(
        &self,
        category: &str,
        record_date: &str,
        metric_key: &str,
        metric_value: f64,
        notes: Option<&str>,
        note_ref: Option<&str>,
    ) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
        let conn = self.pool.get()?;
        let id = format!(
            "metric_{}_{}",
            Utc::now().timestamp_millis(),
            &uuid::Uuid::new_v4().to_string()[..8]
        );
        let now_iso = Utc::now().to_rfc3339();

        conn.execute(
            "INSERT INTO user_tabular_data (id, category, record_date, metric_key, metric_value, notes, note_ref, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                id,
                category.trim(),
                record_date.trim(),
                metric_key.trim(),
                metric_value,
                notes.map(|s| s.trim()),
                note_ref.map(|s| s.trim()),
                now_iso,
            ],
        )?;

        Ok(id)
    }

    pub fn query_tabular_metrics(
        &self,
        category: Option<&str>,
        start_date: Option<&str>,
        end_date: Option<&str>,
        metric_key: Option<&str>,
    ) -> Result<Vec<TabularMetric>, Box<dyn std::error::Error + Send + Sync>> {
        let conn = self.pool.get()?;
        let mut sql = String::from(
            "SELECT id, category, record_date, metric_key, metric_value, notes, note_ref, created_at FROM user_tabular_data WHERE 1=1"
        );
        let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        if let Some(cat) = category {
            let cat_clean = cat.trim();
            if !cat_clean.is_empty() {
                sql.push_str(" AND category = ?");
                params_vec.push(Box::new(cat_clean.to_string()));
            }
        }

        if let Some(key) = metric_key {
            let key_clean = key.trim();
            if !key_clean.is_empty() {
                sql.push_str(" AND metric_key = ?");
                params_vec.push(Box::new(key_clean.to_string()));
            }
        }

        if let Some(start) = start_date {
            let start_clean = start.trim();
            if !start_clean.is_empty() {
                sql.push_str(" AND record_date >= ?");
                params_vec.push(Box::new(start_clean.to_string()));
            }
        }

        if let Some(end) = end_date {
            let end_clean = end.trim();
            if !end_clean.is_empty() {
                sql.push_str(" AND record_date <= ?");
                params_vec.push(Box::new(end_clean.to_string()));
            }
        }

        sql.push_str(" ORDER BY record_date ASC, created_at ASC");

        let mut stmt = conn.prepare(&sql)?;
        let param_refs: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|b| b.as_ref()).collect();

        let rows = stmt.query_map(param_refs.as_slice(), |row| {
            Ok(TabularMetric {
                id: row.get(0)?,
                category: row.get(1)?,
                record_date: row.get(2)?,
                metric_key: row.get(3)?,
                metric_value: row.get(4)?,
                notes: row.get(5)?,
                note_ref: row.get(6)?,
                created_at: row.get(7)?,
            })
        })?;

        let mut results = Vec::new();
        for r in rows {
            results.push(r?);
        }
        Ok(results)
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TabularMetric {
    pub id: String,
    pub category: String,
    pub record_date: String,
    pub metric_key: String,
    pub metric_value: f64,
    pub notes: Option<String>,
    pub note_ref: Option<String>,
    pub created_at: String,
}

pub type SharedDatabase = Arc<Database>;
