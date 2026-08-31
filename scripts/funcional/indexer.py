"""VaultIndexer — Sprint 02: Embeddings locais e busca semântica.

FastEmbed (ONNX/CPU) + cache SQLite para similaridade de cosseno.
Resolução de paths via pathlib + .env, import raiz (scripts.funcional.*).
"""

from __future__ import annotations

import hashlib
import os
import sqlite3
import warnings
from pathlib import Path
from typing import Any

import frontmatter
import numpy as np
from dotenv import load_dotenv

# Silencia warning cosmético do fastembed 0.8 sobre pooling do modelo multilíngue
warnings.filterwarnings(
    "ignore",
    category=UserWarning,
    message=r"The model sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2.*",
)

from scripts.funcional.vault import VaultManager

load_dotenv()

# Mapeamento de modelos legados da spec para modelos suportados no fastembed 0.8+
_LEGACY_MODEL_MAP: dict[str, str] = {
    "intfloat/multilingual-e5-small": "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
    "intfloat/multilingual-e5-base": "intfloat/multilingual-e5-large",
}

_DEFAULT_MODEL: str = os.getenv(
    "EMBEDDING_MODEL", "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
)
# Se spec pedir e5-small, mapeia automaticamente
if _DEFAULT_MODEL in _LEGACY_MODEL_MAP:
    _DEFAULT_MODEL = _LEGACY_MODEL_MAP[_DEFAULT_MODEL]

_FALLBACK_MODELS: list[str] = [
    "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
    "BAAI/bge-small-en-v1.5",
    "sentence-transformers/all-MiniLM-L6-v2",
]


def _project_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent


def _resolve_db_path(db_path: Path | str | None) -> Path:
    if db_path is not None:
        raw: Path = Path(db_path)
    else:
        env: str | None = os.getenv("DB_PATH")
        raw = Path(env) if env else Path("cofres/cache.db")
    if not raw.is_absolute():
        raw = (_project_root() / raw).resolve()
    else:
        raw = raw.resolve()
    return raw


