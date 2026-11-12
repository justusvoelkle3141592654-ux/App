from __future__ import annotations

import datetime as dt
from pathlib import Path

from PySide6.QtCore import QTimer
from PySide6.QtWidgets import QFileDialog, QLabel, QLineEdit, QTableWidgetItem, QVBoxLayout

from desktop_organizer.app.base import ToolPage
from desktop_organizer.app.widgets import button, confirm, error, muted, row, status, table
from desktop_organizer.core.i18n import t
from desktop_organizer.tools.time_tracker.logic import (
    day_bounds,
    export_csv,
    format_duration,
    totals_by_project,
    week_bounds,
)


class TimeTrackerPage(ToolPage):
    def build(self, layout: QVBoxLayout) -> None:
        layout.addWidget(muted(t("time.intro")))
        self._project = QLineEdit()
        self._project.setPlaceholderText(t("time.project_placeholder"))
        self._task = QLineEdit()
        self._task.setPlaceholderText(t("time.task_placeholder"))
        self._toggle = button("time.start", primary=True, parent=self)
        self._toggle.clicked.connect(self._toggle_timer)
        layout.addLayout(row(self._project, self._task, self._toggle))
        self._clock = QLabel("0:00:00")
        self._clock.setProperty("role", "headline")
        layout.addWidget(self._clock)

        layout.addWidget(QLabel(t("time.today")))
        self._today = table(
            [t("time.col_project"), t("time.col_task"), t("time.col_start"), t("time.col_end"), t("time.col_duration")]
        )
        layout.addWidget(self._today, 1)
        self._week_summary = status("")
        layout.addWidget(self._week_summary)

        delete = button("time.delete", parent=self)
        export = button("time.export", parent=self)
        delete.clicked.connect(self._delete_selected)
        export.clicked.connect(self._export)
        layout.addLayout(row(delete, export, stretch_last=True))

        self._timer = QTimer(self)
        self._timer.timeout.connect(self._tick)
        self._timer.start(1000)
        self._entry_ids: list[int] = []
        self._reload()

    def _toggle_timer(self) -> None:
        now = dt.datetime.now().replace(microsecond=0)
        if self.ctx.time.running() is not None:
            self.ctx.time.stop(now)
        else:
            self.ctx.time.start(self._project.text(), self._task.text(), now)
        self._reload()

    def _tick(self) -> None:
        running = self.ctx.time.running()
        if running is None:
            self._clock.setText("0:00:00")
            self._toggle.setText(t("time.start"))
            return
        seconds = (dt.datetime.now() - running.started_at).total_seconds()
        self._clock.setText(format_duration(seconds))
        self._toggle.setText(t("time.stop"))

    def _reload(self) -> None:
        now = dt.datetime.now()
        self._tick()
        day_start, day_end = day_bounds(now.date())
        entries = self.ctx.time.between(day_start, day_end)
        self._entry_ids = [e.id for e in entries]
        self._today.setRowCount(len(entries))
        for r, entry in enumerate(entries):
            seconds = entry.seconds_within(day_start, day_end, now)
            self._today.setItem(r, 0, QTableWidgetItem(entry.project))
            self._today.setItem(r, 1, QTableWidgetItem(entry.task))
            self._today.setItem(r, 2, QTableWidgetItem(entry.started_at.strftime("%H:%M")))
            self._today.setItem(
                r, 3, QTableWidgetItem(entry.ended_at.strftime("%H:%M") if entry.ended_at else t("time.running"))
            )
            self._today.setItem(r, 4, QTableWidgetItem(format_duration(seconds)))
        week_start, week_end = week_bounds(now.date())
        week_entries = self.ctx.time.between(week_start, week_end)
        totals = totals_by_project(week_entries, week_start, week_end, now)
        if totals:
            parts = [f"{name}: {format_duration(seconds)}" for name, seconds in totals.items()]
            total = sum(totals.values())
            self._week_summary.setText(t("time.week_total", total=format_duration(total)) + "\n" + "   ".join(parts))
        else:
            self._week_summary.setText(t("time.week_empty"))

    def _delete_selected(self) -> None:
        row_index = self._today.currentRow()
        if row_index < 0 or row_index >= len(self._entry_ids):
            return
        if not confirm(self, "time.delete_title", "time.delete_text"):
            return
        self.ctx.time.delete(self._entry_ids[row_index])
        self._reload()

    def _export(self) -> None:
        now = dt.datetime.now()
        week_start, week_end = week_bounds(now.date())
        entries = self.ctx.time.between(week_start, week_end)
        if not entries:
            error(self, t("time.nothing_to_export"))
            return
        suggested = str(Path.home() / f"time-{week_start:%Y-%m-%d}.csv")
        path, _ = QFileDialog.getSaveFileName(self, t("time.export"), suggested, "CSV (*.csv)")
        if not path:
            return
        export_csv(entries, Path(path), now)
        self._week_summary.setText(t("time.exported", count=len(entries), path=path))

    def shutdown(self) -> None:
        self._timer.stop()
        super().shutdown()
