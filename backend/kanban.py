"""Kanban semanal + hábitos + insights. Ports kanban_srv.rs / habit_srv.rs."""
import re
import uuid
from datetime import date, datetime, timedelta

from . import db

HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def iso_week_of(d: date) -> tuple[int, int]:
    iso = d.isocalendar()
    return iso.year, iso.week


def week_id_for(year: int, week: int) -> str:
    return f"{year}-W{week:02d}"


def week_id_of(d: date) -> str:
    y, w = iso_week_of(d)
    return week_id_for(y, w)


def iso_week_bounds(year: int, week: int) -> tuple[date, date]:
    start = date.fromisocalendar(year, week, 1)
    return start, start + timedelta(days=6)


def parse_week_id(raw: str) -> tuple[int, int] | None:
    m = re.fullmatch(r"(\d{4})-W(\d{2})", (raw or "").strip())
    if not m:
        return None
    return int(m.group(1)), int(m.group(2))


def get_or_create_open_week(conn, today: date | None = None) -> dict:
    today = today or date.today()
    y, w = iso_week_of(today)
    wid = week_id_for(y, w)
    row = conn.execute("SELECT * FROM kanban_weeks WHERE id = ?", (wid,)).fetchone()
    if row:
        return dict(row)
    start, end = iso_week_bounds(y, w)
    week = {
        "id": wid,
        "year": y,
        "iso_week": w,
        "week_start": start.isoformat(),
        "week_end": end.isoformat(),
        "status": "open",
        "created_at": now_iso(),
        "closed_at": None,
    }
    conn.execute(
        "INSERT INTO kanban_weeks (id, year, iso_week, week_start, week_end, status, created_at, closed_at)"
        " VALUES (:id, :year, :iso_week, :week_start, :week_end, :status, :created_at, :closed_at)",
        week,
    )
    conn.commit()
    return week


def ensure_weeks_closed(conn, today: date | None = None) -> list[str]:
    """Closes past open weeks (lazy Sunday-23h rule). Returns closed ids."""
    today = today or date.today()
    current = week_id_of(today)
    closed: list[str] = []
    for row in conn.execute(
        "SELECT * FROM kanban_weeks WHERE status = 'open' AND id != ? ORDER BY id", (current,)
    ).fetchall():
        w = dict(row)
        if w["week_end"] < today.isoformat():
            conn.execute(
                "UPDATE kanban_weeks SET status = 'closed', closed_at = ? WHERE id = ?",
                (now_iso(), w["id"]),
            )
            for t in conn.execute(
                "SELECT * FROM kanban_tasks WHERE week_id = ? AND status = 'active' AND task_column != 'done' AND task_kind = 'normal'",
                (w["id"],),
            ).fetchall():
                t = dict(t)
                conn.execute(
                    "INSERT OR IGNORE INTO inbox_items (id, session_id, title, summary, content, item_type, status, requires_decision, created_at)"
                    " VALUES (?, NULL, ?, ?, ?, 'kanban_rollover', 'unread', 1, ?)",
                    (
                        f"rollover-{t['id']}",
                        f"Rollover: {t['titulo']}",
                        t["titulo"],
                        f"<!--kanban_rollover task_id={t['id']} week_id={w['id']}-->",
                        now_iso(),
                    ),
                )
            closed.append(w["id"])
    if closed:
        conn.commit()
    return closed


def task_links(conn, task_id: str) -> dict:
    notes = [
        r["note_path"]
        for r in conn.execute(
            "SELECT note_path FROM kanban_task_notes WHERE task_id = ?", (task_id,)
        ).fetchall()
    ]
    entities: list[dict] = []
    for r in conn.execute(
        "SELECT e.* FROM entities_index e JOIN kanban_task_entities l ON l.entity_id = e.id WHERE l.task_id = ?",
        (task_id,),
    ).fetchall():
        entities.append(dict(r))
    return {"task_id": task_id, "notes": notes, "entities": entities}


