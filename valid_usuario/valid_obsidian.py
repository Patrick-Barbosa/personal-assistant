"""valid_obsidian.py — Validacao interativa: Multi-Vault Indexer (padrao + Obsidian).

Uso: uv run python valid_usuario/valid_obsidian.py
"""
from __future__ import annotations

import sys
import time
from pathlib import Path


def _project_root() -> Path:
    return Path(__file__).resolve().parent.parent


sys.path.insert(0, str(_project_root()))


def _barra(current: int, total: int, width: int = 40) -> str:
    pct = current / total if total else 0
    filled = int(width * pct)
    bar = chr(9608) * filled + chr(9617) * (width - filled)
    return f"[{bar}] {current}/{total} ({pct*100:.0f}%%)"


def _indexar_com_progresso(indexer: object, vault_name: str) -> int:
    """Indexa vault com barra de progresso simples."""
    from scripts.funcional.indexer import VaultIndexer, ObsidianIndexer

    if not isinstance(indexer, (VaultIndexer, ObsidianIndexer)):
        return 0

    try:
        notas = indexer.vault.listar_notas()  # type: ignore[attr-defined]
    except Exception as exc:
        print(f"  [WARN] Nao foi possivel listar notas de {vault_name}: {exc}")
        return 0

    total = len(notas)
    if total == 0:
        print(f"  {vault_name}: vault vazio.")
        return 0

    print(f"\n  Indexando {vault_name} ({total} notas)...")
    count = 0
    for i, nota in enumerate(notas, 1):
        try:
            did = indexer.indexar_nota(nota)  # type: ignore[attr-defined]
            if did:
                count += 1
        except Exception:
            pass
        print(f"  \r  {_barra(i, total)}", end="", flush=True)

    print(f"\n  Concluido: {count} notas (re)indexadas de {total}.")
    return count


def _linha(char: str = "-", width: int = 60) -> None:
    print(char * width)


def main() -> None:
    print()
    _linha("=")
    print("  VALIDACAO: Multi-Vault Indexer (Padrao + Obsidian)")
    _linha("=")

    from scripts.funcional.indexer import MultiVaultIndexer, ObsidianIndexer, VaultIndexer
    from scripts.funcional.vault import VaultManager

    # -------------------------------------------------------
    print("\n[1/3] Inicializando vaults e indexers...")
    try:
        default_vm = VaultManager()
        default_idx = VaultIndexer(vault=default_vm)
        obsidian_idx = ObsidianIndexer()
        multi = MultiVaultIndexer(
            default_indexer=default_idx,
            obsidian_indexer=obsidian_idx,
        )
        print(f"  Vault padrao : {default_vm.vault_path}")
        print(f"  Vault Obsidian: {obsidian_idx.vault.vault_path}")
    except Exception as exc:
        print(f"  ERRO ao inicializar: {exc}")
        sys.exit(1)

    # -------------------------------------------------------
    print("\n[2/3] Indexacao inicial (usa cache se arquivo nao mudou)...")
    _indexar_com_progresso(default_idx, "Cofre Padrao")
    _indexar_com_progresso(obsidian_idx, "Cofre Obsidian")

    # Stats
    print()
    _linha()
    stats = multi.get_stats()
    print(f"  Indice padrao  : {stats['default']['count']} notas indexadas")
    print(f"  Indice Obsidian: {stats['obsidian']['count']} notas indexadas")
    _linha()

    # -------------------------------------------------------
    print("\n[3/3] Busca interativa (Ctrl+C ou 'sair' para encerrar)\n")
    consultas_sugeridas = [
        "quem sou eu",
        "o que eu gosto de comer",
        "filmes que quero assistir",
        "livros para ler",
        "projetos em andamento",
    ]
    print("  Sugestoes de consulta:")
    for i, q in enumerate(consultas_sugeridas, 1):
        print(f"  {i}. {q}")
    print()

    while True:
        try:
            query = input("  Busca> ").strip()
        except (KeyboardInterrupt, EOFError):
            print("\n  Encerrando.")
            break

        if not query or query.lower() in ("sair", "quit", "exit"):
            print("  Encerrando.")
            break

        # Verifica se digitou numero da sugestao
        if query.isdigit() and 1 <= int(query) <= len(consultas_sugeridas):
            query = consultas_sugeridas[int(query) - 1]
            print(f"  >> Buscando: {query}")

        t0 = time.time()
        try:
            results = multi.buscar_notas(query, top_k=8)
        except Exception as exc:
            print(f"  ERRO na busca: {exc}\n")
            continue
        elapsed = time.time() - t0

        print()
        if not results:
            print("  Nenhum resultado encontrado.")
        else:
            print(f"  {len(results)} resultado(s) em {elapsed:.2f}s:\n")
            for i, r in enumerate(results, 1):
                vault_label = f"[{r.get('vault', 'default').upper()}]"
                cat = r.get("categoria", "")
                cat_label = f" / {cat}" if cat else ""
                score = r.get("score", 0)
                titulo = r.get("titulo", "?")
                preview = r.get("preview", "")
                print(f"  {i:>2}. {vault_label}{cat_label}  score={score:.4f}")
                print(f"      Titulo : {titulo}")
                print(f"      Preview: {preview[:120]}{'...' if len(preview) > 120 else ''}")
                print()
        _linha()
        print()


if __name__ == "__main__":
    main()
