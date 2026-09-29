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


def habit_to_dict(row, valor: float = 0) -> dict:
    keys = row.keys()
    return {
        "id": row["id"],
        "nome": row["nome"],
        "tipo": row["tipo"],
        "unidade": row["unidade"],
        "meta": row["meta"] if "meta" in keys else 0,
        "valor": valor,
        "created_at": row["created_at"],
    }


def cumprido(tipo: str, valor: float, meta: float) -> bool:
    """Dia conta como feito? Numérico com meta exige atingir a meta."""
    if (valor or 0) <= 0:
        return False
    if tipo == "numeric" and (meta or 0) > 0:
        return valor >= meta
    return True


def list_habits(conn, data: str = "") -> list[dict]:
    data = _check_data(data)
    rows = conn.execute("SELECT * FROM habits ORDER BY created_at, id").fetchall()
    checks = {r["habit_id"]: r["valor"] for r in conn.execute("SELECT * FROM habit_checks WHERE data = ?", (data,)).fetchall()}
    return [habit_to_dict(r, checks.get(r["id"], 0)) for r in rows]


def create_habit(conn, nome: str, tipo: str = "binary", unidade: str = "", meta: float = 0) -> dict:
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
        "INSERT INTO habits (id, nome, tipo, unidade, meta, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (hid, nome, tipo, (unidade or "").strip(), meta, now_iso()),
    )
    conn.commit()
    return habit_to_dict(conn.execute("SELECT * FROM habits WHERE id = ?", (hid,)).fetchone(), 0)


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
    if updates:
        sets = ", ".join(f"{k} = ?" for k in updates)
        conn.execute(f"UPDATE habits SET {sets} WHERE id = ?", (*updates.values(), habit_id))
        conn.commit()
    data = habits_today(conn)
    return habit_to_dict(conn.execute("SELECT * FROM habits WHERE id = ?", (habit_id,)).fetchone(), data.get(habit_id, 0))


def habits_today(conn) -> dict[str, float]:
    rows = conn.execute("SELECT habit_id, valor FROM habit_checks WHERE data = ?", (today_str(),)).fetchall()
    return {r["habit_id"]: r["valor"] for r in rows}


def set_check(conn, habit_id: str, data: str, valor: float) -> dict:
    data = _check_data(data)
    row = conn.execute("SELECT * FROM habits WHERE id = ?", (habit_id,)).fetchone()
    if not row:
        raise LookupError(f"hábito não encontrado: {habit_id}")
    try:
        valor = float(valor)
    except (TypeError, ValueError):
        raise ValueError("valor deve ser número")
    if row["tipo"] == "binary":
        valor = 1 if valor > 0 else 0
    elif valor < 0:
        raise ValueError("valor não pode ser negativo")
    conn.execute(
        "INSERT INTO habit_checks (habit_id, data, valor) VALUES (?, ?, ?) "
        "ON CONFLICT(habit_id, data) DO UPDATE SET valor = excluded.valor",
        (habit_id, data, valor),
    )
    conn.commit()
    return habit_to_dict(row, valor)


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