def get_board(conn, semana: str | None = None) -> dict:
    ensure_weeks_closed(conn)
    if semana:
        parsed = parse_week_id(semana)
        if not parsed:
            raise ValueError(f"semana inválida: {semana} (use YYYY-Www)")
        row = conn.execute("SELECT * FROM kanban_weeks WHERE id = ?", (semana,)).fetchone()
        if not row:
            raise LookupError(f"semana não encontrada: {semana}")
        week = dict(row)
    else:
        week = get_or_create_open_week(conn)
    tasks = [
        _to_task(dict(r))
        for r in conn.execute(
            "SELECT * FROM kanban_tasks WHERE week_id = ? ORDER BY task_column, position, created_at",
            (week["id"],),
        ).fetchall()
    ]
    links = [task_links(conn, t["id"]) for t in tasks]
    habits = [dict(r) | {"streak_atual": 0} for r in conn.execute("SELECT * FROM habits WHERE ativo = 1 ORDER BY created_at").fetchall()]
    return {"week": week, "tasks": tasks, "links": links, "habits": habits}


def _to_task(t: dict) -> dict:
    return {
        "id": t["id"],
        "week_id": t["week_id"],
        "titulo": t["titulo"],
        "note_path": t.get("note_path"),
        "task_column": t.get("task_column", "todo"),
        "status": t.get("status", "active"),
        "carried_to": t.get("carried_to"),
        "position": t.get("position", 0),
        "task_kind": t.get("task_kind", "normal"),
        "habit_id": t.get("habit_id"),
        "due_date": t.get("due_date"),
        "created_at": t.get("created_at"),
        "updated_at": t.get("updated_at"),
    }


def _require_open(conn, week_id: str) -> None:
    row = conn.execute("SELECT status FROM kanban_weeks WHERE id = ?", (week_id,)).fetchone()
    if row and row["status"] == "closed":
        raise ValueError(f"semana fechada: {week_id}")


