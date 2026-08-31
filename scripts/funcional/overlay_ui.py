"""OverlayUI — Sprint 05: Interface Raycast & Chat em PySide6.

Janela modal frameless tema escuro, Raycast bar + expansão chat, painel lateral de sessões,
atalho global via pynput. Integra VaultManager / VaultIndexer / AgentCore / ChatManager.
"""

from __future__ import annotations

import os
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

from dotenv import load_dotenv

load_dotenv()

# Garante prints utf-8 no terminal Windows cp1252 (evita crash com emoji/●)
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")  # type: ignore
except Exception:
    pass


def _safe_print(*args: Any, **kwargs: Any) -> None:
    try:
        # use builtins print to avoid recursion
        import builtins

        builtins.print(*args, **kwargs)
    except UnicodeEncodeError:
        try:
            import builtins as _b

            txt = " ".join(str(a) for a in args)
            _b.print(txt.encode("ascii", errors="replace").decode("ascii"), **kwargs)
        except Exception:
            pass

try:
    from PySide6.QtCore import Qt, QPoint, Signal, QSize, QTimer, Slot
    from PySide6.QtGui import QAction, QColor, QFont, QIcon, QKeySequence, QPainter, QPixmap, QShortcut
    from PySide6.QtWidgets import (
        QAbstractItemView,
        QApplication,
        QFrame,
        QHBoxLayout,
        QLabel,
        QLineEdit,
        QListWidget,
        QListWidgetItem,
        QMainWindow,
        QMenu,
        QPushButton,
        QSplitter,
        QTextEdit,
        QVBoxLayout,
        QWidget,
    )

    _QT_AVAILABLE: bool = True
except ImportError:
    _QT_AVAILABLE = False

# Importa managers com try para permitir import mesmo sem dependências pesadas em testes de import
try:
    from scripts.funcional.agent_core import AgentCore
    from scripts.funcional.chat_manager import ChatManager
    from scripts.funcional.vault import VaultManager
    from scripts.funcional.indexer import VaultIndexer
except Exception:
    AgentCore = None  # type: ignore
    ChatManager = None  # type: ignore


_DARK_QSS: str = """
QWidget { background-color: transparent; color: #e0e0e0; font-family: 'Inter', 'Segoe UI Variable Text', 'Segoe UI', sans-serif; font-size: 13px; }
#centralWidget { background-color: #1e1e1e; border-radius: 14px; border: 1px solid #333333; }
QLineEdit { background-color: #2d2d2d; border: 1px solid #3a3a3a; border-radius: 10px; padding: 10px 14px; color: #f0f0f0; selection-background-color: #3b82f6; }
QLineEdit:focus { border: 1px solid #3b82f6; }
QTextEdit { background-color: #252525; border: 1px solid #3a3a3a; border-radius: 10px; }
QListWidget { background-color: #252525; border: 1px solid #3a3a3a; border-radius: 10px; outline: none; }
QListWidget::item { padding: 8px 10px; border-radius: 8px; }
QListWidget::item:selected { background-color: rgba(59, 130, 246, 0.30); color: #ffffff; }
QListWidget::item:hover { background-color: #2a2a2a; }
QPushButton { background-color: #2f2f36; border: none; border-radius: 10px; padding: 8px 14px; color: #e0e0e0; font-weight: 500; }
QPushButton:hover { background-color: #3a3a44; }
QPushButton:pressed { background-color: #3b82f6; color: #ffffff; }
QPushButton:disabled { background-color: #26262c; color: #6b6b74; }
QPushButton[iconButton="true"] { background-color: transparent; border: none; border-radius: 9px; color: #9a9aa4; padding: 6px; font-family: "Segoe Fluent Icons", "Segoe MDL2 Assets"; font-size: 13px; }
QPushButton[iconButton="true"]:hover { background-color: #2f2f36; color: #ffffff; }
QPushButton[iconButton="true"]:pressed { background-color: #3b82f6; color: #ffffff; }
QPushButton[iconButton="true"]:disabled { background-color: transparent; color: #5a5a62; }
QPushButton[recording="true"] { background-color: #c23b3b; color: #ffffff; }
QPushButton[primary="true"] { background-color: #3b82f6; color: #ffffff; border: none; border-radius: 10px; font-weight: 600; font-family: "Segoe Fluent Icons", "Segoe MDL2 Assets"; }
QPushButton[primary="true"]:hover { background-color: #2f6fe0; }
QPushButton[primary="true"]:pressed { background-color: #265cc0; }
QPushButton[primary="true"]:disabled { background-color: #26456e; color: #8fa8c8; }
QPushButton[accentButton="true"] { background-color: rgba(59, 130, 246, 0.14); color: #8ab5ff; border: none; border-radius: 10px; padding: 9px 12px; text-align: left; font-weight: 600; }
QPushButton[accentButton="true"]:hover { background-color: rgba(59, 130, 246, 0.24); color: #cfe0ff; }
QPushButton[accentButton="true"]:pressed { background-color: rgba(59, 130, 246, 0.38); color: #ffffff; }
QFrame { border: none; }
QSplitter::handle { background-color: transparent; }
QToolTip { background-color: #2d2d2d; color: #e0e0e0; border: 1px solid #3a3a3a; border-radius: 6px; padding: 4px 8px; }
QMenu { background-color: #26262c; border: 1px solid #3a3a44; border-radius: 10px; padding: 6px; }
QMenu::item { padding: 8px 26px 8px 12px; border-radius: 6px; color: #e0e0e0; background: transparent; }
QMenu::item:selected { background-color: #3b82f6; color: #ffffff; }
QMenu::separator { height: 1px; background-color: #3a3a44; margin: 5px 8px; }

/* --- Scrollbars modernas: finas, sem setas, handle arredondado --- */
QScrollBar:vertical { background: transparent; width: 8px; margin: 4px 2px 4px 0; }
QScrollBar::handle:vertical { background: #3f3f46; border-radius: 4px; min-height: 30px; }
QScrollBar::handle:vertical:hover { background: #5a5a66; }
QScrollBar::handle:vertical:pressed { background: #3b82f6; }
QScrollBar:horizontal { background: transparent; height: 8px; margin: 0 4px 2px 4px; }
QScrollBar::handle:horizontal { background: #3f3f46; border-radius: 4px; min-width: 30px; }
QScrollBar::handle:horizontal:hover { background: #5a5a66; }
QScrollBar::handle:horizontal:pressed { background: #3b82f6; }
QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical { height: 0px; }
QScrollBar::add-line:horizontal, QScrollBar::sub-line:horizontal { width: 0px; }
QScrollBar::add-page:vertical, QScrollBar::sub-page:vertical { background: transparent; }
QScrollBar::add-page:horizontal, QScrollBar::sub-page:horizontal { background: transparent; }
"""


# ---------------------------------------------------------------------------
# Ícones — Segoe Fluent Icons (Win11) / Segoe MDL2 Assets (Win10) + SVG opcional
# ---------------------------------------------------------------------------
_ICON_FAMILIES: list[str] = ["Segoe Fluent Icons", "Segoe MDL2 Assets"]
GLYPH_MIC: str = "\uE720"            # Microfone
GLYPH_SEND: str = "\uE724"           # Enviar
GLYPH_NEW_CHAT: str = "\uE70B"       # Lápis em quadrado (novo chat)
GLYPH_SEARCH: str = "\uE721"         # Lupa
GLYPH_MORE: str = "\uE712"           # "…" mais opções
GLYPH_EDIT: str = "\uE70F"           # Renomear
GLYPH_COPY: str = "\uE8C8"           # Copiar
GLYPH_DELETE: str = "\uE74D"         # Lixeira
GLYPH_PANEL: str = "\uE90C"          # Painel esquerdo (recolher sidebar)
GLYPH_PANEL_CLOSED: str = "\uE90D"   # Painel direito (expandir sidebar)


def _icon_font(size: int = 12) -> QFont:
    """Fonte de ícones nativa do Windows (Fluent no Win11, MDL2 no Win10)."""
    font: QFont = QFont()
    font.setFamilies(_ICON_FAMILIES)
    font.setPointSize(size)
    return font


def _glyph_icon(glyph: str, color: str = "#e0e0e0", size: int = 16) -> QIcon:
    """Renderiza um glifo da fonte de ícones em QIcon (menu/botões com texto normal).

    Renderiza em 2x e marca devicePixelRatio=2 → nítido em telas com escala (125/150%).
    """
    pm: QPixmap = QPixmap(size * 2, size * 2)
    pm.fill(Qt.GlobalColor.transparent)
    painter: QPainter = QPainter(pm)
    try:
        painter.setPen(QColor(color))
        # canvas 2x → fonte 2x (glifo mantém o tamanho lógico, com nitidez Dobrada)
        painter.setFont(_icon_font(max(int(size * 2 * 0.72), 8)))
        painter.drawText(pm.rect(), Qt.AlignmentFlag.AlignCenter, glyph)
    finally:
        painter.end()
    pm.setDevicePixelRatio(2.0)
    return QIcon(pm)


