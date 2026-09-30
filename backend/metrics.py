"""Weekly metrics: habits % + streak, tasks flow, notes count. Plain functions."""
from datetime import datetime, timedelta

from . import habits

HISTORICO_SEMANAS = 8


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


def _dias_set(habit) -> set[str] | None:
    """Dias planejados do hábito. None = todo dia."""
    raw = (habit["dias"] if "dias" in habit.keys() else "") or ""
    valid = {p.strip() for p in raw.split(",") if p.strip()}
    valid = {p for p in valid if p in ("Seg", "Ter", "Qua", "Qui", "Sex", "Sab", "Dom")}
    return valid or None


def _planned_in_week(habit, days: list[str], dm: dict | None = None) -> list[str]:
    """Dias planejados da semana: dias programados desde a criação + dias com registro explícito."""
    sched = _dias_set(habit)
    nasc = ((habit["created_at"] if "created_at" in habit.keys() else "") or "")[:10]
    out = []
    for d in days:
        if sched is not None and habits.weekday_label(d) not in sched:
            continue
        if nasc and d < nasc:
            if dm is None:
                continue
            v, f = dm.get(d, (0, 0))
            if not _is_done(habit, v, f):
                continue
        out.append(d)
    return out


def _is_done(habit, valor: float, feito) -> bool:
    hmeta = habit["meta"] if "meta" in habit.keys() else 0
    return habits.cumprido(habit["tipo"], valor, hmeta, feito)


def _week_done(conn, habit, days: list[str], full: dict | None = None) -> tuple[list[str], int, list[bool]]:
    """(planejados, feitos, flags dos 7 dias) para uma semana."""
    dm = full if full is not None else _done_map(conn, habit["id"], days)
    planned = _planned_in_week(habit, days, dm)
    done_n = 0
    for d in planned:
        v, f = dm.get(d, (0, 0))
        if _is_done(habit, v, f):
            done_n += 1
    flags = []
    for d in days:
        v, f = dm.get(d, (0, 0))
        flags.append(bool(_is_done(habit, v, f)))
    return planned, done_n, flags


def _streak(conn, habit, anchor: str, week_start: str) -> int:
    """Sessões planejadas em sequência até anchor. Descansos pulam; hoje pendente não quebra (ainda dá pra fazer)."""
    sched = _dias_set(habit)
    hoje = habits.today_str()
    streak = 0
    d = datetime.strptime(anchor, "%Y-%m-%d").date()
    for _ in range(400):
        key = d.isoformat()
        if sched is not None and habits.weekday_label(key) not in sched:
            d -= timedelta(days=1)
            continue
        r = conn.execute("SELECT valor, feito, protegido FROM habit_checks WHERE habit_id = ? AND data = ?", (habit["id"], key)).fetchone()
        rkeys = r.keys() if r else []
        feito = r["feito"] if r and "feito" in rkeys else 0
        prot = r["protegido"] if r and "protegido" in rkeys else 0
        if r and (feito or prot):
            streak += 1
            d -= timedelta(days=1)
            continue
        if key == hoje:
            d -= timedelta(days=1)
            continue
        if key >= week_start and conn.execute(
            "SELECT 1 FROM habit_checks WHERE habit_id = ? AND data < ? AND feito = 1 LIMIT 1", (habit["id"], key)
        ).fetchone():
            if habits.spend_shield(conn, habit["id"], key):
                streak += 1
                d -= timedelta(days=1)
                continue
        break
    return streak


