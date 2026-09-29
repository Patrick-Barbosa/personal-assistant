"""Agent loop: DeepSeek (OpenAI-compatible) + kanban + grounding tools. Stdlib HTTP via urllib."""
import json
import urllib.error
import urllib.request

from . import config, db, habits, kanban

MAX_STEPS = 8
MAX_CTX = 3000

SYSTEM_PROMPT = (
    "Você é o Copernico, um assistente pessoal direto e conciso. "
    "Fale sempre em português. "
    "Você pode gerenciar o quadro de tarefas do usuário com as ferramentas "
    "(colunas: todo=backlog, doing=esta semana, done=feito). "
    "Regra de planejamento: ao planejar a semana, crie tarefas APENAS no backlog (todo). "
    "O usuário move para a semana manualmente. "
    "Quando criar ou mover tarefas, confirme o que fez."
)

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "listar_kanban",
            "description": "Lista o quadro de tarefas (todo/doing/done).",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "criar_tarefa",
            "description": "Cria uma tarefa no backlog (coluna todo). Use para planejamento semanal.",
            "parameters": {
                "type": "object",
                "properties": {"titulo": {"type": "string"}},
                "required": ["titulo"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "mover_tarefa",
            "description": "Move tarefa entre colunas todo/doing/done.",
            "parameters": {
                "type": "object",
                "properties": {"id_ou_titulo": {"type": "string"}, "coluna": {"type": "string"}},
                "required": ["id_ou_titulo", "coluna"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "listar_habitos",
            "description": "Lista hábitos com o check de hoje (nome, tipo, valor).",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "ler_nota_tarefa",
            "description": "Lê a nota .md de uma tarefa por id ou título.",
            "parameters": {
                "type": "object",
                "properties": {"id_ou_titulo": {"type": "string"}},
                "required": ["id_ou_titulo"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "listar_notas_dia",
            "description": "Lista as notas rápidas diárias recentes.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
]


def _stored_key(name: str) -> str:
    try:
        conn = db.connect()
        try:
            r = conn.execute("SELECT value FROM settings WHERE key = ?", (name,)).fetchone()
            return (r["value"] if r else "") or ""
        finally:
            conn.close()
    except Exception:
        return ""


def _deepseek_key() -> str:
    return _stored_key("deepseek_api_key") or config.DEEPSEEK_API_KEY


def _chat_api(messages: list[dict], tools: list[dict] | None = None) -> dict:
    key = _deepseek_key()
    payload: dict = {"model": config.DEEPSEEK_MODEL, "messages": messages, "temperature": 0.7}
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"
    req = urllib.request.Request(
        config.DEEPSEEK_BASE_URL.rstrip("/") + "/chat/completions",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:300]
        if e.code in (401, 403):
            raise RuntimeError(f"DeepSeek recusou a chave (HTTP {e.code}). Confira DEEPSEEK_API_KEY. Detalhe: {detail}")
        raise RuntimeError(f"DeepSeek HTTP {e.code}: {detail}")


def build_context(conn) -> str:
    """Snapshot curto para aterrar o chat: quadro + hábitos de hoje + notas."""
    try:
        board = kanban.list_board(conn)
    except Exception:
        board = {"todo": [], "doing": [], "done": []}
    lines = []
    for col in ("todo", "doing", "done"):
        items = board.get(col, [])[:15]
        if not items:
            lines.append(f"## {col}\n(vazio)")
            continue
        rows = []
        for t in items:
            day = f" [{t.get('day_label')}]" if t.get("day_label") else ""
            cat = f" ({t.get('categoria')})" if t.get("categoria") else ""
            rows.append(f"- {t.get('titulo')}{day}{cat} (id={t.get('id')})")
        lines.append(f"## {col}\n" + "\n".join(rows))
    try:
        habs = habits.list_habits(conn, habits.today_str())
    except Exception:
        habs = []
    if habs:
        lines.append("## hábitos hoje\n" + "\n".join(f"- {h['nome']}: {h['valor']}{h['unidade']}" for h in habs))
    else:
        lines.append("## hábitos hoje\n(nenhum)")
    try:
        nota = habits.get_daily_note(conn, habits.today_str())
    except Exception:
        nota = None
    if nota and nota.get("conteudo"):
        lines.append("## nota de hoje\n" + nota["conteudo"][:800])
    try:
        notes = conn.execute(
            "SELECT titulo, note_md FROM tasks WHERE note_md IS NOT NULL AND note_md != '' ORDER BY updated_at DESC LIMIT 5"
        ).fetchall()
    except Exception:
        notes = []
    if notes:
        cut = []
        for r in notes:
            cut.append(f"### {r['titulo']}\n{(r['note_md'] or '')[:300]}")
        lines.append("## notas de tarefas\n" + "\n".join(cut))
    ctx = "\n".join(lines)
    return ctx[:MAX_CTX]


def execute_tool(conn, name: str, args: dict) -> str:
    try:
        if name == "listar_kanban":
            board = kanban.list_board(conn)
            out = []
            for col in ("todo", "doing", "done"):
                items = [f"- {t['titulo']} (id={t['id']})" for t in board[col]] or ["(vazio)"]
                out.append(f"## {col}\n" + "\n".join(items))
            return "\n".join(out)
        if name == "criar_tarefa":
            t = kanban.create_task(conn, args.get("titulo", ""), "todo")
            return f"Tarefa criada no backlog: {t['titulo']} (id={t['id']})"
        if name == "mover_tarefa":
            key = args.get("id_ou_titulo", "")
            row = conn.execute("SELECT id FROM tasks WHERE id = ?", (key,)).fetchone()
            if not row:
                row = conn.execute("SELECT id FROM tasks WHERE titulo LIKE ? ORDER BY updated_at DESC LIMIT 1", (f"%{key}%",)).fetchone()
            if not row:
                return f"Tarefa não encontrada: {key}"
            t = kanban.move_task(conn, row["id"], args.get("coluna", "todo"))
            return f"Tarefa movida: {t['titulo']} -> {t['column']}"
        if name == "listar_habitos":
            habs = habits.list_habits(conn, habits.today_str())
            if not habs:
                return "(nenhum hábito)"
            lines = []
            for h in habs:
                mark = "✓" if h["feito"] else "○"
                extra = f" {h['valor']}{h['unidade']}" if h["tipo"] == "numeric" else ""
                meta = f" (meta {h['meta']}{h['unidade']})" if h["tipo"] == "numeric" and h["meta"] else ""
                lines.append(f"- {mark} {h['nome']}{extra}{meta}")
            return "\n".join(lines)
        if name == "ler_nota_tarefa":
            key = args.get("id_ou_titulo", "")
            row = conn.execute("SELECT titulo, note_md FROM tasks WHERE id = ?", (key,)).fetchone()
            if not row:
                row = conn.execute("SELECT titulo, note_md FROM tasks WHERE titulo LIKE ? ORDER BY updated_at DESC LIMIT 1", (f"%{key}%",)).fetchone()
            if not row:
                return f"Tarefa não encontrada: {key}"
            return f"# {row['titulo']}\n{(row['note_md'] or '(nota vazia)')[:2000]}"
        if name == "listar_notas_dia":
            rows = conn.execute("SELECT data, conteudo FROM daily_notes ORDER BY data DESC LIMIT 7").fetchall()
            if not rows:
                return "(nenhuma nota diária)"
            return "\n".join(f"## {r['data']}\n{(r['conteudo'] or '')[:500]}" for r in rows)
        return f"Ferramenta desconhecida: {name}"
    except Exception as e:
        return f"Erro em {name}: {e}"


def run_turn(session_id: str, user_input: str, refs: str = "") -> str:
    conn = db.connect()
    try:
        custom = conn.execute("SELECT value FROM settings WHERE key = 'custom_instructions'").fetchone()
        system = SYSTEM_PROMPT + (f"\n\n[INSTRUÇÕES DO USUÁRIO]\n{custom['value']}" if custom and custom["value"] else "")
        system += "\n\n[CONTEXTO]\n" + build_context(conn)
        if refs:
            user_input = user_input + "\n\n[REFERÊNCIAS MENCIONADAS]\n" + refs[:6000]
        msgs = conn.execute(
            "SELECT role, content FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT 20", (session_id,)
        ).fetchall()
        history = [{"role": r["role"], "content": r["content"]} for r in reversed(msgs) if r["role"] in ("user", "assistant")]
        messages = [{"role": "system", "content": system}, *history, {"role": "user", "content": user_input}]
        if not _deepseek_key():
            return "Configure DEEPSEEK_API_KEY no .env para ativar o agente."
        for _ in range(MAX_STEPS):
            resp = _chat_api(messages, TOOLS)
            choice = resp["choices"][0]["message"]
            tool_calls = choice.get("tool_calls") or []
            content = choice.get("content") or ""
            if not tool_calls:
                return content or "(resposta vazia)"
            messages.append({"role": "assistant", "content": content, "tool_calls": tool_calls})
            for tc in tool_calls:
                fn = tc.get("function", {})
                try:
                    targs = json.loads(fn.get("arguments") or "{}")
                except json.JSONDecodeError:
                    targs = {}
                result = execute_tool(conn, fn.get("name", ""), targs)
                messages.append({"role": "tool", "tool_call_id": tc.get("id", ""), "content": result})
        last = messages[-1]
        return last.get("content", "(limite de passos)") if isinstance(last, dict) else "(limite de passos)"
    finally:
        conn.close()


def quick_title(first_message: str) -> str:
    words = (first_message or "").strip().split()
    return " ".join(words[:6]) or "Nova Conversa"
