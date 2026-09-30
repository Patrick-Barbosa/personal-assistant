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
    tmp = Path(tempfile.mkdtemp(prefix="tiba-smoke-"))
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
        s, hsync = req("POST", "/api/habits", {"nome": "Sync", "tipo": "binary", "dias": ""})
        check("sync-habit", s == 201, hsync["id"])
        s, _ = req("GET", "/api/hoje")
        check("sync-ensure", s == 200)
        s, _ = req("POST", f"/api/habits/{hsync['id']}/check", {"feito": 1})
        s, board = req("GET", "/api/board")
        linked = [t for t in board["done"] if t.get("habit_id") == hsync["id"]]
        check("sync habit->task", s == 200 and len(linked) == 1, f"done={len(linked) if s == 200 else '?'}")
        s, back = req("POST", f"/api/tasks/{linked[0]['id']}/place", {"dest": linked[0]["day_label"] or "backlog", "index": 0})
        check("sync task->habit", s == 200)
        s, hoje = req("GET", "/api/hoje")
        feito = [h["feito"] for h in hoje["habits"] if h["id"] == hsync["id"]]
        check("sync feito-off", s == 200 and feito == [0], str(feito))
        s, _ = req("DELETE", f"/api/habits/{hsync['id']}")
        check("sync-cleanup", s == 200)
        s, cats = req("GET", "/api/categorias")
        check("categorias", s == 200 and len(cats) >= 5, f"n={len(cats) if s == 200 else '?'}")
        s, cat = req("POST", "/api/categorias", {"nome": "SmokeCat", "cor": "#8a8a8a"})
        check("create-categoria", s == 201, str(cat)[:60])
        s, _ = req("DELETE", f"/api/categorias/{cat['id']}")
        check("delete-categoria", s == 200)
        s, hn = req("POST", "/api/habits", {"nome": "Meta", "tipo": "numeric", "unidade": "min", "meta": 30})
        s, chkn = req("POST", f"/api/habits/{hn['id']}/check", {"feito": 1})
        check("check-fills-meta", s == 200 and chkn["valor"] == 30 and chkn["feito"] == 1, str(chkn)[:80])
        s, chkn = req("POST", f"/api/habits/{hn['id']}/check", {"feito": 0})
        check("uncheck-zeroes", s == 200 and chkn["valor"] == 0 and chkn["feito"] == 0, str(chkn)[:80])
        s, hs = req("POST", "/api/habits", {"nome": "Shield", "tipo": "binary", "dias": ""})
        import datetime as _dt
        _today = _dt.date.today()
        _gain = None
        for _n in (2, 1, 0):
            _d = (_today - _dt.timedelta(days=_n)).isoformat()
            s, _chk = req("POST", f"/api/habits/{hs['id']}/check", {"data": _d, "feito": 1})
            _gain = _chk.get("escudo_ganho")
        check("shield-grant", _gain is True, f"ganho={_gain}")
        s, met2 = req("GET", "/api/metricas")
        _mine = [x for x in met2["habitos"] if x["id"] == hs["id"]][0]
        check("shield-streak", s == 200 and _mine["streak"] == 3 and met2["escudos"] == 1, str((_mine["streak"], met2["escudos"])))
        s, _ = req("DELETE", f"/api/habits/{hs['id']}")
        check("shield-cleanup", s == 200)
        s, _ = req("DELETE", f"/api/habits/{hn['id']}")
        check("check-fills-meta-cleanup", s == 200)
        s, hc = req("POST", "/api/habits", {"nome": "CatHab", "tipo": "binary", "dias": ""})
        check("create-habit-fixed", s == 201 and "categoria" not in hc, str(hc)[:80])
        s, _ = req("GET", "/api/hoje")
        check("hoje-ensure", s == 200)
        s, board = req("GET", "/api/board")
        linked = [t for t in board["doing"] if t.get("habit_id") == hc["id"]]
        check("habit-task-cat", s == 200 and len(linked) >= 1 and all(t.get("categoria") == "habitos" for t in linked), f"n={len(linked) if s == 200 else '?'}")
        s, cats = req("GET", "/api/categorias")
        check("habitos-seeded", s == 200 and any(c["id"] == "habitos" for c in cats), f"n={len(cats) if s == 200 else '?'}")
        s, _ = req("DELETE", "/api/categorias/habitos")
        check("habitos-delete", s == 200)
        s, _ = req("GET", "/api/hoje")
        s, cats = req("GET", "/api/categorias")
        check("habitos-reseed", s == 200 and any(c["id"] == "habitos" for c in cats))
        for t in linked:
            req("DELETE", f"/api/tasks/{t['id']}")
        s, _ = req("DELETE", f"/api/habits/{hc['id']}")
        check("habit-cat-cleanup", s == 200)
        import datetime as _dt2
        _labels = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sab", "Dom"]
        _today2 = _dt2.date.today()
        _tl = _labels[_today2.weekday()]
        _tom = _labels[(_today2.weekday() + 1) % 7]
        s, hs2 = req("POST", "/api/habits", {"nome": "Sched2", "tipo": "binary", "dias": f"{_tl},{_tom}"})
        check("sched-create", s == 201, str(hs2.get("dias")))
        s, _ = req("POST", f"/api/habits/{hs2['id']}/check", {"feito": 1})
        s, met3 = req("GET", "/api/metricas")
        _mine = [x for x in met3["habitos"] if x["id"] == hs2["id"]][0]
        _exp_planned = 1 if _today2.weekday() == 6 else 2
        check("sched-pct", s == 200 and _mine["planned_days"] == _exp_planned and _mine["done_days"] == 1
              and _mine["pct"] == round(100 / _exp_planned), str((_mine["planned_days"], _mine["pct"])))
        check("sched-streak", s == 200 and _mine["streak"] == 1, str(_mine["streak"]))
        s, hn2 = req("POST", "/api/habits", {"nome": "NotToday", "tipo": "binary", "dias": _tom})
        s, met4 = req("GET", "/api/metricas")
        check("pendente-schedule", s == 200 and all(p["id"] != hn2["id"] for p in met4["hoje_pendente"]),
              str([p["nome"] for p in met4["hoje_pendente"]]))
        _hist = met4["historico"]
        _hs2 = [x for x in _hist["series"] if x["id"] == hs2["id"]][0]
        check("historico", s == 200 and len(_hist["semanas"]) == 8 and len(_hist["series"]) == len(met4["habitos"])
              and _hs2["pct"][-1] == _mine["pct"], str(_hs2["pct"][-2:]))
        s, _ = req("POST", f"/api/habits/{hn2['id']}/check", {"feito": 1})
        s, met5 = req("GET", "/api/metricas")
        _hn = [x for x in met5["habitos"] if x["id"] == hn2["id"]][0]
        _exp_pct2 = 100 if _today2.weekday() == 6 else 0
        check("extra-visivel", s == 200 and _hn["extras"] == [_today2.isoformat()] and _hn["pct"] == _exp_pct2,
              str((_hn["extras"], _hn["pct"])))
        _past = _today2 - _dt2.timedelta(days=7)
        _mon = _past - _dt2.timedelta(days=_past.weekday())
        _wed = (_mon + _dt2.timedelta(days=2)).isoformat()
        s, hb = req("POST", "/api/habits", {"nome": "Backfill", "tipo": "binary", "dias": "Qua"})
        s, _ = req("POST", f"/api/habits/{hb['id']}/check", {"data": _wed, "feito": 1})
        s, metb = req("GET", f"/api/metricas?data={_past.isoformat()}")
        _b = [x for x in metb["habitos"] if x["id"] == hb["id"]][0]
        check("backfill-planned", s == 200 and _b["planned_days"] == 1 and _b["done_days"] == 1
              and _b["pct"] == 100 and _b["extras"] == [], str((_b["planned_days"], _b["pct"], _b["extras"])))
        check("backfill-streak", s == 200 and _b["streak"] == 1, str(_b["streak"]))
        s, _ = req("DELETE", f"/api/habits/{hb['id']}")
        check("backfill-cleanup", s == 200)
        s, board = req("GET", "/api/board")
        for _col in ("todo", "doing", "done"):
            for t in board.get(_col, []):
                if t.get("habit_id") in (hs2["id"], hn2["id"]):
                    req("DELETE", f"/api/tasks/{t['id']}")
        s, _ = req("DELETE", f"/api/habits/{hs2['id']}")
        check("sched-cleanup", s == 200)
        s, _ = req("DELETE", f"/api/habits/{hn2['id']}")
        check("nottoday-cleanup", s == 200)
        s, _ = req("DELETE", f"/api/tasks/{tid}")
        check("delete-task", s == 200)
        s, _ = req("DELETE", f"/api/sessions/{sid}")
        check("delete-session", s == 200)
        s, bad = req("POST", "/api/stt", {})
        check("stt-requires-audio", s == 400, str(bad)[:80])
        s, bad = req("POST", "/api/stt", {"audio_b64": "!!!"})
        check("stt-rejects-bad-b64", s == 400, str(bad)[:80])
        s, cfg = req("GET", "/api/agent")
        check("agent-defaults", s == 200 and cfg["temperature"] == 0.7 and cfg["persona"] == "", str(cfg)[:80])
        s, cfg = req("PATCH", "/api/agent", {"persona": "Direto", "behavior": "Respostas curtas", "temperature": 0.2})
        check("agent-save", s == 200 and cfg["persona"] == "Direto" and cfg["temperature"] == 0.2, str(cfg)[:80])
        s, cfg = req("PATCH", "/api/agent", {"persona": "", "behavior": "", "temperature": 9})
        check("agent-clamp", s == 200 and cfg["temperature"] == 2.0, str(cfg)[:80])
        s, bad = req("PATCH", "/api/agent", {"temperature": "quente"})
        check("agent-bad-temp", s == 400, str(bad)[:80])
    finally:
        proc.terminate()
    print(f"\n{len(failures)} falhas: {failures}" if failures else "\nSMOKE OK — tudo verde")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
