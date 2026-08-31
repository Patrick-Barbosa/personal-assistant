"""Testes Sprint 03 — Motor agêntico com mocks.

Verifica se modelo decide corretamente entre responder direto vs criar arquivos.
"""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from scripts.funcional.agent_core import AgentCore
from scripts.funcional.vault import VaultManager


@pytest.fixture
def tmp_vault(tmp_path: Path) -> VaultManager:
    vault_dir: Path = tmp_path / "vault"
    vault_dir.mkdir()
    return VaultManager(vault_path=vault_dir)


@pytest.fixture
def tmp_agent(tmp_vault: VaultManager, tmp_path: Path) -> AgentCore:
    db_path: Path = tmp_path / "cache.db"
    from scripts.funcional.indexer import VaultIndexer

    indexer: VaultIndexer = VaultIndexer(vault=tmp_vault, db_path=db_path)
    # Usa chaves fake; clientes serão mockados
    agent: AgentCore = AgentCore(
        vault=tmp_vault,
        indexer=indexer,
        deepseek_api_key="sk-test",
        groq_api_key="gsk_test",
    )
    return agent


def _mock_tool_call(id_: str, name: str, arguments: dict) -> SimpleNamespace:
    return SimpleNamespace(
        id=id_, function=SimpleNamespace(name=name, arguments=json.dumps(arguments, ensure_ascii=False))
    )


def _mock_response(content: str | None, tool_calls: list | None = None) -> SimpleNamespace:
    msg: SimpleNamespace = SimpleNamespace(content=content, tool_calls=tool_calls)
    choice: SimpleNamespace = SimpleNamespace(message=msg)
    return SimpleNamespace(choices=[choice])


# ------------------------------------------------------------------
# Testes de decisão agêntica
# ------------------------------------------------------------------
def test_chat_resposta_direta_sem_tool(tmp_agent: AgentCore) -> None:
    agent: AgentCore = tmp_agent
    mock_client: MagicMock = MagicMock()
    mock_client.chat.completions.create.return_value = _mock_response("Olá! Como posso ajudar?", None)
    agent._openai_client = mock_client  # injeta mock

    resp: str = agent.chat("Olá")
    assert resp == "Olá! Como posso ajudar?"
    # Deve ter chamado API uma vez com tools
    assert mock_client.chat.completions.create.call_count == 1
    _, kwargs = mock_client.chat.completions.create.call_args
    assert "tools" in kwargs
    # Nenhum arquivo deve ter sido criado
    assert len(agent.vault.listar_notas()) == 0


def test_chat_consulta_usa_buscar_notas(tmp_agent: AgentCore, tmp_vault: VaultManager) -> None:
    vault: VaultManager = tmp_vault
    agent: AgentCore = tmp_agent
    # Cria nota relevante
    vault.criar_nota(titulo="Preço Item X", corpo="O item X custa R$ 42,00 na loja Y.", tags=["preço"])
    agent.indexer.reindexar_tudo(force=True)

    # Mock: 1ª chamada pede buscar_notas, 2ª retorna resposta final
    mock_client: MagicMock = MagicMock()
    mock_client.chat.completions.create.side_effect = [
        _mock_response(None, [_mock_tool_call("call_1", "buscar_notas", {"query": "quanto custa item X", "top_k": 5})]),
        _mock_response("O item X custa R$ 42,00 (fonte: Preço Item X).", None),
    ]
    agent._openai_client = mock_client

    resp: str = agent.chat("quanto custa o item X?")
    assert "42" in resp
    assert mock_client.chat.completions.create.call_count == 2
    # Verifica que nenhuma nota foi criada adicionalmente (só consulta)
    assert len(vault.listar_notas()) == 1


def test_chat_criacao_usa_salvar_nota(tmp_agent: AgentCore) -> None:
    agent: AgentCore = tmp_agent
    mock_client: MagicMock = MagicMock()
    mock_client.chat.completions.create.side_effect = [
        _mock_response(
            None, [_mock_tool_call("call_2", "salvar_nota", {"titulo": "Ideia Nova", "corpo": "Conteúdo da ideia com [[Link]]", "tags": ["ideia"]})]
        ),
        _mock_response("Nota 'Ideia Nova' salva com sucesso!", None),
    ]
    agent._openai_client = mock_client

    resp: str = agent.chat("salve a ideia: nova feature com link")
    assert "Ideia Nova" in resp or "salva" in resp.lower()
    # Arquivo deve existir
    assert len(agent.vault.listar_notas()) == 1
    meta, corpo = agent.vault.ler_nota("Ideia Nova")
    assert meta["titulo"] == "Ideia Nova"
    assert "[[Link]]" in corpo


