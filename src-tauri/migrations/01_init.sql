-- Migração Inicial do Banco de Dados SQLite do Copernico
PRAGMA foreign_keys = ON;

-- 1. Sessões de Conversa
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    titulo TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- 2. Mensagens da Sessão (com CASCADE delete)
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('system', 'user', 'assistant', 'tool')),
    content TEXT NOT NULL,
    tool_call_id TEXT,
    tool_calls TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);

-- 3. Índice Semântico do Cofre Padrão (Leitura / Escrita)
CREATE TABLE IF NOT EXISTS vault_index (
    path TEXT PRIMARY KEY,
    hash TEXT NOT NULL,
    embedding BLOB NOT NULL,
    dim INTEGER NOT NULL,
    titulo TEXT,
    mtime REAL NOT NULL
);

-- 4. Índice Semântico do Cofre Obsidian (Somente Leitura)
CREATE TABLE IF NOT EXISTS obsidian_index (
    path TEXT PRIMARY KEY,
    hash TEXT NOT NULL,
    embedding BLOB NOT NULL,
    dim INTEGER NOT NULL,
    titulo TEXT,
    categoria TEXT,
    mtime REAL NOT NULL
);
