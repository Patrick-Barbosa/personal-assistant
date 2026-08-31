#!/usr/bin/env python3
"""Validação interativa Sprint 01 — Cofre Markdown.

Menu amigável para criar, editar e visualizar arquivos em cofres/default/
sem atrito. Tratamento de exceções com mensagens claras e saída limpa.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

# Garante import a partir da raiz do projeto
ROOT: Path = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.funcional.vault import VaultManager

try:
    import frontmatter  # noqa: F401 — apenas para verificar dependência
except ImportError:
    print("[ERRO] Dependência 'python-frontmatter' não encontrada. Rode: pip install python-frontmatter")
    sys.exit(1)


def _clear() -> None:
    os.system("cls" if os.name == "nt" else "clear")


def _header(vm: VaultManager) -> None:
    print("=" * 62)
    print("  SECOND BRAIN — Validação Sprint 01: Cofre Markdown")
    print("=" * 62)
    print(f"  Cofre: {vm.vault_path}")
    try:
        qtd: int = len(vm.listar_notas())
    except Exception:
        qtd = 0
    print(f"  Notas: {qtd} arquivo(s) .md")
    print("-" * 62)


def _print_menu() -> None:
    print(
        """
  [1] Listar notas
  [2] Visualizar nota (ler + frontmatter)
  [3] Criar nova nota
  [4] Atualizar nota (append / replace)
  [5] Deletar nota
  [6] Extrair frontmatter (YAML)
  [0] Sair
