use rusqlite::Connection;

/// Migrações do Kanban Semanal, hábitos e índice de entidades.
///
/// Idempotente (`IF NOT EXISTS`) e chamada por **todos** os bootstraps de
/// conexão — `Database::init` (caminho efetivo da aplicação) e
/// `create_pool` (bootstrap canônico referenciado pela documentação).
pub fn run_kanban_migrations(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        r#"
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

        CREATE INDEX IF NOT EXISTS idx_kanban_weeks_status
            ON kanban_weeks(status, year, iso_week);

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

        CREATE INDEX IF NOT EXISTS idx_kanban_tasks_week
            ON kanban_tasks(week_id, task_column, position);
        CREATE INDEX IF NOT EXISTS idx_kanban_tasks_due
            ON kanban_tasks(due_date);
        CREATE INDEX IF NOT EXISTS idx_kanban_tasks_habit
            ON kanban_tasks(habit_id);

        -- Idempotência da geração por hábito: uma tarefa por data/semana.
        CREATE UNIQUE INDEX IF NOT EXISTS uq_kanban_tasks_habit
            ON kanban_tasks(habit_id, week_id, due_date)
            WHERE habit_id IS NOT NULL;

        -- Notas vinculadas À parte da nota principal (`kanban_tasks.note_path`).
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

        -- Derivado e reconstruível a partir das notas `tipo: entidade`.
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
        "#,
    )
}
