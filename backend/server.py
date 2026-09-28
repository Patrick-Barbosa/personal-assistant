"""Copernico web backend — stdlib only (http.server + sqlite3 + urllib).

Run:  python3 -m backend.server
Env:  BACKEND_PORT=8000, DB_PATH, VAULT_PATH, DEEPSEEK_API_KEY, GROQ_API_KEY (see .env.example)
"""
import asyncio
import json
import re
import uuid
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from . import agent, config, db, kanban, prompts, search, vault
from .voice import edge_tts_mp3, groq_transcribe

FRONT_ORIGINS = ("http://localhost:1420", "http://127.0.0.1:1420", "http://localhost:5173", "http://127.0.0.1:5173")


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def send_json(handler: BaseHTTPRequestHandler, status: int, obj, raw_bytes: tuple[bytes, str] | None = None) -> None:
    if raw_bytes:
        data, ctype = raw_bytes
        handler.send_response(status)
        handler.send_header("Content-Type", ctype)
        handler.send_header("Content-Length", str(len(data)))
        handler.send_header("Access-Control-Allow-Origin", "*")
        handler.end_headers()
        handler.wfile.write(data)
        return
    data = json.dumps(obj, ensure_ascii=False).encode()
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(data)))
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.end_headers()
    handler.wfile.write(data)


def read_body(handler: BaseHTTPRequestHandler) -> tuple[bytes, str]:
    length = int(handler.headers.get("Content-Length") or 0)
    return handler.rfile.read(length) if length else b"", handler.headers.get("Content-Type") or ""


def read_json(handler: BaseHTTPRequestHandler) -> dict:
    raw, _ = read_body(handler)
    if not raw:
        return {}
    try:
        return json.loads(raw.decode())
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {}


