from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QApplication,
    QCheckBox,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QVBoxLayout,
)

from desktop_organizer.app.base import ToolPage
from desktop_organizer.app.widgets import button, confirm, muted, row
from desktop_organizer.core.i18n import t
from desktop_organizer.tools.clipboard.logic import ClipEntry

_ID = Qt.ItemDataRole.UserRole
PREVIEW_CHARS = 200


class ClipboardPage(ToolPage):
    def build(self, layout: QVBoxLayout) -> None:
        layout.addWidget(muted(t("clipboard.intro")))
        self._record = QCheckBox(t("clipboard.record"))
        self._record.setChecked(self.ctx.settings.clipboard_enabled)
        self._record.toggled.connect(self._record_toggled)
        self._status = muted(t("clipboard.status_on") if self._record.isChecked() else t("clipboard.status_off"))
        layout.addWidget(self._record)
        layout.addWidget(self._status)

        self._search = QLineEdit()
        self._search.setPlaceholderText(t("clipboard.search_placeholder"))
        self._search.textChanged.connect(self._reload)
        layout.addWidget(self._search)

        self._list = QListWidget()
        self._list.itemDoubleClicked.connect(lambda _item: self._copy())
        layout.addWidget(self._list, 1)

        copy = button("clipboard.copy", primary=True, parent=self)
        pin = button("clipboard.pin", parent=self)
        delete = button("clipboard.delete", parent=self)
        clear = button("clipboard.clear", parent=self)
        copy.clicked.connect(self._copy)
        pin.clicked.connect(self._toggle_pin)
        delete.clicked.connect(self._delete)
        clear.clicked.connect(self._clear)
        layout.addLayout(row(copy, pin, delete, clear, stretch_last=True))
        self._reload()

    def _record_toggled(self, checked: bool) -> None:
        self.ctx.settings.clipboard_enabled = checked
        self.ctx.save_settings()
        self._status.setText(t("clipboard.status_on") if checked else t("clipboard.status_off"))
        if checked and self.ctx.clipboard_watcher is not None:
            self.ctx.clipboard_watcher.start()

    def _reload(self) -> None:
        self._list.clear()
        for entry in self.ctx.clipboard.list(self._search.text()):
            item = QListWidgetItem(self._label(entry))
            item.setData(_ID, entry.id)
            item.setToolTip(entry.content[:1000])
            self._list.addItem(item)

    @staticmethod
    def _label(entry: ClipEntry) -> str:
        single_line = " ".join(entry.content.split())
        if len(single_line) > PREVIEW_CHARS:
            single_line = single_line[:PREVIEW_CHARS] + " ..."
        prefix = f"[{t('clipboard.pinned')}] " if entry.pinned else ""
        return prefix + single_line

    def _selected(self) -> ClipEntry | None:
        item = self._list.currentItem()
        if item is None:
            return None
        entry_id = int(item.data(_ID))
        for entry in self.ctx.clipboard.list(self._search.text()):
            if entry.id == entry_id:
                return entry
        return None

    def _copy(self) -> None:
        entry = self._selected()
        if entry is None:
            return
        if self.ctx.clipboard_watcher is not None:
            self.ctx.clipboard_watcher.ignore_next(entry.content)
        QApplication.clipboard().setText(entry.content)
        self._status.setText(t("clipboard.copied"))

    def _toggle_pin(self) -> None:
        entry = self._selected()
        if entry is None:
            return
        self.ctx.clipboard.set_pinned(entry.id, not entry.pinned)
        self._reload()

    def _delete(self) -> None:
        entry = self._selected()
        if entry is None:
            return
        self.ctx.clipboard.delete(entry.id)
        self._reload()

    def _clear(self) -> None:
        if not confirm(self, "clipboard.clear_title", "clipboard.clear_text"):
            return
        self.ctx.clipboard.clear(keep_pinned=True)
        self._reload()
