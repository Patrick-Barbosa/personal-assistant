-- Copernico web backend schema. Ported from
-- src-tauri/src/infra/sqlite/pool.rs + migrations.rs (same tables/columns).
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

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
CREATE INDEX IF NOT EXISTS idx_inbox_items_created_at ON inbox_items(created_at);

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
CREATE INDEX IF NOT EXISTS idx_tabular_cat_date ON user_tabular_data(category, record_date);
CREATE INDEX IF NOT EXISTS idx_tabular_key_date ON user_tabular_data(metric_key, record_date);

CREATE TABLE IF NOT EXISTS kanban_weeks (
    id TEXT PRIMARY KEY,
    year INTEGER NOT NULL,
    iso_week INTEGER NOT NULL,
    week_start TEXT NOT NULL,
    week_end TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL,
    closed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_kanban_weeks_status ON kanban_weeks(status, year, iso_week);

CREATE TABLE IF NOT EXISTS kanban_tasks (
    id TEXT PRIMARY KEY,
    week_id TEXT NOT NULL REFERENCES kanban_weeks(id) ON DELETE CASCADE,
    titulo TEXT NOT NULL,
    note_path TEXT,
    task_column TEXT NOT NULL DEFAULT 'todo',
    status TEXT NOT NULL DEFAULT 'active',
    carried_to TEXT,
    position REAL NOT NULL DEFAULT 0,
    task_kind TEXT NOT NULL DEFAULT 'normal',
    habit_id TEXT,
    due_date TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kanban_tasks_week ON kanban_tasks(week_id, task_column, position);
CREATE INDEX IF NOT EXISTS idx_kanban_tasks_due ON kanban_tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_kanban_tasks_habit ON kanban_tasks(habit_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_kanban_tasks_habit
    ON kanban_tasks(habit_id, week_id, due_date)
    WHERE habit_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS kanban_task_notes (
    task_id TEXT NOT NULL REFERENCES kanban_tasks(id) ON DELETE CASCADE,
    note_path TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (task_id, note_path)
);

CREATE TABLE IF NOT EXISTS kanban_task_entities (
    task_id TEXT NOT NULL REFERENCES kanban_tasks(id) ON DELETE CASCADE,
    entity_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (task_id, entity_id)
);

CREATE TABLE IF NOT EXISTS entities_index (
    id TEXT PRIMARY KEY,
    subtipo TEXT NOT NULL DEFAULT 'livre',
    titulo TEXT NOT NULL,
    note_path TEXT NOT NULL UNIQUE,
    metadata TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS habits (
    id TEXT PRIMARY KEY,
    titulo TEXT NOT NULL,
    cron_expr TEXT NOT NULL,
    cor TEXT NOT NULL DEFAULT '#22c55e',
    ativo INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
