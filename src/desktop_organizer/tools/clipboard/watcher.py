"""Watches the system clipboard and stores text while history recording is on.

Skipped: content marked private by the copying app (password managers set that flag on Windows),
blank text, and text the app itself just copied from the password tool.
"""

from __future__ import annotations

import datetime as dt
import logging

from PySide6.QtCore import QObject, Signal
from PySide6.QtWidgets import QApplication

from desktop_organizer.app.context import AppContext
from desktop_organizer.core import winapi
from desktop_organizer.tools.clipboard.logic import content_hash

log = logging.getLogger(__name__)


class ClipboardWatcher(QObject):
    changed = Signal()

    def __init__(self, ctx: AppContext, parent: QObject | None = None) -> None:
        super().__init__(parent)
        self._ctx = ctx
        self._ignore_hash: str | None = None
        self._connected = False

    def start(self) -> None:
        if self._connected:
            return
        clipboard = QApplication.clipboard()
        clipboard.dataChanged.connect(self._on_changed)
        self._connected = True

    def stop(self) -> None:
        if not self._connected:
            return
        QApplication.clipboard().dataChanged.disconnect(self._on_changed)
        self._connected = False

    def ignore_next(self, text: str) -> None:
        """Called when the app copies text itself (for example a generated password)."""
        self._ignore_hash = content_hash(text)

    def _on_changed(self) -> None:
        if not self._ctx.settings.clipboard_enabled:
            return
        if winapi.clipboard_marked_private():
            return
        text = QApplication.clipboard().text()
        if not text:
            return
        digest = content_hash(text)
        if digest == self._ignore_hash:
            self._ignore_hash = None
            return
        try:
            self._ctx.clipboard.max_entries = self._ctx.settings.clipboard_max_entries
            if self._ctx.clipboard.add_text(text, dt.datetime.now()):
                self.changed.emit()
        except Exception:
            log.exception("Clipboard entry could not be stored")
