# AGENTS.md — Copernico (beginner version)

Web-only personal assistant: chat + kanban board. No Rust, no voice, no vault.

## Stack
- Backend: Python stdlib only (`backend/*.py`, `http.server` + `sqlite3` + `urllib`). Zero pip deps.
- Frontend: React 19 + TypeScript + Vite + Tailwind v4 (`src/`, 8 files). UI libs: `@base-ui/react` (Dialog/Checkbox/Switch/Slider), `@dnd-kit/*` (Semana drag todo/doing/done), `recharts` (Métricas), `react-markdown`+`remark-gfm` (task .md), `diff`+`@git-diff-view/*` (AI suggestion diff), `lucide-react` (icons), `date-fns` (Semana/streak).
- DB: single SQLite file (`cofres/cache.db` via `DB_PATH`). Old DBs keep working — schema is additive (`tasks` table); delete the file for a fully fresh start.

## Layout
- `backend/server.py` — all HTTP routes (chat, sessions, tasks).
- `backend/kanban.py` — flat board logic (todo/doing/done).
- `backend/agent.py` — DeepSeek loop + 3 tools (listar/criar/mover tarefa).
- `backend/db.py` + `backend/schema.sql` — SQLite helper + schema.
- `backend/config.py` — env vars (`.env`: `DEEPSEEK_API_KEY`).
- `src/api.ts` — the only place that calls the backend (base URL hardcoded `http://127.0.0.1:8000`). Components never `fetch` directly.
- `src/types.ts` — shared types (`Session`, `Message`, `Task`, `Board`).
- `src/App.tsx` — shell: Chat tab + Board tab + session list.
- `src/components/ChatView.tsx`, `src/components/BoardView.tsx` — the two views.

## Rules
1. Keep it beginner-readable: plain functions, no abstractions for one use-case.
2. New backend route? Add it in `server.py`, expose it in `src/api.ts`, use it from a component.
3. Never commit `.env`, `*.db`, `node_modules/`, `__pycache__/`. Commit `pnpm-lock.yaml` whenever `package.json` changes.
4. Copy in pt-BR for all user-facing text.
5. Tool permissions live in `opencode.json`: `cofres/obsidian/` is read-only, `.env`/`*.db` are unreadable — don't try to open them.

## Gotchas (learned the hard way)
- Bare `rm`/`rm -rf` in shell is denied by `opencode.json`. Delete tracked files with `git rm`, untracked with `git clean -fd <path>`.
- `write`/`edit` do not `git add`. Stage explicitly before every commit.
- Backend has no hot reload: restart `python3 -m backend.server` after any `backend/*.py` change. Vite hot-reloads frontend automatically.
- After editing `package.json`, run `pnpm install` before `pnpm build`.

## Verify / run
```sh
python3 backend/smoke_test.py   # backend, temp DB (10 checks)
pnpm build                      # frontend (tsc + vite)
sh start_web.sh                 # daily: backend :8000 + Vite :1420
```
