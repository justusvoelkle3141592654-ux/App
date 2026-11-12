from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtGui import QKeySequence, QShortcut
from PySide6.QtWidgets import (
    QComboBox,
    QDialog,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QPlainTextEdit,
    QVBoxLayout,
    QWidget,
)

from desktop_organizer.app.base import ToolPage
from desktop_organizer.app.context import AppContext
from desktop_organizer.app.widgets import button, confirm, error, muted, row
from desktop_organizer.core.i18n import t
from desktop_organizer.tools.notes.logic import Note, NotesStore

ALL_TAGS = "__all__"


class NotesPage(ToolPage):
    def build(self, layout: QVBoxLayout) -> None:
        self._current_id: int | None = None
        self._search = QLineEdit()
        self._search.setPlaceholderText(t("notes.search_placeholder"))
        self._search.textChanged.connect(self._refresh)
        self._tag_filter = QComboBox()
        self._tag_filter.currentIndexChanged.connect(self._refresh)
        layout.addLayout(row(self._search, self._tag_filter))

        body = QHBoxLayout()
        self._list = QListWidget()
        self._list.setMinimumWidth(220)
        self._list.currentItemChanged.connect(self._select)
        body.addWidget(self._list, 1)

        editor = QVBoxLayout()
        self._title = QLineEdit()
        self._title.setPlaceholderText(t("notes.title_placeholder"))
        self._editor = QPlainTextEdit()
        self._editor.setPlaceholderText(t("notes.body_placeholder"))
        self._meta = muted("")
        editor.addWidget(self._title)
        editor.addWidget(self._editor, 1)
        editor.addWidget(self._meta)
        new = button("notes.new", parent=self)
        save = button("notes.save", primary=True, parent=self)
        delete = button("notes.delete", parent=self)
        new.clicked.connect(self._new)
        save.clicked.connect(self._save)
        delete.clicked.connect(self._delete)
        editor.addLayout(row(new, save, delete, stretch_last=True))
        body.addLayout(editor, 2)
        layout.addLayout(body, 1)

        save_shortcut = QShortcut(QKeySequence.StandardKey.Save, self)
        save_shortcut.activated.connect(self._save)
        new_shortcut = QShortcut(QKeySequence("Ctrl+N"), self)
        new_shortcut.activated.connect(self._new)

        self._reload_tags()
        self._refresh()

    def _reload_tags(self) -> None:
        current = self._tag_filter.currentData()
        self._tag_filter.blockSignals(True)
        self._tag_filter.clear()
        self._tag_filter.addItem(t("notes.all_tags"), ALL_TAGS)
        for tag, count in self.ctx.notes.tag_counts().items():
            self._tag_filter.addItem(f"#{tag} ({count})", tag)
        index = self._tag_filter.findData(current)
        self._tag_filter.setCurrentIndex(index if index >= 0 else 0)
        self._tag_filter.blockSignals(False)

    def _refresh(self) -> None:
        store: NotesStore = self.ctx.notes
        notes = store.search(self._search.text())
        tag = self._tag_filter.currentData()
        if tag and tag != ALL_TAGS:
            notes = [n for n in notes if tag in n.tags]
        self._list.blockSignals(True)
        self._list.clear()
        for note in notes:
            item = QListWidgetItem(note.title or t("notes.untitled"))
            item.setData(Qt.ItemDataRole.UserRole, note.id)
            self._list.addItem(item)
            if note.id == self._current_id:
                self._list.setCurrentItem(item)
        self._list.blockSignals(False)
        if not notes:
            self._meta.setText(t("notes.empty"))

    def _select(self, item: QListWidgetItem | None) -> None:
        if item is None:
            return
        note_id = int(item.data(Qt.ItemDataRole.UserRole))
        note = self.ctx.notes.get(note_id)
        if note is not None:
            self._show(note)

    def _show(self, note: Note) -> None:
        self._current_id = note.id
        self._title.setText(note.title)
        self._editor.setPlainText(note.body)
        tags = " ".join(f"#{tag}" for tag in note.tags)
        self._meta.setText(t("notes.meta", updated=note.updated_at.replace("T", " "), tags=tags or "-"))

    def _new(self) -> None:
        self._current_id = None
        self._title.clear()
        self._editor.clear()
        self._meta.setText("")
        self._editor.setFocus()

    def _save(self) -> None:
        body = self._editor.toPlainText()
        try:
            if self._current_id is None:
                self._current_id = self.ctx.notes.add(body, self._title.text())
            else:
                self.ctx.notes.update(self._current_id, body, self._title.text())
        except ValueError as exc:
            error(self, str(exc))
            return
        self._reload_tags()
        self._refresh()
        note = self.ctx.notes.get(self._current_id) if self._current_id else None
        if note is not None:
            self._show(note)

    def _delete(self) -> None:
        if self._current_id is None:
            return
        if not confirm(self, "notes.delete_title", "notes.delete_text"):
            return
        self.ctx.notes.delete(self._current_id)
        self._new()
        self._reload_tags()
        self._refresh()

    def open_note(self, note_id: int) -> None:
        self._current_id = note_id
        note = self.ctx.notes.get(note_id)
        if note is not None:
            self._show(note)
        self._refresh()


class QuickCaptureDialog(QDialog):
    """Small window opened by the global shortcut. Ctrl+Enter saves, Esc closes."""

    def __init__(self, ctx: AppContext, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.ctx = ctx
        self.setWindowTitle(t("notes.quick_title"))
        self.resize(460, 260)
        layout = QVBoxLayout(self)
        layout.addWidget(QLabel(t("notes.quick_hint")))
        self._text = QPlainTextEdit()
        layout.addWidget(self._text, 1)
        save = button("notes.save", primary=True, parent=self)
        save.clicked.connect(self._save)
        layout.addLayout(row(save, stretch_last=True))
        ctrl_enter = QShortcut(QKeySequence("Ctrl+Return"), self)
        ctrl_enter.activated.connect(self._save)

    def _save(self) -> None:
        try:
            self.ctx.notes.add(self._text.toPlainText())
        except ValueError as exc:
            error(self, str(exc))
            return
        self.accept()
