"""Testes unitários Sprint 01 — VaultManager.

Validação de escrita, leitura e sanitização de nomes de arquivos.
"""

from __future__ import annotations

import os
import re
import tempfile
from pathlib import Path

import frontmatter
import pytest

from scripts.funcional.vault import VaultManager


@pytest.fixture
def tmp_vault(tmp_path: Path) -> VaultManager:
    """Vault isolado em diretório temporário."""
    vault_dir: Path = tmp_path / "vault"
    vault_dir.mkdir()
    return VaultManager(vault_path=vault_dir)


def test_criar_e_ler_nota(tmp_vault: VaultManager) -> None:
    vm: VaultManager = tmp_vault
    path: Path = vm.criar_nota(
        titulo="Minha Primeira Nota",
        corpo="Conteúdo com [[Link]] e texto.",
        tags=["ideia", "teste"],
        topicos=["python"],
    )
    assert path.exists()
    assert path.suffix == ".md"

    meta, corpo = vm.ler_nota(path)
    assert meta["titulo"] == "Minha Primeira Nota"
    assert meta["tags"] == ["ideia", "teste"]
    assert meta["topicos"] == ["python"]
    assert "id" in meta
    assert re.match(r"^\d{14}$", str(meta["id"]))
    assert "data" in meta
    assert corpo.strip() == "Conteúdo com [[Link]] e texto."

    # Leitura por título
    meta2, _ = vm.ler_nota("Minha Primeira Nota")
    assert meta2["titulo"] == "Minha Primeira Nota"


def test_frontmatter_persistido_com_python_frontmatter(tmp_vault: VaultManager) -> None:
    vm: VaultManager = tmp_vault
    path: Path = vm.criar_nota(titulo="Nota YAML", corpo="corpo xyz", tags=["a"])
    # Leitura raw via biblioteca frontmatter diretamente
    post: frontmatter.Post = frontmatter.load(str(path))
    assert post["titulo"] == "Nota YAML"
    assert post.content.strip() == "corpo xyz"


def test_listar_notas_ordenadas(tmp_vault: VaultManager) -> None:
    vm: VaultManager = tmp_vault
    vm.criar_nota(titulo="B Nota", corpo="b")
    vm.criar_nota(titulo="A Nota", corpo="a")
    vm.criar_nota(titulo="C Nota", corpo="c")
    files: list[Path] = vm.listar_notas()
    assert len(files) == 3
    names: list[str] = [p.name for p in files]
    assert names == sorted(names)


def test_extrair_frontmatter(tmp_vault: VaultManager) -> None:
    vm: VaultManager = tmp_vault
    path: Path = vm.criar_nota(titulo="Extrair", corpo="conteúdo", tags=["x"], topicos=["y"])
    fm: dict = vm.extrair_frontmatter(path)
    assert fm["titulo"] == "Extrair"
    assert fm["tags"] == ["x"]
    # Alias EN
    fm2: dict = vm.get_frontmatter("Extrair")
    assert fm2["titulo"] == "Extrair"


def test_atualizar_nota_append(tmp_vault: VaultManager) -> None:
    vm: VaultManager = tmp_vault
    path: Path = vm.criar_nota(titulo="Atualizar", corpo="linha1")
    vm.atualizar_nota(path, novo_conteudo="linha2", modo="append")
    _, corpo = vm.ler_nota(path)
    assert "linha1" in corpo
    assert "linha2" in corpo

    # replace
    vm.atualizar_nota(path, novo_conteudo="novo", modo="replace")
    _, corpo2 = vm.ler_nota(path)
    assert corpo2.strip() == "novo"
    assert "linha1" not in corpo2


def test_atualizar_nota_metadados(tmp_vault: VaultManager) -> None:
    vm: VaultManager = tmp_vault
    path: Path = vm.criar_nota(titulo="Meta", corpo="corpo", tags=["old"])
    vm.atualizar_nota(path, novo_titulo="Meta Novo", tags=["new"], topicos=["t1"])
    meta, _ = vm.ler_nota(path)
    assert meta["titulo"] == "Meta Novo"
    assert meta["tags"] == ["new"]
    assert meta["topicos"] == ["t1"]


def test_sanitizacao_nomes_invalidos(tmp_vault: VaultManager) -> None:
    vm: VaultManager = tmp_vault
    # Título com caracteres proibidos Windows
    titulo_invalido: str = 'Item: Preço <100> "especial" | teste?*'
    path: Path = vm.criar_nota(titulo=titulo_invalido, corpo="corpo")
    # Arquivo não deve conter caracteres inválidos
    assert not any(c in path.name for c in '<>:"/\\|?*')
    # Mas frontmatter preserva título original
    meta, _ = vm.ler_nota(path)
    assert meta["titulo"] == titulo_invalido

    # Sanitização direta
    assert VaultManager.sanitize_filename('a:b/c') == "a_b_c"
    assert VaultManager.sanitize_filename('   ') == "sem_titulo"
    assert VaultManager.sanitize_filename('CON') == "_CON"


def test_colisao_nome_gera_sufixo(tmp_vault: VaultManager) -> None:
    vm: VaultManager = tmp_vault
    p1: Path = vm.criar_nota(titulo="Duplicado", corpo="um")
    p2: Path = vm.criar_nota(titulo="Duplicado", corpo="dois")
    assert p1 != p2
    assert p1.exists() and p2.exists()
    _, c1 = vm.ler_nota(p1)
    _, c2 = vm.ler_nota(p2)
    assert c1.strip() == "um"
    assert c2.strip() == "dois"


def test_erro_titulo_vazio(tmp_vault: VaultManager) -> None:
    vm: VaultManager = tmp_vault
    with pytest.raises(ValueError):
        vm.criar_nota(titulo="   ", corpo="corpo")


def test_erro_nota_nao_encontrada(tmp_vault: VaultManager) -> None:
    vm: VaultManager = tmp_vault
    with pytest.raises(FileNotFoundError):
        vm.ler_nota("inexistente")
    with pytest.raises(FileNotFoundError):
        vm.atualizar_nota("inexistente", novo_conteudo="x")
    with pytest.raises(FileNotFoundError):
        vm.deletar_nota("inexistente")


def test_deletar_nota(tmp_vault: VaultManager) -> None:
    vm: VaultManager = tmp_vault
    path: Path = vm.criar_nota(titulo="Deletar", corpo="bye")
    assert path.exists()
    vm.deletar_nota(path)
    assert not path.exists()


def test_vault_path_via_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    env_vault: Path = tmp_path / "env_cofre"
    monkeypatch.setenv("VAULT_PATH", str(env_vault))
    vm: VaultManager = VaultManager(vault_path=None)
    assert vm.vault_path == env_vault.resolve()
    assert vm.vault_path.exists()
    # Criação funciona no path do env
    p: Path = vm.criar_nota(titulo="Env Test", corpo="ok")
    assert p.exists()


def test_modo_invalido_atualizar(tmp_vault: VaultManager) -> None:
    vm: VaultManager = tmp_vault
    path: Path = vm.criar_nota(titulo="Modo", corpo="a")
    with pytest.raises(ValueError):
        vm.atualizar_nota(path, novo_conteudo="b", modo="invalido")  # type: ignore[arg-type]