def _load_icon_svg(name: str) -> QIcon | None:
    """Ícone customizado do usuário: assets/icons/<name>.svg (opcional; fallback = glifo nativo)."""
    try:
        path: Path = Path(__file__).resolve().parent.parent.parent / "assets" / "icons" / f"{name}.svg"
        if path.exists():
            return QIcon(str(path))
    except Exception:
        pass
    return None


def _btn_icon(name: str, glyph: str, color: str = "#e0e0e0", size: int = 16) -> QIcon:
    """Ícone de botão/menu: prioriza SVG customizado; senão renderiza o glifo nativo."""
    svg: QIcon | None = _load_icon_svg(name)
    if svg is not None and not svg.isNull():
        return svg
    return _glyph_icon(glyph, color, size)


def _apply_icon(btn: QPushButton, name: str, glyph: str, size: int = 12) -> None:
    """Aplica ícone em botão: SVG customizado (sem texto) ou glifo da fonte de ícones."""
    icon: QIcon | None = _load_icon_svg(name)
    if icon is not None and not icon.isNull():
        btn.setIcon(icon)
        btn.setIconSize(QSize(18, 18))
        btn.setText("")
    else:
        btn.setFont(_icon_font(size))
        btn.setText(glyph)


def _relative_stamp(iso: str | None) -> str:
    """Timestamp curto p/ mensagens: 'hoje 14:32' / 'ontem 20:07' / '12/08 09:10'."""
    try:
        dt: datetime = datetime.fromisoformat(iso) if iso else datetime.now().astimezone()
        now: datetime = datetime.now(dt.tzinfo) if dt.tzinfo else datetime.now()
        hm: str = dt.strftime("%H:%M")
        days: int = (now.date() - dt.date()).days
        if days <= 0:
            return f"hoje {hm}"
        if days == 1:
            return f"ontem {hm}"
        return dt.strftime("%d/%m %H:%M")
    except Exception:
        return "agora"


def _session_group(iso: str) -> str:
    """Grupo de data p/ agrupar sessões: HOJE/ONTEM/ÚLTIMOS 7 DIAS/ÚLTIMOS 30 DIAS/MAIS ANTIGAS."""
    try:
        dt: datetime = datetime.fromisoformat(iso)
        now: datetime = datetime.now(dt.tzinfo) if dt.tzinfo else datetime.now()
        days: int = (now.date() - dt.date()).days
        if days <= 0:
            return "HOJE"
        if days == 1:
            return "ONTEM"
        if days <= 7:
            return "ÚLTIMOS 7 DIAS"
        if days <= 30:
            return "ÚLTIMOS 30 DIAS"
    except Exception:
        pass
    return "MAIS ANTIGAS"


