"""Daily habits (max 10, binary + numeric) + daily quick notes. Plain functions."""
import re
import uuid
from datetime import datetime

from . import kanban

MAX_HABITS = 10
TIPOS = ("binary", "numeric")
DATA_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def today_str() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _check_data(data: str) -> str:
    data = (data or "").strip() or today_str()
    if not DATA_RE.match(data):
        raise ValueError(f"data inválida: {data}. Use YYYY-MM-DD.")
    return data


def habit_to_dict(row, valor: float = 0, feito: int = 0) -> dict:
    keys = row.keys()
    return {
        "id": row["id"],
        "nome": row["nome"],
        "tipo": row["tipo"],
        "unidade": row["unidade"],
        "meta": row["meta"] if "meta" in keys else 0,
        "dias": row["dias"] if "dias" in keys else "",
        "valor": valor,
        "feito": feito,
        "created_at": row["created_at"],
    }


def cumprido(tipo: str, valor: float, meta: float, feito=None) -> bool:
    """Dia conta como feito? Flag explícita manda; sem ela, regra antiga."""
    if feito is not None:
        return bool(feito)
    if (valor or 0) <= 0:
        return False
    if tipo == "numeric" and (meta or 0) > 0:
        return valor >= meta
    return True


def list_habits(conn, data: str = "") -> list[dict]:
    data = _check_data(data)
    rows = conn.execute("SELECT * FROM habits ORDER BY created_at, id").fetchall()
    checks = {r["habit_id"]: (r["valor"], r["feito"] if "feito" in r.keys() else 0)
              for r in conn.execute("SELECT * FROM habit_checks WHERE data = ?", (data,)).fetchall()}
    return [habit_to_dict(r, *checks.get(r["id"], (0, 0))) for r in rows]


def _norm_dias(dias) -> str:
    if isinstance(dias, str):
        parts = [p.strip() for p in dias.split(",")]
    else:
        parts = list(dias or [])
    valid = ("Seg", "Ter", "Qua", "Qui", "Sex", "Sab", "Dom")
    return ",".join(p for p in parts if p in valid)


def create_habit(conn, nome: str, tipo: str = "binary", unidade: str = "", meta: float = 0, dias="") -> dict:
    nome = (nome or "").strip()
    if not nome:
        raise ValueError("nome vazio")
    tipo = (tipo or "binary").strip()
    if tipo not in TIPOS:
        raise ValueError(f"tipo inválido: {tipo}")
    try:
        meta = float(meta or 0)
    except (TypeError, ValueError):
        raise ValueError("meta deve ser número")
    if meta < 0:
        raise ValueError("meta não pode ser negativa")
    total = conn.execute("SELECT COUNT(*) AS c FROM habits").fetchone()["c"]
    if total >= MAX_HABITS:
        raise ValueError("máximo de 10 hábitos")
    hid = f"h_{uuid.uuid4().hex[:12]}"
    conn.execute(
        "INSERT INTO habits (id, nome, tipo, unidade, meta, dias, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (hid, nome, tipo, (unidade or "").strip(), meta, _norm_dias(dias), now_iso()),
    )
    conn.commit()
    return habit_to_dict(conn.execute("SELECT * FROM habits WHERE id = ?", (hid,)).fetchone(), 0, 0)


def delete_habit(conn, habit_id: str) -> None:
    cur = conn.execute("DELETE FROM habits WHERE id = ?", (habit_id,))
    if cur.rowcount == 0:
        raise LookupError(f"hábito não encontrado: {habit_id}")
    conn.commit()


def update_habit(conn, habit_id: str, patch: dict) -> dict:
    row = conn.execute("SELECT * FROM habits WHERE id = ?", (habit_id,)).fetchone()
    if not row:
        raise LookupError(f"hábito não encontrado: {habit_id}")
    updates: dict = {}
    if "nome" in patch:
        nome = (patch.get("nome") or "").strip()
        if not nome:
            raise ValueError("nome vazio")
        updates["nome"] = nome
    if "unidade" in patch:
        updates["unidade"] = (patch.get("unidade") or "").strip()
    if "meta" in patch:
        try:
            meta = float(patch.get("meta") or 0)
        except (TypeError, ValueError):
            raise ValueError("meta deve ser número")
        if meta < 0:
            raise ValueError("meta não pode ser negativa")
        updates["meta"] = meta
    if "dias" in patch:
        updates["dias"] = _norm_dias(patch.get("dias"))
    if updates:
        sets = ", ".join(f"{k} = ?" for k in updates)
        conn.execute(f"UPDATE habits SET {sets} WHERE id = ?", (*updates.values(), habit_id))
        conn.commit()
    data = habits_today(conn)
    return habit_to_dict(conn.execute("SELECT * FROM habits WHERE id = ?", (habit_id,)).fetchone(), data.get(habit_id, 0))


def habits_today(conn) -> dict[str, float]:
    rows = conn.execute("SELECT habit_id, valor FROM habit_checks WHERE data = ?", (today_str(),)).fetchall()
    return {r["habit_id"]: r["valor"] for r in rows}


