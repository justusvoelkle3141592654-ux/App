"""Windows notifications through the tray icon, with a log fallback.

Focus Assist: Windows decides whether a tray notification is shown during Focus Assist.
The app does not query that state itself (no public API), so this is a known limitation.
"""

from __future__ import annotations

import logging

from PySide6.QtWidgets import QSystemTrayIcon

log = logging.getLogger(__name__)


class Notifier:
    def __init__(self) -> None:
        self._tray: QSystemTrayIcon | None = None

    def attach_tray(self, tray: QSystemTrayIcon | None) -> None:
        self._tray = tray

    def notify(self, title: str, message: str) -> None:
        if self._tray is not None and QSystemTrayIcon.supportsMessages():
            self._tray.showMessage(title, message, QSystemTrayIcon.MessageIcon.Information, 8000)
        else:
            log.info("Notification (no tray): %s - %s", title, message)
