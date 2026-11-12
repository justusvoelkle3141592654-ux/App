from __future__ import annotations

from pathlib import Path
from typing import cast

from PySide6.QtWidgets import QCheckBox, QLabel, QLineEdit, QTableWidgetItem, QVBoxLayout

from desktop_organizer.app.base import ToolPage
from desktop_organizer.app.widgets import button, confirm, error, folder_row, muted, row, status, table
from desktop_organizer.core.fs import CancelToken
from desktop_organizer.core.i18n import t
from desktop_organizer.core.worker import ProgressFn
from desktop_organizer.tools.text_replacer.logic import (
    PlanResult,
    ReplaceOptions,
    apply_changes,
    has_undo,
    plan_replacements,
    undo_last_run,
)


class TextReplacerPage(ToolPage):
    def build(self, layout: QVBoxLayout) -> None:
        layout.addWidget(muted(t("text_replacer.intro")))
        self._folder = QLineEdit(self.ctx.settings.last_cleaned_folder)
        self._folder.setPlaceholderText(t("common.folder_placeholder"))
        layout.addLayout(folder_row(self._folder, self))

        self._find = QLineEdit()
        self._find.setPlaceholderText(t("text_replacer.find_placeholder"))
        self._replace = QLineEdit()
        self._replace.setPlaceholderText(t("text_replacer.replace_placeholder"))
        self._case = QCheckBox(t("text_replacer.case_sensitive"))
        self._word = QCheckBox(t("text_replacer.whole_word"))
        self._backup = QCheckBox(t("text_replacer.keep_backups"))
        self._backup.setChecked(True)
        self._extensions = QLineEdit(".txt, .md, .csv, .json, .xml, .html, .htm, .py, .js, .ts, .ini, .cfg, .log")
        layout.addWidget(QLabel(t("text_replacer.find")))
        layout.addWidget(self._find)
        layout.addWidget(QLabel(t("text_replacer.replace")))
        layout.addWidget(self._replace)
        layout.addLayout(row(self._case, self._word, self._backup, stretch_last=True))
        layout.addWidget(QLabel(t("text_replacer.extensions")))
        layout.addWidget(self._extensions)

        preview = button("text_replacer.preview", parent=self)
        self._apply_btn = button("text_replacer.apply", primary=True, parent=self)
        self._undo_btn = button("text_replacer.undo", parent=self)
        preview.clicked.connect(self._preview)
        self._apply_btn.clicked.connect(self._apply)
        self._undo_btn.clicked.connect(self._undo)
        self._apply_btn.setEnabled(False)
        self._undo_btn.setEnabled(has_undo(self.ctx.journal_dir))
        layout.addLayout(row(preview, self._apply_btn, self._undo_btn, stretch_last=True))

        self._table = table([t("text_replacer.col_file"), t("text_replacer.col_count"), t("text_replacer.col_path")])
        layout.addWidget(self._table, 1)
        self._summary = status("")
        layout.addWidget(self._summary)
        self._result: PlanResult | None = None

    def _options(self) -> ReplaceOptions | None:
        if not self._find.text():
            error(self, t("text_replacer.no_find"))
            return None
        exts = frozenset(
            ("." + part.strip().lstrip(".")).lower() for part in self._extensions.text().split(",") if part.strip()
        )
        return ReplaceOptions(
            find=self._find.text(),
            replace=self._replace.text(),
            case_sensitive=self._case.isChecked(),
            whole_word=self._word.isChecked(),
            extensions=exts,
        )

    def _preview(self) -> None:
        options = self._options()
        text = self._folder.text().strip()
        if options is None:
            return
        if not text or not Path(text).is_dir():
            error(self, t("common.folder_missing", path=text or "-"))
            return
        root = Path(text)
        self._apply_btn.setEnabled(False)

        def _work(progress: ProgressFn, cancel: CancelToken) -> PlanResult:
            return plan_replacements(root, options, progress, cancel)

        self.run_background(_work, self._show, start_message=t("text_replacer.scanning"), cancellable=True)

    def _show(self, result: object) -> None:
        assert isinstance(result, PlanResult)
        self._result = result
        self._table.setRowCount(len(result.changes))
        for r, change in enumerate(result.changes):
            self._table.setItem(r, 0, QTableWidgetItem(change.path.name))
            self._table.setItem(r, 1, QTableWidgetItem(str(change.count)))
            self._table.setItem(r, 2, QTableWidgetItem(str(change.path.parent)))
        total = sum(c.count for c in result.changes)
        self._summary.setText(
            t(
                "text_replacer.summary",
                files=len(result.changes),
                count=total,
                scanned=result.scanned,
                binary=result.skipped_binary,
                errors=len(result.errors.items),
            )
        )
        self._apply_btn.setEnabled(bool(result.changes))

    def _apply(self) -> None:
        if self._result is None or not self._result.changes:
            return
        if not confirm(
            self, "text_replacer.confirm_title", "text_replacer.confirm_text", count=len(self._result.changes)
        ):
            return
        changes = list(self._result.changes)
        backup_root = self.ctx.backup_dir if self._backup.isChecked() else None
        journal = self.ctx.journal_dir
        self._apply_btn.setEnabled(False)

        def _work(progress: ProgressFn, cancel: CancelToken) -> tuple[int, list[tuple[str, str]]]:
            return apply_changes(changes, backup_root, journal)

        def _done(result: object) -> None:
            written, failed = cast(tuple[int, list[tuple[str, str]]], result)
            self._result = None
            self._table.setRowCount(0)
            self._undo_btn.setEnabled(has_undo(journal))
            self._summary.setText(t("text_replacer.done", written=written, failed=len(failed)))

        self.run_background(_work, _done, start_message=t("text_replacer.writing"))

    def _undo(self) -> None:
        if not confirm(self, "text_replacer.undo_title", "text_replacer.undo_text"):
            return
        journal = self.ctx.journal_dir

        def _done(result: object) -> None:
            restored, failed = cast(tuple[int, list[tuple[str, str]]], result)
            self._undo_btn.setEnabled(has_undo(journal))
            self._summary.setText(t("text_replacer.undo_done", restored=restored, failed=len(failed)))

        self.run_background(lambda _p, _c: undo_last_run(journal), _done, start_message=t("text_replacer.undoing"))
