#!/usr/bin/env python3
"""Validação Sprint 04 — Gerenciador de sessões e histórico.

CLI para criar, listar, alternar, continuar chats e verificar histórico acumulado.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT: Path = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.funcional.chat_manager import ChatManager


def _clear() -> None:
    os.system("cls" if os.name == "nt" else "clear")


def _header(m: ChatManager, current: str | None) -> None:
    print("=" * 72)
    print("  SECOND BRAIN — Validação Sprint 04: Sessões & Histórico (SQLite)")
    print("=" * 72)
    try:
        sessions: list[dict] = m.listar_sessoes()
        print(f"  DB: {m.db_path} | sessões: {len(sessions)}")
        if current:
            cur: dict | None = m.obter_sessao(current)
            titulo: str = cur["titulo"] if cur else "?"
            cnt: int = m.contar_mensagens(current)
            print(f"  Sessão ativa: {current[:8]}… \"{titulo}\" ({cnt} msgs)")
        else:
            print("  Sessão ativa: (nenhuma — crie com [1])")
    except Exception as exc:
        print(f"  [WARN] {exc}")
    print("-" * 72)


def _menu() -> None:
    print(
        """
  [1] Criar nova sessão
  [2] Listar sessões (ordenadas por atividade)
  [3] Alternar sessão ativa
  [4] Enviar mensagem (user → assistant simulado)
  [5] Ver histórico da sessão ativa
  [6] Renomear sessão ativa
  [7] Limpar histórico da sessão ativa
  [8] Deletar sessão
  [9] Stress-test: alternar & persistir múltiplas sessões
  [0] Sair
