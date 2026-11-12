from __future__ import annotations

import datetime as dt

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QComboBox,
    QDateTimeEdit,
    QFormLayout,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QSpinBox,
    QTimeEdit,
    QVBoxLayout,
    QWidget,
)

from desktop_organizer.app.base import ToolPage
from desktop_organizer.app.widgets import button, confirm, error, muted, row, to_qdatetime, to_qtime
from desktop_organizer.core.i18n import t
from desktop_organizer.tools.reminders.logic import Reminder


def describe(reminder: Reminder) -> str:
    due = reminder.next_due.strftime("%d.%m.%Y %H:%M") if reminder.next_due else t("reminders.finished")
    if reminder.kind == "interval":
        rule = t("reminders.rule_interval", minutes=reminder.interval_minutes or 0)
    elif reminder.kind == "daily":
        rule = t("reminders.rule_daily", time=reminder.daily_time or "")
    else:
        rule = t("reminders.rule_once")
    return f"{reminder.title}  |  {rule}  |  {t('reminders.next')}: {due}"


class RemindersPage(ToolPage):
    def build(self, layout: QVBoxLayout) -> None:
        layout.addWidget(muted(t("reminders.intro")))
        form_host = QWidget()
        form = QFormLayout(form_host)
        self._title = QLineEdit()
        self._title.setPlaceholderText(t("reminders.title_placeholder"))
        self._kind = QComboBox()
        self._kind.addItem(t("reminders.kind_once"), "once")
        self._kind.addItem(t("reminders.kind_interval"), "interval")
        self._kind.addItem(t("reminders.kind_daily"), "daily")
        self._kind.currentIndexChanged.connect(self._kind_changed)
        self._when = QDateTimeEdit(
            to_qdatetime(dt.datetime.now().replace(second=0, microsecond=0) + dt.timedelta(hours=1))
        )
        self._when.setCalendarPopup(True)
        self._when.setDisplayFormat("dd.MM.yyyy HH:mm")
        self._minutes = QSpinBox()
        self._minutes.setRange(1, 24 * 60)
        self._minutes.setValue(60)
        self._minutes.setSuffix(f" {t('reminders.minutes')}")
        self._time = QTimeEdit()
        self._time.setDisplayFormat("HH:mm")
        self._time.setTime(to_qtime(dt.time(9, 0)))
        form.addRow(t("reminders.title"), self._title)
        form.addRow(t("reminders.kind"), self._kind)
        form.addRow(t("reminders.at"), self._when)
        form.addRow(t("reminders.every"), self._minutes)
        form.addRow(t("reminders.daily_at"), self._time)
        layout.addWidget(form_host)

        add = button("reminders.add", primary=True, parent=self)
        toggle = button("reminders.toggle", parent=self)
        delete = button("reminders.delete", parent=self)
        add.clicked.connect(self._add)
        toggle.clicked.connect(self._toggle)
        delete.clicked.connect(self._delete)
        layout.addLayout(row(add, toggle, delete, stretch_last=True))

        self._list = QListWidget()
        layout.addWidget(self._list, 1)
        self._kind_changed(0)
        self._reload()

    def _kind_changed(self, _index: int) -> None:
        kind = self._kind.currentData()
        self._when.setVisible(kind == "once")
        self._minutes.setVisible(kind == "interval")
        self._time.setVisible(kind == "daily")

    def _reload(self) -> None:
        self._list.clear()
        for reminder in self.ctx.reminders.all():
            item = QListWidgetItem(describe(reminder))
            item.setData(Qt.ItemDataRole.UserRole, reminder.id)
            if not reminder.active:
                item.setText(item.text() + f"  ({t('reminders.off')})")
            self._list.addItem(item)

    def _add(self) -> None:
        now = dt.datetime.now()
        kind = str(self._kind.currentData())
        title = self._title.text()
        try:
            if kind == "once":
                due = self._when.dateTime().toPython()
                if not isinstance(due, dt.datetime) or due <= now:
                    raise ValueError(t("reminders.past"))
                self.ctx.reminders.add_once(title, due)
            elif kind == "interval":
                self.ctx.reminders.add_interval(title, self._minutes.value(), now)
            else:
                self.ctx.reminders.add_daily(title, self._time.time().toString("HH:mm"), now)
        except ValueError as exc:
            error(self, str(exc))
            return
        self._title.clear()
        self._reload()

    def _selected_id(self) -> int | None:
        item = self._list.currentItem()
        return int(item.data(Qt.ItemDataRole.UserRole)) if item is not None else None

    def _toggle(self) -> None:
        reminder_id = self._selected_id()
        if reminder_id is None:
            return
        reminder = self.ctx.reminders.get(reminder_id)
        if reminder is None:
            return
        self.ctx.reminders.set_active(reminder_id, not reminder.active)
        self._reload()

    def _delete(self) -> None:
        reminder_id = self._selected_id()
        if reminder_id is None:
            return
        if not confirm(self, "reminders.delete_title", "reminders.delete_text"):
            return
        self.ctx.reminders.delete(reminder_id)
        self._reload()
