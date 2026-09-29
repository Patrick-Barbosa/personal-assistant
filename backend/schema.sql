-- Tiba beginner schema: chat sessions + flat kanban tasks. No weeks, no vault index.
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

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    titulo TEXT NOT NULL,
    task_column TEXT NOT NULL DEFAULT 'todo',
    position REAL NOT NULL DEFAULT 0,
    day_label TEXT,
    note_md TEXT NOT NULL DEFAULT '',
    habit_id TEXT,
    categoria TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_column ON tasks(task_column, position);

CREATE TABLE IF NOT EXISTS habits (
    id TEXT PRIMARY KEY,
    nome TEXT NOT NULL,
    tipo TEXT NOT NULL DEFAULT 'binary',
    unidade TEXT NOT NULL DEFAULT '',
    meta REAL NOT NULL DEFAULT 0,
    dias TEXT NOT NULL DEFAULT '',
    escudo_marco INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS habit_checks (
    habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
    data TEXT NOT NULL,
    valor REAL NOT NULL DEFAULT 0,
    feito INTEGER NOT NULL DEFAULT 0,
    protegido INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (habit_id, data)
);

CREATE TABLE IF NOT EXISTS habit_tasks (
    habit_id TEXT NOT NULL,
    data TEXT NOT NULL,
    task_id TEXT NOT NULL,
    PRIMARY KEY (habit_id, data)
);

CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    nome TEXT NOT NULL,
    cor TEXT NOT NULL DEFAULT '#141414'
);

CREATE TABLE IF NOT EXISTS daily_notes (
    data TEXT PRIMARY KEY,
    conteudo TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
