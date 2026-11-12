"""One window per tool. Esc closes it. The page is created the first time the tool opens."""

from __future__ import annotations

import importlib
from typing import cast

from PySide6.QtCore import Qt
from PySide6.QtGui import QCloseEvent, QKeyEvent
from PySide6.QtWidgets import QMainWindow, QWidget

from desktop_organizer.app.base import ToolPage
from desktop_organizer.app.context import AppContext
from desktop_organizer.core.i18n import t
from desktop_organizer.tools import ToolSpec


def load_page_class(spec: ToolSpec) -> type[ToolPage]:
    module = importlib.import_module(spec.module)
    page_class = cast(type[ToolPage], getattr(module, spec.page_class))
    if not issubclass(page_class, ToolPage):
        raise TypeError(f"{spec.page_class} must derive from ToolPage")
    return page_class


class ToolWindow(QMainWindow):
    def __init__(self, spec: ToolSpec, ctx: AppContext, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.spec = spec
        self.setWindowTitle(f"{t(f'tool.{spec.key}.title')} - {t('app.name')}")
        self.resize(820, 600)
        self.setMinimumSize(560, 420)
        page_class = load_page_class(spec)
        self.page: ToolPage = page_class(ctx, self)
        self.setCentralWidget(self.page)

    def keyPressEvent(self, event: QKeyEvent) -> None:
        if event.key() == Qt.Key.Key_Escape:
            self.close()
            return
        super().keyPressEvent(event)

    def closeEvent(self, event: QCloseEvent) -> None:
        self.page.shutdown()
        super().closeEvent(event)
