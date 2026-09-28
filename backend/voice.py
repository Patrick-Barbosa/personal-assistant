"""Voice: Groq Whisper STT (stdlib multipart) + Edge-TTS (optional dep)."""
import io
import json
import mimetypes
import urllib.error
import urllib.request
import uuid

from . import config


def groq_transcribe(audio: bytes, mime: str = "audio/webm") -> str:
    # Saved settings override .env (user can rotate keys in the UI).
    key = ""
    from . import db as _db
    try:
        _c = _db.connect()
        try:
            _r = _c.execute("SELECT value FROM settings WHERE key = 'groq_api_key'").fetchone()
            key = (_r["value"] if _r else "") or ""
        finally:
            _c.close()
    except Exception:
        key = ""
    key = key or config.GROQ_API_KEY
    if not key:
        raise RuntimeError("Configure GROQ_API_KEY no .env (ou nas Configurações) para transcrever.")
    boundary = uuid.uuid4().hex
    ext = mimetypes.guess_extension(mime or "") or ".webm"
    buf = io.BytesIO()
    def field(name: str, value: str) -> None:
        buf.write(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n".encode())
    field("model", config.GROQ_MODEL)
    field("language", "pt")
    buf.write(
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"audio{ext}\"\r\nContent-Type: {mime}\r\n\r\n".encode()
    )
    buf.write(audio)
    buf.write(f"\r\n--{boundary}--\r\n".encode())
    req = urllib.request.Request(
        "https://api.groq.com/openai/v1/audio/transcriptions",
        data=buf.getvalue(),
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "User-Agent": "copernico-web/0.1",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return json.loads(resp.read().decode()).get("text", "")
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:300]
        if e.code in (401, 403):
            raise RuntimeError(f"Groq recusou a chave (HTTP {e.code}). Gere outra em console.groq.com e atualize GROQ_API_KEY. Detalhe: {detail}")
        raise RuntimeError(f"Groq HTTP {e.code}: {detail}")


async def edge_tts_mp3(text: str, voice: str = "pt-BR-ThalitaNeural") -> bytes:
    try:
        import edge_tts  # type: ignore  # optional: pip install edge-tts
    except ImportError as e:
        raise RuntimeError("TTS exige 'pip install edge-tts' no servidor.") from e
    import asyncio, tempfile
    from pathlib import Path
    tmp = Path(tempfile.gettempdir()) / f"copernico-{uuid.uuid4().hex}.mp3"
    await edge_tts.Communicate(_strip_md(text), voice).save(str(tmp))
    data = tmp.read_bytes()
    tmp.unlink(missing_ok=True)
    return data


def _strip_md(text: str) -> str:
    import re
    t = re.sub(r"```[\s\S]*?```", " ", text or "")
    t = re.sub(r"\[\[([^\]]+)\]\]", r"\1", t)
    t = re.sub(r"[*_#>~`|]", "", t)
    return re.sub(r"\s+", " ", t).strip()
