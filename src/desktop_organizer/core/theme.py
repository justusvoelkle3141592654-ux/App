"""Colors, type scale and spacing from docs/design-system.md, applied to the Qt application."""

from __future__ import annotations

from dataclasses import dataclass

from PySide6.QtCore import Qt
from PySide6.QtGui import QColor, QFont, QGuiApplication, QPalette
from PySide6.QtWidgets import QApplication

FONT_FAMILY = "Segoe UI Variable"
FONT_FALLBACK = "Segoe UI"

# 8 px grid
SPACE_1 = 4
SPACE_2 = 8
SPACE_3 = 16
SPACE_4 = 24
SPACE_5 = 32

# Type scale in px (12 / 14 / 16 / 20 / 28)
TYPE_CAPTION = 12
TYPE_BODY = 14
TYPE_SUBTITLE = 16
TYPE_TITLE = 20
TYPE_HEADLINE = 28


@dataclass(frozen=True)
class Palette:
    window: str
    surface: str
    text: str
    text_muted: str
    border: str
    accent: str
    accent_text: str
    hover: str
    selected: str
    success: str
    warning: str
    error: str


LIGHT = Palette(
    window="#F3F3F3",
    surface="#FFFFFF",
    text="#1B1B1B",
    text_muted="#5C5C5C",
    border="#D6D6D6",
    accent="#2E5C8A",
    accent_text="#FFFFFF",
    hover="#EAEAEA",
    selected="#DCE6F1",
    success="#1E7A3C",
    warning="#8A5A00",
    error="#B42318",
)

DARK = Palette(
    window="#202020",
    surface="#2B2B2B",
    text="#F2F2F2",
    text_muted="#A8A8A8",
    border="#3F3F3F",
    accent="#7EA6D1",
    accent_text="#101010",
    hover="#333333",
    selected="#2F3D4F",
    success="#6CC68A",
    warning="#E0B45C",
    error="#F08B82",
)


def palette_for(dark: bool) -> Palette:
    return DARK if dark else LIGHT


def is_dark_mode(theme: str) -> bool:
    if theme == "dark":
        return True
    if theme == "light":
        return False
    if QGuiApplication.instance() is None:
        return False
    return QGuiApplication.styleHints().colorScheme() == Qt.ColorScheme.Dark


def apply_theme(app: QApplication, theme: str, reduce_motion: bool) -> Palette:
    colors = palette_for(is_dark_mode(theme))
    qpalette = QPalette()
    qpalette.setColor(QPalette.ColorRole.Window, QColor(colors.window))
    qpalette.setColor(QPalette.ColorRole.Base, QColor(colors.surface))
    qpalette.setColor(QPalette.ColorRole.AlternateBase, QColor(colors.window))
    qpalette.setColor(QPalette.ColorRole.Text, QColor(colors.text))
    qpalette.setColor(QPalette.ColorRole.WindowText, QColor(colors.text))
    qpalette.setColor(QPalette.ColorRole.ButtonText, QColor(colors.text))
    qpalette.setColor(QPalette.ColorRole.Button, QColor(colors.surface))
    qpalette.setColor(QPalette.ColorRole.Highlight, QColor(colors.accent))
    qpalette.setColor(QPalette.ColorRole.HighlightedText, QColor(colors.accent_text))
    app.setPalette(qpalette)

    family = FONT_FAMILY if FONT_FAMILY in _families() else FONT_FALLBACK
    font = QFont(family)
    font.setPixelSize(TYPE_BODY)
    app.setFont(font)
    app.setStyleSheet(build_stylesheet(colors))
    app.setProperty("reduce_motion", reduce_motion)
    return colors


def _families() -> set[str]:
    from PySide6.QtGui import QFontDatabase

    return set(QFontDatabase.families())


def build_stylesheet(c: Palette) -> str:
    return f"""
    QWidget {{ color: {c.text}; }}
    QMainWindow, QDialog {{ background: {c.window}; }}
    QLabel[role="muted"] {{ color: {c.text_muted}; font-size: {TYPE_CAPTION}px; }}
    QLabel[role="title"] {{ font-size: {TYPE_TITLE}px; }}
    QLabel[role="headline"] {{ font-size: {TYPE_HEADLINE}px; }}
    QLabel[role="status-ok"] {{ color: {c.success}; }}
    QLabel[role="status-warn"] {{ color: {c.warning}; }}
    QLabel[role="status-error"] {{ color: {c.error}; }}
    QPushButton {{
        background: {c.surface}; border: 1px solid {c.border}; border-radius: 4px;
        padding: {SPACE_1}px {SPACE_2 + SPACE_1}px; min-height: 24px;
    }}
    QPushButton:hover {{ background: {c.hover}; }}
    QPushButton:disabled {{ color: {c.text_muted}; }}
    QPushButton[role="primary"] {{
        background: {c.accent}; color: {c.accent_text}; border: 1px solid {c.accent};
    }}
    QPushButton:focus, QLineEdit:focus, QComboBox:focus, QSpinBox:focus, QListWidget:focus,
    QTableWidget:focus, QTreeWidget:focus, QTextEdit:focus, QPlainTextEdit:focus {{
        border: 2px solid {c.accent};
    }}
    QLineEdit, QTextEdit, QPlainTextEdit, QSpinBox, QComboBox {{
        background: {c.surface}; border: 1px solid {c.border}; border-radius: 4px;
        padding: {SPACE_1}px; selection-background-color: {c.accent};
    }}
    QListWidget, QTableWidget, QTreeWidget {{
        background: {c.surface}; border: 1px solid {c.border}; border-radius: 4px;
        alternate-background-color: {c.window};
    }}
    QListWidget::item:selected, QTableWidget::item:selected, QTreeWidget::item:selected {{
        background: {c.selected}; color: {c.text};
    }}
    QHeaderView::section {{
        background: {c.window}; color: {c.text_muted}; border: none;
        border-bottom: 1px solid {c.border}; padding: {SPACE_1}px {SPACE_2}px;
    }}
    QProgressBar {{
        border: 1px solid {c.border}; border-radius: 4px; background: {c.surface};
        text-align: center; height: 16px;
    }}
    QProgressBar::chunk {{ background: {c.accent}; border-radius: 3px; }}
    QToolTip {{ background: {c.surface}; color: {c.text}; border: 1px solid {c.border}; }}
    """