def set_check(conn, habit_id: str, data: str, patch) -> dict:
    """patch: número (legado) ou dict {valor?, feito?}. Valor>0 liga o feito, salvo ordem explícita."""
    if not isinstance(patch, dict):
        patch = {"valor": patch}
    data = _check_data(data)
    row = conn.execute("SELECT * FROM habits WHERE id = ?", (habit_id,)).fetchone()
    if not row:
        raise LookupError(f"hábito não encontrado: {habit_id}")
    cur = conn.execute("SELECT valor, feito FROM habit_checks WHERE habit_id = ? AND data = ?", (habit_id, data)).fetchone()
    valor = cur["valor"] if cur else 0
    feito = cur["feito"] if cur and "feito" in cur.keys() else 0
    if "valor" in patch:
        try:
            valor = float(patch.get("valor") or 0)
        except (TypeError, ValueError):
            raise ValueError("valor deve ser número")
        if row["tipo"] == "binary":
            valor = 1 if valor > 0 else 0
        elif valor < 0:
            raise ValueError("valor não pode ser negativo")
        if valor > 0 and "feito" not in patch:
            feito = 1
    if "feito" in patch:
        feito = 1 if patch.get("feito") else 0
        if row["tipo"] == "binary":
            valor = feito
        elif not feito:
            valor = 0
        elif "valor" not in patch:
            meta = row["meta"] if "meta" in row.keys() else 0
            if (meta or 0) > 0:
                valor = meta
    conn.execute(
        "INSERT INTO habit_checks (habit_id, data, valor, feito) VALUES (?, ?, ?, ?) "
        "ON CONFLICT(habit_id, data) DO UPDATE SET valor = excluded.valor, feito = excluded.feito",
        (habit_id, data, valor, feito),
    )
    conn.commit()
    if "feito" in patch:
        from . import kanban

        link = conn.execute("SELECT task_id FROM habit_tasks WHERE habit_id = ? AND data = ?", (habit_id, data)).fetchone()
        if link:
            try:
                kanban.move_task(conn, link["task_id"], "done" if feito else "doing", 999)
            except (ValueError, LookupError):
                pass
    return habit_to_dict(row, valor, feito)


def weekday_label(data: str) -> str:
    dias = ("Seg", "Ter", "Qua", "Qui", "Sex", "Sab", "Dom")
    return dias[datetime.strptime(_check_data(data), "%Y-%m-%d").weekday()]


def week_days(data: str = "") -> list[str]:
    from datetime import timedelta

    base = datetime.strptime(_check_data(data), "%Y-%m-%d").date()
    start = base - timedelta(days=base.weekday())
    return [(start + timedelta(days=i)).isoformat() for i in range(7)]


def ensure_habit_tasks(conn, data: str = "") -> int:
    """Garante 1 tarefa por hábito ativo em cada dia da semana (via mapa habit_tasks)."""
    from . import kanban

    conn.execute("CREATE TABLE IF NOT EXISTS habit_tasks (habit_id TEXT NOT NULL, data TEXT NOT NULL, task_id TEXT NOT NULL, PRIMARY KEY (habit_id, data))")
    created = 0
    for day in week_days(data):
        label = weekday_label(day)
        for h in conn.execute("SELECT * FROM habits").fetchall():
            dias = (h["dias"] if "dias" in h.keys() else "") or ""
            ativos = [d for d in dias.split(",") if d]
            if ativos and label not in ativos:
                continue
            link = conn.execute("SELECT task_id FROM habit_tasks WHERE habit_id = ? AND data = ?", (h["id"], day)).fetchone()
            if link and conn.execute("SELECT 1 FROM tasks WHERE id = ?", (link["task_id"],)).fetchone():
                continue
            t = kanban.create_task(conn, h["nome"], "doing")
            conn.execute("UPDATE tasks SET day_label = ?, habit_id = ? WHERE id = ?", (label, h["id"], t["id"]))
            conn.execute("INSERT OR REPLACE INTO habit_tasks (habit_id, data, task_id) VALUES (?, ?, ?)", (h["id"], day, t["id"]))
            conn.commit()
            created += 1
    return created


def sync_task_done(conn, task_id: str, done: bool) -> None:
    """Task com habit_id concluída/reaberta espelha o feito do hábito (via mapa habit_tasks)."""
    row = conn.execute("SELECT habit_id FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if not row or not row["habit_id"]:
        return
    link = conn.execute("SELECT data FROM habit_tasks WHERE task_id = ?", (task_id,)).fetchone()
    if not link:
        return
    set_check(conn, row["habit_id"], link["data"], {"feito": 1 if done else 0})


def get_daily_note(conn, data: str) -> dict | None:
    data = _check_data(data)
    row = conn.execute("SELECT * FROM daily_notes WHERE data = ?", (data,)).fetchone()
    if not row:
        return None
    return {"data": row["data"], "conteudo": row["conteudo"], "updated_at": row["updated_at"]}


def save_daily_note(conn, data: str, conteudo: str) -> dict:
    data = _check_data(data)
    conteudo = conteudo if isinstance(conteudo, str) else ""
    now = now_iso()
    conn.execute(
        "INSERT INTO daily_notes (data, conteudo, created_at, updated_at) VALUES (?, ?, ?, ?) "
        "ON CONFLICT(data) DO UPDATE SET conteudo = excluded.conteudo, updated_at = excluded.updated_at",
        (data, conteudo, now, now),
    )
    conn.commit()
    return get_daily_note(conn, data) or {"data": data, "conteudo": conteudo, "updated_at": now}


def get_hoje(conn, data: str = "") -> dict:
    data = _check_data(data)
    board = kanban.list_board(conn)
    return {
        "data": data,
        "habits": list_habits(conn, data),
        "doing": board.get("doing", []),
        "nota": get_daily_note(conn, data),
    }
