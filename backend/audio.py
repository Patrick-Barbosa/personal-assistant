"""Speech-to-text via Groq Whisper (OpenAI-compatible). Stdlib only."""
import json
import urllib.error
import urllib.request
import uuid

from . import config

MAX_AUDIO_BYTES = 10 * 1024 * 1024


def _ext_for(mime: str) -> str:
    mime = (mime or "").split(";")[0].strip().lower()
    if mime in ("audio/mp4", "audio/m4a", "audio/x-m4a"):
        return "m4a"
    if mime in ("audio/ogg", "audio/opus"):
        return "ogg"
    if mime == "audio/wav":
        return "wav"
    return "webm"


def transcribe(raw: bytes, mime: str = "") -> str:
    """Envia o áudio ao Whisper da Groq e devolve o texto em português."""
    key = config.GROQ_API_KEY
    if not key:
        raise RuntimeError("Configure GROQ_API_KEY no .env para transcrever áudio.")
    if not raw:
        raise ValueError("Áudio vazio.")
    if len(raw) > MAX_AUDIO_BYTES:
        raise ValueError("Áudio muito longo (máx ~10 MB). Grave trechos menores.")
    filename = f"audio.{_ext_for(mime)}"
    ctype = (mime or "audio/webm").split(";")[0].strip() or "audio/webm"
    boundary = uuid.uuid4().hex
    parts: list[bytes] = []

    def field(name: str, value: str) -> None:
        parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n".encode())

    field("model", config.GROQ_STT_MODEL)
    field("language", "pt")
    field("response_format", "json")
    parts.append(
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\nContent-Type: {ctype}\r\n\r\n".encode()
    )
    parts.append(raw)
    parts.append(f"\r\n--{boundary}--\r\n".encode())
    # Groq fica atrás da Cloudflare, que barra o User-Agent padrão do urllib
    # (HTTP 403 "error code: 1010" — parece chave inválida, mas não é).
    req = urllib.request.Request(
        config.GROQ_BASE_URL.rstrip("/") + "/audio/transcriptions",
        data=b"".join(parts),
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "User-Agent": "Tiba/0.3",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            payload = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:300]
        if e.code in (401, 403):
            raise RuntimeError(f"Groq recusou a chave (HTTP {e.code}). Confira GROQ_API_KEY. Detalhe: {detail}")
        raise RuntimeError(f"Groq HTTP {e.code}: {detail}")
    text = (payload.get("text") or "").strip()
    if not text:
        raise RuntimeError("Groq não retornou transcrição.")
    return text
