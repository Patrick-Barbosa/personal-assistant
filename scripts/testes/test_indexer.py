"""Testes Sprint 02 — Indexação local e busca semântica."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from scripts.funcional.indexer import VaultIndexer
from scripts.funcional.vault import VaultManager


@pytest.fixture
def tmp_vault(tmp_path: Path) -> VaultManager:
    vault_dir: Path = tmp_path / "vault"
    vault_dir.mkdir()
    return VaultManager(vault_path=vault_dir)


@pytest.fixture
def tmp_indexer(tmp_path: Path, tmp_vault: VaultManager) -> VaultIndexer:
    db_path: Path = tmp_path / "cache.db"
    # Usa modelo leve e rápido; fallback tratado pelo indexer
    return VaultIndexer(vault=tmp_vault, db_path=db_path)


def test_geracao_vetores_e_dimensao(tmp_indexer: VaultIndexer) -> None:
    idx: VaultIndexer = tmp_indexer
    vecs: list[np.ndarray] = idx._embed_texts(["Olá mundo", "Teste de embedding"], is_query=False)  # type: ignore[attr-defined]
    assert len(vecs) == 2
    assert isinstance(vecs[0], np.ndarray)
    assert vecs[0].ndim == 1
    # Paraphrase multilingual MiniLM L12 v2 -> dim 384
    assert vecs[0].shape[0] in (384, 768, 512, 1024)
    # Vetores normalizáveis (cosseno não NaN)
    assert not np.isnan(vecs[0]).any()


def test_indexar_e_buscar_relevancia(tmp_indexer: VaultIndexer, tmp_vault: VaultManager) -> None:
    vault: VaultManager = tmp_vault
    idx: VaultIndexer = tmp_indexer

    # Cria notas com conteúdos semanticamente distintos
    vault.criar_nota(
        titulo="Receita de Bolo",
        corpo="Receita de bolo de chocolate com farinha, ovos, açúcar e cobertura cremosa.",
        tags=["culinária"],
    )
    vault.criar_nota(
        titulo="Reunião de Trabalho",
        corpo="Ata da reunião sobre roadmap do produto, metas trimestrais e KPIs.",
        tags=["trabalho"],
    )
    vault.criar_nota(
        titulo="Viagem para Japão",
        corpo="Roteiro de viagem para Tóquio, Quioto, templos e gastronomia japonesa.",
        tags=["viagem"],
    )

    count: int = idx.reindexar_tudo(force=True)
    assert count == 3

    # Busca culinária deve retornar bolo em primeiro
    results: list[dict] = idx.buscar_notas("como fazer bolo de chocolate", top_k=3)
    assert len(results) == 3
    assert results[0]["titulo"] == "Receita de Bolo"
    assert results[0]["score"] > results[1]["score"]

    # Busca viagem Japão
    results2: list[dict] = idx.buscar_notas("roteiro Tóquio Japão templos", top_k=2)
    assert results2[0]["titulo"] == "Viagem para Japão"

    # Alias EN
    results3: list[dict] = idx.search("reunião trabalho metas", top_k=1)
    assert results3[0]["titulo"] == "Reunião de Trabalho"


def test_cache_evita_reindex(tmp_indexer: VaultIndexer, tmp_vault: VaultManager) -> None:
    vault: VaultManager = tmp_vault
    idx: VaultIndexer = tmp_indexer

    p: Path = vault.criar_nota(titulo="Cache Test", corpo="conteúdo estático", tags=["x"])
    did1: bool = idx.indexar_nota(p)
    assert did1 is True
    # Segunda chamada sem mudança → cache hit
    did2: bool = idx.indexar_nota(p)
    assert did2 is False

    # Alteração deve forçar reindex
    vault.atualizar_nota(p, novo_conteudo="conteúdo modificado completamente diferente", modo="replace")
    did3: bool = idx.indexar_nota(p)
    assert did3 is True


def test_busca_topk_e_score_ordenado(tmp_indexer: VaultIndexer, tmp_vault: VaultManager) -> None:
    vault: VaultManager = tmp_vault
    idx: VaultIndexer = tmp_indexer
    for i in range(5):
        vault.criar_nota(titulo=f"Nota {i}", corpo=f"conteúdo número {i} sobre python e dados")
    idx.reindexar_tudo(force=True)
    results: list[dict] = idx.buscar_notas("python dados", top_k=2)
    assert len(results) == 2
    assert results[0]["score"] >= results[1]["score"]
    # Scores no intervalo [-1, 1] (cosseno)
    for r in results:
        assert -1.0 <= r["score"] <= 1.0


def test_busca_query_vazia_erro(tmp_indexer: VaultIndexer) -> None:
    with pytest.raises(ValueError):
        tmp_indexer.buscar_notas("", top_k=5)
    with pytest.raises(ValueError):
        tmp_indexer.buscar_notas("   ", top_k=5)
    with pytest.raises(ValueError):
        tmp_indexer.buscar_notas("teste", top_k=0)


def test_reindex_force_e_clear(tmp_indexer: VaultIndexer, tmp_vault: VaultManager) -> None:
    vault: VaultManager = tmp_vault
    idx: VaultIndexer = tmp_indexer
    vault.criar_nota(titulo="A", corpo="alpha")
    vault.criar_nota(titulo="B", corpo="beta")
    idx.reindexar_tudo()
    assert idx.get_stats()["count"] == 2
    idx.limpar_indice()
    assert idx.get_stats()["count"] == 0
    # Reindex com force
    c: int = idx.reindexar_tudo(force=True)
    assert c == 2


def test_busca_retorna_preview_e_path(tmp_indexer: VaultIndexer, tmp_vault: VaultManager) -> None:
    vault: VaultManager = tmp_vault
    idx: VaultIndexer = tmp_indexer
    vault.criar_nota(titulo="Preview Test", corpo="Este é um conteúdo longo " * 20, tags=["t"])
    idx.reindexar_tudo(force=True)
    results: list[dict] = idx.buscar_notas("conteúdo longo", top_k=1)
    assert len(results) == 1
    r: dict = results[0]
    assert "path" in r and isinstance(r["path"], Path)
    assert "preview" in r and len(r["preview"]) > 0
    assert "titulo" in r and r["titulo"] == "Preview Test"


def test_index_incremental_remove_orfaos(tmp_path: Path, tmp_vault: VaultManager) -> None:
    db_path: Path = tmp_path / "cache.db"
    idx: VaultIndexer = VaultIndexer(vault=tmp_vault, db_path=db_path)
    p: Path = tmp_vault.criar_nota(titulo="Orfao", corpo="para deletar")
    idx.reindexar_tudo(force=True)
    assert idx.get_stats()["count"] == 1
    # Deleta arquivo fisicamente
    p.unlink()
    # Reindex deve limpar órfão
    idx.reindexar_tudo(force=False)
    assert idx.get_stats()["count"] == 0
