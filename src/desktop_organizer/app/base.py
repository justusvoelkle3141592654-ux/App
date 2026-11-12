"""Base class for tool pages: shared background-work handling and a common layout."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QVBoxLayout, QWidget

from desktop_organizer.app.context import AppContext
from desktop_organizer.app.widgets import ProgressPanel, error
from desktop_organizer.core.fs import CancelToken
from desktop_organizer.core.i18n import t
from desktop_organizer.core.theme import SPACE_3
from desktop_organizer.core.worker import ProgressFn, Worker


class ToolPage(QWidget):
    """Every tool page derives from this. Subclasses build their widgets in ``build``."""

    def __init__(self, ctx: AppContext, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.ctx = ctx
        self._worker: Worker | None = None
        self._progress = ProgressPanel(self)
        self._progress.cancel_requested.connect(self._cancel_worker)
        self._root = QVBoxLayout(self)
        self._root.setContentsMargins(SPACE_3, SPACE_3, SPACE_3, SPACE_3)
        self._root.setSpacing(SPACE_3)
        self.build(self._root)
        self._root.addWidget(self._progress)

    def build(self, layout: QVBoxLayout) -> None:
        raise NotImplementedError

    @property
    def busy(self) -> bool:
        return self._worker is not None and self._worker.isRunning()

    def run_background(
        self,
        work: Callable[[ProgressFn, CancelToken], Any],
        on_success: Callable[[Any], None],
        *,
        start_message: str = "",
        done_message: str = "",
        on_cancel: Callable[[], None] | None = None,
        cancellable: bool = False,
    ) -> bool:
        """Run work on a thread. Returns False if another job is still running."""
        if self.busy:
            return False
        worker = Worker(work, self)
        self._worker = worker
        self._progress.start(start_message or t("common.working"), cancellable=cancellable)
        queued = Qt.ConnectionType.QueuedConnection
        worker.progress.connect(self._progress.update_progress, queued)

        def _ok(result: Any) -> None:
            self._progress.finish(done_message)
            on_success(result)

        def _cancelled() -> None:
            self._progress.finish(t("common.cancelled"))
            if on_cancel is not None:
                on_cancel()

        def _failed(message: str) -> None:
            self._progress.finish("")
            error(self, t("common.failed_with", message=message))

        # Queued connections: the callbacks run on the UI thread, never on the worker thread.
        worker.succeeded.connect(_ok, queued)
        worker.cancelled.connect(_cancelled, queued)
        worker.failed.connect(_failed, queued)
        worker.start()
        return True

    def _cancel_worker(self) -> None:
        if self._worker is not None:
            self._worker.cancel()

    def shutdown(self) -> None:
        """Called when the window closes. Stops background work and timers."""
        if self._worker is not None and self._worker.isRunning():
            self._worker.cancel()
            self._worker.wait(5000)
