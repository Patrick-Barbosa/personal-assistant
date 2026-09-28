"""Flat kanban tasks: todo / doing / done. Task detail: day_label + note_md (.md)."""
import uuid
from datetime import datetime

COLUMNS = ("todo", "doing", "done")

DAY_LABELS = ("Seg", "Ter", "Qua", "Qui", "Sex", "Sab", "Dom")


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def to_dict(row) -> dict:
    return {
        "id": row["id"],
        "titulo": row["titulo"],
        "column": row["task_column"],
        "position": row["position"],
        "day_label": row["day_label"] if "day_label" in row.keys() else None,
        "note_md": row["note_md"] if "note_md" in row.keys() else "",
        "habit_id": row["habit_id"] if "habit_id" in row.keys() else None,
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


def update_task(conn, task_id: str, patch: dict) -> dict:
    row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if not row:
        raise LookupError(f"tarefa não encontrada: {task_id}")
    updates: dict = {}
    if "titulo" in patch:
        titulo = (patch.get("titulo") or "").strip()
        if not titulo:
            raise ValueError("titulo vazio")
        updates["titulo"] = titulo
    if "day_label" in patch:
        day = patch.get("day_label")
        if day in (None, ""):
            updates["day_label"] = None
        elif day in DAY_LABELS:
            updates["day_label"] = day
        else:
            raise ValueError(f"day_label inválido: {day}. Use Seg/Ter/Qua/Qui/Sex/Sab/Dom ou vazio.")
    if "note_md" in patch:
        note = patch.get("note_md")
        if note is None:
            updates["note_md"] = ""
        elif isinstance(note, str):
            updates["note_md"] = note
        else:
            raise ValueError("note_md deve ser texto")
    if "habit_id" in patch:
        hab = patch.get("habit_id")
        updates["habit_id"] = hab if hab else None
    if updates:
        sets = ", ".join(f"{k} = ?" for k in updates)
        conn.execute(f"UPDATE tasks SET {sets}, updated_at = ? WHERE id = ?", (*updates.values(), now_iso(), task_id))
        conn.commit()
    return to_dict(conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone())


def delete_task(conn, task_id: str) -> None:
    cur = conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
    if cur.rowcount == 0:
        raise LookupError(f"tarefa não encontrada: {task_id}")
    conn.commit()