def create_task(conn, titulo: str, column: str = "todo", due_date: str | None = None) -> dict:
    titulo = (titulo or "").strip()
    if not titulo:
        raise ValueError("titulo não pode ser vazio")
    if column not in ("todo", "doing", "done"):
        raise ValueError(f"coluna inválida: {column}")
    week = get_or_create_open_week(conn)
    pos = conn.execute(
        "SELECT COALESCE(MAX(position), -1) + 1 AS p FROM kanban_tasks WHERE week_id = ? AND task_column = ?",
        (week["id"], column),
    ).fetchone()["p"]
    t = {
        "id": f"t_{uuid.uuid4().hex[:12]}",
        "week_id": week["id"],
        "titulo": titulo,
        "note_path": None,
        "task_column": column,
        "status": "active",
        "carried_to": None,
        "position": float(pos or 0),
        "task_kind": "normal",
        "habit_id": None,
        "due_date": due_date,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    conn.execute(
        "INSERT INTO kanban_tasks (id, week_id, titulo, note_path, task_column, status, carried_to, position, task_kind, habit_id, due_date, created_at, updated_at)"
        " VALUES (:id, :week_id, :titulo, :note_path, :task_column, :status, :carried_to, :position, :task_kind, :habit_id, :due_date, :created_at, :updated_at)",
        t,
    )
    conn.commit()
    return _to_task(t)


def move_task(conn, task_id: str, column: str, index: int = 0) -> dict:
    if column not in ("todo", "doing", "done"):
        raise ValueError(f"coluna inválida: {column}")
    row = conn.execute("SELECT * FROM kanban_tasks WHERE id = ?", (task_id,)).fetchone()
    if not row:
        raise LookupError(f"tarefa não encontrada: {task_id}")
    t = dict(row)
    _require_open(conn, t["week_id"])
    was_done = t["task_column"] == "done"
    conn.execute(
        "UPDATE kanban_tasks SET task_column = ?, position = ?, updated_at = ? WHERE id = ?",
        (column, float(index), now_iso(), task_id),
    )
    if t.get("task_kind") == "habit" and t.get("habit_id") and t.get("due_date"):
        if column == "done" and not was_done:
            conn.execute(
                "INSERT OR IGNORE INTO user_tabular_data (id, category, record_date, metric_key, metric_value, notes, created_at)"
                " VALUES (?, 'habito', ?, ?, 1, ?, ?)",
                (f"hab-{t['habit_id']}-{t['due_date']}", t["due_date"], t["habit_id"], t["titulo"], now_iso()),
            )
        elif was_done and column != "done":
            conn.execute(
                "DELETE FROM user_tabular_data WHERE category = 'habito' AND metric_key = ? AND record_date = ?",
                (t["habit_id"], t["due_date"]),
            )
    conn.commit()
    return _to_task(dict(conn.execute("SELECT * FROM kanban_tasks WHERE id = ?", (task_id,)).fetchone()))


def update_task(conn, task_id: str, titulo: str, due_date: str | None = None) -> dict:
    row = conn.execute("SELECT * FROM kanban_tasks WHERE id = ?", (task_id,)).fetchone()
    if not row:
        raise LookupError(f"tarefa não encontrada: {task_id}")
    t = dict(row)
    _require_open(conn, t["week_id"])
    conn.execute(
        "UPDATE kanban_tasks SET titulo = ?, due_date = COALESCE(?, due_date), updated_at = ? WHERE id = ?",
        ((titulo or "").strip() or t["titulo"], due_date, now_iso(), task_id),
    )
    conn.commit()
    return _to_task(dict(conn.execute("SELECT * FROM kanban_tasks WHERE id = ?", (task_id,)).fetchone()))


def delete_task(conn, task_id: str) -> None:
    row = conn.execute("SELECT * FROM kanban_tasks WHERE id = ?", (task_id,)).fetchone()
    if not row:
        return
    _require_open(conn, dict(row)["week_id"])
    conn.execute("DELETE FROM kanban_tasks WHERE id = ?", (task_id,))
    conn.commit()


# --- Hábitos ---

def _cron_match(expr: str, d: date) -> bool:
    """5-field cron match on (dom, month, dow). Ignores min/hour (daily granularity)."""
    try:
        minute, hour, dom, month, dow = (expr or "").split()
    except ValueError:
        return False
    py_dow = (d.weekday() + 1) % 7  # cron: 0/7 = Sunday
    return _field_match(dom, d.day, 1, 31) and _field_match(month, d.month, 1, 12) and _field_match(
        dow, py_dow, 0, 6, sunday7=True
    )


def _field_match(field: str, value: int, lo: int, hi: int, sunday7: bool = False) -> bool:
    if field == "*":
        return True
    for part in field.split(","):
        if "/" in part:
            base, step = part.split("/", 1)
            step = int(step)
            start, end = (lo, hi) if base in ("*", "") else _range(base, lo, hi)
            if value in range(start, end + 1, step):
                return True
        elif "-" in part:
            start, end = _range(part, lo, hi)
            if start <= value <= end:
                return True
        else:
            v = 7 if (sunday7 and part.strip() == "7") else int(part)
            if v == value:
                return True
    return False


def _range(part: str, lo: int, hi: int) -> tuple[int, int]:
    a, b = part.split("-", 1)
    return max(lo, int(a)), min(hi, int(b))


def list_habits(conn) -> list[dict]:
    return [dict(r) | {"streak_atual": streak_of(conn, r["id"])} for r in conn.execute("SELECT * FROM habits ORDER BY created_at").fetchall()]


def create_habit(conn, titulo: str, cron_expr: str, cor: str | None = None) -> dict:
    titulo = (titulo or "").strip()
    if not titulo:
        raise ValueError("titulo não pode ser vazio")
    if not cron_expr or len(cron_expr.split()) != 5:
        raise ValueError("cron inválido (use 5 campos: min hora dom mês dow)")
    cor = (cor or "#22c55e").strip()
    if not HEX_COLOR_RE.match(cor):
        raise ValueError(f"cor inválida: {cor}")
    h = {
        "id": f"h_{uuid.uuid4().hex[:12]}",
        "titulo": titulo,
        "cron_expr": cron_expr.strip(),
        "cor": cor,
        "ativo": 1,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    conn.execute(
        "INSERT INTO habits (id, titulo, cron_expr, cor, ativo, created_at, updated_at)"
        " VALUES (:id, :titulo, :cron_expr, :cor, :ativo, :created_at, :updated_at)",
        h,
    )
    conn.commit()
    return dict(h) | {"streak_atual": 0}


def set_habit_active(conn, habit_id: str, ativo: bool) -> dict:
    conn.execute("UPDATE habits SET ativo = ?, updated_at = ? WHERE id = ?", (1 if ativo else 0, now_iso(), habit_id))
    conn.commit()
    row = conn.execute("SELECT * FROM habits WHERE id = ?", (habit_id,)).fetchone()
    if not row:
        raise LookupError(f"hábito não encontrado: {habit_id}")
    return dict(row) | {"streak_atual": streak_of(conn, habit_id)}


def delete_habit(conn, habit_id: str) -> bool:
    n = conn.execute("SELECT COUNT(*) AS c FROM kanban_tasks WHERE habit_id = ?", (habit_id,)).fetchone()["c"]
    if n:
        conn.execute("UPDATE habits SET ativo = 0, updated_at = ? WHERE id = ?", (now_iso(), habit_id))
        conn.commit()
        return False
    conn.execute("DELETE FROM habits WHERE id = ?", (habit_id,))
    conn.commit()
    return True


def sync_habit_tasks_today(conn, today: date | None = None) -> int:
    today = today or date.today()
    week = get_or_create_open_week(conn, today)
    if week["status"] == "closed":
        return 0
    created = 0
    for r in conn.execute("SELECT * FROM habits WHERE ativo = 1").fetchall():
        h = dict(r)
        if not _cron_match(h["cron_expr"], today):
            continue
        pos = conn.execute(
            "SELECT COALESCE(MAX(position), -1) + 1 AS p FROM kanban_tasks WHERE week_id = ? AND task_column = 'todo'",
            (week["id"],),
        ).fetchone()["p"]
        try:
            conn.execute(
                "INSERT INTO kanban_tasks (id, week_id, titulo, task_column, status, position, task_kind, habit_id, due_date, created_at, updated_at)"
                " VALUES (?, ?, ?, 'todo', 'active', ?, 'habit', ?, ?, ?, ?)",
                (
                    f"t_{uuid.uuid4().hex[:12]}",
                    week["id"],
                    h["titulo"],
                    float(pos or 0),
                    h["id"],
                    today.isoformat(),
                    now_iso(),
                    now_iso(),
                ),
            )
            created += 1
        except Exception:
            continue  # unique index -> already generated (idempotent)
    conn.commit()
    return created


def streak_of(conn, habit_id: str) -> int:
    rows = conn.execute(
        "SELECT record_date FROM user_tabular_data WHERE category = 'habito' AND metric_key = ? ORDER BY record_date DESC",
        (habit_id,),
    ).fetchall()
    days = {r["record_date"] for r in rows}
    streak, cursor = 0, date.today()
    if cursor.isoformat() not in days:
        cursor -= timedelta(days=1)
    while cursor.isoformat() in days:
        streak += 1
        cursor -= timedelta(days=1)
    return streak


def get_insights(conn, periodo: str = "semana") -> dict:
    ensure_weeks_closed(conn)
    sync_habit_tasks_today(conn)
    habits = list_habits(conn)
    today = date.today()
    feito_hoje = sum(
        1
        for r in conn.execute(
            "SELECT 1 FROM user_tabular_data WHERE category = 'habito' AND record_date = ?", (today.isoformat(),)
        ).fetchall()
    )
    total_hoje = sum(1 for h in habits if _cron_match(dict(conn.execute("SELECT cron_expr FROM habits WHERE id = ?", (h["id"],)).fetchone())["cron_expr"], today))
    week = get_or_create_open_week(conn)
    wt = conn.execute("SELECT COUNT(*) AS t, SUM(task_column = 'done') AS d FROM kanban_tasks WHERE week_id = ?", (week["id"],)).fetchone()
    pct_semana = round(100.0 * (wt["d"] or 0) / wt["t"], 1) if wt["t"] else 0.0
    bars: list[dict] = []
    for i in range(13, -1, -1):
        d = today - timedelta(days=i)
        ds = d.isoformat()
        tk = conn.execute(
            "SELECT COUNT(*) AS t, SUM(task_column = 'done') AS done FROM kanban_tasks WHERE due_date = ? OR substr(updated_at, 1, 10) = ?",
            (ds, ds),
        ).fetchone()
        hb = conn.execute(
            "SELECT COUNT(*) AS c FROM user_tabular_data WHERE category = 'habito' AND record_date = ?", (ds,)
        ).fetchone()["c"]
        total, done = tk["t"] or 0, tk["done"] or 0
        bars.append({
            "date": ds,
            "pct_tarefas": round(100.0 * done / total, 1) if total else 0.0,
            "habitos_registrados": hb,
            "tarefas_feitas": done,
            "tarefas_total": total,
        })
    weeks = [dict(r) for r in conn.execute("SELECT * FROM kanban_weeks ORDER BY id DESC LIMIT 8").fetchall()]
    trend = []
    for w in sorted(weeks, key=lambda x: x["id"]):
        tk = conn.execute("SELECT COUNT(*) AS t, SUM(task_column = 'done') AS d FROM kanban_tasks WHERE week_id = ?", (w["id"],)).fetchone()
        hb = conn.execute("SELECT COUNT(*) AS t, SUM(task_column = 'done') AS d FROM kanban_tasks WHERE week_id = ? AND task_kind = 'habit'", (w["id"],)).fetchone()
        trend.append({
            "week_id": w["id"],
            "pct_conclusao": round(100.0 * (tk["d"] or 0) / tk["t"], 1) if tk["t"] else 0.0,
            "taxa_habitos": round(100.0 * (hb["d"] or 0) / hb["t"], 1) if hb["t"] else 0.0,
        })
    streaks = []
    maior: dict[str, int] = {}
    for h in habits:
        rows = conn.execute(
            "SELECT record_date FROM user_tabular_data WHERE category = 'habito' AND metric_key = ? ORDER BY record_date",
            (h["id"],),
        ).fetchall()
        best, cur, prev = 0, 0, None
        for r in rows:
            d = date.fromisoformat(r["record_date"])
            cur = cur + 1 if prev and (d - prev).days == 1 else 1
            best = max(best, cur)
            prev = d
        maior[h["id"]] = best
        streaks.append({
            "habit": h,
            "streak_atual": h["streak_atual"],
            "maior_streak": best,
            "feito_hoje": conn.execute(
                "SELECT 1 FROM user_tabular_data WHERE category = 'habito' AND metric_key = ? AND record_date = ?",
                (h["id"], today.isoformat()),
            ).fetchone()
            is not None,
        })
    lines = [
        {
            "periodo": w["week_id"],
            "estimado_tarefas": 0,
            "realizado_tarefas": 0,
            "estimado_habitos": 0,
            "realizado_habitos": 0,
        }
        for w in trend
    ]
    return {
        "periodo": periodo or "semana",
        "streaks": streaks,
        "habitos_hoje_total": total_hoje,
        "habitos_hoje_feitos": feito_hoje,
        "pct_semana": pct_semana,
        "bars": bars,
        "trend": trend,
        "lines": lines,
    }
