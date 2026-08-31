"""Testes Sprint 05 — Overlay Raycast/Chat.

Valida instanciação, alternância de modos e atalhos de teclado (offscreen).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

# Offscreen para CI/headless
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from scripts.funcional.overlay_ui import OverlayWindow


@pytest.fixture(scope="module")
def qapp() -> MagicMock:
    """Cria QApplication única para todos os testes."""
    from PySide6.QtWidgets import QApplication

    app: QApplication | None = QApplication.instance()
    if app is None:
        app = QApplication(sys.argv)
    return app  # type: ignore[return-value]


@pytest.fixture
def mock_managers() -> tuple[MagicMock, MagicMock]:
    chat_manager: MagicMock = MagicMock()
    chat_manager.listar_sessoes.return_value = [
        {"id": "sess_abc123", "titulo": "Conversa Teste", "created_at": "2026-01-01T00:00:00+00:00", "updated_at": "2026-01-01T00:00:00+00:00"},
        {"id": "sess_def456", "titulo": "Outra Sessão", "created_at": "2026-01-01T00:00:00+00:00", "updated_at": "2026-01-01T00:00:00+00:00"},
    ]
    chat_manager.carregar_historico.return_value = [
        {"id": 1, "session_id": "sess_abc123", "role": "user", "content": "hello", "tool_call_id": None, "tool_calls": None, "created_at": "2026-01-01T00:00:00+00:00"},
        {"id": 2, "session_id": "sess_abc123", "role": "assistant", "content": "hi!", "tool_call_id": None, "tool_calls": None, "created_at": "2026-01-01T00:00:00+00:00"},
    ]
    chat_manager.criar_sessao.return_value = "sess_new123"
    chat_manager.contar_mensagens.return_value = 2

    agent_core: MagicMock = MagicMock()
    agent_core.system_prompt = "test system"
    agent_core.chat.return_value = "resposta mockada"
    agent_core.gravar_e_transcrever.return_value = "transcrição mock"

    return chat_manager, agent_core


def test_instanciacao_widgets(qapp: MagicMock, mock_managers: tuple[MagicMock, MagicMock]) -> None:
    chat_manager, agent_core = mock_managers
    win: OverlayWindow = OverlayWindow(agent_core=agent_core, chat_manager=chat_manager, hotkey="alt+space")
    assert win.raycast_bar is not None
    assert win.chat_view is not None
    assert win.sidebar is not None
    assert hasattr(win.raycast_bar, "search_input") and win.raycast_bar.search_input is not None
    assert win.is_raycast_mode is True
    assert win.is_chat_mode is False
    win.close()


def test_alternancia_modos(qapp: MagicMock, mock_managers: tuple[MagicMock, MagicMock]) -> None:
    chat_manager, agent_core = mock_managers
    win: OverlayWindow = OverlayWindow(agent_core=agent_core, chat_manager=chat_manager)
    win.show()
    assert win.is_raycast_mode is True
    assert win.chat_view.isHidden() is True  # raycast inicia com chat oculto

    win.switch_to_chat_mode()
    assert win.is_chat_mode is True
    assert win.is_raycast_mode is False
    assert win.chat_view.isHidden() is False

    win.switch_to_raycast_mode()
    assert win.is_raycast_mode is True
    assert win.chat_view.isHidden() is True

    win.toggle_mode()
    assert win.is_chat_mode is True
    win.toggle_mode()
    assert win.is_raycast_mode is True
    win.close()


def test_toggle_sidebar(qapp: MagicMock, mock_managers: tuple[MagicMock, MagicMock]) -> None:
    chat_manager, agent_core = mock_managers
    win: OverlayWindow = OverlayWindow(agent_core=agent_core, chat_manager=chat_manager)
    # Começa recolhida em raycast
    assert win.is_sidebar_collapsed() is True
    win.switch_to_chat_mode()
    assert win.is_sidebar_collapsed() is False
    win._toggle_sidebar()
    assert win.is_sidebar_collapsed() is True
    win._toggle_sidebar()
    assert win.is_sidebar_collapsed() is False
    win.close()


def test_toggle_visibility(qapp: MagicMock, mock_managers: tuple[MagicMock, MagicMock]) -> None:
    chat_manager, agent_core = mock_managers
    win: OverlayWindow = OverlayWindow(agent_core=agent_core, chat_manager=chat_manager)
    win.show()
    assert win.isVisible() is True
    win.hide_overlay()
    assert win.isVisible() is False
    win.show_overlay()
    assert win.isVisible() is True
    win.toggle_visibility()
    assert win.isVisible() is False
    win.toggle_visibility()
    assert win.isVisible() is True
    win.close()


def test_session_select_carrega_historico(qapp: MagicMock, mock_managers: tuple[MagicMock, MagicMock]) -> None:
    chat_manager, agent_core = mock_managers
    win: OverlayWindow = OverlayWindow(agent_core=agent_core, chat_manager=chat_manager)
    win.show()
    # Simula seleção de sessão
    win._on_session_selected("sess_abc123")
    assert win.current_session_id == "sess_abc123"
    # Chat view deve ter mensagens carregadas
    assert win.chat_view.messages.count() >= 2
    chat_manager.carregar_historico.assert_called()
    win.close()


def test_raycast_submit_expande_chat_e_envia(qapp: MagicMock, mock_managers: tuple[MagicMock, MagicMock]) -> None:
    chat_manager, agent_core = mock_managers
    win: OverlayWindow = OverlayWindow(agent_core=agent_core, chat_manager=chat_manager)
    win.show()
    assert win.is_raycast_mode is True
    win._on_raycast_submit("pergunta teste")
    # Deve ter expandido para chat
    assert win.is_chat_mode is True
    # Espera worker thread + Signal (async) — antes era síncrono, agora thread-safe
    from PySide6.QtCore import QEventLoop, QTimer

    loop = QEventLoop()
    QTimer.singleShot(800, loop.quit)
    loop.exec()
    # Processa signals pendentes
    from PySide6.QtWidgets import QApplication

    QApplication.processEvents()
    assert win.chat_view.messages.count() >= 2
    agent_core.chat.assert_called()
    win.close()


def test_shortcuts_existentes(qapp: MagicMock, mock_managers: tuple[MagicMock, MagicMock]) -> None:
    chat_manager, agent_core = mock_managers
    win: OverlayWindow = OverlayWindow(agent_core=agent_core, chat_manager=chat_manager, hotkey="right_shift")
    # Verifica que shortcuts de janela foram criados (Esc, Tab, Ctrl+N, Ctrl+B)
    from PySide6.QtGui import QShortcut

    shortcuts: list[QShortcut] = win.findChildren(QShortcut)
    assert len(shortcuts) >= 3  # Esc, Tab, Ctrl+N
    keys: list[str] = [s.key().toString().lower() for s in shortcuts]
    # Esc e Tab devem estar presentes
    assert any("esc" in k for k in keys)
    assert any("tab" in k for k in keys)
    win.close()


def test_hold_to_talk_attributes(qapp: MagicMock, mock_managers: tuple[MagicMock, MagicMock]) -> None:
    chat_manager, agent_core = mock_managers
    win: OverlayWindow = OverlayWindow(agent_core=agent_core, chat_manager=chat_manager, hotkey="right_shift")
    # Verifica atributos de hold-to-talk
    assert hasattr(win, "_key_press_time")
    assert hasattr(win, "_tap_threshold")
    assert hasattr(win, "_voice_stop_fn")
    assert hasattr(win, "_voice_recording")
    assert win._tap_threshold == 0.2
    assert win._voice_recording is False
    assert win._voice_stop_fn is None
    win.close()


def test_hotkey_is_right_shift(qapp: MagicMock, mock_managers: tuple[MagicMock, MagicMock]) -> None:
    chat_manager, agent_core = mock_managers
    win: OverlayWindow = OverlayWindow(agent_core=agent_core, chat_manager=chat_manager, hotkey="right_shift")
    # Verifica que o hotkey_str foi configurado
    assert win.hotkey_str == "right_shift"
    win.close()


def test_frameless_e_tema(qapp: MagicMock, mock_managers: tuple[MagicMock, MagicMock]) -> None:
    chat_manager, agent_core = mock_managers
    win: OverlayWindow = OverlayWindow(agent_core=agent_core, chat_manager=chat_manager)
    # Frameless
    assert bool(win.windowFlags() & win.windowFlags().__class__.FramelessWindowHint)
    # Tema escuro aplicado
    assert win.styleSheet() != ""
    assert "#1e1e1e" in win.styleSheet()
    win.close()


def test_nova_sessao_cria_e_seleciona(qapp: MagicMock, mock_managers: tuple[MagicMock, MagicMock]) -> None:
    chat_manager, agent_core = mock_managers
    chat_manager.criar_sessao.return_value = "sess_new999"
    win: OverlayWindow = OverlayWindow(agent_core=agent_core, chat_manager=chat_manager)
    win.show()
    win._on_new_session()
    chat_manager.criar_sessao.assert_called()
    assert win.current_session_id == "sess_new999"
    win.close()
