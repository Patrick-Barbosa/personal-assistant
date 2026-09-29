"""Copernico web backend — stdlib only (http.server + sqlite3 + urllib).

Beginner version: chat sessions + flat kanban board. No vault, no voice, no search.

Run:  python3 -m backend.server
Env:  BACKEND_PORT=8000, DB_PATH, DEEPSEEK_API_KEY (see .env.example)
"""
import json
import re
import uuid
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from . import agent, categories, config, db, habits, kanban, metrics


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def send_json(handler: BaseHTTPRequestHandler, status: int, obj) -> None:
    data = json.dumps(obj, ensure_ascii=False).encode()
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(data)))
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.end_headers()
    handler.wfile.write(data)


def read_json(handler: BaseHTTPRequestHandler) -> dict:
    length = int(handler.headers.get("Content-Length") or 0)
    raw = handler.rfile.read(length) if length else b""
    if not raw:
        return {}
    try:
        return json.loads(raw.decode())
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {}


def session_to_dict(r) -> dict:
    return {"id": r["id"], "title": r["titulo"], "created_at": r["created_at"], "updated_at": r["updated_at"]}


def message_to_dict(r) -> dict:
    return {"id": r["id"], "session_id": r["session_id"], "role": r["role"], "content": r["content"], "created_at": r["created_at"]}


def build_refs(conn, refs) -> str:
    """Expande menções @tarefa / #nota em contexto para o turno (não persiste)."""
    if not isinstance(refs, list):
        return ""
    parts = []
    for ref in refs[:8]:
        if not isinstance(ref, dict):
            continue
        kind, rid = ref.get("kind"), ref.get("id")
        if kind == "task":
            r = conn.execute("SELECT titulo, note_md, day_label, categoria FROM tasks WHERE id = ?", (rid,)).fetchone()
            if r:
                parts.append(f"[TAREFA {r['titulo']}]\n{(r['note_md'] or '(sem nota)')[:1500]}")
        elif kind == "daily":
            r = conn.execute("SELECT data, conteudo FROM daily_notes WHERE data = ?", (rid,)).fetchone()
            if r:
                parts.append(f"[NOTA {r['data']}]\n{(r['conteudo'] or '')[:1500]}")
    return "\n\n".join(parts)


def suggest_categories(conn) -> list[dict]:
    """Sugere categoria para notas sem categoria via IA. Não aplica — UI confirma."""
    from . import agent as _agent

    if not _agent._deepseek_key():
        raise RuntimeError("Configure DEEPSEEK_API_KEY no .env para organizar.")
    cats = categories.list_categories(conn)
    if not cats:
        return []
    rows = conn.execute(
        "SELECT id, titulo, substr(note_md, 1, 400) AS trecho FROM tasks "
        "WHERE note_md IS NOT NULL AND note_md != '' AND (categoria IS NULL OR categoria = '') "
        "ORDER BY updated_at DESC LIMIT 10"
    ).fetchall()
    if not rows:
        return []
    valid = ", ".join(f"{c['id']} ({c['nome']})" for c in cats)
    prompt = (
        f"Classifique cada nota em UMA categoria. Válidas: {valid}. "
        "Responda SÓ JSON: [{\"id\": \"...\", \"categoria\": \"...\"}].\n"
        + "\n".join(f"- {r['id']}: {r['titulo']} :: {r['trecho']}" for r in rows)
    )
    try:
        resp = _agent._chat_api([{"role": "user", "content": prompt}])
        text = resp["choices"][0]["message"].get("content", "").strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        import json as _json

        out = _json.loads(text)
    except Exception as e:
        raise RuntimeError(f"IA não retornou classificação válida: {e}")
    ids = {c["id"] for c in cats}
    known = {r["id"] for r in rows}
    return [{"id": s.get("id"), "categoria": s.get("categoria")}
            for s in out if isinstance(s, dict) and s.get("id") in known and s.get("categoria") in ids]


