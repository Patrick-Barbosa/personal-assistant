#!/usr/bin/env python3
"""Validação interativa Sprint 02 — Busca semântica local.

CLI para digitar perguntas/termos e ver notas mais similares com score.
Reindexa automaticamente e exibe frontmatter + preview.
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path

ROOT: Path = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.funcional.indexer import VaultIndexer
from scripts.funcional.vault import VaultManager


def _clear() -> None:
    os.system("cls" if os.name == "nt" else "clear")


def _header(idx: VaultIndexer) -> None:
    print("=" * 70)
    print("  SECOND BRAIN — Validação Sprint 02: Busca Semântica Local")
    print("=" * 70)
    try:
        stats: dict = idx.get_stats()
        vault_count: int = len(idx.vault.listar_notas())
        print(f"  Cofre: {idx.vault.vault_path}  ({vault_count} .md)")
        print(f"  Modelo: {stats['model']}  |  dim={stats['dim'] or '?'}")
        print(f"  Cache: {stats['db_path']}  |  indexados={stats['count']}")
    except Exception as exc:
        print(f"  [WARN] Falha ao obter stats: {exc}")
    print("-" * 70)


def _menu() -> None:
    print(
        """
  [1] Reindexar cofre (incremental)
  [2] Reindexar com --force (re-gera todos os vetores)
  [3] Buscar notas por pergunta/termo
  [4] Limpar índice (cache)
  [5] Ver detalhes de uma nota (ler)
  [6] Listar notas + status do índice
  [0] Sair
