"""SQLite helper: stdlib only, WAL + foreign_keys, schema.sql bootstrap."""
import sqlite3
from pathlib import Path

from . import config

SCHEMA_PATH = Path(__file__).resolve().parent / "schema.sql"


def connect() -> sqlite3.Connection:
    config.DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(config.DB_PATH), timeout=30.0, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA busy_timeout = 5000;")
    return conn


def init_db() -> None:
    conn = connect()
    try:
        with open(SCHEMA_PATH, "r", encoding="utf-8") as f:
            conn.executescript(f.read())
        _migrate_tasks(conn)
        _migrate_habits_legacy(conn)
        conn.commit()
    finally:
        conn.close()


def _ensure_column(conn, table: str, column: str, ddl: str) -> None:
    cols = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    if column not in cols:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")


def _migrate_tasks(conn) -> None:
    """Additive migration for DBs created before newer task columns."""
    _ensure_column(conn, "tasks", "day_label", "TEXT")
    _ensure_column(conn, "tasks", "note_md", "TEXT NOT NULL DEFAULT ''")
    _ensure_column(conn, "tasks", "habit_id", "TEXT")
    _ensure_column(conn, "tasks", "categoria", "TEXT NOT NULL DEFAULT ''")
    _ensure_column(conn, "habits", "meta", "REAL NOT NULL DEFAULT 0")


def _migrate_habits_legacy(conn) -> None:
    """Real DBs may carry a pre-v0 habits table (titulo/cron_expr/...). Rebuild to v0, keeping rows."""
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(habits)").fetchall()}
    if "nome" in cols:
        return
    rows = conn.execute("SELECT * FROM habits").fetchall()
    conn.execute("ALTER TABLE habits RENAME TO habits_legacy")
    conn.execute(
        "CREATE TABLE habits (id TEXT PRIMARY KEY, nome TEXT NOT NULL, "
        "tipo TEXT NOT NULL DEFAULT 'binary', unidade TEXT NOT NULL DEFAULT '', "
        "meta REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL)"
    )
    for r in rows:
        keys = r.keys()
        get = lambda k, d="": r[k] if k in keys and r[k] is not None else d
        tm = get("tipo_metrica")
        tipo = tm if tm in ("binary", "numeric") else "binary"
        conn.execute(
            "INSERT OR IGNORE INTO habits (id, nome, tipo, unidade, meta, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (get("id"), get("nome", get("titulo", "Hábito")), tipo, get("unidade"), get("meta", 0) or 0, get("created_at", "")),
        )


def rows_to_dicts(cursor) -> list[dict]:
    cols = [d[0] for d in cursor.description] if cursor.description else []
    return [dict(zip(cols, r)) for r in cursor.fetchall()]
