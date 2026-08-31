#!/usr/bin/env python3
"""Validação Sprint 03 — Chat agêntico com texto/voz.

Terminal interativo: converse por texto ou voz, pergunte sobre cofre ou peça para salvar ideias.
Requer DEEPSEEK_API_KEY e GROQ_API_KEY no .env para modo real; modo MOCK disponível.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT: Path = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.funcional.agent_core import AgentCore


def _check_keys() -> tuple[bool, bool]:
    deepseek: str = (os.getenv("DEEPSEEK_API_KEY") or "").strip()
    groq: str = (os.getenv("GROQ_API_KEY") or "").strip()
    has_deepseek: bool = deepseek not in ("", "sk-placeholder", "sk-xxx")
    has_groq: bool = groq not in ("", "gsk_placeholder", "gsk_xxx")
    return has_deepseek, has_groq


def _header(agent: AgentCore) -> None:
    has_ds, has_groq = _check_keys()
    print("=" * 72)
    print("  SECOND BRAIN — Validação Sprint 03: Motor Agêntico + Voz")
    print("=" * 72)
    print(f"  Modelo: {agent.deepseek_model} @ {agent.deepseek_base_url}")
    print(f"  Vault: {agent.vault.vault_path} ({len(agent.vault.listar_notas())} notas)")
    try:
        print(f"  Índice: {agent.indexer.get_stats()['count']} vetores | STT: {agent.groq_model}")
    except Exception:
        print(f"  STT: {agent.groq_model}")
    print(f"  DeepSeek: {'● OK' if has_ds else '○ MOCK/fake (defina DEEPSEEK_API_KEY no .env)'}")
    print(f"  Groq: {'● OK' if has_groq else '○ MOCK/fake'}")
    print("-" * 72)


def _menu() -> None:
    print(
        """
  [1] Conversar por texto (tool calling real)
  [2] Conversar por voz (gravar 5s + transcrever + chat)
  [3] Transcrever arquivo de áudio (wav/mp3)
  [4] Testar decisão MOCK (sem API) — cria/busca local
  [5] Ver notas do cofre
  [6] Limpar histórico de chat
  [0] Sair
"""
    )


def _acao_chat_texto(agent: AgentCore) -> None:
    has_ds, _ = _check_keys()
    if not has_ds:
        print("\n  [AVISO] DEEPSEEK_API_KEY não configurada. Use opção 4 (MOCK) ou defina no .env.")
        return
    print("\n  --- Chat por texto (digite 'voltar' para sair) ---")
    while True:
        try:
            user: str = input("\n  Você: ").strip()
        except (EOFError, KeyboardInterrupt):
            break
        if not user:
            continue
        if user.lower() in ("voltar", "sair", "exit", "quit"):
            break
        try:
            print("  Agente: pensando...", end="\r")
            resp: str = agent.chat(user)
            print(f"  Agente: {resp}          ")
        except RuntimeError as exc:
            print(f"\n  [ERRO] {exc}")
        except Exception as exc:
            print(f"\n  [ERRO] Inesperado: {exc}")


def _acao_chat_voz(agent: AgentCore) -> None:
    has_ds, has_groq = _check_keys()
    if not has_ds or not has_groq:
        print("\n  [AVISO] Configure DEEPSEEK_API_KEY e GROQ_API_KEY no .env para voz real.")
        return
    dur_raw: str = input("  Duração da gravação em segundos (padrão 5): ").strip()
    try:
        dur: float = float(dur_raw) if dur_raw else 5.0
    except ValueError:
        print("  [ERRO] Duração inválida.")
        return
    try:
        texto: str = agent.gravar_e_transcrever(duration=dur)
        print(f"\n  Transcrição: \"{texto}\"")
        if not texto.strip():
            print("  [WARN] Transcrição vazia, tente novamente.")
            return
        confirm: str = input("  Enviar para o agente? (s/N): ").strip().lower()
        if confirm != "s":
            print("  [cancelado]")
            return
        print("  Agente: pensando...", end="\r")
        resp: str = agent.chat(texto)
        print(f"  Agente: {resp}          ")
    except RuntimeError as exc:
        print(f"\n  [ERRO] {exc}")
    except Exception as exc:
        print(f"\n  [ERRO] Inesperado: {exc}")


def _acao_transcrever_arquivo(agent: AgentCore) -> None:
    has_groq: bool = _check_keys()[1]
    if not has_groq:
        print("\n  [AVISO] GROQ_API_KEY não configurada.")
        return
    path: str = input("  Caminho do áudio (wav/mp3/m4a): ").strip().strip('"')
    if not path:
        print("  [cancelado]")
        return
    try:
        texto: str = agent.transcrever_arquivo(path)
        print(f"\n  Transcrição: \"{texto}\"")
        if input("  Enviar para o agente? (s/N): ").strip().lower() == "s":
            resp: str = agent.chat(texto)
            print(f"  Agente: {resp}")
    except (FileNotFoundError, RuntimeError) as exc:
        print(f"  [ERRO] {exc}")
    except Exception as exc:
        print(f"  [ERRO] Inesperado: {exc}")


def _acao_mock(agent: AgentCore) -> None:
    """Demonstra decisão agêntica sem chamar API externa."""
    print(
        """
  --- Modo MOCK (sem API) ---
  Testa tools locais diretamente:
  1) buscar_notas  2) salvar_nota  3) atualizar_nota  4) ler_nota
