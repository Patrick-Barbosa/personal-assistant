"""test_obsidian_indexer.py — Testes unitários para integração com cofre Obsidian."""

from __future__ import annotations

import sqlite3
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest

from scripts.funcional.indexer import MultiVaultIndexer, ObsidianIndexer, VaultIndexer
from scripts.funcional.vault import VaultManager


@pytest.fixture
def tmp_obsidian_vault(tmp_path: Path) -> Path:
    (tmp_path / "Gastronomia").mkdir()
    (tmp_path / "Gastronomia" / "pizza.md").write_text(
        "# Pizza\n\nGosto de pizza napolitana.", encoding="utf-8"
    )
    (tmp_path / "Gastronomia" / "sushi.md").write_text(
        "---\ntitulo: Sushi\ntags: [japones]\n---\nAdoro sashimi de salmao.",
        encoding="utf-8",
    )
    (tmp_path / "Eu").mkdir()
    (tmp_path / "Eu" / "Pessoal.md").write_text("# Pessoal\n\nMinha nota pessoal.", encoding="utf-8")
    (tmp_path / ".obsidian").mkdir()
    (tmp_path / ".obsidian" / "config.md").write_text("ignorado", encoding="utf-8")
    (tmp_path / ".trash").mkdir()
    (tmp_path / ".trash" / "lixo.md").write_text("descartado", encoding="utf-8")
    (tmp_path / "README.md").write_text("# Vault\n\nMeu vault.", encoding="utf-8")
    return tmp_path


@pytest.fixture
def tmp_db(tmp_path: Path) -> Path:
    return tmp_path / "test_cache.db"


class TestVaultManagerRecursive:
    def test_lista_arquivos_recursivamente(self, tmp_obsidian_vault: Path) -> None:
        vm = VaultManager(vault_path=tmp_obsidian_vault, recursive=True)
        nomes = {p.name for p in vm.listar_notas()}
        assert "pizza.md" in nomes
        assert "sushi.md" in nomes
        assert "Pessoal.md" in nomes
        assert "README.md" in nomes

    def test_ignora_diretorios_ocultos(self, tmp_obsidian_vault: Path) -> None:
        vm = VaultManager(vault_path=tmp_obsidian_vault, recursive=True)
        nomes = {p.name for p in vm.listar_notas()}
        assert "config.md" not in nomes
        assert "lixo.md" not in nomes

    def test_total_de_notas(self, tmp_obsidian_vault: Path) -> None:
        vm = VaultManager(vault_path=tmp_obsidian_vault, recursive=True)
        assert len(vm.listar_notas()) == 4

    def test_modo_nao_recursivo_lista_apenas_raiz(self, tmp_obsidian_vault: Path) -> None:
        vm = VaultManager(vault_path=tmp_obsidian_vault, recursive=False)
        nomes = {p.name for p in vm.listar_notas()}
        assert "README.md" in nomes
        assert "pizza.md" not in nomes

    def test_resolve_path_por_stem(self, tmp_obsidian_vault: Path) -> None:
        vm = VaultManager(vault_path=tmp_obsidian_vault, recursive=True)
        resolved = vm._resolve_path("pizza")
        assert resolved.exists()
        assert resolved.name == "pizza.md"


class TestObsidianIndexerExtraction:
    def test_extrai_titulo_do_frontmatter(self) -> None:
        post = SimpleNamespace(content="conteudo", get=lambda k, d="": {"titulo": "Meu Titulo", "title": ""}.get(k, d))
        assert ObsidianIndexer._extract_obsidian_title(Path("nota.md"), post) == "Meu Titulo"

    def test_extrai_titulo_do_h1(self) -> None:
        post = SimpleNamespace(content="# Titulo H1\n\nConteudo.", get=lambda k, d="": d)
        assert ObsidianIndexer._extract_obsidian_title(Path("nota.md"), post) == "Titulo H1"

    def test_extrai_titulo_do_stem(self) -> None:
        post = SimpleNamespace(content="sem cabecalho", get=lambda k, d="": d)
        assert ObsidianIndexer._extract_obsidian_title(Path("minha-nota.md"), post) == "minha-nota"

    def test_extrai_categoria_da_subpasta(self, tmp_obsidian_vault: Path) -> None:
        path = tmp_obsidian_vault / "Gastronomia" / "pizza.md"
        assert ObsidianIndexer._extract_category(path, tmp_obsidian_vault) == "Gastronomia"

    def test_extrai_categoria_vazia_para_raiz(self, tmp_obsidian_vault: Path) -> None:
        path = tmp_obsidian_vault / "README.md"
        assert ObsidianIndexer._extract_category(path, tmp_obsidian_vault) == ""

    def test_build_doc_text_inclui_categoria(self) -> None:
        inst = ObsidianIndexer.__new__(ObsidianIndexer)
        text = inst._build_doc_text_obsidian("Pizza", "Gosto de pizza", "Gastronomia", ["italiana"])
        assert "Titulo: Pizza" in text or "Título: Pizza" in text
        assert "Categoria: Gastronomia" in text
        assert "Gosto de pizza" in text