"""
    )


def _acao_reindex(idx: VaultIndexer, force: bool = False) -> None:
    print(f"\n  Reindexando ({'force' if force else 'incremental'}) — isso pode baixar modelo na 1ª vez...")
    t0: float = time.time()
    try:
        count: int = idx.reindexar_tudo(force=force)
        dt: float = time.time() - t0
        print(f"  [OK] {count} nota(s) (re)indexada(s) em {dt:.1f}s")
        stats: dict = idx.get_stats()
        print(f"       total no índice: {stats['count']} | modelo: {stats['model']}")
    except RuntimeError as exc:
        print(f"  [ERRO] {exc}")
    except Exception as exc:
        print(f"  [ERRO] Inesperado: {exc}")


def _acao_buscar(idx: VaultIndexer) -> None:
    query: str = input("\n  Digite sua pergunta/termo (ex: 'quanto custa o item X?'): ").strip()
    if not query:
        print("  [cancelado] query vazia.")
        return
    top_raw: str = input("  Top K (padrão 5): ").strip()
    try:
        top_k: int = int(top_raw) if top_raw else 5
    except ValueError:
        print("  [ERRO] top_k deve ser número inteiro.")
        return

    # Garante índice atualizado silenciosamente
    try:
        idx.reindexar_tudo(force=False)
    except Exception:
        pass

    try:
        t0: float = time.time()
        results: list[dict] = idx.buscar_notas(query, top_k=top_k)
        dt: float = time.time() - t0
        if not results:
            print(f"\n  Nenhum resultado para '{query}' (índice vazio? Reindexe com [1]).")
            return
        print(f"\n  {len(results)} resultado(s) para \"{query}\" em {dt:.2f}s (cosseno):")
        print("-" * 70)
        for i, r in enumerate(results, 1):
            score: float = r["score"]
            # Barra visual simples
            bar_len: int = int(max(0, score) * 20)
            bar: str = "█" * bar_len + "░" * (20 - bar_len)
            print(f"  {i}. {r['titulo']}  (score={score:.4f})")
            print(f"     arquivo: {Path(r['path']).name}")
            print(f"     relevância: [{bar}] {score:.2%}")
            print(f"     preview: {r['preview']}")
            print()
        # Opção de abrir
        sel: str = input("  Abrir nota? Digite número (ou ENTER p/ voltar): ").strip()
        if sel.isdigit():
            n: int = int(sel)
            if 1 <= n <= len(results):
                chosen: dict = results[n - 1]
                _mostrar_nota(idx, str(chosen["path"]))
    except ValueError as exc:
        print(f"  [ERRO] {exc}")
    except RuntimeError as exc:
        print(f"  [ERRO] {exc}")
    except Exception as exc:
        print(f"  [ERRO] Inesperado: {exc}")


def _mostrar_nota(idx: VaultIndexer, identifier: str) -> None:
    try:
        meta, corpo = idx.vault.ler_nota(identifier)
        print("\n" + "=" * 70)
        print(f"  {meta.get('titulo','?')} — {identifier}")
        print(f"  id={meta.get('id')}  tags={meta.get('tags')}  topicos={meta.get('topicos')}")
        print("-" * 70)
        print(corpo.strip()[:2000] if corpo.strip() else "(vazio)")
        print("=" * 70)
    except Exception as exc:
        print(f"  [ERRO] Falha ao ler nota: {exc}")


def _acao_limpar(idx: VaultIndexer) -> None:
    confirm: str = input("  Limpar todo o cache vetorial? (s/N): ").strip().lower()
    if confirm != "s":
        print("  [cancelado]")
        return
    try:
        idx.limpar_indice()
        print("  [OK] Índice limpo.")
    except RuntimeError as exc:
        print(f"  [ERRO] {exc}")


def _acao_listar(idx: VaultIndexer) -> None:
    try:
        notas: list[Path] = idx.vault.listar_notas()
        stats: dict = idx.get_stats()
        print(f"\n  Notas no disco: {len(notas)} | Indexadas: {stats['count']}")
        if not notas:
            print("  (cofre vazio)")
            return
        for p in notas:
            try:
                meta, _ = idx.vault.ler_nota(p)
                titulo: str = str(meta.get("titulo", p.stem))
                # Checa se está indexada
                import sqlite3

                with sqlite3.connect(str(idx.db_path)) as conn:
                    cur = conn.execute("SELECT 1 FROM vault_index WHERE path = ?", (str(p.resolve()),))
                    indexed: bool = cur.fetchone() is not None
                status: str = "● indexada" if indexed else "○ pendente"
                print(f"    {p.name:<30} | {titulo:<25} | {status}")
            except Exception as exc:
                print(f"    {p.name} [erro: {exc}]")
    except Exception as exc:
        print(f"  [ERRO] {exc}")


def _acao_ver(idx: VaultIndexer) -> None:
    ident: str = input("\n  Identificador (nome/título/caminho): ").strip()
    if not ident:
        print("  [cancelado]")
        return
    _mostrar_nota(idx, ident)


def main() -> None:
    try:
        vault: VaultManager = VaultManager()
        idx: VaultIndexer = VaultIndexer(vault=vault)
    except (OSError, RuntimeError) as exc:
        print(f"[ERRO] Falha ao inicializar: {exc}")
        sys.exit(1)

    # Primeira abertura: tenta reindexar silenciosamente se índice vazio
    try:
        if idx.get_stats()["count"] == 0 and len(vault.listar_notas()) > 0:
            print("  Índice vazio detectado — reindexando automaticamente...")
            idx.reindexar_tudo(force=False)
            print(f"  [OK] {idx.get_stats()['count']} nota(s) indexada(s).")
    except Exception:
        pass

    while True:
        _header(idx)
        _menu()
        try:
            escolha: str = input("  Escolha: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\n\n  Até logo!")
            break

        if escolha == "1":
            _acao_reindex(idx, force=False)
        elif escolha == "2":
            _acao_reindex(idx, force=True)
        elif escolha == "3":
            _acao_buscar(idx)
        elif escolha == "4":
            _acao_limpar(idx)
        elif escolha == "5":
            _acao_ver(idx)
        elif escolha == "6":
            _acao_listar(idx)
        elif escolha == "0":
            print("\n  Até logo!")
            break
        else:
            print("  [ERRO] Opção inválida (0-6).")

        input("\n  Pressione ENTER para continuar...")
        _clear()


if __name__ == "__main__":
    main()
