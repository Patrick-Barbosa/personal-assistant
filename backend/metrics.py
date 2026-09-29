"""Weekly metrics: habits % + streak, tasks flow, notes count. Plain functions."""
from datetime import datetime, timedelta

from . import habits


def week_range(data: str = "") -> dict:
    base = habits._check_data(data)
    d = datetime.strptime(base, "%Y-%m-%d").date()
    start = d - timedelta(days=d.weekday())
    days = [(start + timedelta(days=i)).isoformat() for i in range(7)]
    return {"inicio": days[0], "fim": days[-1], "dias": days}


def _done_map(conn, habit_id: str, days: list[str]) -> dict[str, tuple]:
    rows = conn.execute(
        "SELECT data, valor, feito FROM habit_checks WHERE habit_id = ? AND data BETWEEN ? AND ?",
        (habit_id, days[0], days[-1]),
    ).fetchall()
    return {r["data"]: (r["valor"], r["feito"] if "feito" in r.keys() else 0) for r in rows}


def get_metricas(conn, data: str = "") -> dict:
    wk = week_range(data)
    days = wk["dias"]
    today = habits.today_str()
    anchor = today if days[0] <= today <= days[-1] else days[-1]

    hrows = conn.execute("SELECT * FROM habits ORDER BY created_at, id").fetchall()
    habitos = []
    serie = []
    for day in days:
        feitos = 0
        for h in hrows:
            hkeys = h.keys()
            r = conn.execute("SELECT valor, feito FROM habit_checks WHERE habit_id = ? AND data = ?", (h["id"], day)).fetchone()
            if r and habits.cumprido(h["tipo"], r["valor"], h["meta"] if "meta" in hkeys else 0, r["feito"] if "feito" in r.keys() else None):
                feitos += 1
        serie.append({"data": day[5:], "feitos": feitos})
    for h in hrows:
        hkeys = h.keys()
        hmeta = h["meta"] if "meta" in hkeys else 0
        dm = _done_map(conn, h["id"], days)
        done_days = sum(1 for d in days if habits.cumprido(h["tipo"], dm.get(d, (0, 0))[0], hmeta, dm.get(d, (0, 0))[1]))
        pct = round(done_days / 7 * 100)
        dias = [bool(habits.cumprido(h["tipo"], dm.get(d, (0, 0))[0], hmeta, dm.get(d, (0, 0))[1])) for d in days]
        streak = 0
        d = datetime.strptime(anchor, "%Y-%m-%d").date()
        for _ in range(400):
            key = d.isoformat()
            r = conn.execute("SELECT valor, feito, protegido FROM habit_checks WHERE habit_id = ? AND data = ?", (h["id"], key)).fetchone()
            rkeys = r.keys() if r else []
            feito = r["feito"] if r and "feito" in rkeys else 0
            prot = r["protegido"] if r and "protegido" in rkeys else 0
            if r and (feito or prot):
                streak += 1
                d -= timedelta(days=1)
                continue
            if key >= days[0] and conn.execute(
                "SELECT 1 FROM habit_checks WHERE habit_id = ? AND data < ? AND feito = 1 LIMIT 1", (h["id"], key)
            ).fetchone():
                if habits.spend_shield(conn, h["id"], key):
                    streak += 1
                    d -= timedelta(days=1)
                    continue
            break
        protegidas = [r["data"] for r in conn.execute(
            "SELECT data FROM habit_checks WHERE habit_id = ? AND protegido = 1 AND data BETWEEN ? AND ?", (h["id"], days[0], days[-1])
        ).fetchall()]
        marco = streak if streak in (7, 30, 100, 365) else None
        habitos.append({"id": h["id"], "nome": h["nome"], "tipo": h["tipo"], "unidade": h["unidade"], "meta": hmeta, "pct": pct, "streak": streak, "done_days": done_days, "dias": dias, "marco": marco, "protegidas": protegidas})

    media = round(sum(h["pct"] for h in habitos) / len(habitos)) if habitos else 0
    cheios = sum(1 for h in habitos if h["done_days"] == 7)

    ini, fim = days[0], days[-1]
    criadas = conn.execute("SELECT COUNT(*) AS c FROM tasks WHERE substr(created_at, 1, 10) BETWEEN ? AND ?", (ini, fim)).fetchone()["c"]
    concluidas = conn.execute("SELECT COUNT(*) AS c FROM tasks WHERE task_column = 'done' AND substr(updated_at, 1, 10) BETWEEN ? AND ?", (ini, fim)).fetchone()["c"]
    carregadas = conn.execute("SELECT COUNT(*) AS c FROM tasks WHERE task_column != 'done' AND substr(created_at, 1, 10) < ?", (ini,)).fetchone()["c"]
    pct_task = round(concluidas / criadas * 100) if criadas else (100 if concluidas == 0 else 0)

    daily = conn.execute("SELECT COUNT(*) AS c FROM daily_notes WHERE data BETWEEN ? AND ?", (ini, fim)).fetchone()["c"]
    tnotes = conn.execute("SELECT COUNT(*) AS c FROM tasks WHERE note_md IS NOT NULL AND note_md != '' AND substr(updated_at, 1, 10) BETWEEN ? AND ?", (ini, fim)).fetchone()["c"]

    pendente = []
    for h in habitos:
        r = conn.execute("SELECT feito FROM habit_checks WHERE habit_id = ? AND data = ?", (h["id"], today)).fetchone()
        if not r or not r["feito"]:
            pendente.append({"id": h["id"], "nome": h["nome"], "streak": h["streak"]})

    return {
        "semana": {"inicio": ini, "fim": fim},
        "habitos": habitos,
        "serie": serie,
        "geral": {"media_pct": media, "cheios": cheios},
        "tarefas": {"criadas": criadas, "concluidas": concluidas, "carregadas": carregadas, "pct": pct_task},
        "notas": {"total": daily + tnotes, "diarias": daily, "tarefas": tnotes},
        "resumo": None,
        "escudos": habits.get_escudos(conn),
        "hoje_pendente": pendente,
    }


def summarize_week(metricas: dict) -> str:
    from . import agent

    if not agent._deepseek_key():
        return "Configure DEEPSEEK_API_KEY no .env para gerar o resumo."
    prompt = (
        "Resuma a semana em 3 bullets curtos em português: (1) vitórias, (2) pontos perdidos, (3) foco da próxima semana. "
        f"Dados: {metricas}"
    )
    try:
        resp = agent._chat_api([{"role": "user", "content": prompt}])
        return resp["choices"][0]["message"].get("content", "(resposta vazia)")
    except Exception as e:
        return f"Erro no resumo: {e}"
