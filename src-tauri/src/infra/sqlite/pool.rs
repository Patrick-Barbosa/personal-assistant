use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use std::path::Path;

pub type DbPool = Pool<SqliteConnectionManager>;

pub fn create_pool(db_path: &Path) -> Result<DbPool, Box<dyn std::error::Error + Send + Sync>> {
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

    // Run initial DDL
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

    // Migrations
    let _ = conn.execute(
        "ALTER TABLE messages ADD COLUMN tokens INTEGER DEFAULT 0",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE messages ADD COLUMN parent_id INTEGER REFERENCES messages(id)",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE inbox_items ADD COLUMN target_base_note_slug TEXT",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE inbox_items ADD COLUMN proposed_content TEXT",
        [],
    );
    let _ = conn.execute("ALTER TABLE inbox_items ADD COLUMN diff_data TEXT", []);
    let _ = conn.execute("ALTER TABLE inbox_items ADD COLUMN updated_at TEXT", []);
    let _ = conn.execute(
        "ALTER TABLE inbox_items ADD COLUMN decision_reason TEXT",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE scheduled_routines ADD COLUMN skill_id TEXT",
        [],
    );

    // Migrações do Kanban Semanal, hábitos e índice de entidades.
    crate::infra::sqlite::run_kanban_migrations(&conn)?;

    Ok(pool)
}