def _relative_ago(iso: str | None) -> str:
    """'agora' / 'há 5 min' / 'há 2 h' / 'ontem 14:32' / 'há 3 dias' / '12/08/26'."""
    if not iso:
        return ""
    try:
        dt: datetime = datetime.fromisoformat(iso)
        now: datetime = datetime.now(dt.tzinfo) if dt.tzinfo else datetime.now()
        mins: int = int((now - dt).total_seconds() // 60)
        if mins < 1:
            return "agora"
        if mins < 60:
            return f"há {mins} min"
        days: int = (now.date() - dt.date()).days
        if days <= 0:
            return f"há {int((now - dt).total_seconds() // 3600)} h"
        if days == 1:
            return f"ontem {dt.strftime('%H:%M')}"
        if days <= 7:
            return f"há {days} dias"
        return dt.strftime("%d/%m/%y")
    except Exception:
        return ""


def _require_qt() -> None:
    if not _QT_AVAILABLE:
        raise RuntimeError("PySide6 não instalado. Rode: pip install PySide6")


class _MessageBubble(QWidget):
    """Mensagem do chat: bolha creme à direita (user) ou texto puro (assistant/system)."""

    def __init__(self, role: str, content: str, timestamp: str | None, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
        self._role: str = role
        is_user: bool = role == "user"

        root: QVBoxLayout = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 2)
        root.setSpacing(3)

        if is_user:
            stamp: QLabel = QLabel(_relative_stamp(timestamp), self)
            stamp.setStyleSheet("color: #8a8a94; font-size: 11px; background: transparent;")
            stamp.setAlignment(Qt.AlignmentFlag.AlignRight)
            root.addWidget(stamp)

        self.content: QLabel = QLabel(content, self)
        self.content.setWordWrap(True)
        self.content.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
        if is_user:
            self.content.setStyleSheet(
                "background-color: #3b342f; color: #f2ede8; font-size: 13px;"
                " border-radius: 14px; padding: 10px 14px;"
            )
            self.content.setMaximumWidth(560)  # refinado no relayout (~75% do viewport)
        elif role == "system":
            self.content.setStyleSheet("background: transparent; color: #8a8a94; font-size: 12px; font-style: italic;")
            self.content.setAlignment(Qt.AlignmentFlag.AlignHCenter)
        else:
            head: QLabel = QLabel("Second Brain", self)
            head.setStyleSheet("color: #8a8a94; font-size: 11px; background: transparent;")
            root.addWidget(head)
            self.content.setStyleSheet("background: transparent; color: #e6e6ea; font-size: 13px;")

        if is_user:
            root.addWidget(self.content, 0, Qt.AlignmentFlag.AlignRight)
        else:
            root.addWidget(self.content)

    def set_bubble_max_width(self, width: int) -> None:
        """Limita a largura da bolha do usuário (~75% do viewport), alinhada à direita."""
        if self._role == "user":
            self.content.setMaximumWidth(max(width, 280))


class RaycastBar(QWidget):
    """Barra estilo Raycast — input único com ícone."""

    submitted: Signal = Signal(str)  # type: ignore

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setObjectName("raycastBar")
        layout: QHBoxLayout = QHBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(8)

        self.icon_label: QLabel = QLabel(self)
        # Pixmap renderizado com a fonte de ícones (QSS de fonte não sobrescreve pixmap)
        self.icon_label.setPixmap(_glyph_icon(GLYPH_SEARCH, "#8a8a94", 16).pixmap(16, 16))
        self.icon_label.setFixedSize(QSize(24, 24))
        self.icon_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(self.icon_label)

        self.search_input: QLineEdit = QLineEdit(self)
        self.search_input.setPlaceholderText("Digite para buscar ou conversar…  (Enter → chat, Esc → fechar)")
        self.search_input.setClearButtonEnabled(True)
        self.search_input.returnPressed.connect(self._on_submit)  # type: ignore
        layout.addWidget(self.search_input, 1)

        self.voice_btn: QPushButton = QPushButton("", self)
        self.voice_btn.setFixedSize(QSize(36, 36))
        self.voice_btn.setToolTip("Ditar por voz (Groq Whisper)")
        self.voice_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.voice_btn.setProperty("iconButton", True)
        _apply_icon(self.voice_btn, "mic", GLYPH_MIC)
        layout.addWidget(self.voice_btn)

    def _on_submit(self) -> None:
        text: str = self.search_input.text().strip()
        if text:
            self.submitted.emit(text)  # type: ignore
            self.search_input.clear()

    def set_placeholder(self, text: str) -> None:
        self.search_input.setPlaceholderText(text)

    def focus_input(self) -> None:
        self.search_input.setFocus()
        self.search_input.selectAll()


class ChatView(QWidget):
    """View de chat contínuo com histórico de mensagens."""

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        layout: QVBoxLayout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(8)

        self.messages: QListWidget = QListWidget(self)
        self.messages.setWordWrap(True)
        self.messages.setSpacing(4)
        # Sem scroll horizontal: texto quebra na largura do viewport (ver _relayout_message_rows)
        self.messages.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.messages.setVerticalScrollMode(QAbstractItemView.ScrollMode.ScrollPerPixel)
        layout.addWidget(self.messages, 1)

        bottom: QHBoxLayout = QHBoxLayout()
        bottom.setSpacing(8)
        self.voice_btn: QPushButton = QPushButton("", self)
        self.voice_btn.setFixedSize(QSize(36, 36))
        self.voice_btn.setToolTip("Ditar por voz (Groq Whisper)")
        self.voice_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.voice_btn.setProperty("iconButton", True)
        _apply_icon(self.voice_btn, "mic", GLYPH_MIC)
        bottom.addWidget(self.voice_btn)
        self.chat_input: QLineEdit = QLineEdit(self)
        self.chat_input.setPlaceholderText("Mensagem…  (Enter para enviar)")
        self.chat_input.setClearButtonEnabled(True)
        bottom.addWidget(self.chat_input, 1)
        self.send_btn: QPushButton = QPushButton("", self)
        self.send_btn.setFixedSize(QSize(44, 36))
        self.send_btn.setToolTip("Enviar (Enter)")
        self.send_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.send_btn.setProperty("primary", True)
        _apply_icon(self.send_btn, "send", GLYPH_SEND, 11)
        bottom.addWidget(self.send_btn)
        layout.addLayout(bottom)

    def add_message(self, role: str, content: str, timestamp: str | None = None) -> None:
        """Adiciona mensagem: bolha creme à direita (user) ou texto puro (assistant/system).

        timestamp: ISO opcional (histórico usa created_at; ao vivo usa agora).
        """
        item: QListWidgetItem = QListWidgetItem()
        item.setData(Qt.ItemDataRole.UserRole, role)
        bubble: _MessageBubble = _MessageBubble(role, content, timestamp, self.messages)
        item.setSizeHint(QSize(600, bubble.sizeHint().height() + 8))
        self.messages.addItem(item)
        self.messages.setItemWidget(item, bubble)
        self._relayout_message_rows()  # alturas por heightForWidth + largura da bolha
        self.messages.scrollToBottom()

    def resizeEvent(self, event: Any) -> None:  # type: ignore[override]
        """Ao redimensionar, recalcula a altura das linhas (wrap acompanha a largura)."""
        super().resizeEvent(event)
        self._relayout_message_rows()

    def _relayout_message_rows(self) -> None:
        """Ajusta o sizeHint de cada item ao widget-bolha (wrap real, sem scroll horizontal).

        QListWidget não recalcula a altura de itens com widget nem na inserção nem
        no resize — aqui medimos cada bolha com heightForWidth na largura do viewport.
        """
        viewport_w: int = self.messages.viewport().width()
        if viewport_w <= 0:
            return
        bubble_max: int = max(int(viewport_w * 0.75), 280)
        for i in range(self.messages.count()):
            item: QListWidgetItem = self.messages.item(i)
            widget: QWidget | None = self.messages.itemWidget(item)
            if widget is None:
                continue
            if hasattr(widget, "set_bubble_max_width"):
                widget.set_bubble_max_width(bubble_max)  # type: ignore[attr-defined]
            h: int = widget.heightForWidth(viewport_w - 10) if widget.hasHeightForWidth() else widget.sizeHint().height()
            if h <= 0:
                h = widget.sizeHint().height()
            item.setSizeHint(QSize(viewport_w, h + 6))

    def clear_messages(self) -> None:
        self.messages.clear()


class _SessionRow(QWidget):
    """Linha de sessão: título bold + tempo relativo + botão '⋯' (menu de opções)."""

    rename_clicked: Signal = Signal()   # type: ignore
    delete_clicked: Signal = Signal()   # type: ignore
    copy_requested: Signal = Signal()   # type: ignore — OverlayWindow copia a transcrição

    def __init__(self, titulo: str, updated_at: str | None = None, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setObjectName("sessionRow")
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
        layout: QHBoxLayout = QHBoxLayout(self)
        layout.setContentsMargins(6, 5, 2, 5)
        layout.setSpacing(6)

        col: QVBoxLayout = QVBoxLayout()
        col.setContentsMargins(0, 0, 0, 0)
        col.setSpacing(1)
        self.title_label: QLabel = QLabel(self)
        self.title_label.setStyleSheet("color: #f0f0f0; font-size: 13px; font-weight: 600; background: transparent;")
        self.title_label.setMaximumWidth(170)
        self.update_title(titulo)
        col.addWidget(self.title_label)

        self.time_label: QLabel = QLabel(_relative_ago(updated_at), self)
        self.time_label.setStyleSheet("color: #8a8a94; font-size: 11px; background: transparent;")
        col.addWidget(self.time_label)
        layout.addLayout(col, 1)

        self.more_btn: QPushButton = QPushButton("", self)
        self.more_btn.setFixedSize(QSize(26, 26))
        self.more_btn.setToolTip("Opções da conversa")
        self.more_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.more_btn.setProperty("iconButton", True)
        _apply_icon(self.more_btn, "more", GLYPH_MORE, 10)
        self.more_btn.clicked.connect(self._show_menu)  # type: ignore
        layout.addWidget(self.more_btn, 0, Qt.AlignmentFlag.AlignTop)

    def update_title(self, titulo: str) -> None:
        metrics = self.title_label.fontMetrics()
        elided = metrics.elidedText(titulo, Qt.TextElideMode.ElideRight, 170)
        self.title_label.setText(elided)
        self.title_label.setToolTip(titulo)

    def update_time(self, iso: str | None) -> None:
        self.time_label.setText(_relative_ago(iso))

    def _show_menu(self) -> None:
        """Menu de opções estilo ChatGPT: Renomear / Copiar conversa / Excluir (vermelho)."""
        menu: QMenu = QMenu(self)
        act_rename: QAction = QAction(_btn_icon("edit", GLYPH_EDIT), "Renomear", menu)
        act_copy: QAction = QAction(_btn_icon("copy", GLYPH_COPY), "Copiar conversa", menu)
        act_delete: QAction = QAction(_btn_icon("trash", GLYPH_DELETE, "#ff6b6b"), "Excluir", menu)
        menu.addAction(act_rename)
        menu.addAction(act_copy)
        menu.addSeparator()
        menu.addAction(act_delete)
        chosen: QAction | None = menu.exec(self.more_btn.mapToGlobal(QPoint(0, self.more_btn.height())))
        if chosen is act_rename:
            self.rename_clicked.emit()  # type: ignore
        elif chosen is act_copy:
            self.copy_requested.emit()  # type: ignore
        elif chosen is act_delete:
            self.delete_clicked.emit()  # type: ignore


class Sidebar(QWidget):
    """Painel lateral retrátil com sessões agrupadas por data."""

    session_selected: Signal = Signal(str)          # type: ignore
    session_rename_requested: Signal = Signal(str, str)  # type: ignore  (session_id, new_title)
    session_delete_requested: Signal = Signal(str)  # type: ignore  session_id
    session_copy_requested: Signal = Signal(str)    # type: ignore  session_id (copiar transcrição)

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setObjectName("sidebar")
        self.setMinimumWidth(250)
        self.setMaximumWidth(320)
        layout: QVBoxLayout = QVBoxLayout(self)
        layout.setContentsMargins(6, 6, 6, 6)
        layout.setSpacing(6)

        header: QHBoxLayout = QHBoxLayout()
        title: QLabel = QLabel("Conversas", self)
        title.setStyleSheet("color: #f0f0f0; font-size: 14px; font-weight: 600; background: transparent;")
        header.addWidget(title, 1)
        self.toggle_btn: QPushButton = QPushButton("", self)
        self.toggle_btn.setFixedSize(QSize(28, 28))
        self.toggle_btn.setToolTip("Recolher painel (Ctrl+B)")
        self.toggle_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.toggle_btn.setProperty("iconButton", True)
        _apply_icon(self.toggle_btn, "panel", GLYPH_PANEL, 11)
        header.addWidget(self.toggle_btn, 0, Qt.AlignmentFlag.AlignTop)
        layout.addLayout(header)

        self.new_btn: QPushButton = QPushButton(" Nova conversa", self)
        self.new_btn.setIcon(_btn_icon("new_chat", GLYPH_NEW_CHAT, "#8ab5ff"))
        self.new_btn.setToolTip("Nova conversa (Ctrl+N)")
        self.new_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.new_btn.setProperty("accentButton", True)
        self.new_btn.setMinimumHeight(36)
        layout.addWidget(self.new_btn)

        self.session_list: QListWidget = QListWidget(self)
        self.session_list.setToolTip("Selecione para retomar chat")
        self.session_list.setSpacing(2)
        self.session_list.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.session_list.setVerticalScrollMode(QAbstractItemView.ScrollMode.ScrollPerPixel)
        self.session_list.itemClicked.connect(self._on_item_clicked)  # type: ignore
        layout.addWidget(self.session_list, 1)

    def _on_item_clicked(self, item: QListWidgetItem) -> None:
        sid: str | None = item.data(Qt.ItemDataRole.UserRole)
        if sid:
            self.session_selected.emit(sid)  # type: ignore

    def _on_rename_clicked(self, item: QListWidgetItem, row_widget: "_SessionRow") -> None:
        """Abre QLineEdit inline para renomear a sessão."""
        sid: str | None = item.data(Qt.ItemDataRole.UserRole)
        if not sid:
            return
        current_title: str = item.data(Qt.ItemDataRole.UserRole + 1) or ""

        editor = QLineEdit(current_title, self.session_list)
        editor.setStyleSheet(
            "QLineEdit { background: #2d2d2d; border: 1px solid #3b82f6; border-radius: 6px;"
            " color: #f0f0f0; font-size: 12px; padding: 2px 6px; }"
        )
        editor.setMaxLength(60)
        editor.selectAll()

        def _commit() -> None:
            new_title = editor.text().strip()
            editor.deleteLater()
            if new_title and new_title != current_title:
                self.session_rename_requested.emit(sid, new_title)  # type: ignore

        editor.returnPressed.connect(_commit)  # type: ignore
        editor.editingFinished.connect(_commit)  # type: ignore

        # Position editor over the row widget (reserve space for 2×28px buttons + spacing)
        rect = self.session_list.visualItemRect(item)
        editor.setGeometry(rect.x() + 4, rect.y() + 2, rect.width() - 70, rect.height() - 4)
        editor.show()
        editor.setFocus()

    def load_sessions(self, sessions: list[dict[str, Any]]) -> None:
        """Popula a lista com headers de data (HOJE/ONTEM/…) — headers não são clicáveis."""
        self.session_list.clear()
        current_group: str | None = None
        for s in sessions:
            group: str = _session_group(s.get("updated_at") or s.get("created_at") or "")
            if group != current_group:
                current_group = group
                header: QListWidgetItem = QListWidgetItem(group)
                header.setForeground(QColor("#77777f"))
                hfont: QFont = QFont()
                hfont.setPointSize(9)
                hfont.setBold(True)
                hfont.setLetterSpacing(QFont.SpacingType.AbsoluteSpacing, 0.8)
                header.setFont(hfont)
                header.setFlags(Qt.ItemFlag.ItemIsEnabled)  # não selecionável; clique ignorado
                self.session_list.addItem(header)

            titulo: str = s["titulo"]
            item: QListWidgetItem = QListWidgetItem()
            item.setData(Qt.ItemDataRole.UserRole, s["id"])
            item.setData(Qt.ItemDataRole.UserRole + 1, titulo)
            item.setSizeHint(QSize(0, 48))
            item.setToolTip(f"{s['id'][:8]}… — {titulo}\n{s.get('updated_at', '')[:16]}")
            self.session_list.addItem(item)

            row = _SessionRow(titulo, s.get("updated_at"), self.session_list)
            row.delete_clicked.connect(
                lambda checked=False, sid=s["id"]: self.session_delete_requested.emit(sid)  # type: ignore
            )
            row.rename_clicked.connect(
                lambda checked=False, it=item, rw=row: self._on_rename_clicked(it, rw)
            )
            row.copy_requested.connect(
                lambda checked=False, sid=s["id"]: self.session_copy_requested.emit(sid)  # type: ignore
            )
            self.session_list.setItemWidget(item, row)

        # Força repintura para garantir que os widgets de cada item são renderizados
        self.session_list.update()
        self.session_list.repaint()

    def set_collapsed(self, collapsed: bool) -> None:
        self.session_list.setVisible(not collapsed)
        self.new_btn.setVisible(not collapsed)
        _apply_icon(
            self.toggle_btn,
            "panel_closed" if collapsed else "panel",
            GLYPH_PANEL_CLOSED if collapsed else GLYPH_PANEL,
            11,
        )
        self.toggle_btn.setToolTip("Expandir painel (Ctrl+B)" if collapsed else "Recolher painel (Ctrl+B)")
        self.setMaximumWidth(60 if collapsed else 320)
        self.setMinimumWidth(60 if collapsed else 250)


class OverlayWindow(QMainWindow):
    """Janela principal overlay Raycast/Chat."""

    # Sinais para controle externo/testes
    visibility_toggled: Signal = Signal(bool)  # type: ignore
    mode_changed: Signal = Signal(str)  # type: ignore
    hotkey_triggered: Signal = Signal()  # type: ignore — thread-safe trigger do pynput
    voice_ready: Signal = Signal(str)  # type: ignore — thread-safe voz → agente
    voice_failed: Signal = Signal(str)  # type: ignore
    voice_stop: Signal = Signal()  # type: ignore — sinaliza parar gravação contínua
    agent_ready: Signal = Signal(str)  # type: ignore — thread-safe DeepSeek resposta
    agent_failed: Signal = Signal(str)  # type: ignore
    _sound_requested: Signal = Signal()  # type: ignore — toca MP3 no main thread
    title_ready: Signal = Signal(str, str)  # type: ignore — (session_id, titulo) gerado pela IA

    def __init__(
        self,
        agent_core: Any | None = None,
        chat_manager: Any | None = None,
        hotkey: str | None = None,
        parent: QWidget | None = None,
    ) -> None:
        _require_qt()
        super().__init__(parent)
        self.agent_core: Any = agent_core
        self.chat_manager: Any = chat_manager
        self.hotkey_str: str = (hotkey or os.getenv("HOTKEY") or "alt+space").strip().lower()
        self._is_raycast_mode: bool = True
        self._sidebar_collapsed: bool = False
        self._current_session_id: str | None = None
        self._hotkey_listener: Any | None = None
        self._force_quit: bool = False
        # Hold-to-talk
        self._key_press_time: float = 0.0
        self._held_duration_snapshot: float = 0.0  # medido no thread pynput (tempo real)
        self._tap_threshold: float = 0.2  # 200ms — duração máxima para tap
        self._voice_stop_fn: Any | None = None  # callable para parar gravação contínua
        self._voice_recording: bool = False  # True enquanto gravação estiver ativa
        self._voice_cancel_requested: bool = False  # cancelamento pedido enquanto a stream ainda abria
        self._start_recording_sound_path: Path = Path(__file__).resolve().parent.parent.parent / "assets" / "start-recording.mp3"
        # Instâncias persistentes de QMediaPlayer/QAudioOutput (evita GC prematuro que crashava Qt)
        self._rec_player: Any | None = None
        self._rec_audio_output: Any | None = None

        self._setup_window()
        self._setup_ui()
        self._setup_shortcuts()
        self.hotkey_triggered.connect(self.toggle_visibility)  # thread-safe hotkey
        self.voice_ready.connect(self._on_voice_success)  # type: ignore
        self.voice_failed.connect(self._on_voice_error)  # type: ignore
        self.voice_stop.connect(self._on_voice_stop)  # type: ignore
        self.agent_ready.connect(self._on_agent_done)  # type: ignore
        self.agent_failed.connect(self._on_agent_error)  # type: ignore
        self._sound_requested.connect(self._do_play_mp3_sound)  # type: ignore
        self.title_ready.connect(self._on_title_ready)  # type: ignore
        self._load_initial_state()

    # ------------------------------------------------------------------
    # Janela
    # ------------------------------------------------------------------
    def _setup_window(self) -> None:
        self.setWindowTitle("Second Brain")
        self.setWindowFlags(
            Qt.WindowType.FramelessWindowHint | Qt.WindowType.WindowStaysOnTopHint | Qt.WindowType.Tool
        )
        # Transparência leve (janela ~96% opaca) + cantos arredondados:
        # fundo translúcido → o QSS de #centralWidget pinta o retângulo com border-radius
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
        self.setWindowOpacity(0.96)
        self.setMinimumSize(QSize(720, 480))
        self.resize(860, 560)
        # Centraliza
        try:
            screen: Any = QApplication.primaryScreen()
            geo: Any = screen.availableGeometry()
            self.move(geo.center() - self.rect().center())
        except Exception:
            pass
        self.setStyleSheet(_DARK_QSS)

    def _setup_ui(self) -> None:
        central: QWidget = QWidget(self)
        central.setObjectName("centralWidget")  # alvo do QSS de cantos arredondados
        self.setCentralWidget(central)
        root: QVBoxLayout = QVBoxLayout(central)
        root.setContentsMargins(12, 12, 12, 12)
        root.setSpacing(10)

        # Top bar Raycast
        self.raycast_bar: RaycastBar = RaycastBar(self)
        self.raycast_bar.submitted.connect(self._on_raycast_submit)  # type: ignore
        self.raycast_bar.voice_btn.clicked.connect(self._on_voice)  # type: ignore
        root.addWidget(self.raycast_bar)

        # Splitter: sidebar + chat
        self.splitter: QSplitter = QSplitter(Qt.Orientation.Horizontal, self)
        self.sidebar: Sidebar = Sidebar(self)
        self.sidebar.session_selected.connect(self._on_session_selected)  # type: ignore
        self.sidebar.new_btn.clicked.connect(self._on_new_session)  # type: ignore
        self.sidebar.toggle_btn.clicked.connect(self._toggle_sidebar)  # type: ignore
        self.sidebar.session_delete_requested.connect(self._on_delete_session)  # type: ignore
        self.sidebar.session_rename_requested.connect(self._on_rename_session)  # type: ignore
        self.sidebar.session_copy_requested.connect(self._on_copy_session)  # type: ignore

        self.chat_view: ChatView = ChatView(self)
        self.chat_view.send_btn.clicked.connect(self._on_chat_send)  # type: ignore
        self.chat_view.chat_input.returnPressed.connect(self._on_chat_send)  # type: ignore
        self.chat_view.voice_btn.clicked.connect(self._on_voice)  # type: ignore

        self.splitter.addWidget(self.sidebar)
        self.splitter.addWidget(self.chat_view)
        self.splitter.setSizes([260, 600])
        self.splitter.setCollapsible(0, True)
        self.splitter.setCollapsible(1, False)
        root.addWidget(self.splitter, 1)

        # Status bar simples
        self.status_label: QLabel = QLabel(f"Atalho: {self.hotkey_str}  |  Esc fecha  |  Tab alterna modo", self)
        self.status_label.setStyleSheet("color: #888; font-size: 11px;")
        root.addWidget(self.status_label)

        # Começa em modo Raycast (sidebar recolhida)
        self.switch_to_raycast_mode()

    def _setup_shortcuts(self) -> None:
        # Esc fecha/hide
        esc: QShortcut = QShortcut(QKeySequence("Escape"), self)
        esc.activated.connect(self.hide_overlay)  # type: ignore
        # Tab alterna modo
        tab: QShortcut = QShortcut(QKeySequence("Tab"), self)
        tab.activated.connect(self.toggle_mode)  # type: ignore
        # Ctrl+N nova sessão
        new_sc: QShortcut = QShortcut(QKeySequence("Ctrl+N"), self)
        new_sc.activated.connect(self._on_new_session)  # type: ignore
        # Ctrl+B toggle sidebar
        b_sc: QShortcut = QShortcut(QKeySequence("Ctrl+B"), self)
        b_sc.activated.connect(self._toggle_sidebar)  # type: ignore

    def _load_initial_state(self) -> None:
        # Carrega sessões no sidebar se manager disponível
        if self.chat_manager is not None:
            try:
                sessions: list[dict[str, Any]] = self.chat_manager.listar_sessoes()
                self.sidebar.load_sessions(sessions)
                if sessions:
                    self._current_session_id = sessions[0]["id"]
                    self._load_session_history(self._current_session_id)
            except Exception as exc:
                self.status_label.setText(f"ChatManager erro: {exc}")

    # ------------------------------------------------------------------
    # API pública (testável)
    # ------------------------------------------------------------------
    @property
    def is_raycast_mode(self) -> bool:
        return self._is_raycast_mode

    @property
    def is_chat_mode(self) -> bool:
        return not self._is_raycast_mode

    @property
    def current_session_id(self) -> str | None:
        return self._current_session_id

    def is_sidebar_collapsed(self) -> bool:
        return self._sidebar_collapsed

    def switch_to_raycast_mode(self) -> None:
        self._is_raycast_mode = True
        self._sidebar_collapsed = True
        # Em raycast esconde sidebar completamente (evita "Con" truncado truncado da Image 1)
        self.sidebar.setVisible(False)
        self.sidebar.set_collapsed(True)
        self.chat_view.setVisible(False)
        self.raycast_bar.setVisible(True)
        self.raycast_bar.set_placeholder("🔍  Buscar no cofre ou digitar mensagem…  (Enter → chat)")
        self.raycast_bar.focus_input()
        try:
            self.mode_changed.emit("raycast")  # type: ignore
        except Exception:
            pass

    def switch_to_chat_mode(self) -> None:
        self._is_raycast_mode = False
        self._sidebar_collapsed = False
        self.sidebar.setVisible(True)
        self.sidebar.set_collapsed(False)
        self.chat_view.setVisible(True)
        self.raycast_bar.setVisible(False)  # esconde barra de busca no modo chat
        self.chat_view.chat_input.setFocus()
        try:
            self.mode_changed.emit("chat")  # type: ignore
        except Exception:
            pass

    def toggle_mode(self) -> None:
        if self._is_raycast_mode:
            self.switch_to_chat_mode()
        else:
            self.switch_to_raycast_mode()

    def show_overlay(self) -> None:
        try:
            self.setWindowState(self.windowState() & ~Qt.WindowState.WindowMinimized)
        except Exception:
            pass
        self.showNormal()
        self.show()
        self.raise_()
        self.activateWindow()
        try:
            import ctypes

            hwnd: int | None = int(self.winId())
            ctypes.windll.user32.SetForegroundWindow(hwnd)
            ctypes.windll.user32.BringWindowToTop(hwnd)
        except Exception:
            pass
        if self._is_raycast_mode:
            self.raycast_bar.focus_input()
        else:
            self.chat_view.chat_input.setFocus()
        try:
            _safe_print(f"[OVERLAY] show -> visible={self.isVisible()} geo={self.geometry().getRect()}")
        except Exception:
            pass
        try:
            self.visibility_toggled.emit(True)  # type: ignore
        except Exception:
            pass

    def hide_overlay(self) -> None:
        try:
            _safe_print(f"[OVERLAY] hide <- visible={self.isVisible()}")
        except Exception:
            pass
        self.hide()
        try:
            self.visibility_toggled.emit(False)  # type: ignore
        except Exception:
            pass

    def toggle_visibility(self) -> None:
        try:
            _safe_print(f"[OVERLAY] toggle pressed -> isVisible={self.isVisible()}")
        except Exception:
            pass
        if self.isVisible():
            self.hide_overlay()
        else:
            self.show_overlay()

    def _toggle_sidebar(self) -> None:
        self._sidebar_collapsed = not self._sidebar_collapsed
        self.sidebar.set_collapsed(self._sidebar_collapsed)

    # ------------------------------------------------------------------
    # Ações
    # ------------------------------------------------------------------
    def _on_raycast_submit(self, text: str) -> None:
        # Raycast submit → expande chat e envia mensagem
        self.switch_to_chat_mode()
        self._send_to_agent(text)

    def _on_chat_send(self) -> None:
        text: str = self.chat_view.chat_input.text().strip()
        if not text:
            return
        self.chat_view.chat_input.clear()
        self._send_to_agent(text)

    def _send_to_agent(self, text: str) -> None:
        # Garante sessão
        if self.chat_manager is not None and self._current_session_id is None:
            try:
                self._current_session_id = self.chat_manager.criar_sessao(text[:30])
                self.sidebar.load_sessions(self.chat_manager.listar_sessoes())
            except Exception as exc:
                self.chat_view.add_message("system", f"Erro ao criar sessão: {exc}")
                return

        # Persiste user
        if self.chat_manager is not None and self._current_session_id is not None:
            try:
                self.chat_manager.adicionar_mensagem(self._current_session_id, "user", text)
            except Exception:
                pass

        self.chat_view.add_message("user", text)
        # Garante overlay visível para voz/atalhos
        if not self.isVisible():
            try:
                self.show_overlay()
            except Exception:
                pass

        if self.agent_core is None:
            # Fallback sem LLM — busca local
            try:
                from scripts.funcional.indexer import VaultIndexer

                idx: Any = getattr(self.agent_core, "indexer", None) or VaultIndexer()
                results: list[dict[str, Any]] = idx.buscar_notas(text, top_k=3)
                if results:
                    resp: str = "Encontrei no cofre:\n" + "\n".join(
                        f"• {r['titulo']} (score {r['score']:.2f}): {r['preview'][:80]}" for r in results
                    )
                else:
                    resp = f"(sem AgentCore) Você disse: {text}"
            except Exception as exc:
                resp = f"(sem AgentCore) erro busca: {exc}"
            self.chat_view.add_message("assistant", resp)
            if self.chat_manager is not None and self._current_session_id is not None:
                try:
                    self.chat_manager.adicionar_mensagem(self._current_session_id, "assistant", resp)
                except Exception:
                    pass
            return

        # Com AgentCore — chamada assíncrona thread-safe via Signal (corrige QTimer.singleShot falho)
        try:
            history: list[dict[str, Any]] = []
            if self.chat_manager is not None and self._current_session_id is not None:
                raw_hist: list[dict[str, Any]] = self.chat_manager.carregar_historico(self._current_session_id)
                for h in raw_hist[:-1]:
                    history.append({"role": h["role"], "content": h["content"]})
            if not history or history[0].get("role") != "system":
                history = [{"role": "system", "content": getattr(self.agent_core, "system_prompt", "")}] + history
        except Exception as exc:
            self.chat_view.add_message("system", f"Erro histórico: {exc}")
            history = [{"role": "system", "content": getattr(self.agent_core, "system_prompt", "")}]

        self.chat_view.add_message("assistant", "… pensando (DeepSeek) — aguarde…")
        self.status_label.setText("● DeepSeek pensando…")
        _safe_print(f"[AGENT] enviando: {text[:60]} | history={len(history)} msgs")
        QApplication.processEvents()

        # Worker usa Signal (thread-safe) ao invés de QTimer.singleShot
        def _agent_worker() -> None:
            try:
                import threading

                _safe_print(f"[AGENT][WORKER] thread={threading.current_thread().name} start")
                resp: str = self.agent_core.chat(text, history=history)
                _safe_print(f"[AGENT][WORKER] got resp {len(resp)} chars, emitting agent_ready")
                self.agent_ready.emit(resp)  # type: ignore
            except Exception as exc:
                import traceback

                traceback.print_exc()
                _safe_print(f"[AGENT][WORKER] erro: {exc}")
                try:
                    self.agent_failed.emit(str(exc))  # type: ignore
                except Exception:
                    pass

        import threading

        threading.Thread(target=_agent_worker, daemon=True).start()

    def _on_agent_done(self, resp: str) -> None:
        _safe_print(f"[AGENT][SLOT] resposta: {resp[:80]} isVisible={self.isVisible()}")
        try:
            for r in range(self.chat_view.messages.count() - 1, -1, -1):
                item = self.chat_view.messages.item(r)
                if item and "… pensando" in item.text():
                    self.chat_view.messages.takeItem(r)
                    break
        except Exception:
            pass
        self.chat_view.add_message("assistant", resp)
        self.status_label.setText("Atalho: Right Shift  |  Tap = overlay  |  Hold = voz")
        if not self.isVisible():
            try:
                self.show_overlay()
            except Exception:
                pass
        if self.chat_manager is not None and self._current_session_id is not None:
            try:
                self.chat_manager.adicionar_mensagem(self._current_session_id, "assistant", resp)
                sessions = self.chat_manager.listar_sessoes()
                self.sidebar.load_sessions(sessions)
                # Gera título automático na primeira troca (1 user + 1 assistant)
                session_info = next((s for s in sessions if s["id"] == self._current_session_id), None)
                if session_info:
                    current_title = session_info["titulo"]
                    msg_count = self.chat_manager.contar_mensagens(self._current_session_id)
                    is_placeholder = current_title in ("Nova conversa",) or (
                        msg_count <= 2 and len(current_title) <= 30
                    )
                    if msg_count == 2 and is_placeholder and self.agent_core is not None:
                        self._spawn_title_generation(resp)
            except Exception:
                pass

    def _spawn_title_generation(self, assistant_resp: str) -> None:
        """Gera título automático em background após a primeira troca."""
        sid = self._current_session_id
        if sid is None or self.agent_core is None:
            return
        # Extrai a última mensagem do usuário do chat para usar no prompt
        try:
            hist = self.chat_manager.carregar_historico(sid) if self.chat_manager else []
            user_msg = next((h["content"] for h in reversed(hist) if h["role"] == "user"), "")
        except Exception:
            user_msg = ""

        def _worker() -> None:
            try:
                client = self.agent_core._get_openai_client()
                prompt = (
                    "Crie um título curto (máx 40 caracteres) em português para esta conversa. "
                    "Responda APENAS com o título, sem aspas, sem pontuação final.\n"
                    f"Usuário: {user_msg[:200]}\n"
                    f"Assistente: {assistant_resp[:200]}"
                )
                result = client.chat.completions.create(
                    model=self.agent_core.deepseek_model,
                    messages=[{"role": "user", "content": prompt}],
                    max_tokens=20,
                    temperature=0.3,
                )
                title = (result.choices[0].message.content or "").strip().strip('"').strip("'")[:40]
                if title:
                    _safe_print(f"[TITLE] gerado: {title!r}")
                    self.title_ready.emit(sid, title)  # type: ignore
            except Exception as exc:
                _safe_print(f"[TITLE] falha ao gerar título: {exc}")

        import threading
        threading.Thread(target=_worker, daemon=True).start()

    def _on_title_ready(self, session_id: str, title: str) -> None:
        """Aplica título gerado pela IA à sessão e recarrega a sidebar."""
        if self.chat_manager is None or not title:
            return
        try:
            self.chat_manager.renomear_sessao(session_id, title)
            self.sidebar.load_sessions(self.chat_manager.listar_sessoes())
            _safe_print(f"[TITLE] aplicado: {session_id[:8]}… → {title!r}")
        except Exception as exc:
            _safe_print(f"[TITLE] erro ao aplicar: {exc}")

    def _on_agent_error(self, err: str) -> None:
        _safe_print(f"[AGENT][SLOT] erro: {err}")
        try:
            for r in range(self.chat_view.messages.count() - 1, -1, -1):
                item = self.chat_view.messages.item(r)
                if item and "… pensando" in item.text():
                    self.chat_view.messages.takeItem(r)
                    break
        except Exception:
            pass
        msg: str = f"Erro AgentCore: {err}"
        self.chat_view.add_message("system", msg)
        self.status_label.setText("Atalho: Right Shift  |  Tap = overlay  |  Hold = voz")
        if "DEEPSEEK_API_KEY" in err or "401" in err or "429" in err:
            self.chat_view.add_message("system", "Dica: verifique DEEPSEEK_API_KEY/BASE_URL no .env")
        if self.chat_manager is not None and self._current_session_id is not None:
            try:
                self.chat_manager.adicionar_mensagem(self._current_session_id, "assistant", msg)
            except Exception:
                pass

    def _on_session_selected(self, sid: str) -> None:
        self._current_session_id = sid
        self._load_session_history(sid)
        self.switch_to_chat_mode()

    def _load_session_history(self, sid: str) -> None:
        if self.chat_manager is None:
            return
        try:
            hist: list[dict[str, Any]] = self.chat_manager.carregar_historico(sid)
            self.chat_view.clear_messages()
            for h in hist:
                if h["role"] in ("user", "assistant", "system"):
                    self.chat_view.add_message(h["role"], h["content"], h.get("created_at"))
        except Exception as exc:
            self.status_label.setText(f"Erro ao carregar histórico: {exc}")

    def _on_new_session(self) -> None:
        if self.chat_manager is None:
            self.chat_view.clear_messages()
            self.chat_view.add_message("system", "Nova conversa (sem persistência — ChatManager não configurado)")
            self.switch_to_chat_mode()
            return
        try:
            sid: str = self.chat_manager.criar_sessao("Nova conversa")
            self._current_session_id = sid
            self.sidebar.load_sessions(self.chat_manager.listar_sessoes())
            self.chat_view.clear_messages()
            self.chat_view.add_message("system", "Nova conversa iniciada.")
            self.switch_to_chat_mode()
        except Exception as exc:
            self.chat_view.add_message("system", f"Erro ao criar sessão: {exc}")

    def _on_delete_session(self, session_id: str) -> None:
        """Exclui a sessão e limpa o chat se era a sessão ativa."""
        if self.chat_manager is None:
            return
        try:
            self.chat_manager.deletar_sessao(session_id)
            _safe_print(f"[SIDEBAR] sessão deletada: {session_id[:8]}…")
        except Exception as exc:
            self.chat_view.add_message("system", f"Erro ao excluir sessão: {exc}")
            return
        # Limpa view se a sessão deletada era a ativa
        if self._current_session_id == session_id:
            self._current_session_id = None
            self.chat_view.clear_messages()
        # Recarrega lista
        try:
            self.sidebar.load_sessions(self.chat_manager.listar_sessoes())
        except Exception:
            pass

    def _on_rename_session(self, session_id: str, new_title: str) -> None:
        """Renomeia sessão e recarrega a lista lateral."""
        if self.chat_manager is None:
            return
        try:
            self.chat_manager.renomear_sessao(session_id, new_title)
            _safe_print(f"[SIDEBAR] sessão renomeada: {session_id[:8]}… → {new_title!r}")
            self.sidebar.load_sessions(self.chat_manager.listar_sessoes())
        except Exception as exc:
            self.chat_view.add_message("system", f"Erro ao renomear sessão: {exc}")

    @staticmethod
    def _repolish(widget: QWidget) -> None:
        """Reaplica QSS após mudança de propriedade dinâmica (ex.: recording=True)."""
        style = widget.style()
        style.unpolish(widget)
        style.polish(widget)

    def _set_voice_recording(self, recording: bool) -> None:
        """Visual de gravação: mic fica vermelho enquanto grava."""
        for b in (self.raycast_bar.voice_btn, self.chat_view.voice_btn):
            b.setProperty("recording", True if recording else False)
            self._repolish(b)

    def _on_copy_session(self, session_id: str) -> None:
        """Copia a transcrição da conversa para a área de transferência."""
        if self.chat_manager is None:
            return
        try:
            hist: list[dict[str, Any]] = self.chat_manager.carregar_historico(session_id)
            lines: list[str] = []
            for h in hist:
                who: str = {"user": "Você", "assistant": "Second Brain", "system": "Sistema", "tool": "Tool"}.get(
                    h["role"], h["role"]
                )
                lines.append(f"{who}: {h['content']}")
            QApplication.clipboard().setText("\n\n".join(lines))
            self.status_label.setText("Conversa copiada ✓")
        except Exception as exc:
            self.status_label.setText(f"Erro ao copiar: {exc}")

    def _on_voice(self) -> None:
        if self.agent_core is None or not hasattr(self.agent_core, "gravar_e_transcrever"):
            self.chat_view.add_message("system", "Voz indisponível (AgentCore sem STT).")
            return
        if getattr(self, "_voice_running", False):
            self.chat_view.add_message("system", "Já gravando… aguarde.")
            return
        self._voice_running = True  # type: ignore[attr-defined]
        self.raycast_bar.voice_btn.setEnabled(False)
        self.chat_view.voice_btn.setEnabled(False)
        self._set_voice_recording(True)
        self.status_label.setText("● Gravando 5s… fale agora!")
        self.chat_view.add_message("system", "● Gravando 5s… fale agora!")
        # Força modo chat para ver mensagens de voz
        if self._is_raycast_mode:
            try:
                self.switch_to_chat_mode()
            except Exception:
                pass
        QApplication.processEvents()

        def _worker() -> None:
            try:
                import threading

                _safe_print(f"[VOICE][WORKER] thread={threading.current_thread().name} start")
                text: str = self.agent_core.gravar_e_transcrever(duration=5.0)
                _safe_print(f"[VOICE][WORKER] transcrito: {text[:60]} -> emit voice_ready")
                self.voice_ready.emit(text)  # type: ignore — thread-safe
            except Exception as exc:
                import traceback

                traceback.print_exc()
                _safe_print(f"[VOICE][WORKER] erro: {exc}")
                try:
                    self.voice_failed.emit(str(exc))  # type: ignore
                except Exception:
                    pass

        import threading

        threading.Thread(target=_worker, daemon=True).start()

    def _on_voice_success(self, text: str) -> None:
        _safe_print(f"[VOICE][SLOT] success: {text[:60]} isVisible={self.isVisible()}")
        self._voice_running = False  # type: ignore[attr-defined]
        self._voice_recording = False
        self.raycast_bar.voice_btn.setEnabled(True)
        self.chat_view.voice_btn.setEnabled(True)
        self._set_voice_recording(False)
        self.status_label.setText(f"Atalho: Right Shift  |  Tap = overlay  |  Hold = voz")
        if not self.isVisible():
            try:
                self.show_overlay()
            except Exception:
                pass
        if text.strip():
            _safe_print(f"[OVERLAY] voz -> agente: {text.strip()[:60]}")
            self._send_to_agent(text.strip())
        else:
            self.chat_view.add_message("system", "Transcrição vazia — tente falar mais alto/perto do microfone.")

    def _on_voice_error(self, err: str) -> None:
        _safe_print(f"[VOICE][SLOT] error: {err}")
        self._voice_running = False  # type: ignore[attr-defined]
        self._voice_recording = False
        self.raycast_bar.voice_btn.setEnabled(True)
        self.chat_view.voice_btn.setEnabled(True)
        self._set_voice_recording(False)
        self.status_label.setText(f"Atalho: Right Shift  |  Tap = overlay  |  Hold = voz")
        self.chat_view.add_message("system", f"Erro voz: {err}")
        if "GROQ_API_KEY" in err or "401" in err or "groq" in err.lower():
            self.chat_view.add_message("system", "Dica: verifique GROQ_API_KEY no .env e conexão com api.groq.com")

    # ------------------------------------------------------------------
    # Atalho global pynput — Listener (detecta press + release)
    # ------------------------------------------------------------------
    @staticmethod
    def _normalize_hotkey(raw: str) -> str:
        """Normaliza 'alt+space' / '<alt>+<p>' → '<alt>+<space>' / '<alt>+p' para pynput."""
        s: str = raw.strip().lower()
        if not s:
            return "<ctrl>+<space>"
        parts: list[str] = [p.strip().strip("<>") for p in s.replace(" ", "").split("+") if p.strip().strip("<>")]
        if not parts:
            return "<ctrl>+<space>"
        bracket: list[str] = []
        _special: set[str] = {"alt", "ctrl", "shift", "cmd", "win", "super", "space", "enter", "tab", "esc", "backspace", "delete", "up", "down", "left", "right"}
        for p in parts:
            if p in _special:
                bracket.append(f"<{p}>")
            elif len(p) == 1:
                bracket.append(p)
            else:
                bracket.append(f"<{p}>")
        return "+".join(bracket) if bracket else "<ctrl>+<space>"

    def _play_hotkey_sound(self) -> None:
        """Toca o som suave (start-recording.mp3) — o MESMO som em todas as ações.

        Abrir o overlay usava um beep (winsound) e iniciar a gravação usava o mp3
        suave — dois sons diferentes para a mesma tecla irritavam. Agora ambos
        delegam para _play_start_recording_sound (signal _sound_requested →
        main thread → QMediaPlayer persistente; fallback beep só se falhar).
        """
        self._play_start_recording_sound()

    def _play_start_recording_sound(self) -> None:
        """Solicita reprodução do som de início de gravação.

        Chamado em thread daemon — emite _sound_requested para que
        _do_play_mp3_sound execute no main thread (obrigatório para QMediaPlayer).
        Se o sinal falhar, usa winsound.Beep como fallback síncrono na thread.
        """
        try:
            self._sound_requested.emit()  # type: ignore — main thread via Qt signal
            return
        except Exception:
            pass
        # Fallback: winsound na thread (seguro, mas bloqueia ~100ms)
        try:
            import winsound
            winsound.Beep(1200, 100)
        except Exception:
            pass

    @Slot()
    def _do_play_mp3_sound(self) -> None:
        """Toca assets/start-recording.mp3 usando QMediaPlayer persistente (main thread).

        Instâncias _rec_player/_rec_audio_output são mantidas como atributos para
        evitar GC prematuro que causava crash no Qt Multimedia.
        Fallback: winsound.Beep se o arquivo não existir ou QtMultimedia falhar.
        """
        if self._start_recording_sound_path.exists():
            try:
                from PySide6.QtMultimedia import QMediaPlayer, QAudioOutput
                from PySide6.QtCore import QUrl
                if self._rec_player is None:
                    self._rec_audio_output = QAudioOutput(self)
                    self._rec_player = QMediaPlayer(self)
                    self._rec_player.setAudioOutput(self._rec_audio_output)
                self._rec_audio_output.setVolume(0.8)  # type: ignore[union-attr]
                self._rec_player.setSource(QUrl.fromLocalFile(str(self._start_recording_sound_path)))
                self._rec_player.play()
                _safe_print(f"[SOUND] reproduzindo: {self._start_recording_sound_path.name}")
                return
            except Exception as exc:
                _safe_print(f"[SOUND] QMediaPlayer falhou ({exc}), usando beep")
        # Fallback: beep
        try:
            import winsound
            winsound.Beep(1200, 100)
            _safe_print("[SOUND] beep fallback")
        except Exception:
            pass

    @Slot()
    def _on_right_shift_press(self) -> None:
        """Chamado quando Right Shift é pressionado.

        Se o overlay estiver VISÍVEL, inicia gravação contínua (hold-to-talk).
        Se o overlay estiver OCULTO, não faz nada — o release decidirá mostrar a janela.

        Nota: _key_press_time já foi gravado no thread pynput (tempo real).
        """
        _safe_print(f"[HOLD] _on_right_shift_press CALLED isVisible={self.isVisible()}")

        # Se o overlay não está visível, não inicia gravação.
        # O release vai apenas exibir a janela.
        if not self.isVisible():
            _safe_print("[HOLD] overlay oculto — aguardando release para mostrar")
            return

        if self.agent_core is None or not hasattr(self.agent_core, "iniciar_gravacao_continua"):
            _safe_print("[HOLD] AgentCore sem suporte a gravação contínua")
            return

        if self._voice_recording:
            _safe_print("[HOLD] já gravando — ignorando novo press")
            return

        # Overlay visível → inicia gravação contínua e toca som de início
        import threading as _thr
        _thr.Thread(target=self._play_start_recording_sound, daemon=True).start()

        self._voice_recording = True
        self._voice_cancel_requested = False
        self._voice_stop_fn = None
        self.raycast_bar.voice_btn.setEnabled(False)
        self.chat_view.voice_btn.setEnabled(False)
        self.status_label.setText("● Gravando… fale agora!")
        if self._is_raycast_mode:
            try:
                self.switch_to_chat_mode()
            except Exception:
                pass
        QApplication.processEvents()

        def _worker() -> None:
            try:
                import threading
                _safe_print(f"[HOLD][WORKER] thread={threading.current_thread().name} — gravando")
                stop_fn, sr = self.agent_core.iniciar_gravacao_continua()
                if self._voice_cancel_requested:
                    # Cancelamento chegou enquanto a stream abria → fecha JÁ (evita stream vazia)
                    try:
                        stop_fn()
                    except Exception:
                        pass
                    self._voice_cancel_requested = False
                    self._voice_recording = False
                    self._voice_stop_fn = None
                    _safe_print("[HOLD][WORKER] gravação cancelada antes de iniciar (stream fechada)")
                    return
                self._voice_stop_fn = (stop_fn, sr)
                _safe_print(f"[HOLD][WORKER] gravação iniciada, aguardando stop...")
            except Exception as exc:
                import traceback
                traceback.print_exc()
                _safe_print(f"[HOLD][WORKER] erro ao iniciar: {exc}")
                self._voice_recording = False
                self._voice_cancel_requested = False
                try:
                    self.voice_failed.emit(str(exc))
                except Exception:
                    pass

        import threading
        threading.Thread(target=_worker, daemon=True).start()

    @Slot()
    def _on_right_shift_release(self) -> None:
        """Chamado quando Right Shift é liberado — decide tap vs hold.

        Usa _held_duration_snapshot gravado no thread pynput no momento exato
        do release, evitando distorção causada por latência de fila ou pelo beep.
        """
        held_duration = self._held_duration_snapshot
        _safe_print(f"[HOLD] _on_right_shift_release CALLED held={held_duration:.3f}s threshold={self._tap_threshold}s isRecording={self._voice_recording}")

        if held_duration < self._tap_threshold:
            _safe_print(f"[HOLD] tap ({held_duration:.3f}s) → show overlay (before: visible={self.isVisible()})")
            # Tap durante gravação → CANCELA fechando a stream (antes vazava o microfone!)
            if self._voice_recording:
                _safe_print("[HOLD] tap durante gravação → cancelar gravação (stream será fechada)")
                self._stop_voice_recording(transcribe=False)
                return
            if not self.isVisible():
                self._play_hotkey_sound()
                self.show_overlay()
                _safe_print(f"[HOLD] tap → overlay aberto")
            else:
                _safe_print(f"[HOLD] tap → overlay já visível, ignorando (use Esc para fechar)")
            return

        # Hold longo → parar gravação e transcrever
        _safe_print(f"[HOLD] release ({held_duration:.3f}s) → stop recording")
        self.voice_stop.emit()

    def _on_voice_stop(self) -> None:
        """Para a gravação contínua e inicia transcrição."""
        self._stop_voice_recording(transcribe=True)

    def _stop_voice_recording(self, transcribe: bool) -> None:
        """Para a gravação contínua SEMPRE fechando a stream (nunca perder o stop_fn).

        transcribe=True  → envia o áudio para transcrição (Groq);
        transcribe=False → cancela e descarta o áudio (a stream é fechada do mesmo jeito).

        Correção do crash 0xc0000005: o antigo caminho de tap-descarte zerava
        _voice_stop_fn sem chamar stop_fn(), vazando InputStreams do microfone
        (cada tap abria uma nova stream até o PortAudio quebrar nativamente).
        """
        if not self._voice_recording:
            _safe_print("[HOLD] nada para parar")
            return
        if self._voice_stop_fn is None:
            # Stream ainda abrindo no worker → sinaliza; o worker a fecha ao abrir
            self._voice_cancel_requested = True
            _safe_print("[HOLD] stream ainda abrindo — cancelamento solicitado ao worker")
            return

        stop_fn, sr = self._voice_stop_fn
        self._voice_stop_fn = None
        self._voice_recording = False
        self.raycast_bar.voice_btn.setEnabled(True)
        self.chat_view.voice_btn.setEnabled(True)
        self.status_label.setText("● Transcrevendo…" if transcribe else "Gravação cancelada.")

        def _worker() -> None:
            try:
                import threading
                acao = "transcrevendo" if transcribe else "cancelando (fechando stream)"
                _safe_print(f"[HOLD][STOP] thread={threading.current_thread().name} — {acao}")
                audio = stop_fn()  # SEMPRE chamado → a stream do microfone é fechada
                if not transcribe:
                    _safe_print("[HOLD][CANCEL] gravação descartada — stream fechada")
                    return
                if audio.size == 0:
                    _safe_print("[HOLD][STOP] áudio vazio")
                    try:
                        self.voice_ready.emit("")
                    except Exception:
                        pass
                    return
                text: str = self.agent_core.transcrever_audio_gravado(audio, sr)
                _safe_print(f"[HOLD][STOP] transcrito: {text[:60]}")
                try:
                    self.voice_ready.emit(text)
                except Exception:
                    pass
            except Exception as exc:
                import traceback

                traceback.print_exc()
                _safe_print(f"[HOLD][STOP] erro: {exc}")
                try:
                    self.voice_failed.emit(str(exc))
                except Exception:
                    pass

        import threading
        threading.Thread(target=_worker, daemon=True).start()

    def start_global_hotkey(self) -> bool:
        """Registra atalho global via pynput Listener (detecta press + release)."""
        try:
            from pynput import keyboard
        except ImportError:
            self.status_label.setText("pynput não instalado — atalho global desativado (pip install pynput)")
            return False

        def _on_press(key: Any) -> None:
            if key == keyboard.Key.shift_r:
                # Grava tempo AQUI (thread pynput) — não no slot Qt, que chega atrasado
                self._key_press_time = time.monotonic()
                try:
                    _safe_print(f"[HOTKEY] Right Shift pressed (hold-to-talk)")
                except Exception:
                    pass
                try:
                    from PySide6.QtCore import QMetaObject
                    QMetaObject.invokeMethod(self, "_on_right_shift_press", Qt.ConnectionType.QueuedConnection)
                except Exception as exc:
                    _safe_print(f"[HOTKEY] invokeMethod press failed: {exc}")

        def _on_release(key: Any) -> None:
            if key == keyboard.Key.shift_r:
                # Snapshot da duração AQUI (thread pynput) — tempo real, sem latência de fila
                self._held_duration_snapshot = (
                    time.monotonic() - self._key_press_time if self._key_press_time > 0 else 0.0
                )
                try:
                    _safe_print(f"[HOTKEY] Right Shift released (held={self._held_duration_snapshot:.3f}s)")
                except Exception:
                    pass
                try:
                    from PySide6.QtCore import QMetaObject
                    QMetaObject.invokeMethod(self, "_on_right_shift_release", Qt.ConnectionType.QueuedConnection)
                except Exception as exc:
                    _safe_print(f"[HOTKEY] invokeMethod release failed: {exc}")

        try:
            self._hotkey_listener = keyboard.Listener(on_press=_on_press, on_release=_on_release)
            self._hotkey_listener.start()  # type: ignore
            self.hotkey_str = "right_shift"
            self.status_label.setText("Atalho: Right Shift  |  Tap = overlay  |  Hold = voz  |  Esc fecha")
            _safe_print("[HOTKEY] Listener registrado: Right Shift (press+release)")
            return True
        except Exception as exc:
            self.status_label.setText(f"Atalho falhou: {exc}")
            _safe_print(f"[HOTKEY] Falha ao criar Listener: {exc}")
            return False

    def stop_global_hotkey(self) -> None:
        try:
            if self._hotkey_listener is not None:
                self._hotkey_listener.stop()  # type: ignore
                self._hotkey_listener = None
        except Exception:
            pass

    def force_quit(self) -> None:
        """Encerra app limpando hotkey (usado por Ctrl+C)."""
        self._force_quit = True
        try:
            self.stop_global_hotkey()
        except Exception:
            pass
        self.close()

    def closeEvent(self, event: Any) -> None:  # type: ignore[override]
        # Para gravação ativa antes de fechar
        if self._voice_recording and self._voice_stop_fn is not None:
            try:
                stop_fn, _sr = self._voice_stop_fn
                stop_fn()
            except Exception:
                pass
            self._voice_recording = False
            self._voice_stop_fn = None
        # Raycast: X → hide, mantém hotkey. Só fecha de verdade se _force_quit
        if not self._force_quit and self._hotkey_listener is not None:
            try:
                event.ignore()
                self.hide_overlay()
                _safe_print("[OVERLAY] X/Esc → hide (use Ctrl+C ou feche no terminal para sair)")
                return
            except Exception:
                pass
        try:
            self.stop_global_hotkey()
        except Exception:
            pass
        super().closeEvent(event)


def create_app(
    agent_core: Any | None = None,
    chat_manager: Any | None = None,
    hotkey: str | None = None,
) -> tuple[Any, OverlayWindow]:
    """Cria QApplication e OverlayWindow (útil para testes e valid_sprint05)."""
    _require_qt()
    app: Any = QApplication.instance() or QApplication(sys.argv)
    app.setStyle("Fusion")
    # Tenta criar managers se não fornecidos (sem falhar se keys ausentes)
    if chat_manager is None and ChatManager is not None:
        try:
            chat_manager = ChatManager()
        except Exception:
            chat_manager = None
    if agent_core is None and AgentCore is not None:
        try:
            agent_core = AgentCore(chat_manager=chat_manager) if False else AgentCore()  # type: ignore
            # Reconecta chat_manager se agent_core criou outro
        except Exception:
            agent_core = None
    win: OverlayWindow = OverlayWindow(agent_core=agent_core, chat_manager=chat_manager, hotkey=hotkey)
    return app, win





