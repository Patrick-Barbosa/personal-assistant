"""ChatManager — Sprint 04: Persistência de sessões e histórico em SQLite.

Tabelas `sessions` e `messages` com integridade por FK e CASCADE.
Resolução via pathlib.Path + .env (DB_PATH), sem expor valores sensíveis.
"""

from __future__ import annotations

import os
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

load_dotenv()


def _project_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent


def _resolve_db_path(db_path: Path | str | None) -> Path:
    # :memory: é caso especial do SQLite para DB em RAM (usado em testes)
    if isinstance(db_path, str) and db_path == ":memory:":
        return Path(":memory:")  # type: ignore[return-value]
    if db_path is not None:
        raw: Path = Path(db_path)
    else:
        env: str | None = os.getenv("DB_PATH")
        raw = Path(env) if env else Path("cofres/cache.db")
    if str(raw) == ":memory:":
        return raw
    if not raw.is_absolute():
        raw = (_project_root() / raw).resolve()
    else:
        raw = raw.resolve()
    return raw


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class ChatManager:
    """Gerenciador de sessões e mensagens com SQLite local."""

    def __init__(self, db_path: Path | str | None = None) -> None:
        """Inicializa garantindo DB e tabelas.

        Args:
            db_path: Caminho do SQLite; se None usa DB_PATH do .env ou cofres/cache.db
        """
        self.db_path: Path = _resolve_db_path(db_path)
        # Para :memory: mantém conexão persistente (SQLite cria DB por conexão)
        self._mem_conn: sqlite3.Connection | None = None
        if str(self.db_path) == ":memory:":
            self._mem_conn = sqlite3.connect(":memory:", check_same_thread=False)
            self._mem_conn.execute("PRAGMA foreign_keys = ON")
        self._ensure_db()

    # ------------------------------------------------------------------
    # DB setup
    # ------------------------------------------------------------------
    def _ensure_db(self) -> None:
        try:
            if str(self.db_path) != ":memory:":
                self.db_path.parent.mkdir(parents=True, exist_ok=True)
                with sqlite3.connect(str(self.db_path)) as conn:
                    conn.execute("PRAGMA foreign_keys = ON")
                    conn.execute(
                        """
                        CREATE TABLE IF NOT EXISTS sessions (
                            id TEXT PRIMARY KEY,
                            titulo TEXT NOT NULL,
                            created_at TEXT NOT NULL,
                            updated_at TEXT NOT NULL
                        )
                        """
                    )
                    conn.execute(
                        """
                        CREATE TABLE IF NOT EXISTS messages (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                            role TEXT NOT NULL CHECK(role IN ('system','user','assistant','tool')),
                            content TEXT NOT NULL,
                            tool_call_id TEXT,
                            tool_calls TEXT,
                            created_at TEXT NOT NULL
                        )
                        """
                    )
                    conn.execute("CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id)")
                    conn.execute("CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at)")
                    conn.commit()
            else:
                assert self._mem_conn is not None
                self._mem_conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS sessions (
                        id TEXT PRIMARY KEY,
                        titulo TEXT NOT NULL,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    )
                    """
                )
                self._mem_conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS messages (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                        role TEXT NOT NULL CHECK(role IN ('system','user','assistant','tool')),
                        content TEXT NOT NULL,
                        tool_call_id TEXT,
                        tool_calls TEXT,
                        created_at TEXT NOT NULL
                    )
                    """
                )
                self._mem_conn.execute("CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id)")
                self._mem_conn.execute("CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at)")
                self._mem_conn.commit()
        except sqlite3.Error as exc:
            raise RuntimeError(f"Falha ao inicializar Chat DB '{self.db_path}': {exc}") from exc

    def _connect(self) -> sqlite3.Connection:
        try:
            if str(self.db_path) == ":memory:":
                assert self._mem_conn is not None
                return self._mem_conn
            conn: sqlite3.Connection = sqlite3.connect(str(self.db_path), check_same_thread=False)
            conn.execute("PRAGMA foreign_keys = ON")
            return conn
        except sqlite3.Error as exc:
            raise RuntimeError(f"Falha ao conectar DB: {exc}") from exc

    def _commit_if_not_mem(self, conn: sqlite3.Connection) -> None:
        if str(self.db_path) != ":memory:":
            conn.commit()

    def _close_if_not_mem(self, conn: sqlite3.Connection) -> None:
        if str(self.db_path) != ":memory:":
            conn.close()

    # ------------------------------------------------------------------
    # Sessões
    # ------------------------------------------------------------------
    def criar_sessao(self, titulo: str | None = None) -> str:
        """Cria nova sessão e retorna seu id."""
        sid: str = uuid.uuid4().hex[:16]
        now: str = _now_iso()
        final_titulo: str = titulo.strip() if titulo and titulo.strip() else f"Sessão {now[:16]}"
        try:
            with self._connect() as conn:
                conn.execute(
                    "INSERT INTO sessions (id, titulo, created_at, updated_at) VALUES (?, ?, ?, ?)",
                    (sid, final_titulo, now, now),
                )
                conn.commit()
        except sqlite3.Error as exc:
            raise RuntimeError(f"Falha ao criar sessão: {exc}") from exc
        return sid

    def create_session(self, titulo: str | None = None) -> str:
        return self.criar_sessao(titulo)

    def listar_sessoes(self) -> list[dict[str, Any]]:
        """Lista sessões ordenadas por updated_at desc (desempate por ROWID)."""
        try:
            with self._connect() as conn:
                conn.row_factory = sqlite3.Row
                cur: sqlite3.Cursor = conn.execute(
                    "SELECT id, titulo, created_at, updated_at FROM sessions ORDER BY updated_at DESC, rowid DESC"
                )
                rows: list[sqlite3.Row] = cur.fetchall()
                return [dict(r) for r in rows]
        except sqlite3.Error as exc:
            raise RuntimeError(f"Falha ao listar sessões: {exc}") from exc

    def list_sessions(self) -> list[dict[str, Any]]:
        return self.listar_sessoes()

    def obter_sessao(self, session_id: str) -> dict[str, Any] | None:
        try:
            with self._connect() as conn:
                conn.row_factory = sqlite3.Row
                cur = conn.execute("SELECT id, titulo, created_at, updated_at FROM sessions WHERE id = ?", (session_id,))
                row: sqlite3.Row | None = cur.fetchone()
                return dict(row) if row else None
        except sqlite3.Error as exc:
            raise RuntimeError(f"Falha ao obter sessão: {exc}") from exc

    def get_session(self, session_id: str) -> dict[str, Any] | None:
        return self.obter_sessao(session_id)

    def renomear_sessao(self, session_id: str, novo_titulo: str) -> bool:
        if not novo_titulo or not novo_titulo.strip():
            raise ValueError("novo_titulo não pode ser vazio.")
        try:
            with self._connect() as conn:
                cur = conn.execute(
                    "UPDATE sessions SET titulo = ?, updated_at = ? WHERE id = ?",
                    (novo_titulo.strip(), _now_iso(), session_id),
                )
                conn.commit()
                return cur.rowcount > 0
        except sqlite3.Error as exc:
            raise RuntimeError(f"Falha ao renomear sessão: {exc}") from exc

    def rename_session(self, session_id: str, novo_titulo: str) -> bool:
        return self.renomear_sessao(session_id, novo_titulo)

    def deletar_sessao(self, session_id: str) -> bool:
        """Deleta sessão e mensagens (CASCADE). Retorna True se existia."""
        try:
            with self._connect() as conn:
                cur = conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
                conn.commit()
                return cur.rowcount > 0
        except sqlite3.Error as exc:
            raise RuntimeError(f"Falha ao deletar sessão: {exc}") from exc

    def delete_session(self, session_id: str) -> bool:
        return self.deletar_sessao(session_id)

    # ------------------------------------------------------------------
    # Mensagens
    # ------------------------------------------------------------------
    def adicionar_mensagem(
        self,
        session_id: str,
        role: str,
        content: str,
        tool_call_id: str | None = None,
        tool_calls: str | None = None,
    ) -> int:
        """Adiciona mensagem ao histórico. Retorna id da mensagem.

        Args:
            session_id: Sessão existente.
            role: system|user|assistant|tool
            content: Texto da mensagem.
            tool_call_id: Opcional para role=tool
            tool_calls: JSON string para assistant com tool_calls
        """
        if role not in ("system", "user", "assistant", "tool"):
            raise ValueError("role deve ser system/user/assistant/tool")
        if content is None:
            raise ValueError("content não pode ser None")
        now: str = _now_iso()
        try:
            with self._connect() as conn:
                # Verifica sessão existe
                cur = conn.execute("SELECT 1 FROM sessions WHERE id = ?", (session_id,))
                if cur.fetchone() is None:
                    raise FileNotFoundError(f"Sessão não encontrada: {session_id}")
                cur = conn.execute(
                    "INSERT INTO messages (session_id, role, content, tool_call_id, tool_calls, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                    (session_id, role, content, tool_call_id, tool_calls, now),
                )
                # Bump updated_at
                conn.execute("UPDATE sessions SET updated_at = ? WHERE id = ?", (now, session_id))
                conn.commit()
                return int(cur.lastrowid or 0)
        except FileNotFoundError:
            raise
        except sqlite3.Error as exc:
            raise RuntimeError(f"Falha ao adicionar mensagem: {exc}") from exc

    def add_message(
        self,
        session_id: str,
        role: str,
        content: str,
        tool_call_id: str | None = None,
        tool_calls: str | None = None,
    ) -> int:
        return self.adicionar_mensagem(session_id, role, content, tool_call_id, tool_calls)

    def carregar_historico(self, session_id: str) -> list[dict[str, Any]]:
        """Carrega histórico ordenado por id asc (ordem de inserção)."""
        try:
            with self._connect() as conn:
                conn.row_factory = sqlite3.Row
                # Verifica sessão
                cur = conn.execute("SELECT 1 FROM sessions WHERE id = ?", (session_id,))
                if cur.fetchone() is None:
                    raise FileNotFoundError(f"Sessão não encontrada: {session_id}")
                cur = conn.execute(
                    "SELECT id, session_id, role, content, tool_call_id, tool_calls, created_at FROM messages WHERE session_id = ? ORDER BY id ASC",
                    (session_id,),
                )
                rows: list[sqlite3.Row] = cur.fetchall()
                return [dict(r) for r in rows]
        except FileNotFoundError:
            raise
        except sqlite3.Error as exc:
            raise RuntimeError(f"Falha ao carregar histórico: {exc}") from exc

    def load_history(self, session_id: str) -> list[dict[str, Any]]:
        return self.carregar_historico(session_id)

    def contar_mensagens(self, session_id: str) -> int:
        try:
            with self._connect() as conn:
                cur = conn.execute("SELECT COUNT(*) FROM messages WHERE session_id = ?", (session_id,))
                (cnt,) = cur.fetchone()  # type: ignore[misc]
                return int(cnt or 0)
        except sqlite3.Error as exc:
            raise RuntimeError(f"Falha ao contar mensagens: {exc}") from exc

    def count_messages(self, session_id: str) -> int:
        return self.contar_mensagens(session_id)

    def limpar_historico(self, session_id: str) -> int:
        """Remove todas mensagens da sessão. Retorna qtd removidas."""
        try:
            with self._connect() as conn:
                cur = conn.execute("DELETE FROM messages WHERE session_id = ?", (session_id,))
                conn.commit()
                return int(cur.rowcount or 0)
        except sqlite3.Error as exc:
            raise RuntimeError(f"Falha ao limpar histórico: {exc}") from exc

    def clear_history(self, session_id: str) -> int:
        return self.limpar_historico(session_id)

    def deletar_mensagem(self, message_id: int) -> bool:
        try:
            with self._connect() as conn:
                cur = conn.execute("DELETE FROM messages WHERE id = ?", (message_id,))
                conn.commit()
                return cur.rowcount > 0
        except sqlite3.Error as exc:
            raise RuntimeError(f"Falha ao deletar mensagem: {exc}") from exc

    def delete_message(self, message_id: int) -> bool:
        return self.deletar_mensagem(message_id)
