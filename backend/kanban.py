"""Flat kanban tasks: todo / doing / done. No weeks, no habits, no notes."""
import uuid
from datetime import datetime

COLUMNS = ("todo", "doing", "done")


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def to_dict(row) -> dict:
    return {
        "id": row["id"],
        "titulo": row["titulo"],
        "column": row["task_column"],
        "position": row["position"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def list_board(conn) -> dict[str, list[dict]]:
    rows = conn.execute("SELECT * FROM tasks ORDER BY task_column, position, id").fetchall()
    board: dict[str, list[dict]] = {c: [] for c in COLUMNS}
    for r in rows:
        board.setdefault(r["task_column"], board["todo"]).append(to_dict(r))
    return board


def create_task(conn, titulo: str, column: str = "todo") -> dict:
    titulo = (titulo or "").strip()
    if not titulo:
        raise ValueError("titulo vazio")
    if column not in COLUMNS:
        raise ValueError(f"coluna inválida: {column}")
    top = conn.execute("SELECT COALESCE(MAX(position), -1) AS m FROM tasks WHERE task_column = ?", (column,)).fetchone()["m"]
    tid = f"t_{uuid.uuid4().hex[:12]}"
    now = now_iso()
    conn.execute(
        "INSERT INTO tasks (id, titulo, task_column, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        (tid, titulo, column, top + 1, now, now),
    )
    conn.commit()
    return to_dict(conn.execute("SELECT * FROM tasks WHERE id = ?", (tid,)).fetchone())


def move_task(conn, task_id: str, column: str = "todo", index: int = 0) -> dict:
    if column not in COLUMNS:
        raise ValueError(f"coluna inválida: {column}")
    row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if not row:
        raise LookupError(f"tarefa não encontrada: {task_id}")
    ids = [r["id"] for r in conn.execute("SELECT id FROM tasks WHERE task_column = ? AND id != ? ORDER BY position, id", (column, task_id)).fetchall()]
    index = max(0, min(int(index or 0), len(ids)))
    ids.insert(index, task_id)
    for i, tid in enumerate(ids):
        conn.execute("UPDATE tasks SET position = ?, task_column = ?, updated_at = ? WHERE id = ?", (i, column, now_iso(), tid))
    conn.commit()
    return to_dict(conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone())


def update_task(conn, task_id: str, titulo: str) -> dict:
    titulo = (titulo or "").strip()
    if not titulo:
        raise ValueError("titulo vazio")
    cur = conn.execute("UPDATE tasks SET titulo = ?, updated_at = ? WHERE id = ?", (titulo, now_iso(), task_id))
    if cur.rowcount == 0:
        raise LookupError(f"tarefa não encontrada: {task_id}")
    conn.commit()
    return to_dict(conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone())


def delete_task(conn, task_id: str) -> None:
    cur = conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
    if cur.rowcount == 0:
        raise LookupError(f"tarefa não encontrada: {task_id}")
    conn.commit()
