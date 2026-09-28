"""Smoke test: boots the server on a temp port + temp DB/vaults, exercises all routes.

Run:  python3 backend/smoke_test.py
Stdlib only. Never touches the real cofres/cache.db.
"""
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PORT = "8479"


def req(method: str, path: str, body=None, raw: bytes | None = None, ctype="application/json"):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    r = urllib.request.Request(
        f"http://127.0.0.1:{PORT}{path}", data=data,
        headers={"Content-Type": ctype} if data else {}, method=method,
    )
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            payload = resp.read()
            if "application/json" in (resp.headers.get("Content-Type") or ""):
                return resp.status, json.loads(payload.decode())
            return resp.status, payload
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def main() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="copernico-smoke-"))
    env = dict(os.environ, BACKEND_PORT=PORT, DB_PATH=str(tmp / "cache.db"),
               VAULT_PATH=str(tmp / "default"), OBSIDIAN_VAULT_PATH=str(tmp / "obsidian"))
    (tmp / "obsidian").mkdir(parents=True)
    (tmp / "obsidian" / "Guia.md").write_text("---\ntitulo: Guia\n---\n\n# Guia\nConteúdo [[outro]]\n", encoding="utf-8")
    proc = subprocess.Popen([sys.executable, "-m", "backend.server"], cwd=ROOT, env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    failures: list[str] = []
    def check(name: str, cond: bool, detail=""):
        print(("PASS " if cond else "FAIL ") + name, detail)
        if not cond:
            failures.append(name)
    try:
        for _ in range(50):
            try:
                s, b = req("GET", "/api/health")
                if s == 200:
                    break
            except OSError:
                time.sleep(0.2)
        check("health", s == 200 and b["ok"] is True)
        s, sess = req("POST", "/api/sessions", {"title": "Smoke"})
        check("create-session", s == 201 and sess["id"].startswith("s_"), str(sess)[:80])
        sid = sess["id"]
        s, chat = req("POST", "/api/chat", {"session_id": sid, "content": "olá", "origin": "text"})
        check("chat", s == 200 and len(chat["assistant_message"]["content"]) > 0, str(chat)[:100])
        s, msgs = req("GET", f"/api/sessions/{sid}/messages")
        check("messages", s == 200 and len(msgs) == 2, f"n={len(msgs) if s == 200 else '?'}")
        s, tt = req("POST", "/api/chat/time-travel", {"session_id": sid, "message_id": msgs[0]["id"], "newContent": "olá de novo"})
        check("time-travel", s == 200 and "assistant" in tt)
        s, hits = req("GET", "/api/notes/search?q=guia&limit=5")
        check("search", s == 200 and any(h["vault"] == "obsidian" for h in hits), str(hits)[:120])
        s, note = req("GET", "/api/note?identifier=Guia")
        check("read-note", s == 200 and note["title"] == "Guia")
        s, created = req("POST", "/api/notes", {"titulo": "Smoke Nota", "conteudo": "corpo"})
        check("create-note", s == 201, str(created))
        s, board = req("GET", "/api/kanban")
        check("kanban-open", s == 200 and board["week"]["status"] == "open", board["week"]["id"])
        s, task = req("POST", "/api/kanban/tasks", {"titulo": "Smoke Task"})
        check("create-task", s == 201, task["id"])
        tid = task["id"]
        s, moved = req("POST", f"/api/kanban/tasks/{tid}/move", {"column": "doing", "index": 0})
        check("move-task", s == 200 and moved["task_column"] == "doing")
        s, with_note = req("POST", f"/api/kanban/tasks/{tid}/note", {})
        check("task-note-create", s == 200 and with_note["path"], str(with_note))
        s, content = req("GET", f"/api/kanban/tasks/{tid}/note")
        check("task-note-read", s == 200 and content["content"] is not None)
        s, ent = req("POST", "/api/entities", {"titulo": "Smoke Entity", "subtipo": "projeto"})
        check("create-entity", s == 201, str(ent)[:100])
        s, links = req("POST", f"/api/kanban/tasks/{tid}/link-entity", {"entityId": ent["id"]})
        check("link-entity", s == 200 and ent["id"] in [e["id"] for e in links["entities"]])
        s, links = req("DELETE", f"/api/kanban/tasks/{tid}/link-entity?entityId={ent['id']}")
        check("unlink-entity", s == 200 and not links["entities"])
        s, hab = req("POST", "/api/habits", {"titulo": "Smoke Habit", "cronExpr": "0 6 * * *", "cor": "#ff0000"})
        check("create-habit", s == 201, str(hab)[:100])
        hid = hab["id"]
        s, sync = req("POST", "/api/habits/sync")
        check("habit-sync", s == 200 and sync["created"] >= 1, str(sync))
        s, ins = req("GET", "/api/insights?periodo=semana")
        check("insights", s == 200 and ins["habitos_hoje_total"] >= 1, f"hoje={ins.get('habitos_hoje_total')}")
        s, marked = req("POST", "/api/inbox/mark", {"id": "x", "status": "read"})
        check("inbox-mark", s == 200)
        s, cnt = req("GET", "/api/inbox/unread-count")
        check("inbox-count", s == 200 and cnt["count"] == 0, str(cnt))
        s, prof = req("GET", "/api/profile")
        check("profile", s == 200 and "communication_style" in prof)
        s, prm = req("GET", "/api/prompts")
        check("prompts", s == 200 and "system_prompt" in prm)
        s, rou = req("GET", "/api/routines")
        check("routines", s == 200 and isinstance(rou, list))
        s, saved = req("POST", "/api/routines", {"titulo": "R", "cron_expr": "0 8 * * *", "prompt": "oi"})
        check("save-routine", s == 200, str(saved))
        s, _ = req("DELETE", f"/api/routines/{saved['id']}")
        check("delete-routine", s == 200)
        s, stt = req("POST", "/api/stt", raw=b"fake", ctype="audio/webm")
        check("stt-no-key-502", s == 502, str(stt)[:80])
        s, tts = req("POST", "/api/tts", {"text": "oi"})
        check("tts", (s == 200 and len(tts) > 1000) or (s == 502 and "error" in tts), f"status={s}")
        s, _ = req("DELETE", f"/api/habits/{hid}")
        check("delete-habit", s == 200)
        s, _ = req("DELETE", f"/api/kanban/tasks/{tid}")
        check("delete-task", s == 200)
        s, _ = req("DELETE", f"/api/sessions/{sid}")
        check("delete-session", s == 200)
    finally:
        proc.terminate()
    print(f"\n{len(failures)} falhas: {failures}" if failures else "\nSMOKE OK — tudo verde")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