def _hash_content(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Calcula cosseno entre dois vetores 1-D."""
    denom: float = float(np.linalg.norm(a) * np.linalg.norm(b))
    if denom == 0:
        return 0.0
    return float(np.dot(a, b) / denom)


def _needs_e5_prefix(model_name: str) -> bool:
    return "e5" in model_name.lower()


class VaultIndexer:
    """Indexador semântico local para o cofre Markdown."""

    def __init__(
        self,
        vault: VaultManager | None = None,
        db_path: Path | str | None = None,
        model_name: str | None = None,
    ) -> None:
        """Inicializa indexer.

        Args:
            vault: VaultManager existente ou None (cria novo via VAULT_PATH).
            db_path: Caminho do SQLite; se None usa DB_PATH/.env ou cofres/cache.db
            model_name: Nome do modelo fastembed; se None usa EMBEDDING_MODEL ou fallback.
        """
        self.vault: VaultManager = vault or VaultManager()

        requested: str = model_name or _DEFAULT_MODEL
        # Aplica mapeamento legado se necessário
        self.model_name: str = _LEGACY_MODEL_MAP.get(requested, requested)

        self.db_path: Path = _resolve_db_path(db_path)
        self._model: Any | None = None  # TextEmbedding lazy
        self._dim: int | None = None

        self._ensure_db()

    # ------------------------------------------------------------------
    # DB helpers
    # ------------------------------------------------------------------
    def _ensure_db(self) -> None:
        try:
            self.db_path.parent.mkdir(parents=True, exist_ok=True)
            with sqlite3.connect(str(self.db_path)) as conn:
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS vault_index (
                        path TEXT PRIMARY KEY,
                        hash TEXT NOT NULL,
                        embedding BLOB NOT NULL,
                        dim INTEGER NOT NULL,
                        titulo TEXT,
                        mtime REAL NOT NULL
                    )
                    """
                )
                conn.commit()
        except sqlite3.Error as exc:
            raise RuntimeError(f"Falha ao inicializar SQLite '{self.db_path}': {exc}") from exc

    def _get_model(self) -> Any:
        """Lazy load TextEmbedding com fallback automático."""
        if self._model is not None:
            return self._model

        import warnings as _w

        from fastembed import TextEmbedding

        candidates: list[str] = [self.model_name] + [m for m in _FALLBACK_MODELS if m != self.model_name]

        last_exc: Exception | None = None
        for cand in candidates:
            try:
                # TextEmbedding pode baixar modelo na primeira chamada; suprime UserWarning de pooling
                with _w.catch_warnings():
                    _w.simplefilter("ignore", UserWarning)
                    model: Any = TextEmbedding(cand)
                # Teste rápido de embedding para validar
                # Não precisa fazer aqui, apenas instancia
                self._model = model
                self.model_name = cand
                return model
            except Exception as exc:  # noqa: BLE001
                last_exc = exc
                continue

        raise RuntimeError(f"Falha ao carregar modelo de embeddings (tentados {candidates}): {last_exc}") from last_exc

    def _embed_texts(self, texts: list[str], is_query: bool = False) -> list[np.ndarray]:
        """Gera embeddings para lista de textos."""
        if not texts:
            return []

        # Prefixo e5 se necessário
        if _needs_e5_prefix(self.model_name):
            prefix: str = "query: " if is_query else "passage: "
            texts = [f"{prefix}{t}" for t in texts]

        try:
            model: Any = self._get_model()
            # fastembed retorna gerador de np.ndarray
            embeddings: list[np.ndarray] = list(model.embed(texts))
            # Normaliza dtype para float32 para consistência no cache
            normalized: list[np.ndarray] = [np.asarray(e, dtype=np.float32) for e in embeddings]
            if normalized:
                self._dim = int(normalized[0].shape[0])
            return normalized
        except Exception as exc:
            raise RuntimeError(f"Falha ao gerar embeddings: {exc}") from exc

    def _build_doc_text(self, titulo: str, corpo: str, tags: list[str], topicos: list[str]) -> str:
        """Constrói texto representativo da nota para embedding (PT-BR aware)."""
        parts: list[str] = [f"Título: {titulo}", corpo.strip()]
        if tags:
            parts.append(f"Tags: {', '.join(tags)}")
        if topicos:
            parts.append(f"Tópicos: {', '.join(topicos)}")
        # Limita tamanho para evitar truncamento excessivo (fastembed trunca em 512 tokens)
        text: str = "\n".join(parts)
        # Corte simples em chars (aprox 2000 chars ~ 500 tokens)
        if len(text) > 8000:
            text = text[:8000]
        return text

    # ------------------------------------------------------------------
    # Indexação
    # ------------------------------------------------------------------
    def _upsert_embedding(
        self, path: Path, file_hash: str, embedding: np.ndarray, titulo: str, mtime: float
    ) -> None:
        try:
            blob: bytes = embedding.astype(np.float32).tobytes()
            dim: int = int(embedding.shape[0])
            with sqlite3.connect(str(self.db_path)) as conn:
                conn.execute(
                    """
                    INSERT INTO vault_index (path, hash, embedding, dim, titulo, mtime)
                    VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT(path) DO UPDATE SET
                        hash=excluded.hash,
                        embedding=excluded.embedding,
                        dim=excluded.dim,
                        titulo=excluded.titulo,
                        mtime=excluded.mtime
                    """,
                    (str(path.resolve()), file_hash, blob, dim, titulo, mtime),
                )
                conn.commit()
        except sqlite3.Error as exc:
            raise RuntimeError(f"Falha ao persistir embedding para '{path}': {exc}") from exc

    def indexar_nota(self, identifier: str | Path) -> bool:
        """Indexa/Atualiza uma única nota. Retorna True se (re)indexou, False se cache hit."""
        # Resolve path via vault
        try:
            # Tenta resolver via VaultManager para suportar título
            vault_path: Path = self.vault._resolve_path(identifier)  # type: ignore[attr-defined]
            if not vault_path.exists():
                raise FileNotFoundError(f"Nota não encontrada: {identifier}")
            path: Path = vault_path.resolve()
        except Exception as exc:
            raise FileNotFoundError(f"Nota não encontrada: {identifier} ({exc})") from exc

        try:
            post: frontmatter.Post = frontmatter.load(str(path))
        except Exception as exc:
            raise ValueError(f"Falha ao ler nota '{path}': {exc}") from exc

        titulo: str = str(post.get("titulo", path.stem))
        corpo: str = post.content or ""
        tags: list[str] = list(post.get("tags", []))
        topicos: list[str] = list(post.get("topicos", []))

        doc_text: str = self._build_doc_text(titulo, corpo, tags, topicos)
        file_hash: str = _hash_content(doc_text)
        mtime: float = path.stat().st_mtime

        # Verifica cache hit
        try:
            with sqlite3.connect(str(self.db_path)) as conn:
                cur: sqlite3.Cursor = conn.execute("SELECT hash FROM vault_index WHERE path = ?", (str(path),))
                row: tuple[str] | None = cur.fetchone()  # type: ignore[assignment]
                if row is not None and row[0] == file_hash:
                    # Verifica se mtime também bate para evitar re-embed desnecessário
                    return False
        except sqlite3.Error as exc:
            raise RuntimeError(f"Falha ao consultar cache: {exc}") from exc

        # Gera embedding
        embedding: np.ndarray = self._embed_texts([doc_text], is_query=False)[0]
        self._upsert_embedding(path, file_hash, embedding, titulo, mtime)
        return True

    def index_note(self, identifier: str | Path) -> bool:
        return self.indexar_nota(identifier)

    def reindexar_tudo(self, force: bool = False) -> int:
        """Reindexa todas as notas do cofre. Retorna qtd de arquivos (re)indexados."""
        try:
            notas: list[Path] = self.vault.listar_notas()
        except OSError as exc:
            raise RuntimeError(f"Falha ao listar notas: {exc}") from exc

        # Remove entradas órfãs (arquivos deletados)
        try:
            with sqlite3.connect(str(self.db_path)) as conn:
                cur = conn.execute("SELECT path FROM vault_index")
                rows: list[tuple[str]] = cur.fetchall()
                for (p_str,) in rows:
                    if not Path(p_str).exists():
                        conn.execute("DELETE FROM vault_index WHERE path = ?", (p_str,))
                conn.commit()
        except sqlite3.Error as exc:
            raise RuntimeError(f"Falha ao limpar índice órfão: {exc}") from exc

        count: int = 0
        for nota_path in notas:
            try:
                # Se force, deleta cache antes para forçar re-embed
                if force:
                    try:
                        with sqlite3.connect(str(self.db_path)) as conn:
                            conn.execute("DELETE FROM vault_index WHERE path = ?", (str(nota_path.resolve()),))
                            conn.commit()
                    except sqlite3.Error:
                        pass
                did: bool = self.indexar_nota(nota_path)
                if did or force:
                    count += 1
            except Exception as exc:
                # Loga mas não interrompe lote
                print(f"[WARN] Falha ao indexar '{nota_path.name}': {exc}")
                continue
        return count

    def reindex_all(self, force: bool = False) -> int:
        return self.reindexar_tudo(force=force)

    def limpar_indice(self) -> None:
        """Remove todo o cache vetorial."""
        try:
            with sqlite3.connect(str(self.db_path)) as conn:
                conn.execute("DELETE FROM vault_index")
                conn.commit()
        except sqlite3.Error as exc:
            raise RuntimeError(f"Falha ao limpar índice: {exc}") from exc

    def clear_index(self) -> None:
        return self.limpar_indice()

    # ------------------------------------------------------------------
    # Busca
    # ------------------------------------------------------------------
    def buscar_notas(self, query: str, top_k: int = 5) -> list[dict[str, Any]]:
        """Busca semântica por similaridade de cosseno.

        Args:
            query: Pergunta/termo em pt-BR ou en.
            top_k: Quantidade de resultados.

        Returns:
            Lista ordenada (maior score primeiro) com dicts:
            {path, titulo, score, preview, hash}
        """
        if not query or not query.strip():
            raise ValueError("query não pode ser vazia.")
        if top_k <= 0:
            raise ValueError("top_k deve ser > 0.")

        # Garante índice atualizado para arquivos novos/modificados
        # Estratégia leve: reindexa apenas se houver arquivos sem cache
        try:
            notas: list[Path] = self.vault.listar_notas()
            with sqlite3.connect(str(self.db_path)) as conn:
                cur = conn.execute("SELECT COUNT(*) FROM vault_index")
                (cached_count,) = cur.fetchone()  # type: ignore[misc]
                if cached_count != len(notas):
                    # Há divergência → reindexa incrementalmene
                    self.reindexar_tudo(force=False)
        except Exception:
            # Se falhar checagem, tenta reindexar tudo silenciosamente
            pass

        # Embed query
        try:
            q_emb: np.ndarray = self._embed_texts([query.strip()], is_query=True)[0]
        except Exception as exc:
            raise RuntimeError(f"Falha ao vetorizar query: {exc}") from exc

        # Carrega todos os embeddings
        try:
            with sqlite3.connect(str(self.db_path)) as conn:
                cur = conn.execute("SELECT path, hash, embedding, dim, titulo, mtime FROM vault_index")
                rows: list[tuple[str, str, bytes, int, str, float]] = cur.fetchall()
        except sqlite3.Error as exc:
            raise RuntimeError(f"Falha ao ler índice: {exc}") from exc

        if not rows:
            return []

        results: list[dict[str, Any]] = []
        for p_str, f_hash, blob, dim, titulo, mtime in rows:
            try:
                emb: np.ndarray = np.frombuffer(blob, dtype=np.float32)
                if emb.size != dim:
                    # Tenta recuperar mesmo com dim divergente (fallback)
                    emb = emb[:dim] if emb.size > dim else emb
                score: float = _cosine_similarity(q_emb, emb)
                path: Path = Path(p_str)
                # Preview: primeiras linhas do corpo
                preview: str = ""
                try:
                    _, corpo = self.vault.ler_nota(path)
                    preview = " ".join(corpo.strip().split())[:160]
                    if len(corpo.strip()) > 160:
                        preview += "…"
                except Exception:
                    preview = titulo
                results.append(
                    {
                        "path": path,
                        "titulo": titulo,
                        "score": score,
                        "preview": preview,
                        "hash": f_hash,
                    }
                )
            except Exception as exc:
                print(f"[WARN] Falha ao computar similaridade para '{p_str}': {exc}")
                continue

        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:top_k]

    def search(self, query: str, top_k: int = 5) -> list[dict[str, Any]]:
        return self.buscar_notas(query, top_k=top_k)

    # Compat: alias usado pelo agente
    def buscar(self, query: str, top_k: int = 5) -> list[dict[str, Any]]:
        return self.buscar_notas(query, top_k=top_k)

    def get_stats(self) -> dict[str, Any]:
        """Retorna estatísticas do índice."""
        try:
            with sqlite3.connect(str(self.db_path)) as conn:
                cur = conn.execute("SELECT COUNT(*), GROUP_CONCAT(titulo, '|') FROM vault_index")
                count, titles = cur.fetchone()
                return {
                    "model": self.model_name,
                    "db_path": str(self.db_path),
                    "count": int(count or 0),
                    "dim": self._dim,
                }
        except sqlite3.Error as exc:
            raise RuntimeError(f"Falha ao obter stats: {exc}") from exc


