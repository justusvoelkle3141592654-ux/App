from __future__ import annotations

import datetime as dt

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QCheckBox,
    QDateEdit,
    QDialog,
    QDialogButtonBox,
    QFormLayout,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QVBoxLayout,
    QWidget,
)

from desktop_organizer.app.base import ToolPage
from desktop_organizer.app.widgets import button, confirm, error, from_qdate, muted, row, to_qdate
from desktop_organizer.core.i18n import t
from desktop_organizer.tools.tasks.logic import Task

_ID = Qt.ItemDataRole.UserRole


class TaskEditDialog(QDialog):
    def __init__(self, parent: QWidget, title: str, due: dt.date | None) -> None:
        super().__init__(parent)
        self.setWindowTitle(t("tasks.edit_title"))
        self._title = QLineEdit(title)
        self._has_due = QCheckBox(t("tasks.has_due"))
        self._has_due.setChecked(due is not None)
        self._due = QDateEdit(to_qdate(due or dt.date.today()))
        self._due.setCalendarPopup(True)
        self._due.setDisplayFormat("yyyy-MM-dd")
        self._due.setEnabled(due is not None)
        self._has_due.toggled.connect(self._due.setEnabled)
        form = QFormLayout(self)
        form.addRow(t("tasks.title"), self._title)
        form.addRow("", self._has_due)
        form.addRow(t("tasks.due"), self._due)
        buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        form.addRow(buttons)

    def values(self) -> tuple[str, dt.date | None]:
        due = from_qdate(self._due.date()) if self._has_due.isChecked() else None
        return self._title.text(), due


class TasksPage(ToolPage):
    def build(self, layout: QVBoxLayout) -> None:
        layout.addWidget(muted(t("tasks.intro")))
        self._title = QLineEdit()
        self._title.setPlaceholderText(t("tasks.title_placeholder"))
        self._title.returnPressed.connect(self._add)
        self._has_due = QCheckBox(t("tasks.has_due"))
        self._due = QDateEdit(to_qdate(dt.date.today()))
        self._due.setCalendarPopup(True)
        self._due.setDisplayFormat("yyyy-MM-dd")
        self._due.setEnabled(False)
        self._has_due.toggled.connect(self._due.setEnabled)
        self._reminder = QCheckBox(t("tasks.with_reminder"))
        self._reminder.setEnabled(False)
        self._has_due.toggled.connect(self._reminder.setEnabled)
        add = button("tasks.add", primary=True, parent=self)
        add.clicked.connect(self._add)
        layout.addLayout(row(self._title, add))
        layout.addLayout(row(self._has_due, self._due, self._reminder, stretch_last=True))

        self._show_done = QCheckBox(t("tasks.show_done"))
        self._show_done.setChecked(True)
        self._show_done.toggled.connect(self._reload)
        self._list = QListWidget()
        self._list.itemChanged.connect(self._item_toggled)
        self._list.itemDoubleClicked.connect(lambda _item: self._edit())
        layout.addWidget(self._show_done)
        layout.addWidget(self._list, 1)

        edit = button("tasks.edit", parent=self)
        delete = button("tasks.delete", parent=self)
        edit.clicked.connect(self._edit)
        delete.clicked.connect(self._delete)
        layout.addLayout(row(edit, delete, stretch_last=True))
        self._reload()

    def _reload(self) -> None:
        self._list.blockSignals(True)
        self._list.clear()
        today = dt.date.today()
        for task in self.ctx.tasks.all(include_done=self._show_done.isChecked()):
            item = QListWidgetItem(self._label(task, today))
            item.setFlags(item.flags() | Qt.ItemFlag.ItemIsUserCheckable)
            item.setCheckState(Qt.CheckState.Checked if task.done else Qt.CheckState.Unchecked)
            item.setData(_ID, task.id)
            self._list.addItem(item)
        self._list.blockSignals(False)

    @staticmethod
    def _label(task: Task, today: dt.date) -> str:
        if task.due_date is None:
            return task.title
        suffix = t("tasks.overdue") if (task.due_date < today and not task.done) else ""
        return f"{task.title}  |  {task.due_date.isoformat()}{suffix}"

    def _add(self) -> None:
        due = from_qdate(self._due.date()) if self._has_due.isChecked() else None
        try:
            self.ctx.tasks.add(
                self._title.text(),
                due,
                with_reminder=self._reminder.isChecked() and self._reminder.isEnabled(),
                now=dt.datetime.now(),
            )
        except ValueError as exc:
            error(self, str(exc))
            return
        self._title.clear()
        self._reload()

    def _item_toggled(self, item: QListWidgetItem) -> None:
        self.ctx.tasks.set_done(int(item.data(_ID)), item.checkState() == Qt.CheckState.Checked)
        self._reload()

    def _selected_id(self) -> int | None:
        item = self._list.currentItem()
        return int(item.data(_ID)) if item is not None else None

    def _edit(self) -> None:
        task_id = self._selected_id()
        if task_id is None:
            return
        task = self.ctx.tasks.get(task_id)
        if task is None:
            return
        dialog = TaskEditDialog(self, task.title, task.due_date)
        if dialog.exec() != QDialog.DialogCode.Accepted:
            return
        title, due = dialog.values()
        try:
            self.ctx.tasks.update(task_id, title, due)
        except ValueError as exc:
            error(self, str(exc))
            return
        self._reload()

    def _delete(self) -> None:
        task_id = self._selected_id()
        if task_id is None:
            return
        if not confirm(self, "tasks.delete_title", "tasks.delete_text"):
            return
        self.ctx.tasks.delete(task_id)
        self._reload()