def test_chat_nao_cria_arquivo_em_consulta_simples(tmp_agent: AgentCore, tmp_vault: VaultManager) -> None:
    vault: VaultManager = tmp_vault
    agent: AgentCore = tmp_agent
    vault.criar_nota(titulo="Nota Existente", corpo="Informação já salva.", tags=["x"])
    agent.indexer.reindexar_tudo(force=True)

    mock_client: MagicMock = MagicMock()
    mock_client.chat.completions.create.return_value = _mock_response("Resposta direta sem criar.", None)
    agent._openai_client = mock_client

    agent.chat("me diga o que tem na nota existente?")
    # Não deve criar nova nota
    assert len(vault.listar_notas()) == 1


def test_atualizar_nota_tool(tmp_agent: AgentCore, tmp_vault: VaultManager) -> None:
    vault: VaultManager = tmp_vault
    agent: AgentCore = tmp_agent
    vault.criar_nota(titulo="Nota Editável", corpo="linha 1", tags=["a"])

    mock_client: MagicMock = MagicMock()
    mock_client.chat.completions.create.side_effect = [
        _mock_response(None, [_mock_tool_call("call_3", "atualizar_nota", {"identifier": "Nota Editável", "novo_conteudo": "linha 2", "modo": "append"})]),
        _mock_response("Nota atualizada!", None),
    ]
    agent._openai_client = mock_client

    agent.chat("adicione linha 2 na nota editável")
    _, corpo = vault.ler_nota("Nota Editável")
    assert "linha 1" in corpo
    assert "linha 2" in corpo


def test_execute_tool_salvar_nota_direto(tmp_agent: AgentCore) -> None:
    agent: AgentCore = tmp_agent
    result: str = agent._execute_tool("salvar_nota", {"titulo": "T", "corpo": "C", "tags": ["t"]})
    data: dict = json.loads(result)
    assert data.get("ok") is True
    assert "path" in data
    # Verifica que indexou
    assert agent.indexer.get_stats()["count"] >= 1


def test_execute_tool_buscar_notas(tmp_agent: AgentCore, tmp_vault: VaultManager) -> None:
    vault: VaultManager = tmp_vault
    agent: AgentCore = tmp_agent
    vault.criar_nota(titulo="A", corpo="conteúdo sobre python", tags=["py"])
    agent.indexer.reindexar_tudo(force=True)
    result: str = agent._execute_tool("buscar_notas", {"query": "python", "top_k": 2})
    data: dict = json.loads(result)
    assert "resultados" in data
    assert len(data["resultados"]) >= 1
    assert "titulo" in data["resultados"][0]


def test_groq_transcricao_mock(tmp_agent: AgentCore, tmp_path: Path) -> None:
    agent: AgentCore = tmp_agent
    # Cria wav fake
    wav: Path = tmp_path / "fake.wav"
    wav.write_bytes(b"RIFF....fake")

    mock_groq: MagicMock = MagicMock()
    mock_groq.audio.transcriptions.create.return_value = "texto transcrito teste"
    agent._groq_client = mock_groq

    text: str = agent.transcrever_arquivo(wav)
    assert text == "texto transcrito teste"
    mock_groq.audio.transcriptions.create.assert_called_once()


def test_chat_erro_input_vazio(tmp_agent: AgentCore) -> None:
    with pytest.raises(ValueError):
        tmp_agent.chat("   ")


def test_tool_definitions_shape(tmp_agent: AgentCore) -> None:
    tools: list[dict] = tmp_agent._tool_definitions()
    names: set[str] = {t["function"]["name"] for t in tools}
    assert names == {"buscar_notas", "ler_nota", "salvar_nota", "atualizar_nota"}
    for t in tools:
        assert t["type"] == "function"
        assert "parameters" in t["function"]
