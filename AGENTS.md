# AGENTS.md

## Project

Second Brain — PySide6 (Qt6) desktop overlay with pynput global hotkey, sounddevice + Groq Whisper STT, DeepSeek LLM with Tool Calling, FastEmbed local embeddings (ONNX/CPU), SQLite history, local Markdown vault (`cofres/`). Python >=3.11, `uv` + `pyproject.toml`, hatchling.

## Commands

- Tests (68 passing): `.venv\Scripts\python.exe -m pytest scripts/testes/ -v`
  - Single file: `.venv\Scripts\python.exe -m pytest scripts/testes/test_vault.py -v`
  - Single test: `.venv\Scripts\python.exe -m pytest scripts/testes/test_agent_core.py -k test_name -v`
  - Config: `testpaths=["scripts/testes"]`, `pythonpath=["."]` — run from repo root, imports as `from scripts.funcional.<module> import ...`
- Run app: `start.bat` (creates `logs/app_YYYY-MM-DD_HH-mm-ss.log` + `logs/latest.log`, runs `.venv\Scripts\python.exe valid_usuario/valid_sprint05.py`) or `.venv\Scripts\python.exe valid_usuario/valid_sprint05.py` directly
- Sprint validators: `.venv\Scripts\python.exe valid_usuario/valid_sprint0N.py` (N=1..5) — CLI fallback auto-activates if PySide6 unavailable
- Install: `uv sync` or `uv pip install -e ".[dev]"` — `.venv` is gitignored, checked into repo root

## Environment

- `.env` is gitignored — copy from `.env.example`. Variables: `VAULT_PATH` (default `cofres/default`), `OBSIDIAN_VAULT_PATH`, `DEEPSEEK_API_KEY/BASE_URL/MODEL`, `GROQ_API_KEY/MODEL`, `DB_PATH` (`cofres/cache.db`), `HOTKEY` (current `.env`/`.env.example`: `right_shift` — display-only; the Sprint05 overlay listener is hardcoded to Right Shift)
- `load_dotenv()` in every functional module; `valid_sprint05.py` does `load_dotenv(override=True)` on each hotkey read — stale env is a real bug
- `DB_PATH=:memory:` is the test hook (SQLite in-RAM) — `ChatManager` handles it as special case in `scripts/funcional/chat_manager.py:22`

## Architecture — Where Things Live

- `agent/01_PROJECT_SPEC.md`, `02_ARCHITECTURE.md`, `03_SPRINTS.md`, `AGENT_RULES.md` — spec (pt-BR)
- `scripts/funcional/vault.py` — Sprint01: atomic Markdown CRUD, YAML frontmatter, filename sanitization
- `scripts/funcional/indexer.py` — Sprint02: FastEmbed + SQLite cosine search (MultiVaultIndexer/ObsidianIndexer/VaultIndexer)
- `scripts/funcional/agent_core.py` — Sprint03: DeepSeek Tool Calling + Groq STT
- `scripts/funcional/chat_manager.py` — Sprint04: SQLite sessions/messages (FK CASCADE)
- `scripts/funcional/overlay_ui.py` — Sprint05: PySide6 frameless overlay, Raycast bar, sidebar `_SessionRow`
- `scripts/testes/test_*.py` — pytest (incl. `test_obsidian_indexer.py`)
- `valid_usuario/valid_sprint0N.py` — interactive validators (one per sprint)
- `cofres/default/` — writable vault (agent writes here only)
- `cofres/obsidian/` — read-only reference vault (synced, many hidden dirs)
- `cofres/cache.db` — SQLite: sessions + messages + vector cache
- `assets/start-recording.mp3` — played on hold-to-talk

## Quirks and Gotchas

- No heavy orchestration: never add LangChain/LlamaIndex/ChromaDB — use direct SDKs (`openai`/`groq`/`fastembed`/`PySide6`) per `agent/AGENT_RULES.md`.
- Vault duality: `cofres/obsidian` is read-only — `salvar_nota`/`atualizar_nota` write only to `cofres/default`. Search results include `vault` field (`"obsidian"|"default"`); cite `titulo + vault + score`.
- VaultManager (`scripts/funcional/vault.py:1`): atomic write via temp-file + rename, `pathlib.Path` only, filters hidden dirs (`.obsidian`, `.trash`, `.stfolder`, `.Android`, `.copilot-index`, `.thumbcache`) and supports `recursive=True` for Obsidian. Filename sanitization: `<>:"/\|?*` + Windows reserved names.
- Indexer model mapping (`scripts/funcional/indexer.py:22`): spec says `intfloat/multilingual-e5-small` but `fastembed>=0.3` maps it to `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` via `_LEGACY_MODEL_MAP`. Do not change model string blindly — tests expect the mapped name. Warning suppressed via `warnings.filterwarnings`.
- Overlay threading (`scripts/funcional/overlay_ui.py`): pynput runs on its own thread — timing vars (`_key_press_time`, `_held_duration_snapshot`) must be captured there. `QMediaPlayer` must run on Qt main thread — use `_sound_requested` Signal -> `_do_play_mp3_sound` slot pattern. `winsound.Beep` in daemon thread is fallback; sound requires persistent `QMediaPlayer(self)`. `sys.stdout.reconfigure(encoding="utf-8")` at import prevents cp1252 crash.
- Hotkey: the Sprint05 overlay global hotkey is Right Shift only (`keyboard.Key.shift_r`, press+release with hold-to-talk) — `HOTKEY` in `.env` is display-only. `valid_sprint05.py` starts the overlay hidden (only the console is visible); if the hotkey listener fails to start, the window is shown as fallback. Tap (<200ms) shows the overlay; hold starts voice recording.
- Sprint delivery constraint (`agent/AGENT_RULES.md`): each sprint = exactly 3 files (`scripts/funcional/<modulo>.py`, `scripts/testes/test_<modulo>.py`, `valid_usuario/valid_sprintXX.py`). Do not advance sprint or modify prior sprint files without explicit authorization.
- Type hints + imports: strict type hints everywhere, imports from project root (`from scripts.funcional.vault import VaultManager`), never relative.
- No TODOs: `agent/AGENT_RULES.md` forbids `# TODO` — every delivered file must be runnable. Wrap disk/network ops in `try/except` with descriptive messages.

## Tests

- 68 tests, all passing. DB isolation: tests pass `db_path=":memory:"` to `ChatManager`; do not write to `cofres/cache.db` from tests.
- No linter/formatter/CI configured — `pyproject.toml` only defines `[tool.pytest.ini_options]`.

## Reference

- Spec and sprints: `agent/01_PROJECT_SPEC.md`, `agent/02_ARCHITECTURE.md`, `agent/03_SPRINTS.md`
- Immutable rules: `agent/AGENT_RULES.md`