"""
    )
    escolha: str = input("  Escolha tool (1-4): ").strip()
    if escolha == "1":
        q: str = input("  Query: ").strip()
        try:
            res: str = agent._execute_tool("buscar_notas", {"query": q, "top_k": 5})
            print(f"\n  Resultado: {res}")
        except Exception as exc:
            print(f"  [ERRO] {exc}")
    elif escolha == "2":
        titulo: str = input("  Título: ").strip()
        corpo: str = input("  Corpo (com [[links]]): ").strip()
        tags: list[str] = [t.strip() for t in input("  Tags (vírgula): ").split(",") if t.strip()]
        try:
            res = agent._execute_tool("salvar_nota", {"titulo": titulo, "corpo": corpo, "tags": tags})
            print(f"\n  Resultado: {res}")
        except Exception as exc:
            print(f"  [ERRO] {exc}")
    elif escolha == "3":
        ident: str = input("  Identifier (título/caminho): ").strip()
        novo: str = input("  Novo conteúdo: ").strip()
        modo: str = input("  Modo [append/replace] (padrão append): ").strip() or "append"
        try:
            res = agent._execute_tool("atualizar_nota", {"identifier": ident, "novo_conteudo": novo, "modo": modo})
            print(f"\n  Resultado: {res}")
        except Exception as exc:
            print(f"  [ERRO] {exc}")
    elif escolha == "4":
        ident: str = input("  Identifier: ").strip()
        try:
            res = agent._execute_tool("ler_nota", {"identifier": ident})
            print(f"\n  Resultado: {res[:2000]}")
        except Exception as exc:
            print(f"  [ERRO] {exc}")
    else:
        print("  [ERRO] Opção inválida.")


def _acao_ver_notas(agent: AgentCore) -> None:
    try:
        notas: list[Path] = agent.vault.listar_notas()
    except OSError as exc:
        print(f"  [ERRO] {exc}")
        return
    if not notas:
        print("\n  Cofre vazio.")
        return
    print(f"\n  {len(notas)} nota(s):")
    for p in notas:
        try:
            meta, _ = agent.vault.ler_nota(p)
            print(f"    • {p.name:<28} | {meta.get('titulo','?'):<25} | tags={meta.get('tags',[])}")
        except Exception as exc:
            print(f"    • {p.name} [erro: {exc}]")


def main() -> None:
    try:
        agent: AgentCore = AgentCore()
    except (OSError, RuntimeError) as exc:
        print(f"[ERRO] Falha ao inicializar AgentCore: {exc}")
        sys.exit(1)

    # Reindex silencioso inicial
    try:
        agent.indexer.reindexar_tudo(force=False)
    except Exception:
        pass

    while True:
        _header(agent)
        _menu()
        try:
            escolha: str = input("  Escolha: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\n\n  Até logo!")
            break

        if escolha == "1":
            _acao_chat_texto(agent)
        elif escolha == "2":
            _acao_chat_voz(agent)
        elif escolha == "3":
            _acao_transcrever_arquivo(agent)
        elif escolha == "4":
            _acao_mock(agent)
        elif escolha == "5":
            _acao_ver_notas(agent)
        elif escolha == "6":
            agent.reset_history()
            print("\n  [OK] Histórico limpo.")
        elif escolha == "0":
            print("\n  Até logo!")
            break
        else:
            print("  [ERRO] Opção inválida (0-6).")

        input("\n  Pressione ENTER para continuar...")
        os.system("cls" if os.name == "nt" else "clear")


if __name__ == "__main__":
    main()
