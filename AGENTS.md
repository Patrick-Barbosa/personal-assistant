# AGENTS.md — Tiba

Solo weekly OS: chat com IA sobre notas + hábitos diários + planejamento semanal + notas .md + métricas. Web only (Vite + Python stdlib). Copy da UI em pt-BR.

## Stack
- Backend: Python stdlib only (`backend/*.py`: `http.server` + `sqlite3` + `urllib`). Zero pip deps. Usa `.venv/bin/python` se existir, senão `python3`.
- Frontend: React 19 + TS + Vite + Tailwind v4. Headless, estilizado por nós: `@base-ui/react` (Dialog/Checkbox), `@dnd-kit/core` (drag na Semana), `recharts` (Métricas), `react-markdown`+`remark-gfm` (.md), `diff`+`@git-diff-view/*` (diff de sugestão), `lucide-react`, `date-fns`.
- DB: um SQLite (`cofres/cache.db`, via `DB_PATH`). Schema aditivo — `db.py:_migrate_*` mantém DBs antigos funcionando; apagar o arquivo = recomeço total.
- Design: `docs/design.md` (Flim: Canvas `#f5f5f5`, Ink `#141414`, radii 8/16/160, sem sombras, monocromático — sem verde).

## Layout
- `backend/server.py` — todas as rotas. `backend/kanban.py` — tasks (todo/doing/done + `place_task` p/ dias). `backend/habits.py` — hábitos (máx 10) + `ensure_habit_tasks` (cria/corrige 1 task por hábito/dia). `backend/agent.py` — loop DeepSeek + 6 tools + config da IA (`GET/PATCH /api/agent`: persona, comportamento, temperatura). `backend/audio.py` — STT via Groq Whisper (`POST /api/stt`). `backend/categories.py`, `backend/metrics.py`, `backend/config.py` (env: `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL`, `DEEPSEEK_BASE_URL`, `GROQ_API_KEY`, `GROQ_STT_MODEL`, `DB_PATH`, `BACKEND_PORT`; loader `.env` próprio, nunca sobrescreve env real).
- `src/api.ts` — único lugar que chama o backend (BASE hardcoded `http://127.0.0.1:8000`; se mudar a porta, atualize aqui). Componentes nunca fazem `fetch`.
- `src/App.tsx` — shell com 5 abas: Hoje, Chat, Semana, Notas, Métricas. Views em `src/components/`: `HojeView`, `ChatView` (mic via Groq STT + leitura nativa), `AgentConfig` (dialog Configurar IA), `BoardView` (Semana), `NotasView`, `MetricasView`, `TaskDetail` (overlay).
- Notas do usuário ficam no SQLite; `cofres/obsidian/` é dado pessoal externo (só leitura).

## Regras
1. Beginner-readable: funções simples, sem abstração p/ um uso só.
2. Rota nova? `server.py` → expor em `src/api.ts` → usar no componente.
3. Nunca commitar: `.env`, `*.db*`, `node_modules/`, `__pycache__/`, `dist/`, `cofres/obsidian/`, `.venv/`. Commite `pnpm-lock.yaml` se `package.json` mudar.
4. Categoria `habitos` é fixa e herdada por toda task de hábito (`HABIT_CATEGORY` em `habits.py`); usuário não edita. Se excluída, `ensure_habit_tasks` recria no próximo `/api/hoje`.
5. Permissões em `opencode.json`: `cofres/obsidian/` read-only, `.env`/`*.db` ilegíveis, `rm` negado — não tente abrir nem apagar por esses caminhos.

## Gotchas (custo real)
- Backend **sem hot reload** e Vite pode servir transform **stale**: página em branco ou comportamento antigo após editar = processos presos. Mate tudo e recomece, depois hard-reload (`Ctrl+Shift+R`):
  ```sh
  pkill -f "vite --port 1420"; pkill -f "backend.server"; sleep 1
  sh start_web.sh   # backend :8000 + Vite :1420, abre o navegador, mata o backend ao sair
  ```
  Backend stale também desativa features em silêncio (confira o header `Server:` em `/api/health`).
- `write`/`edit` não dão `git add`. Deletar rastreado: `git rm`; não rastreado: `git clean -fd <path>`.
- `package.json` mudou? Rode `pnpm install` antes de `pnpm build`.
- Smoke test usa DB temporário (`DB_PATH`) na porta 8479 — nunca toca o `cofres/cache.db` real.

## Verify / run
```sh
python3 backend/smoke_test.py   # backend em DB temp (~37 checks)
pnpm build                      # frontend (tsc + vite; sem lint separado)
sh start_web.sh                 # dia a dia
```
