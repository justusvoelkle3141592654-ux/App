"""Shared widget helpers so every tool shows buttons, messages and progress the same way."""

from __future__ import annotations

import datetime as dt
from pathlib import Path

from PySide6.QtCore import QDate, QDateTime, QTime, Signal
from PySide6.QtWidgets import (
    QAbstractItemView,
    QFileDialog,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMessageBox,
    QProgressBar,
    QPushButton,
    QTableWidget,
    QVBoxLayout,
    QWidget,
)

from desktop_organizer.core.i18n import t
from desktop_organizer.core.theme import SPACE_2


def to_qdate(value: dt.date) -> QDate:
    """Qt widgets need QDate/QTime objects, not Python date/time objects."""
    return QDate(value.year, value.month, value.day)


def from_qdate(value: QDate) -> dt.date:
    return dt.date(value.year(), value.month(), value.day())


def to_qtime(value: dt.time) -> QTime:
    return QTime(value.hour, value.minute, value.second)


def to_qdatetime(value: dt.datetime) -> QDateTime:
    return QDateTime(to_qdate(value.date()), to_qtime(value.time()))


def button(key: str, *, primary: bool = False, parent: QWidget | None = None) -> QPushButton:
    btn = QPushButton(t(key), parent)
    if primary:
        btn.setProperty("role", "primary")
        btn.setDefault(True)
    return btn


def muted(text: str) -> QLabel:
    label = QLabel(text)
    label.setProperty("role", "muted")
    label.setWordWrap(True)
    return label


def status(text: str, kind: str = "muted") -> QLabel:
    """kind: ok, warn, error or muted."""
    label = QLabel(text)
    label.setWordWrap(True)
    label.setProperty("role", "muted" if kind == "muted" else f"status-{kind}")
    return label


def row(*widgets: QWidget, stretch_last: bool = False) -> QHBoxLayout:
    layout = QHBoxLayout()
    layout.setSpacing(SPACE_2)
    for widget in widgets:
        layout.addWidget(widget)
    if stretch_last:
        layout.addStretch(1)
    return layout


def folder_row(line_edit: QLineEdit, parent: QWidget) -> QHBoxLayout:
    """A folder path field with a Browse button next to it."""
    browse = button("common.browse", parent=parent)

    def _pick() -> None:
        start = line_edit.text().strip() or str(Path.home())
        chosen = QFileDialog.getExistingDirectory(parent, t("common.choose_folder"), start)
        if chosen:
            line_edit.setText(chosen)

    browse.clicked.connect(_pick)
    return row(QLabel(t("common.folder")), line_edit, browse)


def table(headers: list[str]) -> QTableWidget:
    widget = QTableWidget(0, len(headers))
    widget.setHorizontalHeaderLabels(headers)
    widget.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
    widget.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
    widget.setAlternatingRowColors(True)
    widget.verticalHeader().setVisible(False)
    widget.horizontalHeader().setStretchLastSection(True)
    widget.setWordWrap(False)
    return widget


def confirm(parent: QWidget, title_key: str, text_key: str, **kwargs: object) -> bool:
    """Yes/No dialog. The default button is No, so Enter does not confirm a destructive action."""
    box = QMessageBox(parent)
    box.setWindowTitle(t(title_key))
    box.setText(t(text_key, **kwargs))
    yes = box.addButton(t("common.yes"), QMessageBox.ButtonRole.AcceptRole)
    no = box.addButton(t("common.no"), QMessageBox.ButtonRole.RejectRole)
    box.setDefaultButton(no)
    box.exec()
    return box.clickedButton() is yes


def error(parent: QWidget, text: str) -> None:
    QMessageBox.warning(parent, t("common.error_title"), text)


def info(parent: QWidget, title: str, text: str) -> None:
    QMessageBox.information(parent, title, text)


class ProgressPanel(QWidget):
    """A progress bar, a status line and a cancel button. Hidden until work starts."""

    cancel_requested = Signal()

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._bar = QProgressBar(self)
        self._bar.setRange(0, 100)
        self._label = status("")
        self._cancel = button("common.cancel", parent=self)
        self._cancel.clicked.connect(self.cancel_requested)
        self._layout = row(self._bar, self._cancel)

        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(SPACE_2)
        outer.addLayout(self._layout)
        outer.addWidget(self._label)
        self.setVisible(False)

    def start(self, message: str = "", *, cancellable: bool = False) -> None:
        self._bar.setValue(0)
        self._label.setText(message)
        self._cancel.setVisible(cancellable)
        self._cancel.setEnabled(cancellable)
        self.setVisible(True)

    def update_progress(self, percent: int, message: str) -> None:
        self._bar.setValue(percent)
        if message:
            self._label.setText(message)

    def finish(self, message: str = "") -> None:
        self._bar.setValue(100)
        self._label.setText(message)
        self._cancel.setEnabled(False)
        self.setVisible(bool(message))
