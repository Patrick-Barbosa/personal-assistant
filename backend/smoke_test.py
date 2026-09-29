"""Smoke test: boots the server on a temp port + temp DB, exercises chat + board.

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


def req(method: str, path: str, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(
        f"http://127.0.0.1:{PORT}{path}", data=data,
        headers={"Content-Type": "application/json"} if data else {}, method=method,
    )
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def main() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="copernico-smoke-"))
    env = dict(os.environ, BACKEND_PORT=PORT, DB_PATH=str(tmp / "cache.db"))
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
        s, chat = req("POST", "/api/chat", {"session_id": sid, "content": "olá"})
        check("chat", s == 200 and len(chat["assistant_message"]["content"]) > 0, str(chat)[:100])
        s, msgs = req("GET", f"/api/sessions/{sid}/messages")
        check("messages", s == 200 and len(msgs) == 2, f"n={len(msgs) if s == 200 else '?'}")
        s, board = req("GET", "/api/board")
        check("board", s == 200 and set(board) == {"todo", "doing", "done"}, str(board)[:80])
        s, task = req("POST", "/api/tasks", {"titulo": "Smoke Task"})
        check("create-task", s == 201 and task["column"] == "todo", task["id"])
        tid = task["id"]
        s, moved = req("POST", f"/api/tasks/{tid}/move", {"column": "doing", "index": 0})
        check("move-task", s == 200 and moved["column"] == "doing")
        s, placed = req("POST", f"/api/tasks/{tid}/place", {"dest": "Seg", "index": 0})
        check("place-task", s == 200 and placed["column"] == "doing" and placed["day_label"] == "Seg", str(placed)[:100])
        s, updated = req("PATCH", f"/api/tasks/{tid}", {"titulo": "Smoke Task 2"})
        check("update-task", s == 200 and updated["titulo"] == "Smoke Task 2")
        s, noted = req("PATCH", f"/api/tasks/{tid}", {"note_md": "# Smoke nota"})
        check("note-save", s == 200 and noted["note_md"] == "# Smoke nota")
        s, notas = req("GET", "/api/notas")
        check("notas", s == 200 and len(notas["tarefas"]) == 1, f"tarefas={len(notas['tarefas']) if s == 200 else '?'}")
        s, hab = req("POST", "/api/habits", {"nome": "Ler", "tipo": "numeric", "unidade": "min", "meta": 20})
        check("create-habit", s == 201 and hab["meta"] == 20, str(hab)[:100])
        hid = hab["id"]
        s, chk = req("POST", f"/api/habits/{hid}/check", {"valor": 20})
        check("check-habit", s == 200 and chk["valor"] == 20)
        s, hoje = req("GET", "/api/hoje")
        check("hoje", s == 200 and len(hoje["habits"]) == 1, f"habits={len(hoje['habits']) if s == 200 else '?'}")
        s, met = req("GET", "/api/metricas")
        check("metricas", s == 200 and len(met["habitos"]) == 1, str(met["geral"])[:80])
        s, _ = req("DELETE", f"/api/tasks/{tid}")
        check("delete-task", s == 200)
        s, _ = req("DELETE", f"/api/sessions/{sid}")
        check("delete-session", s == 200)
    finally:
        proc.terminate()
    print(f"\n{len(failures)} falhas: {failures}" if failures else "\nSMOKE OK — tudo verde")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
