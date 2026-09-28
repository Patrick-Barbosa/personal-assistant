# AGENTS.md — Copernico (beginner version)

Web-only personal assistant: chat + kanban board. No Rust, no voice, no vault.

## Stack
- Backend: Python stdlib only (`backend/*.py`, `http.server` + `sqlite3` + `urllib`).
- Frontend: React 19 + TypeScript + Vite + Tailwind v4 (`src/`, 8 files).
- DB: single SQLite file (`cofres/cache.db`, see `DB_PATH`).

## Layout
- `backend/server.py` — all HTTP routes (chat, sessions, tasks).
- `backend/kanban.py` — flat board logic (todo/doing/done).
- `backend/agent.py` — DeepSeek loop + 3 tools (listar/criar/mover tarefa).
- `backend/db.py` + `backend/schema.sql` — SQLite helper + schema.
- `backend/config.py` — env vars (`.env`: `DEEPSEEK_API_KEY`).
- `src/api.ts` — the only place that calls the backend. Components never `fetch` directly.
- `src/types.ts` — shared types (`Session`, `Message`, `Task`, `Board`).
- `src/App.tsx` — shell: Chat tab + Board tab + session list.
- `src/components/ChatView.tsx`, `src/components/BoardView.tsx` — the two views.

## Rules
1. Keep it beginner-readable: plain functions, no abstractions for one use-case.
2. New backend route? Add it in `server.py`, expose it in `src/api.ts`, use it from a component.
3. Never commit `.env`, `*.db`, `node_modules/`, `__pycache__/`.
4. Copy in pt-BR for all user-facing text.

## Verify
```sh
python3 backend/smoke_test.py   # backend, temp DB
pnpm build                      # frontend (tsc + vite)
```

## Run (daily)
```sh
sh start_web.sh                 # backend :8000 + Vite :1420
```