class TestObsidianIndexerDB:
    def test_cria_tabela_obsidian_index(self, tmp_obsidian_vault: Path, tmp_db: Path) -> None:
        ObsidianIndexer(vault_path=tmp_obsidian_vault, db_path=tmp_db)
        with sqlite3.connect(str(tmp_db)) as conn:
            cur = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='obsidian_index'")
            assert cur.fetchone() is not None

    def test_nao_interfere_com_vault_index(self, tmp_obsidian_vault: Path, tmp_path: Path, tmp_db: Path) -> None:
        default_vm = VaultManager(vault_path=tmp_path / "default")
        (tmp_path / "default").mkdir(exist_ok=True)
        VaultIndexer(vault=default_vm, db_path=tmp_db)
        ObsidianIndexer(vault_path=tmp_obsidian_vault, db_path=tmp_db)
        with sqlite3.connect(str(tmp_db)) as conn:
            tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
        assert "vault_index" in tables
        assert "obsidian_index" in tables


class TestMultiVaultIndexer:
    def test_busca_combina_resultados(self) -> None:
        default_idx = MagicMock(spec=VaultIndexer)
        obsidian_idx = MagicMock(spec=ObsidianIndexer)
        default_idx.buscar_notas.return_value = [{"titulo": "Padrao", "path": Path("/d/n.md"), "score": 0.9, "preview": "p", "hash": "a"}]
        obsidian_idx.buscar_notas.return_value = [{"titulo": "Obsidian", "path": Path("/o/n.md"), "score": 0.95, "preview": "p", "hash": "b", "vault": "obsidian", "categoria": "Gastronomia"}]
        default_idx.db_path = Path("/tmp/cache.db")
        multi = MultiVaultIndexer(default_indexer=default_idx, obsidian_indexer=obsidian_idx)
        results = multi.buscar_notas("pizza", top_k=5)
        assert results[0]["titulo"] == "Obsidian"
        assert results[1]["vault"] == "default"

    def test_continua_se_vault_padrao_falhar(self) -> None:
        default_idx = MagicMock(spec=VaultIndexer)
        obsidian_idx = MagicMock(spec=ObsidianIndexer)
        default_idx.buscar_notas.side_effect = RuntimeError("falha")
        obsidian_idx.buscar_notas.return_value = [{"titulo": "OK", "path": Path("/o/ok.md"), "score": 0.8, "preview": "ok", "hash": "c", "vault": "obsidian", "categoria": ""}]
        default_idx.db_path = Path("/tmp/cache.db")
        multi = MultiVaultIndexer(default_indexer=default_idx, obsidian_indexer=obsidian_idx)
        results = multi.buscar_notas("ok", top_k=5)
        assert len(results) == 1
        assert results[0]["titulo"] == "OK"

    def test_get_stats_retorna_ambos(self) -> None:
        default_idx = MagicMock(spec=VaultIndexer)
        obsidian_idx = MagicMock(spec=ObsidianIndexer)
        default_idx.get_stats.return_value = {"count": 3}
        obsidian_idx.get_stats.return_value = {"count": 95}
        default_idx.db_path = Path("/tmp/cache.db")
        multi = MultiVaultIndexer(default_indexer=default_idx, obsidian_indexer=obsidian_idx)
        stats = multi.get_stats()
        assert stats["default"]["count"] == 3
        assert stats["obsidian"]["count"] == 95
