"""Testes Sprint 04 — ChatManager integridade SQLite."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from scripts.funcional.chat_manager import ChatManager


@pytest.fixture
def mem_manager() -> ChatManager:
    return ChatManager(db_path=":memory:")


@pytest.fixture
def file_manager(tmp_path: Path) -> ChatManager:
    return ChatManager(db_path=tmp_path / "chat.db")


def test_criar_e_listar_sessoes(mem_manager: ChatManager) -> None:
    m: ChatManager = mem_manager
    sid1: str = m.criar_sessao("Primeira")
    sid2: str = m.criar_sessao("Segunda")
    sessions: list[dict] = m.listar_sessoes()
    assert len(sessions) == 2
    ids: set[str] = {s["id"] for s in sessions}
    assert sid1 in ids and sid2 in ids
    # Ordenação por updated_at desc (sid2 mais recente deve vir primeiro)
    assert sessions[0]["id"] == sid2


def test_adicionar_e_carregar_historico(mem_manager: ChatManager) -> None:
    m: ChatManager = mem_manager
    sid: str = m.criar_sessao("Hist")
    m.adicionar_mensagem(sid, "user", "olá")
    m.adicionar_mensagem(sid, "assistant", "oi, tudo bem?")
    m.adicionar_mensagem(sid, "user", "salve nota X", tool_calls=None)
    hist: list[dict] = m.carregar_historico(sid)
    assert len(hist) == 3
    assert hist[0]["role"] == "user" and hist[0]["content"] == "olá"
    assert hist[1]["role"] == "assistant"
    assert m.contar_mensagens(sid) == 3


def test_integridade_multiplas_sessoes(mem_manager: ChatManager) -> None:
    m: ChatManager = mem_manager
    s1: str = m.criar_sessao("S1")
    s2: str = m.criar_sessao("S2")
    s3: str = m.criar_sessao("S3")

    # Intercala mensagens entre sessões
    m.adicionar_mensagem(s1, "user", "msg s1 a")
    m.adicionar_mensagem(s2, "user", "msg s2 a")
    m.adicionar_mensagem(s1, "assistant", "resp s1 a")
    m.adicionar_mensagem(s3, "user", "msg s3 a")
    m.adicionar_mensagem(s2, "assistant", "resp s2 a")

    assert m.contar_mensagens(s1) == 2
    assert m.contar_mensagens(s2) == 2
    assert m.contar_mensagens(s3) == 1

    h1: list[dict] = m.carregar_historico(s1)
    assert [h["content"] for h in h1] == ["msg s1 a", "resp s1 a"]
    h2: list[dict] = m.carregar_historico(s2)
    assert h2[0]["content"] == "msg s2 a"

    # Deletar s2 não afeta s1/s3
    m.deletar_sessao(s2)
    assert m.obter_sessao(s2) is None
    assert m.contar_mensagens(s1) == 2
    assert len(m.listar_sessoes()) == 2
    # Mensagens de s2 devem ter sido cascade deletadas
    with pytest.raises(FileNotFoundError):
        m.carregar_historico(s2)


def test_persistencia_arquivo(file_manager: ChatManager, tmp_path: Path) -> None:
    m1: ChatManager = file_manager
    sid: str = m1.criar_sessao("Persist")
    m1.adicionar_mensagem(sid, "user", "hello file")
    m1.adicionar_mensagem(sid, "assistant", "hello back")

    # Nova instância apontando mesmo arquivo deve ver dados
    m2: ChatManager = ChatManager(db_path=tmp_path / "chat.db")
    assert m2.obter_sessao(sid) is not None
    assert m2.contar_mensagens(sid) == 2
    hist: list[dict] = m2.carregar_historico(sid)
    assert hist[0]["content"] == "hello file"


def test_renomear_e_deletar_sessao(mem_manager: ChatManager) -> None:
    m: ChatManager = mem_manager
    sid: str = m.criar_sessao("Old")
    ok: bool = m.renomear_sessao(sid, "New Title")
    assert ok is True
    assert m.obter_sessao(sid)["titulo"] == "New Title"
    assert m.deletar_sessao(sid) is True
    assert m.obter_sessao(sid) is None
    assert m.deletar_sessao(sid) is False


def test_limpar_historico(mem_manager: ChatManager) -> None:
    m: ChatManager = mem_manager
    sid: str = m.criar_sessao("Clear")
    m.adicionar_mensagem(sid, "user", "a")
    m.adicionar_mensagem(sid, "assistant", "b")
    removed: int = m.limpar_historico(sid)
    assert removed == 2
    assert m.contar_mensagens(sid) == 0
    assert m.obter_sessao(sid) is not None


def test_erro_sessao_inexistente(mem_manager: ChatManager) -> None:
    m: ChatManager = mem_manager
    with pytest.raises(FileNotFoundError):
        m.adicionar_mensagem("fake_id", "user", "oi")
    with pytest.raises(FileNotFoundError):
        m.carregar_historico("fake_id")


def test_role_invalido(mem_manager: ChatManager) -> None:
    m: ChatManager = mem_manager
    sid: str = m.criar_sessao("Roles")
    with pytest.raises(ValueError):
        m.adicionar_mensagem(sid, "invalid_role", "x")  # type: ignore[arg-type]


def test_cascade_delete_integrity(file_manager: ChatManager) -> None:
    m: ChatManager = file_manager
    sid: str = m.criar_sessao("Cascade")
    m.adicionar_mensagem(sid, "user", "msg1")
    m.adicionar_mensagem(sid, "assistant", "msg2")
    # Verifica via sqlite direto que messages existem
    with sqlite3.connect(str(m.db_path)) as conn:
        cur = conn.execute("SELECT COUNT(*) FROM messages WHERE session_id = ?", (sid,))
        (cnt,) = cur.fetchone()
        assert cnt == 2
    m.deletar_sessao(sid)
    with sqlite3.connect(str(m.db_path)) as conn:
        cur = conn.execute("SELECT COUNT(*) FROM messages WHERE session_id = ?", (sid,))
        (cnt2,) = cur.fetchone()
        assert cnt2 == 0


def test_aliases_en(mem_manager: ChatManager) -> None:
    m: ChatManager = mem_manager
    sid: str = m.create_session("EN")
    m.add_message(sid, "user", "hello")
    assert m.count_messages(sid) == 1
    assert m.get_session(sid) is not None
    assert m.load_history(sid)[0]["content"] == "hello"
    assert m.list_sessions()[0]["id"] == sid
