"""User categories (id, nome, cor). Seeded with 5 Flim presets in db._seed_categories."""
import re
import uuid
from datetime import datetime

HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


def _cols(conn) -> set[str]:
    return {r["name"] for r in conn.execute("PRAGMA table_info(categories)").fetchall()}


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def to_dict(row) -> dict:
    return {"id": row["id"], "nome": row["nome"], "cor": row["cor"]}


def list_categories(conn) -> list[dict]:
    return [to_dict(r) for r in conn.execute("SELECT * FROM categories ORDER BY nome").fetchall()]


def create_category(conn, nome: str, cor: str = "#141414") -> dict:
    nome = (nome or "").strip()
    if not nome:
        raise ValueError("nome vazio")
    if len(nome) > 30:
        raise ValueError("nome muito longo (máx 30)")
    cor = (cor or "#141414").strip()
    if not HEX_RE.match(cor):
        raise ValueError(f"cor inválida: {cor}. Use #rrggbb.")
    cid = f"c_{uuid.uuid4().hex[:8]}"
    cols = _cols(conn)
    now = _now()
    if "created_at" in cols and "updated_at" in cols:
        conn.execute(
            "INSERT INTO categories (id, nome, cor, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            (cid, nome, cor, now, now),
        )
    elif "created_at" in cols:
        conn.execute(
            "INSERT INTO categories (id, nome, cor, created_at) VALUES (?, ?, ?, ?)",
            (cid, nome, cor, now),
        )
    elif "updated_at" in cols:
        conn.execute(
            "INSERT INTO categories (id, nome, cor, updated_at) VALUES (?, ?, ?, ?)",
            (cid, nome, cor, now),
        )
    else:
        conn.execute("INSERT INTO categories (id, nome, cor) VALUES (?, ?, ?)", (cid, nome, cor))
    conn.commit()
    return to_dict(conn.execute("SELECT * FROM categories WHERE id = ?", (cid,)).fetchone())


def update_category(conn, cid: str, patch: dict) -> dict:
    row = conn.execute("SELECT * FROM categories WHERE id = ?", (cid,)).fetchone()
    if not row:
        raise LookupError(f"categoria não encontrada: {cid}")
    updates: dict = {}
    if "nome" in patch:
        nome = (patch.get("nome") or "").strip()
        if not nome:
            raise ValueError("nome vazio")
        updates["nome"] = nome[:30]
    if "cor" in patch:
        cor = (patch.get("cor") or "").strip()
        if not HEX_RE.match(cor):
            raise ValueError(f"cor inválida: {cor}")
        updates["cor"] = cor
    if updates:
        sets = ", ".join(f"{k} = ?" for k in updates)
        conn.execute(f"UPDATE categories SET {sets} WHERE id = ?", (*updates.values(), cid))
        conn.commit()
    return to_dict(conn.execute("SELECT * FROM categories WHERE id = ?", (cid,)).fetchone())


def delete_category(conn, cid: str) -> None:
    cur = conn.execute("DELETE FROM categories WHERE id = ?", (cid,))
    if cur.rowcount == 0:
        raise LookupError(f"categoria não encontrada: {cid}")
    conn.execute("UPDATE tasks SET categoria = '' WHERE categoria = ?", (cid,))
    conn.commit()
