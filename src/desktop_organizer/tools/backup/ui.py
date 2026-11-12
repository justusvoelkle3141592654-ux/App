from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QFileDialog, QLabel, QLineEdit, QListWidget, QVBoxLayout

from desktop_organizer.app.base import ToolPage
from desktop_organizer.app.widgets import button, confirm, error, folder_row, muted, row, status
from desktop_organizer.core.fs import CancelToken
from desktop_organizer.core.i18n import t
from desktop_organizer.core.worker import ProgressFn
from desktop_organizer.tools.backup.logic import BackupPlan, BackupResult, plan_backup, run_backup


class BackupPage(ToolPage):
    def build(self, layout: QVBoxLayout) -> None:
        layout.addWidget(muted(t("backup.intro")))
        layout.addWidget(QLabel(t("backup.sources")))
        self._sources = QListWidget()
        self._sources.setSelectionMode(QListWidget.SelectionMode.ExtendedSelection)
        layout.addWidget(self._sources, 1)
        add = button("backup.add_source", parent=self)
        remove = button("backup.remove_source", parent=self)
        add.clicked.connect(self._add_source)
        remove.clicked.connect(self._remove_source)
        layout.addLayout(row(add, remove, stretch_last=True))

        layout.addWidget(QLabel(t("backup.destination")))
        self._destination = QLineEdit(self.ctx.settings.backup_destination)
        self._destination.setPlaceholderText(t("backup.destination_placeholder"))
        layout.addLayout(folder_row(self._destination, self))

        self._preview_btn = button("backup.preview", parent=self)
        self._start_btn = button("backup.start", primary=True, parent=self)
        self._preview_btn.clicked.connect(self._preview)
        self._start_btn.clicked.connect(self._start)
        self._start_btn.setEnabled(False)
        layout.addLayout(row(self._preview_btn, self._start_btn, stretch_last=True))
        self._summary = status("")
        layout.addWidget(self._summary)
        self._plan: BackupPlan | None = None

    def _add_source(self) -> None:
        path = QFileDialog.getExistingDirectory(self, t("backup.sources"))
        if path and not self._sources.findItems(path, Qt.MatchFlag.MatchExactly):
            self._sources.addItem(path)
            self._invalidate()

    def _remove_source(self) -> None:
        for item in self._sources.selectedItems():
            self._sources.takeItem(self._sources.row(item))
        self._invalidate()

    def _invalidate(self) -> None:
        self._plan = None
        self._start_btn.setEnabled(False)
        self._summary.setText("")

    def _inputs(self) -> tuple[list[Path], Path] | None:
        sources = [Path(self._sources.item(i).text()) for i in range(self._sources.count())]
        dest_text = self._destination.text().strip()
        if not sources:
            error(self, t("backup.no_sources"))
            return None
        if not dest_text:
            error(self, t("backup.no_destination"))
            return None
        return sources, Path(dest_text)

    def _preview(self) -> None:
        inputs = self._inputs()
        if inputs is None:
            return
        sources, destination = inputs
        self.ctx.settings.backup_destination = str(destination)
        self.ctx.save_settings()

        def _work(progress: ProgressFn, cancel: CancelToken) -> BackupPlan:
            return plan_backup(sources, destination, cancel)

        self.run_background(_work, self._show_plan, start_message=t("backup.scanning"), cancellable=True)

    def _show_plan(self, plan: object) -> None:
        assert isinstance(plan, BackupPlan)
        self._plan = plan
        new = sum(1 for c in plan.copies if c.reason == "new")
        changed = sum(1 for c in plan.copies if c.reason == "changed")
        total_bytes = sum(c.size for c in plan.copies)
        from desktop_organizer.tools.file_sizes.logic import human_size

        text = t(
            "backup.plan_summary",
            new=new,
            changed=changed,
            unchanged=plan.unchanged,
            size=human_size(total_bytes),
            errors=len(plan.errors.items),
        )
        self._summary.setText(text)
        self._start_btn.setEnabled(bool(plan.copies))

    def _start(self) -> None:
        inputs = self._inputs()
        if inputs is None or self._plan is None:
            return
        _, destination = inputs
        if not confirm(self, "backup.confirm_title", "backup.confirm_text", count=len(self._plan.copies)):
            return
        plan = self._plan
        self._start_btn.setEnabled(False)

        def _work(progress: ProgressFn, cancel: CancelToken) -> BackupResult:
            return run_backup(plan, destination, progress, cancel)

        self.run_background(
            _work,
            self._finished,
            start_message=t("backup.copying"),
            on_cancel=lambda: self._summary.setText(t("common.cancelled")),
            cancellable=True,
        )

    def _finished(self, result: object) -> None:
        assert isinstance(result, BackupResult)
        self._plan = None
        text = t(
            "backup.done",
            copied=result.copied,
            verified=result.verified,
            failed=len(result.failed),
            mismatched=len(result.mismatched),
        )
        if result.log_file is not None:
            text += "\n" + t("backup.log_at", path=str(result.log_file))
        self._summary.setText(text)
        self.ctx.notifier.notify(t("app.name"), t("backup.notify", copied=result.copied))