class Handler(BaseHTTPRequestHandler):
    server_version = "CopernicoWeb/0.2"

    def log_message(self, *args) -> None:
        pass

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self) -> None:
        url = urlparse(self.path)
        path = url.path
        conn = db.connect()
        try:
            if path == "/api/health":
                return send_json(self, 200, {"ok": True, "db": str(config.DB_PATH), "agent": bool(agent._deepseek_key())})
            if path == "/api/sessions":
                rows = conn.execute("SELECT * FROM sessions ORDER BY updated_at DESC").fetchall()
                return send_json(self, 200, [session_to_dict(r) for r in rows])
            m = re.fullmatch(r"/api/sessions/([^/]+)/messages", path)
            if m:
                rows = conn.execute("SELECT * FROM messages WHERE session_id = ? ORDER BY id", (m.group(1),)).fetchall()
                return send_json(self, 200, [message_to_dict(r) for r in rows])
            if path == "/api/board":
                return send_json(self, 200, kanban.list_board(conn))
            if path == "/api/habits":
                qs = parse_qs(url.query)
                return send_json(self, 200, habits.list_habits(conn, (qs.get("data") or [""])[0]))
            if path == "/api/hoje":
                qs = parse_qs(url.query)
                data = (qs.get("data") or [""])[0]
                habits.ensure_habit_tasks(conn, data)
                return send_json(self, 200, habits.get_hoje(conn, data))
            if path == "/api/categorias":
                return send_json(self, 200, categories.list_categories(conn))
            if path == "/api/metricas":
                qs = parse_qs(url.query)
                return send_json(self, 200, metrics.get_metricas(conn, (qs.get("data") or [""])[0]))
            if path == "/api/notas":
                trows = conn.execute(
                    "SELECT id, titulo, note_md, categoria, day_label, task_column, updated_at FROM tasks "
                    "WHERE note_md IS NOT NULL AND note_md != '' ORDER BY updated_at DESC"
                ).fetchall()
                drows = conn.execute("SELECT data, conteudo, updated_at FROM daily_notes ORDER BY data DESC LIMIT 60").fetchall()
                return send_json(self, 200, {
                    "tarefas": [
                        {"id": r["id"], "titulo": r["titulo"], "note_md": r["note_md"], "categoria": r["categoria"] or "",
                         "day_label": r["day_label"], "column": r["task_column"], "updated_at": r["updated_at"]}
                        for r in trows
                    ],
                    "diarias": [{"data": r["data"], "conteudo": r["conteudo"], "updated_at": r["updated_at"]} for r in drows],
                })
            return send_json(self, 404, {"error": f"GET desconhecido: {path}"})
        finally:
            conn.close()

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        conn = db.connect()
        try:
            if path == "/api/sessions":
                body = read_json(self)
                sid = f"s_{uuid.uuid4().hex[:12]}"
                title = (body.get("title") or "Nova Conversa").strip()
                now = now_iso()
                conn.execute("INSERT INTO sessions (id, titulo, created_at, updated_at) VALUES (?, ?, ?, ?)", (sid, title, now, now))
                conn.commit()
                return send_json(self, 201, {"id": sid, "title": title, "created_at": now, "updated_at": now})
            if path == "/api/chat":
                body = read_json(self)
                sid, content = body.get("session_id", ""), (body.get("content") or "").strip()
                if not sid or not content:
                    return send_json(self, 400, {"error": "session_id e content são obrigatórios"})
                refs = build_refs(conn, body.get("refs") or [])
                if not conn.execute("SELECT 1 FROM sessions WHERE id = ?", (sid,)).fetchone():
                    conn.execute("INSERT INTO sessions (id, titulo, created_at, updated_at) VALUES (?, ?, ?, ?)", (sid, agent.quick_title(content), now_iso(), now_iso()))
                conn.execute("INSERT INTO messages (session_id, role, content, created_at) VALUES (?, 'user', ?, ?)", (sid, content, now_iso()))
                conn.commit()
                try:
                    answer = agent.run_turn(sid, content, refs)
                except Exception as e:
                    answer = f"Erro no agente: {e}"
                conn.execute("INSERT INTO messages (session_id, role, content, created_at) VALUES (?, 'assistant', ?, ?)", (sid, answer, now_iso()))
                first = conn.execute("SELECT COUNT(*) AS c FROM messages WHERE session_id = ? AND role = 'user'", (sid,)).fetchone()["c"]
                new_title = None
                if first <= 1:
                    new_title = agent.quick_title(content)
                    conn.execute("UPDATE sessions SET titulo = ? WHERE id = ?", (new_title, sid))
                conn.execute("UPDATE sessions SET updated_at = ? WHERE id = ?", (now_iso(), sid))
                conn.commit()
                um = conn.execute("SELECT * FROM messages WHERE session_id = ? AND role = 'user' ORDER BY id DESC LIMIT 1", (sid,)).fetchone()
                am = conn.execute("SELECT * FROM messages WHERE session_id = ? AND role = 'assistant' ORDER BY id DESC LIMIT 1", (sid,)).fetchone()
                return send_json(self, 200, {"user_message": message_to_dict(um), "assistant_message": message_to_dict(am), "updated_session_title": new_title})
            if path == "/api/tasks":
                body = read_json(self)
                try:
                    t = kanban.create_task(conn, body.get("titulo", ""), body.get("column") or "todo")
                    return send_json(self, 201, t)
                except ValueError as e:
                    return send_json(self, 400, {"error": str(e)})
            m = re.fullmatch(r"/api/tasks/([^/]+)/move", path)
            if m:
                body = read_json(self)
                try:
                    return send_json(self, 200, kanban.move_task(conn, m.group(1), body.get("column", "todo"), int(body.get("index") or 0)))
                except (ValueError, LookupError) as e:
                    return send_json(self, 400, {"error": str(e)})
            m = re.fullmatch(r"/api/tasks/([^/]+)/place", path)
            if m:
                body = read_json(self)
                try:
                    return send_json(self, 200, kanban.place_task(conn, m.group(1), body.get("dest") or "backlog", int(body.get("index") or 0)))
                except (ValueError, LookupError) as e:
                    return send_json(self, 400, {"error": str(e)})
            if path == "/api/habits":
                body = read_json(self)
                try:
                    h = habits.create_habit(conn, body.get("nome", ""), body.get("tipo") or "binary", body.get("unidade") or "", body.get("meta") or 0, body.get("dias") or "")
                    return send_json(self, 201, h)
                except ValueError as e:
                    return send_json(self, 400, {"error": str(e)})
            if path == "/api/categorias":
                body = read_json(self)
                try:
                    return send_json(self, 201, categories.create_category(conn, body.get("nome", ""), body.get("cor") or "#141414"))
                except ValueError as e:
                    return send_json(self, 400, {"error": str(e)})
            m = re.fullmatch(r"/api/habits/([^/]+)/check", path)
            if m:
                body = read_json(self)
                try:
                    return send_json(self, 200, habits.set_check(conn, m.group(1), body.get("data") or "", body))
                except (ValueError, LookupError) as e:
                    return send_json(self, 400, {"error": str(e)})
            if path == "/api/hoje/nota":
                body = read_json(self)
                try:
                    return send_json(self, 200, habits.save_daily_note(conn, body.get("data") or "", body.get("conteudo") or ""))
                except ValueError as e:
                    return send_json(self, 400, {"error": str(e)})
            if path == "/api/metricas/resumo":
                body = read_json(self)
                m = metrics.get_metricas(conn, body.get("data") or "")
                return send_json(self, 200, {"resumo": metrics.summarize_week(m)})
            if path == "/api/notas/organizar":
                try:
                    return send_json(self, 200, {"sugestoes": suggest_categories(conn)})
                except RuntimeError as e:
                    return send_json(self, 400, {"error": str(e)})
            return send_json(self, 404, {"error": f"POST desconhecido: {path}"})
        finally:
            conn.close()

    def do_PATCH(self) -> None:
        path = urlparse(self.path).path
        body = read_json(self)
        conn = db.connect()
        try:
            m = re.fullmatch(r"/api/sessions/([^/]+)", path)
            if m:
                conn.execute("UPDATE sessions SET titulo = ?, updated_at = ? WHERE id = ?", (body.get("title") or "Conversa", now_iso(), m.group(1)))
                conn.commit()
                return send_json(self, 200, {"ok": True})
            m = re.fullmatch(r"/api/tasks/([^/]+)", path)
            if m:
                try:
                    return send_json(self, 200, kanban.update_task(conn, m.group(1), body))
                except (ValueError, LookupError) as e:
                    return send_json(self, 400, {"error": str(e)})
            m = re.fullmatch(r"/api/habits/([^/]+)", path)
            if m:
                try:
                    return send_json(self, 200, habits.update_habit(conn, m.group(1), body))
                except (ValueError, LookupError) as e:
                    return send_json(self, 400, {"error": str(e)})
            m = re.fullmatch(r"/api/categorias/([^/]+)", path)
            if m:
                try:
                    return send_json(self, 200, categories.update_category(conn, m.group(1), body))
                except (ValueError, LookupError) as e:
                    return send_json(self, 400, {"error": str(e)})
            return send_json(self, 404, {"error": f"PATCH desconhecido: {path}"})
        finally:
            conn.close()

    def do_DELETE(self) -> None:
        path = urlparse(self.path).path
        conn = db.connect()
        try:
            m = re.fullmatch(r"/api/sessions/([^/]+)", path)
            if m:
                conn.execute("DELETE FROM sessions WHERE id = ?", (m.group(1),))
                conn.commit()
                return send_json(self, 200, {"ok": True})
            m = re.fullmatch(r"/api/messages/([^/]+)", path)
            if m:
                conn.execute("DELETE FROM messages WHERE id = ?", (m.group(1),))
                conn.commit()
                return send_json(self, 200, {"ok": True})
            m = re.fullmatch(r"/api/tasks/([^/]+)", path)
            if m:
                try:
                    kanban.delete_task(conn, m.group(1))
                    return send_json(self, 200, {"ok": True})
                except LookupError as e:
                    return send_json(self, 404, {"error": str(e)})
            m = re.fullmatch(r"/api/habits/([^/]+)", path)
            if m:
                try:
                    habits.delete_habit(conn, m.group(1))
                    return send_json(self, 200, {"ok": True})
                except LookupError as e:
                    return send_json(self, 404, {"error": str(e)})
            m = re.fullmatch(r"/api/categorias/([^/]+)", path)
            if m:
                try:
                    categories.delete_category(conn, m.group(1))
                    return send_json(self, 200, {"ok": True})
                except LookupError as e:
                    return send_json(self, 404, {"error": str(e)})
            return send_json(self, 404, {"error": f"DELETE desconhecido: {path}"})
        finally:
            conn.close()


def main() -> None:
    db.init_db()
    port = config.BACKEND_PORT
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"[backend] Copernico web em http://127.0.0.1:{port} (db={config.DB_PATH})")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