class Handler(BaseHTTPRequestHandler):
    server_version = "CopernicoWeb/0.1"

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
        path, qs = url.path, parse_qs(url.query)
        conn = db.connect()
        try:
            if path == "/api/health":
                return send_json(self, 200, {"ok": True, "db": str(config.DB_PATH), "agent": bool(config.DEEPSEEK_API_KEY)})
            if path == "/api/sessions":
                rows = conn.execute("SELECT * FROM sessions ORDER BY updated_at DESC").fetchall()
                return send_json(self, 200, [{"id": r["id"], "title": r["titulo"], "created_at": r["created_at"], "updated_at": r["updated_at"]} for r in rows])
            m = re.fullmatch(r"/api/sessions/([^/]+)/messages", path)
            if m:
                rows = conn.execute("SELECT * FROM messages WHERE session_id = ? ORDER BY id", (m.group(1),)).fetchall()
                return send_json(self, 200, [{"id": r["id"], "session_id": r["session_id"], "role": r["role"], "content": r["content"], "created_at": r["created_at"], "tokens": r["tokens"], "parent_id": r["parent_id"], "tool_calls": r["tool_calls"], "tool_call_id": r["tool_call_id"]} for r in rows])
            if path == "/api/notes/search":
                return send_json(self, 200, search.search(qs.get("q", [""])[0], int(qs.get("limit", ["8"])[0])))
            if path == "/api/notes/titles":
                return send_json(self, 200, search.list_titles())
            if path == "/api/graph":
                return send_json(self, 200, search.graph())
            if path == "/api/note":
                ident = qs.get("identifier", [""])[0]
                for root, vname in ((config.VAULT_PATH, "default"), (config.OBSIDIAN_VAULT_PATH, "obsidian")):
                    try:
                        p = vault.safe_resolve(root, ident)
                        fm, body, title = vault.read_note_file(p)
                        return send_json(self, 200, {"title": title, "titulo": title, "content": body, "corpo": body, "path": f"/{vname}/{p.relative_to(root)}", "frontmatter": fm, "vault": vname, "categoria": fm.get("categoria")})
                    except FileNotFoundError:
                        continue
                return send_json(self, 404, {"error": f"Nota não encontrada: {ident}"})
            if path == "/api/kanban":
                try:
                    return send_json(self, 200, kanban.get_board(conn, qs.get("semana", [None])[0]))
                except (ValueError, LookupError) as e:
                    return send_json(self, 400, {"error": str(e)})
            m = re.fullmatch(r"/api/kanban/tasks/([^/]+)/note", path)
            if m:
                row = conn.execute("SELECT note_path FROM kanban_tasks WHERE id = ?", (m.group(1),)).fetchone()
                if not row or not row["note_path"]:
                    return send_json(self, 200, {"content": None})
                try:
                    p = vault.safe_resolve(config.VAULT_PATH, row["note_path"])
                    _, body, _ = vault.read_note_file(p)
                    return send_json(self, 200, {"content": body})
                except FileNotFoundError:
                    return send_json(self, 200, {"content": None})
            if path == "/api/entities":
                q = "SELECT * FROM entities_index"
                clauses, params = [], []
                if qs.get("subtipo", [None])[0]:
                    clauses.append("subtipo = ?")
                    params.append(qs["subtipo"][0])
                if qs.get("query", [None])[0]:
                    clauses.append("titulo LIKE ?")
                    params.append(f"%{qs['query'][0]}%")
                if clauses:
                    q += " WHERE " + " AND ".join(clauses)
                q += " ORDER BY titulo LIMIT 200"
                return send_json(self, 200, [dict(r) for r in conn.execute(q, params).fetchall()])
            if path == "/api/habits":
                return send_json(self, 200, kanban.list_habits(conn))
            if path == "/api/insights":
                return send_json(self, 200, kanban.get_insights(conn, qs.get("periodo", ["semana"])[0]))
            if path == "/api/inbox":
                rows = conn.execute("SELECT * FROM inbox_items ORDER BY created_at DESC LIMIT 200").fetchall()
                return send_json(self, 200, [{**dict(r), "requires_decision": bool(r["requires_decision"])} for r in rows])
            if path == "/api/inbox/unread-count":
                n = conn.execute("SELECT COUNT(*) AS c FROM inbox_items WHERE status = 'unread'").fetchone()["c"]
                return send_json(self, 200, {"count": n})
            if path == "/api/prompts":
                out = {}
                for k in ("system_prompt", "voice_system_prompt", "custom_instructions", "tts_voice", "user_name", "date_format"):
                    r = conn.execute("SELECT value FROM settings WHERE key = ?", (k,)).fetchone()
                    out[k] = r["value"] if r else None
                out.setdefault("system_prompt", prompts.SYSTEM_PROMPT)
                out.setdefault("voice_system_prompt", prompts.VOICE_SYSTEM_PROMPT)
                return send_json(self, 200, out)
            if path == "/api/profile":
                prof = {"name": "", "communication_style": "direto_conciso", "hotkey": "Ctrl+Space", "onboarding_completed": False}
                for k in ("user_name", "communication_style", "hotkey", "onboarding_completed", "custom_instructions", "date_format"):
                    r = conn.execute("SELECT value FROM settings WHERE key = ?", (k,)).fetchone()
                    if r:
                        prof[k] = r["value"]
                prof["deepseek_api_key"] = "***" if config.DEEPSEEK_API_KEY else ""
                prof["groq_api_key"] = "***" if config.GROQ_API_KEY else ""
                for env_key, setting in (("deepseek_api_key", None), ("groq_api_key", None)):
                    r = conn.execute("SELECT value FROM settings WHERE key = ?", (env_key,)).fetchone()
                    if r and r["value"]:
                        prof[env_key] = r["value"]
                return send_json(self, 200, prof)
            if path == "/api/routines":
                return send_json(self, 200, [dict(r) for r in conn.execute("SELECT * FROM scheduled_routines ORDER BY created_at").fetchall()])
            if path == "/api/tts/voices":
                return send_json(self, 200, [
                    {"name": "pt-BR-ThalitaNeural", "short_name": "pt-BR-ThalitaNeural", "gender": "Female", "locale": "pt-BR", "friendly_name": "Thalita (Expressiva e Ágil)"},
                    {"name": "pt-BR-FranciscaNeural", "short_name": "pt-BR-FranciscaNeural", "gender": "Female", "locale": "pt-BR", "friendly_name": "Francisca (Acolhedora e Natural)"},
                    {"name": "pt-BR-AntonioNeural", "short_name": "pt-BR-AntonioNeural", "gender": "Male", "locale": "pt-BR", "friendly_name": "Antônio (Calmo e Confiante)"},
                ])
            return send_json(self, 404, {"error": f"GET desconhecido: {path}"})
        finally:
            conn.close()

    def do_POST(self) -> None:
        url = urlparse(self.path)
        path = url.path
        conn = db.connect()
        try:
            if path == "/api/sessions":
                body = read_json(self)
                sid = f"s_{uuid.uuid4().hex[:12]}"
                title = (body.get("title") or "Nova Conversa").strip()
                conn.execute("INSERT INTO sessions (id, titulo, created_at, updated_at) VALUES (?, ?, ?, ?)", (sid, title, now_iso(), now_iso()))
                conn.commit()
                return send_json(self, 201, {"id": sid, "title": title, "created_at": now_iso(), "updated_at": now_iso()})
            if path == "/api/chat":
                body = read_json(self)
                sid, content = body.get("session_id", ""), (body.get("content") or "").strip()
                origin = body.get("origin") or "text"
                if not sid or not content:
                    return send_json(self, 400, {"error": "session_id e content são obrigatórios"})
                if not conn.execute("SELECT 1 FROM sessions WHERE id = ?", (sid,)).fetchone():
                    conn.execute("INSERT INTO sessions (id, titulo, created_at, updated_at) VALUES (?, ?, ?, ?)", (sid, agent.quick_title(content), now_iso(), now_iso()))
                conn.execute("INSERT INTO messages (session_id, role, content, created_at) VALUES (?, 'user', ?, ?)", (sid, content, now_iso()))
                conn.commit()
                try:
                    answer = agent.run_turn(sid, content, origin)
                except Exception as e:
                    answer = f"Erro no agente: {e}"
                conn.execute("INSERT INTO messages (session_id, role, content, created_at) VALUES (?, 'assistant', ?, ?)", (sid, answer, now_iso()))
                first = conn.execute("SELECT COUNT(*) AS c FROM messages WHERE session_id = ? AND role = 'user'", (sid,)).fetchone()["c"]
                new_title = None
                if first <= 1:
                    new_title = agent.quick_title(content)
                    conn.execute("UPDATE sessions SET titulo = ?, updated_at = ? WHERE id = ?", (new_title, now_iso(), sid))
                conn.execute("UPDATE sessions SET updated_at = ? WHERE id = ?", (now_iso(), sid))
                conn.commit()
                um = conn.execute("SELECT * FROM messages WHERE session_id = ? AND role = 'user' ORDER BY id DESC LIMIT 1", (sid,)).fetchone()
                am = conn.execute("SELECT * FROM messages WHERE session_id = ? AND role = 'assistant' ORDER BY id DESC LIMIT 1", (sid,)).fetchone()
                to_msg = lambda r: {"id": r["id"], "session_id": r["session_id"], "role": r["role"], "content": r["content"], "created_at": r["created_at"]}
                return send_json(self, 200, {"user_message": to_msg(um), "assistant_message": to_msg(am), "updated_session_title": new_title})
            if path == "/api/stt":
                raw, ctype = read_body(self)
                if not raw:
                    return send_json(self, 400, {"error": "áudio vazio"})
                try:
                    return send_json(self, 200, {"text": groq_transcribe(raw, ctype.split(";")[0] or "audio/webm")})
                except Exception as e:
                    return send_json(self, 502, {"error": str(e)})
            if path == "/api/tts":
                body = read_json(self)
                text = (body.get("text") or "").strip()
                if not text:
                    return send_json(self, 400, {"error": "text vazio"})
                vrow = conn.execute("SELECT value FROM settings WHERE key = 'tts_voice'").fetchone()
                voice = body.get("voice") or (vrow["value"] if vrow else "pt-BR-ThalitaNeural")
                try:
                    mp3 = asyncio.run(edge_tts_mp3(text, voice))
                    return send_json(self, 200, None, raw_bytes=(mp3, "audio/mpeg"))
                except Exception as e:
                    return send_json(self, 502, {"error": str(e)})
            if path == "/api/kanban/tasks":
                body = read_json(self)
                try:
                    t = kanban.create_task(conn, body.get("titulo", ""), body.get("column") or "todo", body.get("dueDate"))
                    return send_json(self, 201, t)
                except ValueError as e:
                    return send_json(self, 400, {"error": str(e)})
            m = re.fullmatch(r"/api/kanban/tasks/([^/]+)/move", path)
            if m:
                body = read_json(self)
                try:
                    return send_json(self, 200, kanban.move_task(conn, m.group(1), body.get("column", "todo"), int(body.get("index") or 0)))
                except (ValueError, LookupError) as e:
                    return send_json(self, 400, {"error": str(e)})
            m = re.fullmatch(r"/api/kanban/tasks/([^/]+)/note", path)
            if m:
                body = read_json(self)
                tid = m.group(1)
                row = conn.execute("SELECT * FROM kanban_tasks WHERE id = ?", (tid,)).fetchone()
                if not row:
                    return send_json(self, 404, {"error": "tarefa não encontrada"})
                note_path = dict(row).get("note_path")
                if not note_path:
                    slug = vault.sanitize_filename(dict(row)["titulo"])
                    note_path = f"{slug}.md"
                    i = 1
                    while (config.VAULT_PATH / note_path).exists():
                        note_path = f"{slug}-{i}.md"
                        i += 1
                    wid = dict(row)["week_id"]
                    vault.atomic_write(config.VAULT_PATH / note_path, f"---\ntipo: tarefa\ntitulo: {dict(row)['titulo']}\nkanban_id: {tid}\nsemana: {wid}\n---\n\n# {dict(row)['titulo']}\n")
                    conn.execute("UPDATE kanban_tasks SET note_path = ?, updated_at = ? WHERE id = ?", (note_path, now_iso(), tid))
                    conn.commit()
                try:
                    p = vault.safe_resolve(config.VAULT_PATH, note_path)
                    _, cur, _ = vault.read_note_file(p)
                except FileNotFoundError:
                    cur = ""
                if body.get("content") is not None:
                    raw = (config.VAULT_PATH / note_path).read_text(encoding="utf-8", errors="replace") if (config.VAULT_PATH / note_path).exists() else ""
                    head = raw[: raw.find("\n---", 3) + 4] if raw.startswith("---") and "\n---" in raw[3:] else "---\ntipo: tarefa\n---\n"
                    vault.atomic_write(config.VAULT_PATH / note_path, head + "\n\n" + body["content"] + "\n")
                    return send_json(self, 200, {"path": note_path})
                return send_json(self, 200, {"path": note_path})
            m = re.fullmatch(r"/api/kanban/tasks/([^/]+)/link-note", path)
            if m:
                body = read_json(self)
                conn.execute("INSERT OR IGNORE INTO kanban_task_notes (task_id, note_path, created_at) VALUES (?, ?, ?)", (m.group(1), body.get("notePath", ""), now_iso()))
                conn.commit()
                return send_json(self, 200, kanban.task_links(conn, m.group(1)))
            m = re.fullmatch(r"/api/kanban/tasks/([^/]+)/link-entity", path)
            if m:
                body = read_json(self)
                conn.execute("INSERT OR IGNORE INTO kanban_task_entities (task_id, entity_id, created_at) VALUES (?, ?, ?)", (m.group(1), body.get("entityId", ""), now_iso()))
                conn.commit()
                return send_json(self, 200, kanban.task_links(conn, m.group(1)))
            if path == "/api/entities":
                body = read_json(self)
                titulo = (body.get("titulo") or "").strip()
                if not titulo:
                    return send_json(self, 400, {"error": "titulo vazio"})
                eid = f"e_{uuid.uuid4().hex[:12]}"
                note_path = f"{vault.sanitize_filename(titulo)}.md"
                vault.atomic_write(config.VAULT_PATH / note_path, f"---\ntipo: entidade\nsubtipo: {body.get('subtipo') or 'livre'}\nid: {eid}\ntitulo: {titulo}\n---\n\n# {titulo}\n")
                conn.execute("INSERT INTO entities_index (id, subtipo, titulo, note_path, created_at) VALUES (?, ?, ?, ?, ?)", (eid, body.get("subtipo") or "livre", titulo, note_path, now_iso()))
                conn.commit()
                return send_json(self, 201, {"id": eid, "subtipo": body.get("subtipo") or "livre", "titulo": titulo, "note_path": note_path, "created_at": now_iso()})
            if path == "/api/habits":
                body = read_json(self)
                try:
                    return send_json(self, 201, kanban.create_habit(conn, body.get("titulo", ""), body.get("cronExpr") or body.get("cron_expr", ""), body.get("cor")))
                except ValueError as e:
                    return send_json(self, 400, {"error": str(e)})
            if path == "/api/habits/sync":
                return send_json(self, 200, {"created": kanban.sync_habit_tasks_today(conn)})
            m = re.fullmatch(r"/api/habits/([^/]+)/active", path)
            if m:
                body = read_json(self)
                try:
                    return send_json(self, 200, kanban.set_habit_active(conn, m.group(1), bool(body.get("ativo"))))
                except LookupError as e:
                    return send_json(self, 404, {"error": str(e)})
            if path == "/api/inbox/accept":
                body = read_json(self)
                iid = body.get("id", "")
                row = conn.execute("SELECT * FROM inbox_items WHERE id = ?", (iid,)).fetchone()
                if not row:
                    return send_json(self, 404, {"error": "item não encontrado"})
                item = dict(row)
                content = item.get("content") or ""
                mm = re.search(r"task_id=([^\s>]+)\s+week_id=([^\s>]+)", content)
                if item.get("item_type") == "kanban_rollover" and mm:
                    tid, _wid = mm.group(1), mm.group(2)
                    trow = conn.execute("SELECT * FROM kanban_tasks WHERE id = ?", (tid,)).fetchone()
                    if trow:
                        week = kanban.get_or_create_open_week(conn)
                        nt = kanban.create_task(conn, dict(trow)["titulo"], dict(trow)["task_column"])
                        conn.execute("UPDATE kanban_tasks SET status = 'carried', carried_to = ? WHERE id = ?", (nt["id"], tid))
                        conn.execute("UPDATE inbox_items SET status = 'applied', decision_reason = ?, updated_at = ? WHERE id = ?", (body.get("reason"), now_iso(), iid))
                        conn.commit()
                        return send_json(self, 200, {"carried_to": nt["id"]})
                conn.execute("UPDATE inbox_items SET status = 'applied', decision_reason = ?, updated_at = ? WHERE id = ?", (body.get("reason"), now_iso(), iid))
                conn.commit()
                return send_json(self, 200, {"ok": True})
            if path == "/api/inbox/mark":
                body = read_json(self)
                conn.execute("UPDATE inbox_items SET status = ?, decision_reason = COALESCE(?, decision_reason), updated_at = ? WHERE id = ?", (body.get("status", "read"), body.get("reason"), now_iso(), body.get("id", "")))
                conn.commit()
                return send_json(self, 200, {"ok": True})
            if path == "/api/inbox/prune":
                cur = conn.execute("DELETE FROM inbox_items WHERE status = 'dismissed'").rowcount or 0
                conn.commit()
                return send_json(self, 200, {"pruned": cur})
            m = re.fullmatch(r"/api/sessions/([^/]+)/consolidate", path)
            if m:
                sid = m.group(1)
                n = conn.execute("SELECT COUNT(*) AS c FROM messages WHERE session_id = ?", (sid,)).fetchone()["c"]
                iid = f"i_{uuid.uuid4().hex[:12]}"
                conn.execute(
                    "INSERT INTO inbox_items (id, session_id, title, summary, content, item_type, status, requires_decision, created_at)"
                    " VALUES (?, ?, ?, ?, ?, 'voice_consolidation', 'unread', 0, ?)",
                    (iid, sid, "Consolidação de sessão", None, f"Sessão {sid} com {n} mensagens consolidada em {now_iso()}.", now_iso()),
                )
                conn.commit()
                return send_json(self, 200, {"inbox_id": iid})
            if path == "/api/notes":
                body = read_json(self)
                titulo = (body.get("titulo") or "").strip() or "Sem título"
                dest = config.VAULT_PATH / (vault.sanitize_filename(titulo) + ".md")
                vault.atomic_write(dest, f"---\ntitulo: {titulo}\n---\n\n{body.get('conteudo') or body.get('content') or ''}\n")
                return send_json(self, 201, {"path": dest.name})
            if path == "/api/notes/rename":
                body = read_json(self)
                try:
                    p = vault.safe_resolve(config.VAULT_PATH, body.get("identifier", ""))
                except FileNotFoundError as e:
                    return send_json(self, 404, {"error": str(e)})
                new_name = vault.sanitize_filename(body.get("novoTitulo", "")) + ".md"
                dest = p.parent / new_name
                p.rename(dest)
                return send_json(self, 200, {"path": new_name})
            if path == "/api/notes/archive-delete":
                body = read_json(self)
                try:
                    p = vault.safe_resolve(config.VAULT_PATH, body.get("identifier", ""))
                except FileNotFoundError as e:
                    return send_json(self, 404, {"error": str(e)})
                arc = config.VAULT_PATH / "Archive"
                arc.mkdir(parents=True, exist_ok=True)
                p.rename(arc / p.name)
                return send_json(self, 200, {"archived": p.name})
            if path == "/api/notes/consolidate":
                body = read_json(self)
                titulo = (body.get("notaPadrao") or "Consolidação").strip()
                dest = config.VAULT_PATH / (vault.sanitize_filename(titulo) + ".md")
                vault.atomic_write(dest, f"---\ntitulo: {titulo}\n---\n\n{body.get('corpoFinal') or ''}\n")
                return send_json(self, 200, {"path": dest.name})
            if path == "/api/routines":
                body = read_json(self)
                r = {
                    "id": body.get("id") or f"r_{uuid.uuid4().hex[:12]}",
                    "titulo": body.get("titulo", ""),
                    "cron_expr": body.get("cron_expr", ""),
                    "prompt": body.get("prompt", ""),
                    "skill_id": body.get("skill_id"),
                    "ativo": 1 if body.get("ativo", True) else 0,
                    "ultima_execucao": body.get("ultima_execucao"),
                    "created_at": now_iso(),
                }
                conn.execute(
                    "INSERT INTO scheduled_routines (id, titulo, cron_expr, prompt, skill_id, ativo, ultima_execucao, created_at)"
                    " VALUES (:id, :titulo, :cron_expr, :prompt, :skill_id, :ativo, :ultima_execucao, :created_at)"
                    " ON CONFLICT(id) DO UPDATE SET titulo = excluded.titulo, cron_expr = excluded.cron_expr,"
                    " prompt = excluded.prompt, skill_id = excluded.skill_id, ativo = excluded.ativo",
                    r,
                )
                conn.commit()
                return send_json(self, 200, {"ok": True, "id": r["id"]})
            if path == "/api/chat/time-travel":
                body = read_json(self)
                sid = body.get("session_id", "")
                try:
                    mid = int(body.get("message_id", 0))
                except (TypeError, ValueError):
                    return send_json(self, 400, {"error": "message_id inválido"})
                conn.execute("DELETE FROM messages WHERE session_id = ? AND id > ?", (sid, mid))
                conn.execute("DELETE FROM messages WHERE session_id = ? AND id = ? AND role != 'user'", (sid, mid))
                conn.commit()
                urow = conn.execute("SELECT * FROM messages WHERE session_id = ? AND id = ?", (sid, mid)).fetchone()
                content = (body.get("newContent") or (dict(urow)["content"] if urow else "")).strip()
                if not content:
                    return send_json(self, 400, {"error": "conteúdo vazio"})
                try:
                    answer = agent.run_turn(sid, content, body.get("origin") or "text")
                except Exception as e:
                    answer = f"Erro no agente: {e}"
                conn.execute("INSERT INTO messages (session_id, role, content, created_at) VALUES (?, 'assistant', ?, ?)", (sid, answer, now_iso()))
                conn.commit()
                return send_json(self, 200, {"assistant": answer})
            return send_json(self, 404, {"error": f"POST desconhecido: {path}"})
        finally:
            conn.close()

    def do_PATCH(self) -> None:
        url = urlparse(self.path)
        path = url.path
        body = read_json(self)
        conn = db.connect()
        try:
            m = re.fullmatch(r"/api/sessions/([^/]+)", path)
            if m:
                conn.execute("UPDATE sessions SET titulo = ?, updated_at = ? WHERE id = ?", (body.get("title") or body.get("titulo") or "Conversa", now_iso(), m.group(1)))
                conn.commit()
                return send_json(self, 200, {"ok": True})
            m = re.fullmatch(r"/api/kanban/tasks/([^/]+)", path)
            if m:
                try:
                    return send_json(self, 200, kanban.update_task(conn, m.group(1), body.get("titulo", ""), body.get("dueDate")))
                except (ValueError, LookupError) as e:
                    return send_json(self, 400, {"error": str(e)})
            m = re.fullmatch(r"/api/habits/([^/]+)", path)
            if m:
                conn.execute("UPDATE habits SET titulo = ?, cron_expr = ?, cor = COALESCE(?, cor), updated_at = ? WHERE id = ?", (body.get("titulo"), body.get("cronExpr") or body.get("cron_expr"), body.get("cor"), now_iso(), m.group(1)))
                conn.commit()
                row = conn.execute("SELECT * FROM habits WHERE id = ?", (m.group(1),)).fetchone()
                return send_json(self, 200, dict(row) if row else {})
            m = re.fullmatch(r"/api/routines/([^/]+)", path)
            if m:
                if body.get("titulo") is not None:
                    conn.execute("UPDATE scheduled_routines SET titulo = ?, cron_expr = ?, prompt = ?, skill_id = ?, ativo = ? WHERE id = ?", (body.get("titulo"), body.get("cron_expr"), body.get("prompt"), body.get("skill_id"), 1 if body.get("ativo", True) else 0, m.group(1)))
                else:
                    conn.execute("UPDATE scheduled_routines SET ativo = ? WHERE id = ?", (1 if body.get("ativo", True) else 0, m.group(1)))
                conn.commit()
                return send_json(self, 200, {"ok": True})
            if path == "/api/prompts":
                for k in ("system_prompt", "voice_system_prompt", "custom_instructions", "tts_voice"):
                    if body.get(k) is not None:
                        conn.execute("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", (k, body[k]))
                conn.commit()
                return send_json(self, 200, {"ok": True})
            if path == "/api/profile":
                mapping = {"name": "user_name", "communication_style": "communication_style", "hotkey": "hotkey", "custom_instructions": "custom_instructions", "date_format": "date_format", "deepseek_api_key": "deepseek_api_key", "groq_api_key": "groq_api_key"}
                for src, dst in mapping.items():
                    if body.get(src) is not None:
                        conn.execute("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", (dst, str(body[src])))
                conn.commit()
                return send_json(self, 200, {"ok": True})
            return send_json(self, 404, {"error": f"PATCH desconhecido: {path}"})
        finally:
            conn.close()

    def do_DELETE(self) -> None:
        url = urlparse(self.path)
        path = url.path
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
            m = re.fullmatch(r"/api/kanban/tasks/([^/]+)", path)
            if m:
                try:
                    kanban.delete_task(conn, m.group(1))
                    return send_json(self, 200, {"ok": True})
                except ValueError as e:
                    return send_json(self, 400, {"error": str(e)})
            m = re.fullmatch(r"/api/kanban/tasks/([^/]+)/link-note", path)
            if m:
                qs = parse_qs(urlparse(self.path).query)
                conn.execute("DELETE FROM kanban_task_notes WHERE task_id = ? AND note_path = ?", (m.group(1), qs.get("notePath", [""])[0]))
                conn.commit()
                return send_json(self, 200, kanban.task_links(conn, m.group(1)))
            m = re.fullmatch(r"/api/kanban/tasks/([^/]+)/link-entity", path)
            if m:
                qs = parse_qs(urlparse(self.path).query)
                conn.execute("DELETE FROM kanban_task_entities WHERE task_id = ? AND entity_id = ?", (m.group(1), qs.get("entityId", [""])[0]))
                conn.commit()
                return send_json(self, 200, kanban.task_links(conn, m.group(1)))
            m = re.fullmatch(r"/api/habits/([^/]+)", path)
            if m:
                return send_json(self, 200, {"deleted": kanban.delete_habit(conn, m.group(1))})
            m = re.fullmatch(r"/api/inbox/([^/]+)", path)
            if m:
                conn.execute("DELETE FROM inbox_items WHERE id = ?", (m.group(1),))
                conn.commit()
                return send_json(self, 200, {"ok": True})
            m = re.fullmatch(r"/api/routines/([^/]+)", path)
            if m:
                conn.execute("DELETE FROM scheduled_routines WHERE id = ?", (m.group(1),))
                conn.commit()
                return send_json(self, 200, {"ok": True})
            return send_json(self, 404, {"error": f"DELETE desconhecido: {path}"})
        finally:
            conn.close()


def main() -> None:
    db.init_db()
    config.VAULT_PATH.mkdir(parents=True, exist_ok=True)
    port = config.BACKEND_PORT
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"[backend] Copernico web em http://127.0.0.1:{port} (db={config.DB_PATH})")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