# ---------------------------------------------------------------------------
# ObsidianIndexer — indexador para cofre Obsidian (recursivo, sem frontmatter obrigatório)
# ---------------------------------------------------------------------------

class ObsidianIndexer(VaultIndexer):
    """Indexador semântico para cofre Obsidian com sub-pastas.

    Diferenças em relação ao VaultIndexer padrão:
    - Usa tabela SQLite separada ``obsidian_index`` (mesmo arquivo cache.db).
    - Funciona com notas sem YAML frontmatter: extrai título do H1 ou do stem do arquivo.
    - Injeta a sub-pasta como categoria virtual nas tags para melhorar a busca.
    - O cofre é tratado como somente-leitura; operações de escrita não são permitidas.
    """

    _TABLE: str = "obsidian_index"

    def __init__(
        self,
        vault_path: Path | str | None = None,
        db_path: Path | str | None = None,
        model_name: str | None = None,
    ) -> None:
        """Inicializa ObsidianIndexer.

        Args:
            vault_path: Caminho do vault Obsidian; se None lê OBSIDIAN_VAULT_PATH do .env
                        ou usa o default ``cofres/obsidian/obsidian-vault``.
            db_path: SQLite compartilhado; se None usa DB_PATH/.env ou cofres/cache.db.
            model_name: Modelo fastembed.
        """
        if vault_path is None:
            env_path: str | None = os.getenv("OBSIDIAN_VAULT_PATH")
            vault_path = env_path if env_path else "cofres/obsidian/obsidian-vault"

        obsidian_vault: VaultManager = VaultManager(vault_path=vault_path, recursive=True)
        super().__init__(vault=obsidian_vault, db_path=db_path, model_name=model_name)

    # ------------------------------------------------------------------
    # Override da criação do DB para usar tabela separada
    # ------------------------------------------------------------------
    def _ensure_db(self) -> None:
        try:
            self.db_path.parent.mkdir(parents=True, exist_ok=True)
            with sqlite3.connect(str(self.db_path)) as conn:
                conn.execute(
                    f"""
                    CREATE TABLE IF NOT EXISTS {self._TABLE} (
                        path TEXT PRIMARY KEY,
                        hash TEXT NOT NULL,
                        embedding BLOB NOT NULL,
                        dim INTEGER NOT NULL,
                        titulo TEXT,
                        categoria TEXT,
                        mtime REAL NOT NULL
                    )
                    """
                )
                conn.commit()
        except sqlite3.Error as exc:
            raise RuntimeError(f"Falha ao inicializar SQLite '{self.db_path}': {exc}") from exc

    # ------------------------------------------------------------------
    # Extração de título e categoria para notas Obsidian
    # ------------------------------------------------------------------
    @staticmethod
    def _extract_obsidian_title(path: Path, post: Any) -> str:
        """Extrai título de nota Obsidian: frontmatter > H1 > stem do arquivo."""
        # 1. frontmatter padrão
        title: str = str(post.get("titulo", "") or post.get("title", "") or "").strip()
        if title:
            return title
        # 2. Primeira linha H1
        for line in post.content.splitlines():
            stripped: str = line.strip()
            if stripped.startswith("# "):
                return stripped[2:].strip()
        # 3. Nome do arquivo sem extensão
        return path.stem

    @staticmethod
    def _extract_category(path: Path, vault_root: Path) -> str:
        """Retorna o nome da sub-pasta imediata como categoria (ex: 'Gastronomia')."""
        try:
            rel: Path = path.relative_to(vault_root)
            if len(rel.parts) > 1:
                return rel.parts[0]
        except ValueError:
            pass
        return ""

    def _build_doc_text_obsidian(
        self, titulo: str, corpo: str, categoria: str, tags: list[str]
    ) -> str:
        """Constrói texto representativo para embedding incluindo categoria Obsidian."""
        parts: list[str] = [f"Título: {titulo}"]
        if categoria:
            parts.append(f"Categoria: {categoria}")
        parts.append(corpo.strip())
        all_tags: list[str] = ([categoria] if categoria else []) + tags
        if all_tags:
            parts.append(f"Tags: {', '.join(all_tags)}")
        text: str = "\n".join(parts)
        if len(text) > 8000:
            text = text[:8000]
        return text

    # ------------------------------------------------------------------
    # Override de _upsert_embedding para usar tabela obsidian_index
    # ------------------------------------------------------------------
    def _upsert_embedding_obsidian(
        self,
        path: Path,
        file_hash: str,
        embedding: "np.ndarray",
        titulo: str,
        categoria: str,
        mtime: float,
    ) -> None:
        try:
            blob: bytes = embedding.astype(np.float32).tobytes()
            dim: int = int(embedding.shape[0])
            with sqlite3.connect(str(self.db_path)) as conn:
                conn.execute(
                    f"""
                    INSERT INTO {self._TABLE} (path, hash, embedding, dim, titulo, categoria, mtime)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(path) DO UPDATE SET
                        hash=excluded.hash,
                        embedding=excluded.embedding,
                        dim=excluded.dim,
                        titulo=excluded.titulo,
                        categoria=excluded.categoria,
                        mtime=excluded.mtime
                    """,
                    (str(path.resolve()), file_hash, blob, dim, titulo, categoria, mtime),
                )
                conn.commit()
        except sqlite3.Error as exc:
            raise RuntimeError(f"Falha ao persistir embedding Obsidian para '{path}': {exc}") from exc

    # ------------------------------------------------------------------
    # Override de indexar_nota para suporte Obsidian
    # ------------------------------------------------------------------
    def indexar_nota(self, identifier: str | Path) -> bool:  # type: ignore[override]
        """Indexa/atualiza uma nota Obsidian. Retorna True se (re)indexou."""
        try:
            vault_path: Path = self.vault._resolve_path(identifier)
            if not vault_path.exists():
                raise FileNotFoundError(f"Nota Obsidian não encontrada: {identifier}")
            path: Path = vault_path.resolve()
        except Exception as exc:
            raise FileNotFoundError(f"Nota Obsidian não encontrada: {identifier} ({exc})") from exc

        try:
            post: Any = frontmatter.load(str(path))
        except Exception as exc:
            raise ValueError(f"Falha ao ler nota Obsidian '{path}': {exc}") from exc

        titulo: str = self._extract_obsidian_title(path, post)
        categoria: str = self._extract_category(path, self.vault.vault_path)
        corpo: str = post.content or ""
        tags: list[str] = list(post.get("tags", []) or [])

        doc_text: str = self._build_doc_text_obsidian(titulo, corpo, categoria, tags)
        file_hash: str = _hash_content(doc_text)
        mtime: float = path.stat().st_mtime

        # Verifica cache hit
        try:
            with sqlite3.connect(str(self.db_path)) as conn:
                cur: sqlite3.Cursor = conn.execute(
                    f"SELECT hash FROM {self._TABLE} WHERE path = ?", (str(path),)
                )
                row: tuple[str] | None = cur.fetchone()  # type: ignore[assignment]
                if row is not None and row[0] == file_hash:
                    return False
        except sqlite3.Error as exc:
            raise RuntimeError(f"Falha ao consultar cache Obsidian: {exc}") from exc

        embedding: "np.ndarray" = self._embed_texts([doc_text], is_query=False)[0]
        self._upsert_embedding_obsidian(path, file_hash, embedding, titulo, categoria, mtime)
        return True

    # ------------------------------------------------------------------
    # Override de reindexar_tudo
    # ------------------------------------------------------------------
    def reindexar_tudo(self, force: bool = False) -> int:
        """Reindexa todas as notas Obsidian. Retorna qtd de arquivos (re)indexados."""
        try:
            notas: list[Path] = self.vault.listar_notas()
        except OSError as exc:
            raise RuntimeError(f"Falha ao listar notas Obsidian: {exc}") from exc

        # Remove entradas órfãs
        try:
            with sqlite3.connect(str(self.db_path)) as conn:
                cur = conn.execute(f"SELECT path FROM {self._TABLE}")
                rows: list[tuple[str]] = cur.fetchall()
                for (p_str,) in rows:
                    if not Path(p_str).exists():
                        conn.execute(f"DELETE FROM {self._TABLE} WHERE path = ?", (p_str,))
                conn.commit()
        except sqlite3.Error as exc:
            raise RuntimeError(f"Falha ao limpar índice Obsidian órfão: {exc}") from exc

        count: int = 0
        for nota_path in notas:
            try:
                if force:
                    try:
                        with sqlite3.connect(str(self.db_path)) as conn:
                            conn.execute(
                                f"DELETE FROM {self._TABLE} WHERE path = ?",
                                (str(nota_path.resolve()),),
                            )
                            conn.commit()
                    except sqlite3.Error:
                        pass
                did: bool = self.indexar_nota(nota_path)
                if did or force:
                    count += 1
            except Exception as exc:
                print(f"[WARN] Falha ao indexar Obsidian '{nota_path.name}': {exc}")
                continue
        return count

    # ------------------------------------------------------------------
    # Override de buscar_notas para usar tabela obsidian_index
    # ------------------------------------------------------------------
    def buscar_notas(self, query: str, top_k: int = 5) -> list[dict[str, Any]]:
        """Busca semântica no cofre Obsidian."""
        if not query or not query.strip():
            raise ValueError("query não pode ser vazia.")
        if top_k <= 0:
            raise ValueError("top_k deve ser > 0.")

        # Garante índice atualizado
        try:
            notas: list[Path] = self.vault.listar_notas()
            with sqlite3.connect(str(self.db_path)) as conn:
                cur = conn.execute(f"SELECT COUNT(*) FROM {self._TABLE}")
                (cached_count,) = cur.fetchone()  # type: ignore[misc]
                if cached_count != len(notas):
                    self.reindexar_tudo(force=False)
        except Exception:
            pass

        try:
            q_emb: "np.ndarray" = self._embed_texts([query.strip()], is_query=True)[0]
        except Exception as exc:
            raise RuntimeError(f"Falha ao vetorizar query Obsidian: {exc}") from exc

        try:
            with sqlite3.connect(str(self.db_path)) as conn:
                cur = conn.execute(
                    f"SELECT path, hash, embedding, dim, titulo, categoria, mtime FROM {self._TABLE}"
                )
                rows: list[tuple[str, str, bytes, int, str, str, float]] = cur.fetchall()
        except sqlite3.Error as exc:
            raise RuntimeError(f"Falha ao ler índice Obsidian: {exc}") from exc

        if not rows:
            return []

        results: list[dict[str, Any]] = []
        for p_str, f_hash, blob, dim, titulo, categoria, mtime in rows:
            try:
                emb: "np.ndarray" = np.frombuffer(blob, dtype=np.float32)
                if emb.size != dim:
                    emb = emb[:dim] if emb.size > dim else emb
                score: float = _cosine_similarity(q_emb, emb)
                path: Path = Path(p_str)
                preview: str = ""
                try:
                    _, corpo = self.vault.ler_nota(path)
                    preview = " ".join(corpo.strip().split())[:160]
                    if len(corpo.strip()) > 160:
                        preview += "…"
                except Exception:
                    preview = titulo
                results.append(
                    {
                        "path": path,
                        "titulo": titulo,
                        "categoria": categoria or "",
                        "score": score,
                        "preview": preview,
                        "hash": f_hash,
                        "vault": "obsidian",
                    }
                )
            except Exception as exc:
                print(f"[WARN] Falha ao computar similaridade Obsidian para '{p_str}': {exc}")
                continue

        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:top_k]

    def get_stats(self) -> dict[str, Any]:
        """Retorna estatísticas do índice Obsidian."""
        try:
            with sqlite3.connect(str(self.db_path)) as conn:
                cur = conn.execute(f"SELECT COUNT(*) FROM {self._TABLE}")
                (count,) = cur.fetchone()
                return {
                    "vault": "obsidian",
                    "model": self.model_name,
                    "db_path": str(self.db_path),
                    "count": int(count or 0),
                    "dim": self._dim,
                }
        except sqlite3.Error as exc:
            raise RuntimeError(f"Falha ao obter stats Obsidian: {exc}") from exc


