"""Start screen: one row per tool, a search field for tools and notes, and a status line."""

from __future__ import annotations

import psutil
from PySide6.QtCore import Qt, QTimer, Signal
from PySide6.QtWidgets import QLabel, QLineEdit, QListWidget, QListWidgetItem, QVBoxLayout, QWidget

from desktop_organizer.app.context import AppContext
from desktop_organizer.core.i18n import t
from desktop_organizer.core.theme import SPACE_2, SPACE_3
from desktop_organizer.tools import TOOLS
from desktop_organizer.tools.system_monitor.ui import battery_text

ROLE_KIND = Qt.ItemDataRole.UserRole
ROLE_ID = Qt.ItemDataRole.UserRole + 1


class Overview(QWidget):
    open_tool = Signal(str)
    open_note = Signal(int)

    def __init__(self, ctx: AppContext, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.ctx = ctx
        layout = QVBoxLayout(self)
        layout.setContentsMargins(SPACE_3, SPACE_3, SPACE_3, SPACE_2)
        layout.setSpacing(SPACE_2)

        self._search = QLineEdit()
        self._search.setPlaceholderText(t("overview.search_placeholder"))
        self._search.textChanged.connect(self.refresh)
        layout.addWidget(self._search)

        self._list = QListWidget()
        self._list.setSpacing(2)
        self._list.itemActivated.connect(self._activate)
        layout.addWidget(self._list, 1)

        self._status = QLabel("")
        self._status.setProperty("role", "muted")
        layout.addWidget(self._status)

        self._timer = QTimer(self)
        self._timer.timeout.connect(self._update_status)
        self._timer.start(2000)
        self.refresh()
        self._update_status()

    def refresh(self) -> None:
        query = self._search.text().strip()
        needle = query.casefold()
        self._list.clear()
        for spec in TOOLS:
            title = t(f"tool.{spec.key}.title")
            desc = t(f"tool.{spec.key}.desc")
            if needle and needle not in title.casefold() and needle not in desc.casefold():
                continue
            self._add(f"{title}\n{desc}", ("tool", spec.key))
        if needle:
            for note in self.ctx.notes.search(query)[:30]:
                label = note.title or t("notes.untitled")
                self._add(f"{t('overview.note_label')}: {label}", ("note", note.id))

    def _add(self, text: str, payload: tuple[str, object]) -> None:
        item = QListWidgetItem(text)
        kind, value = payload
        item.setData(ROLE_KIND, kind)
        item.setData(ROLE_ID, value)
        self._list.addItem(item)

    def _activate(self, item: QListWidgetItem) -> None:
        kind = item.data(ROLE_KIND)
        value = item.data(ROLE_ID)
        if kind == "tool":
            self.open_tool.emit(str(value))
        elif kind == "note":
            self.open_note.emit(int(value))

    def _update_status(self) -> None:
        cpu = psutil.cpu_percent(interval=None)
        memory = psutil.virtual_memory().percent
        self._status.setText(
            "   |   ".join(
                [
                    f"{t('system.cpu')}: {cpu:.0f} %",
                    f"{t('system.memory')}: {memory:.0f} %",
                    f"{t('system.battery')}: {battery_text()}",
                ]
            )
        )

    def shutdown(self) -> None:
        self._timer.stop()
