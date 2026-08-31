#!/usr/bin/env python3
"""Validação Sprint 05 — Interface Raycast & Chat completa.

Inicia OCULTO (só o terminal fica visível). Pressione Right Shift para invocar:
tap curto abre o overlay, segurar grava voz. Converse por texto/voz, pesquise
notas no cofre e retome chats antigos visualmente.

Fallback CLI caso PySide6 não esteja disponível.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT: Path = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv()

HOTKEY: str = os.getenv("HOTKEY", "right_shift")


def _run_cli_fallback() -> None:
    """Modo CLI caso GUI não possa iniciar."""
    print("=" * 72)
    print("  SECOND BRAIN — Sprint 05 (CLI fallback — PySide6 indisponível)")
    print("=" * 72)
    try:
        from scripts.funcional.agent_core import AgentCore
        from scripts.funcional.chat_manager import ChatManager

        agent: AgentCore = AgentCore()
        chat: ChatManager = ChatManager()
        try:
            agent.indexer.reindexar_tudo(force=False)
        except Exception:
            pass
        print(f"  Vault: {agent.vault.vault_path} ({len(agent.vault.listar_notas())} notas)")
        print(f"  Sessões: {len(chat.listar_sessoes())} | Atalho configurado: {HOTKEY}")
        print("-" * 72)
        sid: str | None = None
        sessions: list[dict] = chat.listar_sessoes()
        if sessions:
            sid = sessions[0]["id"]
            print(f"  Sessão ativa: {sid[:8]}… \"{sessions[0]['titulo']}\"")
        else:
            sid = chat.criar_sessao("CLI Sprint05")
            print(f"  Nova sessão: {sid[:8]}…")
        print("\n  Digite mensagens (texto) — 'sair' para encerrar")
        if os.getenv("DEEPSEEK_API_KEY", "sk-placeholder") in ("", "sk-placeholder", "sk-xxx"):
            print("  [MOCK] DEEPSEEK_API_KEY não configurada — usando busca local")
        while True:
            try:
                user: str = input("\n  Você: ").strip()
            except (EOFError, KeyboardInterrupt):
                break
            if not user or user.lower() in ("sair", "exit", "quit"):
                break
            chat.adicionar_mensagem(sid, "user", user)
            try:
                if os.getenv("DEEPSEEK_API_KEY", "sk-placeholder") in ("", "sk-placeholder"):
                    results: list[dict] = agent.indexer.buscar_notas(user, top_k=3)
                    if results:
                        resp: str = "Busca local:\n" + "\n".join(f"• {r['titulo']} ({r['score']:.2f})" for r in results)
                    else:
                        resp = f"Echo: {user}"
                else:
                    resp = agent.chat(user)
                print(f"  Assistente: {resp}")
                chat.adicionar_mensagem(sid, "assistant", resp)
            except Exception as exc:
                print(f"  [ERRO] {exc}")
        print("\n  Até logo!")
    except Exception as exc:
        print(f"[ERRO] Fallback falhou: {exc}")
        sys.exit(1)


def _get_hotkey() -> str:
    # Re-lê .env na hora (evita valor stale importado antes do load_dotenv)
    try:
        from dotenv import load_dotenv

        load_dotenv(override=True)
    except Exception:
        pass
    return (os.getenv("HOTKEY") or "right_shift").strip()


def main() -> None:
    os.environ.setdefault("QT_QPA_PLATFORM", "windows" if os.name == "nt" else "xcb")

    try:
        import signal

        from PySide6.QtCore import QTimer
        from PySide6.QtWidgets import QApplication

        from scripts.funcional.overlay_ui import OverlayWindow, create_app

        hotkey: str = _get_hotkey()
        print("=" * 72)
        print("  SECOND BRAIN — Sprint 05: Overlay Raycast/Chat (PySide6)")
        print("=" * 72)
        print(f"  Iniciando oculto (segundo plano)…  Atalho: Right Shift  |  PySide6 {QApplication.__module__}")
        print("  Uso: TAP no Right Shift abre o overlay  |  SEGURAR grava voz  |  Esc esconde")
        print("  Dicas: Tab alterna Raycast↔Chat, Ctrl+N nova sessão, Ctrl+B recolhe painel")
        print("  Encerrar: Ctrl+C no terminal")
        print("-" * 72)

        try:
            app, win = create_app(hotkey=hotkey)
        except Exception as exc:
            print(f"[ERRO] Falha ao criar overlay: {exc}")
            print("  → Caindo para CLI fallback")
            _run_cli_fallback()
            return

        # Permite Ctrl+C no terminal (Qt bloqueia SIGINT sem timer)
        # Timer mantém interpreter vivo para processar SIGINT
        win._sig_timer = QTimer()  # type: ignore[attr-defined]
        win._sig_timer.start(400)
        win._sig_timer.timeout.connect(lambda: None)

        def _sig_handler(*_: object) -> None:
            print("\n[EXIT] Ctrl+C → encerrando...")
            win.force_quit()
            try:
                app.quit()
            except Exception:
                pass

        signal.signal(signal.SIGINT, _sig_handler)  # type: ignore
        # Windows também precisa de SIGBREAK para Ctrl+Break
        try:
            signal.signal(signal.SIGBREAK, _sig_handler)  # type: ignore[attr-defined]
        except Exception:
            pass

        started: bool = win.start_global_hotkey()
        if started:
            print(f"  [OK] Atalho global '{win.hotkey_str}' registrado (HOTKEY no .env='{hotkey}' — apenas informativo).")
            print("  [OK] Overlay oculto — TAP no Right Shift abre; SEGURAR grava voz.")
            print("  [SOUND] Som suave (mp3) em todas as ações — teste agora!")
        else:
            print(f"  [WARN] Atalho global '{hotkey}'→'{win.hotkey_str}' falhou — exibindo overlay como fallback (sem hotkey não há como invocar)")
            win.show()
            win.raise_()

        try:
            sys.exit(app.exec())
        except SystemExit:
            raise
        finally:
            try:
                win.stop_global_hotkey()
            except Exception:
                pass

    except ImportError as exc:
        print(f"[WARN] PySide6 não disponível ({exc}) — usando CLI fallback")
        _run_cli_fallback()
    except Exception as exc:
        print(f"[ERRO] Falha GUI: {exc}")
        import traceback

        traceback.print_exc()
        print("\n  → CLI fallback")
        _run_cli_fallback()


if __name__ == "__main__":
    main()
