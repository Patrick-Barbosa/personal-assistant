"""Agent loop: DeepSeek (OpenAI-compatible) + local tools. Stdlib HTTP via urllib."""
import json
import urllib.error
import urllib.request
import uuid
from datetime import datetime

from . import config, db, kanban, prompts, search, vault

MAX_STEPS = 8

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "buscar_notas",
            "description": "Busca notas nos cofres (padrão + obsidian somente leitura).",
            "parameters": {"type": "object", "properties": {"query": {"type": "string"}, "limite": {"type": "integer"}}, "required": ["query"]},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "ler_nota",
            "description": "Lê o conteúdo de uma nota por caminho, título ou slug.",
            "parameters": {"type": "object", "properties": {"identifier": {"type": "string"}}, "required": ["identifier"]},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "salvar_nota",
            "description": "Cria nota NOVA no cofre padrão. Nunca no obsidian.",
            "parameters": {"type": "object", "properties": {"titulo": {"type": "string"}, "conteudo": {"type": "string"}}, "required": ["titulo", "conteudo"]},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "atualizar_nota",
            "description": "Atualiza nota existente do cofre padrão (append ou replace).",
            "parameters": {"type": "object", "properties": {"identifier": {"type": "string"}, "novo_conteudo": {"type": "string"}, "modo": {"type": "string"}}, "required": ["identifier", "novo_conteudo"]},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "listar_kanban",
            "description": "Quadro da semana aberta (default). Passe semana YYYY-Www só com pedido explícito.",
            "parameters": {"type": "object", "properties": {"semana": {"type": "string"}}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "criar_tarefa",
            "description": "Cria tarefa na semana aberta.",
            "parameters": {"type": "object", "properties": {"titulo": {"type": "string"}, "coluna": {"type": "string"}}, "required": ["titulo"]},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "mover_tarefa",
            "description": "Move tarefa entre colunas todo/doing/done.",
            "parameters": {"type": "object", "properties": {"id_ou_titulo": {"type": "string"}, "coluna": {"type": "string"}}, "required": ["id_ou_titulo", "coluna"]},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "criar_habito",
            "description": "Cria hábito com cron de 5 campos.",
            "parameters": {"type": "object", "properties": {"titulo": {"type": "string"}, "cron": {"type": "string"}, "cor": {"type": "string"}}, "required": ["titulo", "cron"]},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "perguntar_ao_usuario",
            "description": "Pede informação faltante ao usuário em vez de inventar.",
            "parameters": {"type": "object", "properties": {"pergunta": {"type": "string"}}, "required": ["pergunta"]},
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
    # Saved settings override .env (user can rotate keys in the UI).
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


def execute_tool(conn, name: str, args: dict) -> str:
    try:
        if name == "buscar_notas":
            hits = search.search(args.get("query", ""), int(args.get("limite") or 8))
            lines = [f"- {h['titulo']} (`{h['path']}`, {h['vault']})" for h in hits] or ["(nada encontrado)"]
            return "\n".join(lines)
        if name == "ler_nota":
            ident = args.get("identifier", "")
            for root in (config.VAULT_PATH, config.OBSIDIAN_VAULT_PATH):
                try:
                    p = vault.safe_resolve(root, ident)
                    fm, body, title = vault.read_note_file(p)
                    return f"# {title}\n\n{body[:6000]}"
                except FileNotFoundError:
                    continue
            return f"Nota não encontrada: {ident}"
        if name == "salvar_nota":
            titulo, conteudo = (args.get("titulo") or "").strip(), args.get("conteudo") or ""
            dest = config.VAULT_PATH / (vault.sanitize_filename(titulo) + ".md")
            i = 1
            while dest.exists():
                dest = config.VAULT_PATH / f"{vault.sanitize_filename(titulo)}-{i}.md"
                i += 1
            vault.atomic_write(dest, f"---\ntitulo: {titulo}\ncreated: {datetime.now():%Y-%m-%d}\n---\n\n{conteudo}\n")
            return f"Nota criada: {dest.name}"
        if name == "atualizar_nota":
            p = vault.safe_resolve(config.VAULT_PATH, args.get("identifier", ""))
            fm, body, title = vault.read_note_file(p)
            novo = args.get("novo_conteudo") or ""
            body = (body.rstrip() + "\n\n" + novo) if (args.get("modo") or "append") == "append" else novo
            raw = p.read_text(encoding="utf-8", errors="replace")
            head = raw[: raw.find("\n---", 3) + 4] if raw.startswith("---") and "\n---" in raw[3:] else f"---\ntitulo: {title}\n---\n"
            vault.atomic_write(p, head + "\n\n" + body + "\n")
            return f"Nota atualizada: {p.name}"
        if name == "listar_kanban":
            b = kanban.get_board(conn, args.get("semana"))
            cols: dict[str, list[str]] = {"todo": [], "doing": [], "done": []}
            for t in b["tasks"]:
                cols.get(t["task_column"], cols["todo"]).append(f"{t['titulo']} (id={t['id']})")
            out = [f"# {b['week']['id']} ({b['week']['status']})"]
            for c, items in cols.items():
                out.append(f"## {c}\n" + ("\n".join(f"- {i}" for i in items) or "(vazio)"))
            return "\n".join(out)
        if name == "criar_tarefa":
            t = kanban.create_task(conn, args.get("titulo", ""), args.get("coluna") or "todo")
            return f"Tarefa criada: {t['titulo']} (id={t['id']})"
        if name == "mover_tarefa":
            key = args.get("id_ou_titulo", "")
            row = conn.execute("SELECT id FROM kanban_tasks WHERE id = ?", (key,)).fetchone()
            if not row:
                row = conn.execute("SELECT id FROM kanban_tasks WHERE titulo LIKE ? ORDER BY updated_at DESC LIMIT 1", (f"%{key}%",)).fetchone()
            if not row:
                return f"Tarefa não encontrada: {key}"
            t = kanban.move_task(conn, row["id"], args.get("coluna", "todo"))
            return f"Tarefa movida: {t['titulo']} -> {t['task_column']}"
        if name == "criar_habito":
            h = kanban.create_habit(conn, args.get("titulo", ""), args.get("cron", ""), args.get("cor"))
            n = kanban.sync_habit_tasks_today(conn)
            return f"Hábito criado: {h['titulo']} ({h['cron_expr']}, sync={n})"
        if name == "perguntar_ao_usuario":
            return f"[AGUARDANDO USUÁRIO] {args.get('pergunta', '')}"
        return f"Ferramenta desconhecida: {name}"
    except Exception as e:
        return f"Erro em {name}: {e}"


def run_turn(session_id: str, user_input: str, origin: str = "text") -> str:
    conn = db.connect()
    try:
        system = prompts.VOICE_SYSTEM_PROMPT if origin == "voice" else prompts.SYSTEM_PROMPT
        custom = conn.execute("SELECT value FROM settings WHERE key = 'custom_instructions'").fetchone()
        if custom and custom["value"]:
            system += f"\n\n[INSTRUÇÕES DO USUÁRIO]\n{custom['value']}"
        msgs = conn.execute(
            "SELECT role, content FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT 20", (session_id,)
        ).fetchall()
        history = [{"role": r["role"], "content": r["content"]} for r in reversed(msgs) if r["role"] in ("user", "assistant", "system")]
        messages = [{"role": "system", "content": system}, *history, {"role": "user", "content": user_input}]
        if not _deepseek_key():
            return "Configure DEEPSEEK_API_KEY no .env (ou nas Configurações) para ativar o agente."
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
                if fn.get("name") == "perguntar_ao_usuario":
                    return result.replace("[AGUARDANDO USUÁRIO] ", "")
        return messages[-1].get("content", "(limite de passos)") if isinstance(messages[-1], dict) else "(limite de passos)"
    finally:
        conn.close()


def quick_title(first_message: str) -> str:
    words = (first_message or "").strip().split()
    return " ".join(words[:6]) or "Nova Conversa"