# ---------------------------------------------------------------------------
# MultiVaultIndexer — busca unificada em default + Obsidian
# ---------------------------------------------------------------------------

class MultiVaultIndexer:
    """Indexador unificado que combina o cofre padrão e o cofre Obsidian.

    A busca acontece em paralelo em ambos os índices e os resultados são
    mesclados por score (similaridade de cosseno), com etiqueta de origem.
    """

    def __init__(
        self,
        default_indexer: VaultIndexer | None = None,
        obsidian_indexer: ObsidianIndexer | None = None,
        db_path: Path | str | None = None,
        model_name: str | None = None,
    ) -> None:
        """Inicializa MultiVaultIndexer.

        Args:
            default_indexer: Indexer do cofre padrão. Se None, cria automaticamente.
            obsidian_indexer: Indexer do cofre Obsidian. Se None, cria automaticamente.
            db_path: Caminho SQLite compartilhado (usado se indexers criados internamente).
            model_name: Modelo fastembed (usado se indexers criados internamente).
        """
        self.default_indexer: VaultIndexer = default_indexer or VaultIndexer(
            db_path=db_path, model_name=model_name
        )
        self.obsidian_indexer: ObsidianIndexer = obsidian_indexer or ObsidianIndexer(
            db_path=db_path or self.default_indexer.db_path, model_name=model_name
        )

    # Expõe o vault padrão como .vault para compatibilidade com AgentCore
    @property
    def vault(self) -> VaultManager:
        return self.default_indexer.vault

    @property
    def obsidian_vault(self) -> VaultManager:
        return self.obsidian_indexer.vault

    def reindexar_tudo(self, force: bool = False) -> tuple[int, int]:
        """Reindexa ambos os vaults. Retorna (qtd_default, qtd_obsidian)."""
        count_default: int = self.default_indexer.reindexar_tudo(force=force)
        count_obsidian: int = self.obsidian_indexer.reindexar_tudo(force=force)
        return count_default, count_obsidian

    def buscar_notas(self, query: str, top_k: int = 5) -> list[dict[str, Any]]:
        """Busca semântica unificada em ambos os vaults.

        Args:
            query: Pergunta ou termos de busca.
            top_k: Quantidade total de resultados mesclados.

        Returns:
            Lista ordenada por score com dicts incluindo campo ``vault`` ('default'|'obsidian').
        """
        results: list[dict[str, Any]] = []

        # Busca no vault padrão
        try:
            default_results: list[dict[str, Any]] = self.default_indexer.buscar_notas(
                query, top_k=top_k
            )
            for r in default_results:
                r.setdefault("vault", "default")
                r.setdefault("categoria", "")
            results.extend(default_results)
        except Exception as exc:
            print(f"[WARN] Falha na busca do vault padrão: {exc}")

        # Busca no vault Obsidian
        try:
            obsidian_results: list[dict[str, Any]] = self.obsidian_indexer.buscar_notas(
                query, top_k=top_k
            )
            results.extend(obsidian_results)
        except Exception as exc:
            print(f"[WARN] Falha na busca do vault Obsidian: {exc}")

        # Mescla e ordena por score
        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:top_k]

    # Aliases de compatibilidade
    def buscar(self, query: str, top_k: int = 5) -> list[dict[str, Any]]:
        return self.buscar_notas(query, top_k=top_k)

    def search(self, query: str, top_k: int = 5) -> list[dict[str, Any]]:
        return self.buscar_notas(query, top_k=top_k)

    def get_stats(self) -> dict[str, Any]:
        """Retorna estatísticas combinadas de ambos os índices."""
        return {
            "default": self.default_indexer.get_stats(),
            "obsidian": self.obsidian_indexer.get_stats(),
        }

