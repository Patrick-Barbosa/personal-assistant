"""Runtime config. Same env vars and relative defaults as src-tauri/src/config.rs."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _load_dotenv() -> None:
    """Minimal .env loader (stdlib): KEY=VALUE, ignores comments, never overrides real env."""
    dotenv = ROOT / ".env"
    if not dotenv.exists():
        return
    try:
        for line in dotenv.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            if line.startswith("export "):
                line = line[7:].strip()
            key, _, val = line.partition("=")
            key = key.strip()
            val = val.strip().strip("'\"")
            if key and key not in os.environ:
                os.environ[key] = val
    except OSError:
        pass


_load_dotenv()


def _resolve(val: str | None, default_rel: str) -> Path:
    if val and val.strip():
        p = Path(val.strip())
        return p if p.is_absolute() else ROOT / p
    return ROOT / default_rel


VAULT_PATH = _resolve(os.getenv("VAULT_PATH"), "cofres/default")
OBSIDIAN_VAULT_PATH = _resolve(os.getenv("OBSIDIAN_VAULT_PATH"), "cofres/obsidian")
DB_PATH = _resolve(os.getenv("DB_PATH"), "cofres/cache.db")

DEEPSEEK_API_KEY = (os.getenv("DEEPSEEK_API_KEY") or "").strip()
DEEPSEEK_BASE_URL = (os.getenv("DEEPSEEK_BASE_URL") or "https://api.deepseek.com").strip()
DEEPSEEK_MODEL = (os.getenv("DEEPSEEK_MODEL") or "deepseek-chat").strip()

GROQ_API_KEY = (os.getenv("GROQ_API_KEY") or "").strip()
GROQ_MODEL = (os.getenv("GROQ_MODEL") or "whisper-large-v3-turbo").strip()

BACKEND_PORT = int(os.getenv("BACKEND_PORT") or "8000")
