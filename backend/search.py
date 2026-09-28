"""Local search over vaults: term-overlap scoring (FTS-lite, stdlib)."""
import math
import re
from pathlib import Path

from . import config, vault

TOKEN_RE = re.compile(r"[a-z0-9à-ÿ]{2,}", re.IGNORECASE)


def tokens(s: str) -> list[str]:
    return TOKEN_RE.findall((s or "").lower())


def search(query: str, limit: int = 8) -> list[dict]:
    q = tokens(query)
    if not q:
        return []
    results: list[dict] = []
    for root, vname in ((config.VAULT_PATH, "default"), (config.OBSIDIAN_VAULT_PATH, "obsidian")):
        for f in vault.list_md_files(root):
            try:
                fm, body, title = vault.read_note_file(f)
            except OSError:
                continue
            text = f"{title}\n{body}"
            toks = tokens(text)
            if not toks:
                continue
            tf = sum(toks.count(t) for t in set(q) if t in toks)
            if not tf:
                continue
            score = tf / math.sqrt(len(toks))
            rel = str(f.relative_to(root))
            preview = (body or "")[:220].replace("\n", " ")
            results.append({
                "path": f"/{vname}/{rel}",
                "file_path": f"/{vname}/{rel}",
                "titulo": title,
                "title": title,
                "score": round(score, 4),
                "preview": preview,
                "vault": vname,
                "categoria": fm.get("categoria"),
            })
    results.sort(key=lambda r: r["score"], reverse=True)
    return results[:limit]


def list_titles() -> list[dict]:
    out: list[dict] = []
    for root, vname in ((config.VAULT_PATH, "default"), (config.OBSIDIAN_VAULT_PATH, "obsidian")):
        for f in vault.list_md_files(root):
            rel = str(f.relative_to(root))
            out.append({"title": vault.read_title(f), "vault": vname, "path": f"/{vname}/{rel}"})
    return sorted(out, key=lambda x: x["title"].lower())


def graph() -> dict:
    nodes: list[dict] = []
    links: list[dict] = []
    known: dict[str, str] = {}
    for root, vname in ((config.VAULT_PATH, "default"), (config.OBSIDIAN_VAULT_PATH, "obsidian")):
        for f in vault.list_md_files(root):
            rel = str(f.relative_to(root))
            title = vault.read_title(f)
            nid = f"{vname}:{rel}"
            known[vault.normalize_title(title)] = title
            try:
                fm, body, _ = vault.read_note_file(f)
                tags = fm.get("tags") or []
                if isinstance(tags, str):
                    tags = [tags]
            except OSError:
                tags, body = [], ""
            nodes.append({"id": title, "title": title, "vault": vname, "path": f"/{vname}/{rel}", "tags": tags})
            for target in vault.extract_wikilinks(body):
                links.append({"source": title, "target": target})
    titles = {n["id"] for n in nodes}
    links = [l for l in links if l["target"] in {vault.normalize_title(t) for t in titles} or True][:5000]
    # resolve normalized targets back to display titles when possible
    norm_to_display = {vault.normalize_title(n["id"]): n["id"] for n in nodes}
    fixed = []
    for l in links:
        tgt = norm_to_display.get(l["target"], l["target"])
        if tgt in titles:
            fixed.append({"source": l["source"], "target": tgt})
    return {"nodes": nodes, "links": fixed}
