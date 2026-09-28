"""Weekly metrics: habits % + streak, tasks flow, notes count. Plain functions."""
from datetime import datetime, timedelta

from . import habits


def week_range(data: str = "") -> dict:
    base = habits._check_data(data)
    d = datetime.strptime(base, "%Y-%m-%d").date()
    start = d - timedelta(days=d.weekday())
    days = [(start + timedelta(days=i)).isoformat() for i in range(7)]
    return {"inicio": days[0], "fim": days[-1], "dias": days}


def _done_map(conn, habit_id: str, days: list[str]) -> dict[str, float]:
    rows = conn.execute(
        "SELECT data, valor FROM habit_checks WHERE habit_id = ? AND data BETWEEN ? AND ?",
        (habit_id, days[0], days[-1]),
    ).fetchall()
    return {r["data"]: r["valor"] for r in rows}


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
            r = conn.execute("SELECT valor FROM habit_checks WHERE habit_id = ? AND data = ?", (h["id"], day)).fetchone()
            if r and (r["valor"] or 0) > 0:
                feitos += 1
        serie.append({"data": day[5:], "feitos": feitos})
    for h in hrows:
        dm = _done_map(conn, h["id"], days)
        done_days = sum(1 for d in days if (dm.get(d) or 0) > 0)
        pct = round(done_days / 7 * 100)
        streak = 0
        d = datetime.strptime(anchor, "%Y-%m-%d").date()
        while True:
            key = d.isoformat()
            if key < days[0]:
                break
            r = conn.execute("SELECT valor FROM habit_checks WHERE habit_id = ? AND data = ?", (h["id"], key)).fetchone()
            if r and (r["valor"] or 0) > 0:
                streak += 1
                d -= timedelta(days=1)
            else:
                break
        habitos.append({"id": h["id"], "nome": h["nome"], "pct": pct, "streak": streak, "done_days": done_days})

    media = round(sum(h["pct"] for h in habitos) / len(habitos)) if habitos else 0
    cheios = sum(1 for h in habitos if h["done_days"] == 7)

    ini, fim = days[0], days[-1]
    criadas = conn.execute("SELECT COUNT(*) AS c FROM tasks WHERE substr(created_at, 1, 10) BETWEEN ? AND ?", (ini, fim)).fetchone()["c"]
    concluidas = conn.execute("SELECT COUNT(*) AS c FROM tasks WHERE task_column = 'done' AND substr(updated_at, 1, 10) BETWEEN ? AND ?", (ini, fim)).fetchone()["c"]
    carregadas = conn.execute("SELECT COUNT(*) AS c FROM tasks WHERE task_column != 'done' AND substr(created_at, 1, 10) < ?", (ini,)).fetchone()["c"]
    pct_task = round(concluidas / criadas * 100) if criadas else (100 if concluidas == 0 else 0)

    daily = conn.execute("SELECT COUNT(*) AS c FROM daily_notes WHERE data BETWEEN ? AND ?", (ini, fim)).fetchone()["c"]
    tnotes = conn.execute("SELECT COUNT(*) AS c FROM tasks WHERE note_md IS NOT NULL AND note_md != '' AND substr(updated_at, 1, 10) BETWEEN ? AND ?", (ini, fim)).fetchone()["c"]

    return {
        "semana": {"inicio": ini, "fim": fim},
        "habitos": habitos,
        "serie": serie,
        "geral": {"media_pct": media, "cheios": cheios},
        "tarefas": {"criadas": criadas, "concluidas": concluidas, "carregadas": carregadas, "pct": pct_task},
        "notas": {"total": daily + tnotes, "diarias": daily, "tarefas": tnotes},
        "resumo": None,
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