"""
    )


def _acao_criar(m: ChatManager) -> str | None:
    titulo: str = input("  Título da nova sessão (Enter p/ auto): ").strip()
    try:
        sid: str = m.criar_sessao(titulo if titulo else None)
        print(f"  [OK] Sessão criada: {sid} \"{m.obter_sessao(sid)['titulo']}\"")
        return sid
    except Exception as exc:
        print(f"  [ERRO] {exc}")
        return None


def _acao_listar(m: ChatManager) -> None:
    try:
        sessions: list[dict] = m.listar_sessoes()
    except Exception as exc:
        print(f"  [ERRO] {exc}")
        return
    if not sessions:
        print("\n  Nenhuma sessão encontrada.")
        return
    print(f"\n  {len(sessions)} sessão(ões):")
    for i, s in enumerate(sessions, 1):
        try:
            cnt: int = m.contar_mensagens(s["id"])
        except Exception:
            cnt = 0
        print(f"    {i:>2}. {s['id'][:8]}… | {s['titulo']:<28} | {cnt:>2} msgs | upd: {s['updated_at'][:19]}")


def _acao_alternar(m: ChatManager, current: str | None) -> str | None:
    sessions: list[dict] = m.listar_sessoes()
    if not sessions:
        print("  [WARN] Nenhuma sessão — crie com [1]")
        return current
    _acao_listar(m)
    raw: str = input("\n  Digite número ou id da sessão: ").strip()
    if not raw:
        print("  [cancelado]")
        return current
    # Permite número
    if raw.isdigit():
        idx: int = int(raw) - 1
        if 0 <= idx < len(sessions):
            sid: str = sessions[idx]["id"]
            print(f"  [OK] Ativa: {sid[:8]}… \"{sessions[idx]['titulo']}\"")
            return sid
        print("  [ERRO] Número fora do range.")
        return current
    # Id parcial ou completo
    for s in sessions:
        if s["id"].startswith(raw) or s["id"] == raw:
            print(f"  [OK] Ativa: {s['id'][:8]}… \"{s['titulo']}\"")
            return s["id"]
    print("  [ERRO] Sessão não encontrada.")
    return current


def _acao_enviar(m: ChatManager, current: str | None) -> None:
    if not current:
        print("  [ERRO] Nenhuma sessão ativa — crie/alterne primeiro.")
        return
    # Mostra histórico resumido
    try:
        hist: list[dict] = m.carregar_historico(current)
        if hist:
            print(f"\n  Histórico atual ({len(hist)} msgs) — últimas 3:")
            for h in hist[-3:]:
                print(f"    {h['role']:>9}: {h['content'][:70]}")
        else:
            print("\n  Histórico vazio.")
    except Exception as exc:
        print(f"  [ERRO] {exc}")
        return

    user: str = input("\n  Mensagem do user: ").strip()
    if not user:
        print("  [cancelado] vazia.")
        return
    try:
        m.adicionar_mensagem(current, "user", user)
        print("  → user adicionado.")
        # Simula assistant (sem LLM nesta sprint)
        assistant: str = input("  Resposta do assistant (simulado, Enter p/ auto 'echo'): ").strip()
        if not assistant:
            assistant = f"Echo: {user}"
        m.adicionar_mensagem(current, "assistant", assistant)
        print(f"  → assistant adicionado. Total: {m.contar_mensagens(current)} msgs")
    except (FileNotFoundError, ValueError) as exc:
        print(f"  [ERRO] {exc}")
    except Exception as exc:
        print(f"  [ERRO] Inesperado: {exc}")


def _acao_ver(m: ChatManager, current: str | None) -> None:
    if not current:
        print("  [ERRO] Nenhuma sessão ativa.")
        return
    try:
        hist: list[dict] = m.carregar_historico(current)
        sess: dict | None = m.obter_sessao(current)
        print("\n" + "=" * 72)
        print(f"  Histórico — {sess['titulo'] if sess else current} ({len(hist)} msgs)")
        print("-" * 72)
        if not hist:
            print("  (vazio)")
        for h in hist:
            tag: str = f"[{h['id']:>3}] {h['role']:>9} @ {h['created_at'][:19]}"
            print(f"  {tag}: {h['content']}")
            if h.get("tool_calls"):
                print(f"           tool_calls: {h['tool_calls'][:80]}")
        print("=" * 72)
    except FileNotFoundError as exc:
        print(f"  [ERRO] {exc}")
    except Exception as exc:
        print(f"  [ERRO] {exc}")


def _acao_renomear(m: ChatManager, current: str | None) -> None:
    if not current:
        print("  [ERRO] Nenhuma sessão ativa.")
        return
    novo: str = input("  Novo título: ").strip()
    if not novo:
        print("  [cancelado]")
        return
    try:
        ok: bool = m.renomear_sessao(current, novo)
        print(f"  {'[OK] Renomeada' if ok else '[ERRO] Não encontrada'}")
    except Exception as exc:
        print(f"  [ERRO] {exc}")


def _acao_limpar(m: ChatManager, current: str | None) -> None:
    if not current:
        print("  [ERRO] Nenhuma sessão ativa.")
        return
    confirm: str = input("  Limpar TODO histórico desta sessão? (s/N): ").strip().lower()
    if confirm != "s":
        print("  [cancelado]")
        return
    try:
        n: int = m.limpar_historico(current)
        print(f"  [OK] {n} mensagem(ns) removida(s).")
    except Exception as exc:
        print(f"  [ERRO] {exc}")


def _acao_deletar(m: ChatManager, current: str | None) -> str | None:
    sessions: list[dict] = m.listar_sessoes()
    if not sessions:
        print("  [WARN] Nenhuma sessão.")
        return current
    _acao_listar(m)
    raw: str = input("\n  Qual deletar? (número/id): ").strip()
    if not raw:
        print("  [cancelado]")
        return current
    sid: str | None = None
    if raw.isdigit():
        idx: int = int(raw) - 1
        if 0 <= idx < len(sessions):
            sid = sessions[idx]["id"]
    else:
        for s in sessions:
            if s["id"].startswith(raw) or s["id"] == raw:
                sid = s["id"]
                break
    if not sid:
        print("  [ERRO] Não encontrada.")
        return current
    confirm: str = input(f"  Confirmar deleção de {sid[:8]}…? (s/N): ").strip().lower()
    if confirm != "s":
        print("  [cancelado]")
        return current
    try:
        ok: bool = m.deletar_sessao(sid)
        print(f"  {'[OK] Deletada' if ok else '[ERRO] Falha'}")
        if current == sid:
            # Troca para mais recente ou None
            remaining: list[dict] = m.listar_sessoes()
            return remaining[0]["id"] if remaining else None
        return current
    except Exception as exc:
        print(f"  [ERRO] {exc}")
        return current


def _acao_stress(m: ChatManager) -> None:
    print("\n  Stress-test: cria 3 sessões, intercala 2 msgs cada, verifica isolamento...")
    try:
        s1: str = m.criar_sessao("Stress A")
        s2: str = m.criar_sessao("Stress B")
        s3: str = m.criar_sessao("Stress C")
        for sid, label in [(s1, "A"), (s2, "B"), (s3, "C")]:
            m.adicionar_mensagem(sid, "user", f"msg {label} 1")
            m.adicionar_mensagem(sid, "assistant", f"resp {label} 1")
            m.adicionar_mensagem(sid, "user", f"msg {label} 2")
        # Verifica
        for sid, label in [(s1, "A"), (s2, "B"), (s3, "C")]:
            cnt: int = m.contar_mensagens(sid)
            hist: list[dict] = m.carregar_historico(sid)
            assert cnt == 3, f"cnt {label}"
            assert hist[0]["content"] == f"msg {label} 1"
        print("  [OK] Isolamento verificado (3 msgs por sessão, sem vazamento).")
        print(f"       ids: {s1[:6]}…, {s2[:6]}…, {s3[:6]}…")
        # Cleanup opcional
        if input("  Remover sessões de stress? (s/N): ").strip().lower() == "s":
            for sid in (s1, s2, s3):
                m.deletar_sessao(sid)
            print("  [OK] Removidas.")
    except Exception as exc:
        print(f"  [ERRO] {exc}")


def main() -> None:
    try:
        m: ChatManager = ChatManager()
    except RuntimeError as exc:
        print(f"[ERRO] {exc}")
        sys.exit(1)

    current: str | None = None
    # Auto-seleciona sessão mais recente se existir
    try:
        sessions: list[dict] = m.listar_sessoes()
        if sessions:
            current = sessions[0]["id"]
    except Exception:
        pass

    while True:
        _header(m, current)
        _menu()
        try:
            escolha: str = input("  Escolha: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\n\n  Até logo!")
            break

        if escolha == "1":
            sid: str | None = _acao_criar(m)
            if sid:
                current = sid
        elif escolha == "2":
            _acao_listar(m)
        elif escolha == "3":
            current = _acao_alternar(m, current)
        elif escolha == "4":
            _acao_enviar(m, current)
        elif escolha == "5":
            _acao_ver(m, current)
        elif escolha == "6":
            _acao_renomear(m, current)
        elif escolha == "7":
            _acao_limpar(m, current)
        elif escolha == "8":
            current = _acao_deletar(m, current)
        elif escolha == "9":
            _acao_stress(m)
        elif escolha == "0":
            print("\n  Até logo!")
            break
        else:
            print("  [ERRO] Opção inválida (0-9).")

        input("\n  Pressione ENTER para continuar...")
        _clear()


if __name__ == "__main__":
    main()
