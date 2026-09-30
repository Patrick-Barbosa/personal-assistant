"""Agent loop: DeepSeek (OpenAI-compatible) + kanban + grounding tools. Stdlib HTTP via urllib."""
import json
import re
import urllib.error
import urllib.request

from . import categories, config, db, habits, kanban

MAX_STEPS = 8
MAX_CTX = 3000

SYSTEM_PROMPT = (
    "Você é o Tiba, um assistente pessoal direto e conciso. "
    "Fale sempre em português. "
    "Você pode gerenciar o quadro de tarefas do usuário com as ferramentas "
    "(colunas: todo=backlog, doing=esta semana, done=feito). "
    "Você também pode renomear/editar tarefas (atualizar_tarefa) e "
    "criar/renomear categorias de tarefas (criar_categoria, atualizar_categoria). "
    "Regra de categoria: nunca invente id ou nome de categoria. "
    "Antes de usar uma categoria, chame listar_categorias; "
    "se não existir, chame criar_categoria ou pergunte ao usuário. "
    "Regra de planejamento: ao planejar a semana, crie tarefas APENAS no backlog (todo). "
    "O usuário move para a semana manualmente. "
    "Formatação das respostas: em listas, pule uma linha em branco entre os itens, assim:\n- primeiro item\n\n- segundo item\nEvite muros de texto. "
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
                "properties": {
                    "titulo": {"type": "string"},
                    "categoria": {"type": "string", "description": "Id existente da categoria (opcional). Chame listar_categorias antes; nunca invente."},
                },
                "required": ["titulo"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "atualizar_tarefa",
            "description": "Atualiza título, categoria, dia ou nota de uma tarefa existente (busca por id ou título).",
            "parameters": {
                "type": "object",
                "properties": {
                    "id_ou_titulo": {"type": "string"},
                    "titulo": {"type": "string"},
                    "categoria": {"type": "string", "description": "Id existente da categoria (\"\" limpa). Chame listar_categorias antes; nunca invente."},
                    "day_label": {"type": "string", "description": "Seg/Ter/Qua/Qui/Sex/Sab/Dom ou vazio para limpar."},
                    "note_md": {"type": "string"},
                },
                "required": ["id_ou_titulo"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "listar_categorias",
            "description": "Lista as categorias de tarefas (id, nome, cor).",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "criar_categoria",
            "description": "Cria uma categoria de tarefas com nome e cor #rrggbb opcional.",
            "parameters": {
                "type": "object",
                "properties": {
                    "nome": {"type": "string"},
                    "cor": {"type": "string", "description": "Cor #rrggbb (opcional, padrão #141414)."},
                },
                "required": ["nome"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "atualizar_categoria",
            "description": "Renomeia ou recolore uma categoria existente (busca por id ou nome).",
            "parameters": {
                "type": "object",
                "properties": {
                    "id_ou_nome": {"type": "string"},
                    "nome": {"type": "string"},
                    "cor": {"type": "string", "description": "Cor #rrggbb."},
                },
                "required": ["id_ou_nome"],
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


_LIST_RE = re.compile(r"^(\s*(?:[-*+]|\d+[.)])\s+\S)")
_HEAD_RE = re.compile(r"^(#{1,6}\s+\S)")
_FENCE_RE = re.compile(r"^(```|~~~)")


def _normalize_md(text: str) -> str:
    """Garante o respiro estrutural da resposta (idempotente, ignora code fences).

    Insere linha em branco antes de lista/título após texto e entre itens
    vizinhos (lista justa vira solta); colapsa brancos múltiplos.
    """
    out: list[str] = []
    in_fence = False
    for line in text.split("\n"):
        s = line.strip()
        if _FENCE_RE.match(s):
            in_fence = not in_fence
            out.append(line)
            continue
        if in_fence:
            out.append(line)
            continue
        prev = out[-1] if out else ""
        prev_blank = prev.strip() == ""
        prev_list = bool(_LIST_RE.match(prev))
        prev_head = bool(_HEAD_RE.match(prev))
        cur_list = bool(_LIST_RE.match(line))
        cur_head = bool(_HEAD_RE.match(line))
        if s == "":
            if not prev_blank and out:
                out.append("")
            continue
        if (cur_head or (cur_list and not prev_list)) and not prev_blank and not prev_head and out:
            out.append("")
        elif cur_list and prev_list:
            out.append("")
        out.append(line)
    return "\n".join(out).strip()


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


DEFAULT_TEMPERATURE = 0.7
MAX_TEXT_SETTING = 2000


def get_agent_config(conn) -> dict:
    """Lê persona/comportamento/sobre-mim/temperatura da tabela settings (com padrões)."""
    cfg = {"persona": "", "behavior": "", "about_me": "", "temperature": DEFAULT_TEMPERATURE}
    try:
        rows = conn.execute("SELECT key, value FROM settings WHERE key IN ('persona', 'behavior', 'about_me', 'temperature')").fetchall()
    except Exception:
        return cfg
    for r in rows:
        if r["key"] == "temperature":
            try:
                cfg["temperature"] = min(2.0, max(0.0, float(r["value"])))
            except (TypeError, ValueError):
                pass
        elif r["key"] in cfg:
            cfg[r["key"]] = r["value"] or ""
    return cfg


def save_agent_config(conn, persona: str, behavior: str, temperature, about_me: str = "") -> dict:
    """Valida e grava persona/comportamento/sobre-mim/temperatura. Devolve a config salva."""
    try:
        temperature = min(2.0, max(0.0, float(temperature)))
    except (TypeError, ValueError):
        raise ValueError("Temperatura inválida (use 0 a 2).")
    persona = (persona or "")[:MAX_TEXT_SETTING]
    behavior = (behavior or "")[:MAX_TEXT_SETTING]
    about_me = (about_me or "")[:MAX_TEXT_SETTING]
    for key, value in (("persona", persona), ("behavior", behavior), ("about_me", about_me), ("temperature", str(temperature))):
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )
    conn.commit()
    return {"persona": persona, "behavior": behavior, "about_me": about_me, "temperature": temperature}


def _chat_api(messages: list[dict], tools: list[dict] | None = None, temperature: float = DEFAULT_TEMPERATURE) -> dict:
    key = _deepseek_key()
    payload: dict = {"model": config.DEEPSEEK_MODEL, "messages": messages, "temperature": temperature}
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
        cats = categories.list_categories(conn)
    except Exception:
        cats = []
    if cats:
        lines.append("## categorias válidas (use o id)\n" + "\n".join(f"- {c['nome']} (id={c['id']})" for c in cats))
    else:
        lines.append("## categorias válidas\n(nenhuma)")
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


def _task_id(conn, key: str) -> str | None:
    key = (key or "").strip()
    if not key:
        return None
    row = conn.execute("SELECT id FROM tasks WHERE id = ?", (key,)).fetchone()
    if row:
        return row["id"]
    row = conn.execute("SELECT id FROM tasks WHERE titulo LIKE ? ORDER BY updated_at DESC LIMIT 1", (f"%{key}%",)).fetchone()
    return row["id"] if row else None


def _categoria_id(conn, key: str) -> str | None:
    key = (key or "").strip()
    if not key:
        return None
    row = conn.execute("SELECT id FROM categories WHERE id = ?", (key,)).fetchone()
    if row:
        return row["id"]
    row = conn.execute("SELECT id FROM categories WHERE LOWER(nome) = LOWER(?) LIMIT 1", (key,)).fetchone()
    if row:
        return row["id"]
    row = conn.execute("SELECT id FROM categories WHERE nome LIKE ? ORDER BY nome LIMIT 1", (f"%{key}%",)).fetchone()
    return row["id"] if row else None


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
            cat = (args.get("categoria") or "").strip()
            if cat:
                cid = _categoria_id(conn, cat)
                if not cid:
                    return f"Tarefa criada no backlog: {t['titulo']} (id={t['id']}), mas categoria não encontrada: {cat}"
                t = kanban.update_task(conn, t["id"], {"categoria": cid})
            return f"Tarefa criada no backlog: {t['titulo']} (id={t['id']})"
        if name == "atualizar_tarefa":
            tid = _task_id(conn, args.get("id_ou_titulo", ""))
            if not tid:
                return f"Tarefa não encontrada: {args.get('id_ou_titulo', '')}"
            patch: dict = {}
            if isinstance(args.get("titulo"), str) and args["titulo"].strip():
                patch["titulo"] = args["titulo"].strip()
            if "categoria" in args and isinstance(args.get("categoria"), str):
                cat = args["categoria"].strip()
                if not cat:
                    patch["categoria"] = ""
                else:
                    cid = _categoria_id(conn, cat)
                    if not cid:
                        return f"Categoria não encontrada: {cat}. Use listar_categorias ou criar_categoria."
                    patch["categoria"] = cid
            if "day_label" in args and isinstance(args.get("day_label"), str):
                day = args["day_label"].strip()
                patch["day_label"] = day if day else None
            if "note_md" in args and isinstance(args.get("note_md"), str):
                patch["note_md"] = args["note_md"]
            if not patch:
                return "Nada para atualizar: informe titulo, categoria, day_label ou note_md."
            t = kanban.update_task(conn, tid, patch)
            return f"Tarefa atualizada: {t['titulo']} (id={t['id']})"
        if name == "listar_categorias":
            cats = categories.list_categories(conn)
            if not cats:
                return "(nenhuma categoria)"
            return "\n".join(f"- {c['nome']} (id={c['id']}, cor={c['cor']})" for c in cats)
        if name == "criar_categoria":
            c = categories.create_category(conn, args.get("nome", ""), args.get("cor") or "#141414")
            return f"Categoria criada: {c['nome']} (id={c['id']}, cor={c['cor']})"
        if name == "atualizar_categoria":
            cid = _categoria_id(conn, args.get("id_ou_nome", ""))
            if not cid:
                return f"Categoria não encontrada: {args.get('id_ou_nome', '')}"
            patch = {}
            if isinstance(args.get("nome"), str) and args["nome"].strip():
                patch["nome"] = args["nome"].strip()
            if isinstance(args.get("cor"), str) and args["cor"].strip():
                patch["cor"] = args["cor"].strip()
            if not patch:
                return "Nada para atualizar: informe nome ou cor."
            c = categories.update_category(conn, cid, patch)
            return f"Categoria atualizada: {c['nome']} (id={c['id']}, cor={c['cor']})"
        if name == "mover_tarefa":
            key = args.get("id_ou_titulo", "")
            row = conn.execute("SELECT id FROM tasks WHERE id = ?", (key,)).fetchone()
            if not row:
                row = conn.execute("SELECT id FROM tasks WHERE titulo LIKE ? ORDER BY updated_at DESC LIMIT 1", (f"%{key}%",)).fetchone()
            if not row:
                return f"Tarefa não encontrada: {key}"
            t = kanban.move_task(conn, row["id"], args.get("coluna", "todo"))
            habits.sync_task_done(conn, row["id"], t["column"] == "done")
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
        cfg = get_agent_config(conn)
        system = SYSTEM_PROMPT
        if cfg["persona"]:
            system += f"\n\n[PERSONA]\n{cfg['persona']}"
        if cfg["behavior"]:
            system += f"\n\n[COMPORTAMENTO]\n{cfg['behavior']}"
        if cfg.get("about_me"):
            system += f"\n\n[SOBRE O USUÁRIO]\n{cfg['about_me']}"
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
            resp = _chat_api(messages, TOOLS, cfg["temperature"])
            choice = resp["choices"][0]["message"]
            tool_calls = choice.get("tool_calls") or []
            content = choice.get("content") or ""
            if not tool_calls:
                return _normalize_md(content) if content else "(resposta vazia)"
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
