"""Run slow work off the UI thread with progress, cancel and error reporting."""

from __future__ import annotations

import logging
import traceback
from collections.abc import Callable
from typing import Any

from PySide6.QtCore import QObject, QThread, Signal

from desktop_organizer.core.fs import Cancelled, CancelToken

log = logging.getLogger(__name__)

ProgressFn = Callable[[int, str], None]
WorkFn = Callable[[ProgressFn, CancelToken], Any]


class Worker(QThread):
    progress = Signal(int, str)
    succeeded = Signal(object)
    cancelled = Signal()
    failed = Signal(str)

    def __init__(self, work: WorkFn, parent: QObject | None = None) -> None:
        super().__init__(parent)
        self._work = work
        self.token = CancelToken()

    def cancel(self) -> None:
        self.token.cancel()

    def run(self) -> None:
        try:
            result = self._work(self._emit_progress, self.token)
        except Cancelled:
            self.cancelled.emit()
            return
        except Exception as exc:
            log.error("Background task failed: %s\n%s", exc, traceback.format_exc())
            self.failed.emit(str(exc))
            return
        self.succeeded.emit(result)

    def _emit_progress(self, percent: int, message: str) -> None:
        self.progress.emit(max(0, min(100, percent)), message)
