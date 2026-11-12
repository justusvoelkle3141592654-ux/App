from __future__ import annotations

from pathlib import Path

from PySide6.QtWidgets import QLabel, QLineEdit, QTableWidget, QTableWidgetItem, QVBoxLayout

from desktop_organizer.app.base import ToolPage
from desktop_organizer.app.widgets import button, confirm, error, folder_row, muted, row, status, table
from desktop_organizer.core.i18n import t
from desktop_organizer.tools.file_cleaner.logic import (
    Move,
    apply_moves,
    has_journal,
    plan_moves,
    undo_last_run,
)


class FileCleanerPage(ToolPage):
    def build(self, layout: QVBoxLayout) -> None:
        layout.addWidget(muted(t("file_cleaner.intro")))
        self._folder = QLineEdit(self.ctx.settings.last_cleaned_folder)
        self._folder.setPlaceholderText(t("file_cleaner.folder_placeholder"))
        layout.addLayout(folder_row(self._folder, self))

        self._preview_btn = button("file_cleaner.preview", primary=True, parent=self)
        self._apply_btn = button("file_cleaner.apply", parent=self)
        self._undo_btn = button("file_cleaner.undo", parent=self)
        self._preview_btn.clicked.connect(self._preview)
        self._apply_btn.clicked.connect(self._apply)
        self._undo_btn.clicked.connect(self._undo)
        self._apply_btn.setEnabled(False)
        self._undo_btn.setEnabled(has_journal(self.ctx.journal_dir))
        layout.addLayout(row(self._preview_btn, self._apply_btn, self._undo_btn, stretch_last=True))

        self._table: QTableWidget = table(
            [t("file_cleaner.col_file"), t("file_cleaner.col_category"), t("file_cleaner.col_target")]
        )
        layout.addWidget(self._table, 1)
        self._summary: QLabel = status("")
        layout.addWidget(self._summary)
        self._moves: list[Move] = []

    def _folder_path(self) -> Path | None:
        text = self._folder.text().strip()
        if not text:
            error(self, t("file_cleaner.no_folder"))
            return None
        path = Path(text)
        if not path.is_dir():
            error(self, t("common.folder_missing", path=text))
            return None
        return path

    def _preview(self) -> None:
        folder = self._folder_path()
        if folder is None:
            return
        self.ctx.settings.last_cleaned_folder = str(folder)
        self.ctx.save_settings()
        self._apply_btn.setEnabled(False)
        self.run_background(
            lambda _p, _c: plan_moves(folder),
            self._show_preview,
            start_message=t("file_cleaner.scanning"),
        )

    def _show_preview(self, moves: list[Move]) -> None:
        self._moves = moves
        self._table.setRowCount(len(moves))
        for r, move in enumerate(moves):
            self._table.setItem(r, 0, QTableWidgetItem(move.source.name))
            self._table.setItem(r, 1, QTableWidgetItem(move.category))
            self._table.setItem(r, 2, QTableWidgetItem(str(move.target.parent)))
        self._apply_btn.setEnabled(bool(moves))
        self._summary.setText(t("file_cleaner.summary", count=len(moves)) if moves else t("file_cleaner.nothing"))

    def _apply(self) -> None:
        if not self._moves:
            return
        if not confirm(self, "file_cleaner.confirm_title", "file_cleaner.confirm_text", count=len(self._moves)):
            return
        moves = list(self._moves)
        journal = self.ctx.journal_dir
        self._apply_btn.setEnabled(False)
        self.run_background(
            lambda _p, _c: apply_moves(moves, journal),
            self._after_apply,
            start_message=t("file_cleaner.moving"),
        )

    def _after_apply(self, result: object) -> None:
        from desktop_organizer.tools.file_cleaner.logic import RunResult

        assert isinstance(result, RunResult)
        self._moves = []
        self._table.setRowCount(0)
        self._undo_btn.setEnabled(result.journal is not None)
        text = t("file_cleaner.done", moved=result.moved, failed=len(result.failed))
        if result.failed:
            text += "\n" + "\n".join(f"{Path(src).name}: {reason}" for src, reason in result.failed[:20])
        self.ctx.notifier.notify(t("app.name"), t("file_cleaner.done", moved=result.moved, failed=len(result.failed)))
        self._summary.setText(text)

    def _undo(self) -> None:
        if not confirm(self, "file_cleaner.undo_title", "file_cleaner.undo_text"):
            return
        journal = self.ctx.journal_dir

        def _ok(result: object) -> None:
            from desktop_organizer.tools.file_cleaner.logic import UndoResult

            assert isinstance(result, UndoResult)
            self._undo_btn.setEnabled(has_journal(journal))
            text = t("file_cleaner.undo_done", restored=result.restored, failed=len(result.failed))
            if result.failed:
                text += "\n" + "\n".join(f"{Path(src).name}: {reason}" for src, reason in result.failed[:20])
            self._summary.setText(text)

        self.run_background(lambda _p, _c: undo_last_run(journal), _ok, start_message=t("file_cleaner.undoing"))
