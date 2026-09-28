"""Vault access: stdlib only. Read-only Obsidian, atomic writes in default vault."""
import os
import re
from pathlib import Path

from . import config

WIKILINK_RE = re.compile(r"\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]")
HIDDEN_PREFIXES = (".", "_", "~")


def _is_hidden(path: Path, root: Path) -> bool:
    try:
        rel = path.relative_to(root)
    except ValueError:
        return True
    return any(
        p.name.startswith(HIDDEN_PREFIXES) or p.name.startswith("$")
        for p in [root, *[root / part for part in rel.parts[:-1]]]
    ) or rel.name.startswith(HIDDEN_PREFIXES)


def list_md_files(vault: Path) -> list[Path]:
    out: list[Path] = []
    if not vault.exists():
        return out
    for dirpath, dirnames, filenames in os.walk(vault):
        dirnames[:] = [d for d in dirnames if not d.startswith(HIDDEN_PREFIXES)]
        for fn in filenames:
            if not fn.endswith(".md") or fn.startswith(HIDDEN_PREFIXES):
                continue
            p = Path(dirpath) / fn
            if not _is_hidden(p, vault):
                out.append(p)
    return sorted(out)


def safe_resolve(vault: Path, identifier: str) -> Path:
    """Accepts relative path, title, or slug. Never escapes vault root."""
    ident = (identifier or "").strip().strip("/")
    candidates = [vault / ident]
    if not ident.endswith(".md"):
        candidates.append(vault / (ident + ".md"))
    for c in candidates:
        try:
            resolved = (vault / c.relative_to(vault)).resolve()
        except ValueError:
            continue
        if resolved == vault.resolve() or vault.resolve() in resolved.parents:
            if resolved.exists():
                return resolved
    # title search fallback
    needle = normalize_title(ident)
    for f in list_md_files(vault):
        if normalize_title(f.stem) == needle or normalize_title(read_title(f)) == needle:
            return f
    raise FileNotFoundError(f"Nota não encontrada: {identifier}")


def normalize_title(s: str) -> str:
    return " ".join((s or "").strip().lower().replace("_", " ").split())


def atomic_write(dest: Path, text: str) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, dest)


def parse_frontmatter(raw: str) -> tuple[dict, str]:
    """Returns (frontmatter dict, body). Minimal YAML-subset parser (key: value)."""
    if not raw.startswith("---"):
        return {}, raw
    end = raw.find("\n---", 3)
    if end == -1:
        return {}, raw
    block = raw[3:end].strip()
    body = raw[end + 4 :].lstrip("\n")
    fm: dict = {}
    for line in block.splitlines():
        if ":" not in line or line.strip().startswith("#"):
            continue
        k, v = line.split(":", 1)
        k, v = k.strip(), v.strip().strip("'\"")
        if v.startswith("[") and v.endswith("]"):
            fm[k] = [x.strip().strip("'\"") for x in v[1:-1].split(",") if x.strip()]
        else:
            fm[k] = v
    return fm, body


def read_note_file(path: Path) -> tuple[dict, str, str]:
    raw = path.read_text(encoding="utf-8", errors="replace")
    fm, body = parse_frontmatter(raw)
    title = str(fm.get("titulo") or fm.get("title") or path.stem)
    return fm, body, title


def read_title(path: Path) -> str:
    try:
        _, _, title = read_note_file(path)
        return title
    except OSError:
        return path.stem


def extract_wikilinks(body: str) -> list[str]:
    return [normalize_title(m.group(1)) for m in WIKILINK_RE.finditer(body or "")]


def sanitize_filename(titulo: str) -> str:
    bad = '<>:"/\\|?*'
    name = "".join(c for c in (titulo or "Sem título").strip() if c not in bad).strip()
    return name[:120] or "Sem título"


def vault_of(path: Path) -> str:
    try:
        path.resolve().relative_to(config.OBSIDIAN_VAULT_PATH.resolve())
        return "obsidian"
    except ValueError:
        return "default"