"""
    )


def _escolher_nota(vm: VaultManager, prompt: str = "Identificador (nome/título/caminho): ") -> str | None:
    notas: list[Path] = []
    try:
        notas = vm.listar_notas()
    except OSError as exc:
        print(f"[ERRO] Falha ao listar: {exc}")
        return None

    if not notas:
        print("\n  (cofre vazio — crie a primeira nota com opção 3)")
        return None

    print("\n  Notas disponíveis:")
    for idx, p in enumerate(notas, 1):
        try:
            meta, _ = vm.ler_nota(p)
            titulo: str = str(meta.get("titulo", p.stem))
            tags: str = ", ".join(meta.get("tags", [])) if meta.get("tags") else "-"
        except Exception:
            titulo = p.stem
            tags = "-"
        print(f"    {idx:>2}. {p.name:<30} | titulo: {titulo:<25} | tags: {tags}")

    raw: str = input(f"\n  {prompt}").strip()
    if not raw:
        print("  [cancelado] identificador vazio.")
        return None

    # Permite digitar número da lista
    if raw.isdigit():
        i: int = int(raw) - 1
        if 0 <= i < len(notas):
            return str(notas[i])
        print("  [ERRO] Número fora do range.")
        return None

    return raw


def _acao_listar(vm: VaultManager) -> None:
    try:
        notas: list[Path] = vm.listar_notas()
    except OSError as exc:
        print(f"\n[ERRO] {exc}")
        return
    if not notas:
        print("\n  Nenhuma nota encontrada em cofres/default/.")
        return
    print(f"\n  {len(notas)} nota(s) encontrada(s):\n")
    for p in notas:
        try:
            meta, corpo = vm.ler_nota(p)
            print(f"  • {p.name}")
            print(f"    id: {meta.get('id','-')}  |  data: {meta.get('data','-')}")
            print(f"    titulo: {meta.get('titulo','-')}")
            print(f"    tags: {meta.get('tags',[])}  topicos: {meta.get('topicos',[])}")
            preview: str = corpo.strip().replace("\n", " ")[:90]
            if len(corpo.strip()) > 90:
                preview += "…"
            print(f"    preview: {preview}\n")
        except Exception as exc:
            print(f"  • {p.name}  [erro ao ler: {exc}]")


def _acao_visualizar(vm: VaultManager) -> None:
    ident: str | None = _escolher_nota(vm, "Qual nota visualizar? (número ou nome/título): ")
    if ident is None:
        return
    try:
        meta, corpo = vm.ler_nota(ident)
        path: Path = vm._resolve_path(ident)  # type: ignore[attr-defined]
        print("\n" + "=" * 62)
        print(f"  Arquivo: {path.name}")
        print(f"  Caminho: {path}")
        print("-" * 62)
        print("  FRONTMATTER (YAML):")
        for k, v in meta.items():
            print(f"    {k}: {v}")
        print("-" * 62)
        print("  CONTEÚDO Markdown:")
        print(corpo if corpo.strip() else "  (vazio)")
        print("=" * 62)
    except FileNotFoundError as exc:
        print(f"\n[ERRO] {exc}")
    except Exception as exc:
        print(f"\n[ERRO] Falha ao ler nota: {exc}")


def _acao_criar(vm: VaultManager) -> None:
    print("\n  --- Criar nova nota ---")
    titulo: str = input("  Título: ").strip()
    if not titulo:
        print("  [ERRO] Título não pode ser vazio.")
        return
    print("  Dica: use [[Nome da Nota]] para links bidirecionais.")
    corpo: str = input("  Corpo (Markdown, linha única; deixe vazio para corpo de exemplo): ").strip()
    if not corpo:
        corpo = f"# {titulo}\n\nConteúdo inicial. Link para [[Outra Nota]]."
        print(f"  (usando corpo padrão: {corpo[:60]}…)")

    tags_raw: str = input("  Tags (separadas por vírgula, ex: ideia, trabalho): ").strip()
    tags: list[str] = [t.strip() for t in tags_raw.split(",") if t.strip()] if tags_raw else []

    topicos_raw: str = input("  Tópicos (separados por vírgula): ").strip()
    topicos: list[str] = [t.strip() for t in topicos_raw.split(",") if t.strip()] if topicos_raw else []

    try:
        path: Path = vm.criar_nota(titulo=titulo, corpo=corpo, tags=tags, topicos=topicos)
        meta, _ = vm.ler_nota(path)
        print(f"\n  [OK] Nota criada: {path.name}")
        print(f"       id: {meta.get('id')}  data: {meta.get('data')}")
        print(f"       caminho: {path}")
    except ValueError as exc:
        print(f"\n[ERRO] {exc}")
    except OSError as exc:
        print(f"\n[ERRO] Falha de disco: {exc}")
    except Exception as exc:
        print(f"\n[ERRO] Inesperado: {exc}")


def _acao_atualizar(vm: VaultManager) -> None:
    ident: str | None = _escolher_nota(vm, "Qual nota atualizar? (número ou nome/título): ")
    if ident is None:
        return
    try:
        meta, corpo = vm.ler_nota(ident)
        print(f"\n  Atualizando: {meta.get('titulo')} ({vm._resolve_path(ident).name})")  # type: ignore[attr-defined]
        print(f"  Conteúdo atual (primeiros 200 chars): {corpo.strip()[:200]}")
    except Exception as exc:
        print(f"\n[ERRO] {exc}")
        return

    modo: str = input("  Modo [append=adicionar ao final / replace=substituir] (padrão append): ").strip().lower()
    if not modo:
        modo = "append"
    if modo not in ("append", "replace"):
        print("  [ERRO] Modo deve ser 'append' ou 'replace'.")
        return

    novo: str = input("  Novo conteúdo (pode conter [[links]]): ").strip()
    if not novo:
        print("  [cancelado] conteúdo vazio.")
        return

    novo_titulo: str = input("  Novo título (Enter para manter): ").strip()
    tags_raw: str = input("  Novas tags (vírgula) ou Enter para manter: ").strip()
    tags: list[str] | None = [t.strip() for t in tags_raw.split(",") if t.strip()] if tags_raw else None

    topicos_raw: str = input("  Novos tópicos (vírgula) ou Enter para manter: ").strip()
    topicos: list[str] | None = [t.strip() for t in topicos_raw.split(",") if t.strip()] if topicos_raw else None

    try:
        path: Path = vm.atualizar_nota(
            ident,
            novo_conteudo=novo,
            novo_titulo=novo_titulo if novo_titulo else None,
            tags=tags,
            topicos=topicos,
            modo=modo,
        )
        print(f"\n  [OK] Nota atualizada: {path.name} (modo={modo})")
        _, novo_corpo = vm.ler_nota(path)
        print(f"       novo tamanho: {len(novo_corpo)} chars")
    except (FileNotFoundError, ValueError, OSError) as exc:
        print(f"\n[ERRO] {exc}")
    except Exception as exc:
        print(f"\n[ERRO] Inesperado: {exc}")


def _acao_deletar(vm: VaultManager) -> None:
    ident: str | None = _escolher_nota(vm, "Qual nota deletar? (número ou nome/título): ")
    if ident is None:
        return
    try:
        path: Path = vm._resolve_path(ident)  # type: ignore[attr-defined]
        confirm: str = input(f"  Confirmar deleção de '{path.name}'? (s/N): ").strip().lower()
        if confirm != "s":
            print("  [cancelado]")
            return
        vm.deletar_nota(ident)
        print(f"\n  [OK] Deletada: {path.name}")
    except FileNotFoundError as exc:
        print(f"\n[ERRO] {exc}")
    except OSError as exc:
        print(f"\n[ERRO] Falha ao deletar: {exc}")


def _acao_frontmatter(vm: VaultManager) -> None:
    ident: str | None = _escolher_nota(vm, "Qual nota extrair frontmatter? (número ou nome/título): ")
    if ident is None:
        return
    try:
        fm: dict = vm.extrair_frontmatter(ident)
        print("\n  YAML Frontmatter:")
        for k, v in fm.items():
            print(f"    {k}: {v}")
        # Validação RN02
        print("\n  Checagem RN02:")
        for campo in ("id", "titulo", "data", "tags", "topicos"):
            status: str = "OK" if campo in fm else "FALTANDO"
            print(f"    {campo}: {status}")
    except FileNotFoundError as exc:
        print(f"\n[ERRO] {exc}")
    except Exception as exc:
        print(f"\n[ERRO] {exc}")


def main() -> None:
    try:
        vm: VaultManager = VaultManager()
    except OSError as exc:
        print(f"[ERRO] Falha ao inicializar cofre: {exc}")
        sys.exit(1)

    while True:
        _header(vm)
        _print_menu()
        try:
            escolha: str = input("  Escolha uma opção: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\n\n  Até logo!")
            break

        if escolha == "1":
            _acao_listar(vm)
        elif escolha == "2":
            _acao_visualizar(vm)
        elif escolha == "3":
            _acao_criar(vm)
        elif escolha == "4":
            _acao_atualizar(vm)
        elif escolha == "5":
            _acao_deletar(vm)
        elif escolha == "6":
            _acao_frontmatter(vm)
        elif escolha == "0":
            print("\n  Até logo!")
            break
        else:
            print("\n  [ERRO] Opção inválida. Digite 0-6.")

        input("\n  Pressione ENTER para continuar...")
        _clear()


if __name__ == "__main__":
    main()
