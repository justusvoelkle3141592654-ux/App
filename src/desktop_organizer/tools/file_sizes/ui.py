from __future__ import annotations

from pathlib import Path

from PySide6.QtWidgets import QLabel, QLineEdit, QProgressBar, QTableWidgetItem, QVBoxLayout

from desktop_organizer.app.base import ToolPage
from desktop_organizer.app.widgets import button, error, folder_row, muted, row, status, table
from desktop_organizer.core.fs import CancelToken
from desktop_organizer.core.i18n import t
from desktop_organizer.core.worker import ProgressFn
from desktop_organizer.tools.file_sizes.logic import SizeReport, human_size, scan_sizes


class FileSizesPage(ToolPage):
    def build(self, layout: QVBoxLayout) -> None:
        layout.addWidget(muted(t("file_sizes.intro")))
        self._folder = QLineEdit(self.ctx.settings.last_cleaned_folder)
        self._folder.setPlaceholderText(t("common.folder_placeholder"))
        layout.addLayout(folder_row(self._folder, self))
        scan = button("file_sizes.scan", primary=True, parent=self)
        scan.clicked.connect(self._scan)
        layout.addLayout(row(scan, stretch_last=True))
        self._table = table(
            [t("file_sizes.col_folder"), t("file_sizes.col_size"), t("file_sizes.col_share"), t("file_sizes.col_files")]
        )
        layout.addWidget(self._table, 1)
        self._summary: QLabel = status("")
        layout.addWidget(self._summary)

    def _scan(self) -> None:
        text = self._folder.text().strip()
        if not text or not Path(text).is_dir():
            error(self, t("common.folder_missing", path=text or "-"))
            return
        root = Path(text)
        self.ctx.settings.last_cleaned_folder = text
        self.ctx.save_settings()

        def _work(progress: ProgressFn, cancel: CancelToken) -> SizeReport:
            return scan_sizes(root, progress, cancel)

        self._table.setRowCount(0)
        self.run_background(_work, self._show, start_message=t("file_sizes.scanning"), cancellable=True)

    def _show(self, report: object) -> None:
        assert isinstance(report, SizeReport)
        total = report.total_bytes or 1
        self._table.setRowCount(len(report.rows))
        for r, folder in enumerate(report.rows):
            name = folder.name or t("file_sizes.loose_files")
            self._table.setItem(r, 0, QTableWidgetItem(name))
            self._table.setItem(r, 1, QTableWidgetItem(human_size(folder.total_bytes)))
            share = folder.total_bytes * 100 / total
            bar = QProgressBar()
            bar.setRange(0, 100)
            bar.setValue(int(round(share)))
            bar.setFormat(f"{share:.1f} %")
            self._table.setCellWidget(r, 2, bar)
            self._table.setItem(r, 3, QTableWidgetItem(str(folder.file_count)))
        self._summary.setText(
            t("file_sizes.summary", total=human_size(report.total_bytes), errors=len(report.errors.items))
        )