def get_historico(conn, data: str = "", semanas: int = HISTORICO_SEMANAS) -> dict:
    """% semanal por hábito nas últimas N semanas (None = hábito ainda não existia)."""
    anchor = habits._check_data(data)
    base = datetime.strptime(anchor, "%Y-%m-%d").date()
    weeks = []
    for k in range(semanas - 1, -1, -1):
        ref = (base - timedelta(days=7 * k)).isoformat()
        weeks.append(week_range(ref))
    hrows = conn.execute("SELECT * FROM habits ORDER BY created_at, id").fetchall()
    span = [weeks[0]["dias"][0], weeks[-1]["dias"][-1]]
    series = []
    for h in hrows:
        full = _done_map(conn, h["id"], span)
        pts: list[int | None] = []
        for wk in weeks:
            planned, done_n, _ = _week_done(conn, h, wk["dias"], full)
            pts.append(None if not planned else round(done_n / len(planned) * 100))
        series.append({"id": h["id"], "nome": h["nome"], "pct": pts})
    rotulos = [{"inicio": w["inicio"], "fim": w["fim"], "rotulo": w["dias"][0][5:]} for w in weeks]
    return {"semanas": rotulos, "series": series}


def get_metricas(conn, data: str = "") -> dict:
    wk = week_range(data)
    days = wk["dias"]
    today = habits.today_str()
    anchor = today if days[0] <= today <= days[-1] else days[-1]
    label_hoje = habits.weekday_label(today)

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
        planned, done_n, dias = _week_done(conn, h, days)
        pct = round(done_n / len(planned) * 100) if planned else 100
        planned_set = set(planned)
        extras = [d for d, f in zip(days, dias) if f and d not in planned_set]
        streak = _streak(conn, h, anchor, days[0])
        protegidas = [r["data"] for r in conn.execute(
            "SELECT data FROM habit_checks WHERE habit_id = ? AND protegido = 1 AND data BETWEEN ? AND ?", (h["id"], days[0], days[-1])
        ).fetchall()]
        marco = streak if streak in (7, 30, 100, 365) else None
        sched = _dias_set(h)
        planejados = [(sched is None or habits.weekday_label(d) in sched) for d in days]
        habitos.append({"id": h["id"], "nome": h["nome"], "tipo": h["tipo"], "unidade": h["unidade"], "meta": hmeta,
                        "pct": pct, "streak": streak, "done_days": done_n, "planned_days": len(planned),
                        "dias": dias, "planejados": planejados, "extras": extras, "marco": marco, "protegidas": protegidas})

    media = round(sum(h["pct"] for h in habitos) / len(habitos)) if habitos else 0
    cheios = sum(1 for h in habitos if h["pct"] == 100)

    ini, fim = days[0], days[-1]
    criadas = conn.execute("SELECT COUNT(*) AS c FROM tasks WHERE substr(created_at, 1, 10) BETWEEN ? AND ?", (ini, fim)).fetchone()["c"]
    concluidas = conn.execute("SELECT COUNT(*) AS c FROM tasks WHERE task_column = 'done' AND substr(updated_at, 1, 10) BETWEEN ? AND ?", (ini, fim)).fetchone()["c"]
    carregadas = conn.execute("SELECT COUNT(*) AS c FROM tasks WHERE task_column != 'done' AND substr(created_at, 1, 10) < ?", (ini,)).fetchone()["c"]
    pct_task = round(concluidas / criadas * 100) if criadas else (100 if concluidas == 0 else 0)

    daily = conn.execute("SELECT COUNT(*) AS c FROM daily_notes WHERE data BETWEEN ? AND ?", (ini, fim)).fetchone()["c"]
    tnotes = conn.execute("SELECT COUNT(*) AS c FROM tasks WHERE note_md IS NOT NULL AND note_md != '' AND substr(updated_at, 1, 10) BETWEEN ? AND ?", (ini, fim)).fetchone()["c"]

    pendente = []
    for h in habitos:
        sched = _dias_set(next(r for r in hrows if r["id"] == h["id"]))
        if sched is not None and label_hoje not in sched:
            continue
        r = conn.execute("SELECT feito FROM habit_checks WHERE habit_id = ? AND data = ?", (h["id"], today)).fetchone()
        if not r or not r["feito"]:
            pendente.append({"id": h["id"], "nome": h["nome"], "streak": h["streak"]})

    return {
        "semana": {"inicio": ini, "fim": fim},
        "habitos": habitos,
        "serie": serie,
        "historico": get_historico(conn, data),
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
