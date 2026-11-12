from __future__ import annotations

from pathlib import Path
from typing import cast

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QLineEdit, QTreeWidget, QTreeWidgetItem, QVBoxLayout

from desktop_organizer.app.base import ToolPage
from desktop_organizer.app.widgets import button, confirm, error, folder_row, muted, row, status
from desktop_organizer.core.fs import CancelToken
from desktop_organizer.core.i18n import t
from desktop_organizer.core.worker import ProgressFn
from desktop_organizer.tools.duplicates.logic import ScanResult, delete_to_recycle_bin, find_duplicates
from desktop_organizer.tools.file_sizes.logic import human_size

_PATH_ROLE = Qt.ItemDataRole.UserRole


class DuplicatesPage(ToolPage):
    def build(self, layout: QVBoxLayout) -> None:
        layout.addWidget(muted(t("duplicates.intro")))
        self._folder = QLineEdit(self.ctx.settings.last_cleaned_folder)
        self._folder.setPlaceholderText(t("common.folder_placeholder"))
        layout.addLayout(folder_row(self._folder, self))

        scan = button("duplicates.scan", primary=True, parent=self)
        mark = button("duplicates.mark_extra", parent=self)
        delete = button("duplicates.delete", parent=self)
        scan.clicked.connect(self._scan)
        mark.clicked.connect(self._mark_extra)
        delete.clicked.connect(self._delete)
        layout.addLayout(row(scan, mark, delete, stretch_last=True))

        self._tree = QTreeWidget()
        self._tree.setHeaderLabels([t("duplicates.col_file"), t("duplicates.col_size"), t("duplicates.col_path")])
        self._tree.setRootIsDecorated(True)
        self._tree.setAlternatingRowColors(True)
        self._tree.itemChanged.connect(self._update_summary)
        layout.addWidget(self._tree, 1)
        self._summary = status("")
        layout.addWidget(self._summary)
        self._scan_text = ""

    def _scan(self) -> None:
        text = self._folder.text().strip()
        if not text or not Path(text).is_dir():
            error(self, t("common.folder_missing", path=text or "-"))
            return
        root = Path(text)
        self.ctx.settings.last_cleaned_folder = text
        self.ctx.save_settings()

        def _work(progress: ProgressFn, cancel: CancelToken) -> ScanResult:
            return find_duplicates(root, progress, cancel)

        self._tree.clear()
        self.run_background(_work, self._show, start_message=t("duplicates.scanning"), cancellable=True)

    def _show(self, result: object) -> None:
        scan = cast(ScanResult, result)
        self._tree.blockSignals(True)
        self._tree.clear()
        for group in scan.groups:
            parent = QTreeWidgetItem([t("duplicates.group", count=len(group.paths)), human_size(group.size), ""])
            parent.setFlags(parent.flags() & ~Qt.ItemFlag.ItemIsUserCheckable)
            for path in group.paths:
                child = QTreeWidgetItem([path.name, human_size(group.size), str(path.parent)])
                child.setFlags(child.flags() | Qt.ItemFlag.ItemIsUserCheckable)
                child.setCheckState(0, Qt.CheckState.Unchecked)
                child.setData(0, _PATH_ROLE, str(path))
                parent.addChild(child)
            self._tree.addTopLevelItem(parent)
            parent.setExpanded(True)
        self._tree.blockSignals(False)
        self._tree.resizeColumnToContents(0)
        self._scan_text = t(
            "duplicates.summary",
            groups=len(scan.groups),
            files=scan.files_scanned,
            wasted=human_size(sum(g.wasted_bytes for g in scan.groups)),
            errors=len(scan.errors.items),
        )
        self._update_summary()

    def _groups(self) -> list[QTreeWidgetItem]:
        items: list[QTreeWidgetItem] = []
        for i in range(self._tree.topLevelItemCount()):
            item = self._tree.topLevelItem(i)
            if item is not None:
                items.append(item)
        return items

    def _checked_paths(self) -> list[Path]:
        paths: list[Path] = []
        for group in self._groups():
            for j in range(group.childCount()):
                child = group.child(j)
                if child is not None and child.checkState(0) == Qt.CheckState.Checked:
                    paths.append(Path(str(child.data(0, _PATH_ROLE))))
        return paths

    def _update_summary(self) -> None:
        checked = t("duplicates.checked", count=len(self._checked_paths()))
        self._summary.setText(f"{self._scan_text}\n{checked}" if self._scan_text else checked)

    def _mark_extra(self) -> None:
        """Check every copy except the first one in each group (the first is kept)."""
        self._tree.blockSignals(True)
        for group in self._groups():
            for j in range(group.childCount()):
                child = group.child(j)
                if child is not None:
                    child.setCheckState(0, Qt.CheckState.Unchecked if j == 0 else Qt.CheckState.Checked)
        self._tree.blockSignals(False)
        self._update_summary()

    def _delete(self) -> None:
        paths = self._checked_paths()
        if not paths:
            error(self, t("duplicates.none_checked"))
            return
        if not confirm(self, "duplicates.confirm_title", "duplicates.confirm_text", count=len(paths)):
            return

        def _work(progress: ProgressFn, cancel: CancelToken) -> tuple[int, list[tuple[str, str]]]:
            return delete_to_recycle_bin(paths)

        def _done(result: object) -> None:
            deleted, failed = cast(tuple[int, list[tuple[str, str]]], result)
            self._scan_text = t("duplicates.deleted", count=deleted, failed=len(failed))
            self._mark_gone()

        self.run_background(_work, _done, start_message=t("duplicates.deleting"))

    def _mark_gone(self) -> None:
        """Remove rows for files that no longer exist and drop groups with fewer than two files left."""
        for index in range(self._tree.topLevelItemCount() - 1, -1, -1):
            group = self._tree.topLevelItem(index)
            if group is None:
                continue
            for j in range(group.childCount() - 1, -1, -1):
                child = group.child(j)
                if child is not None and not Path(str(child.data(0, _PATH_ROLE))).exists():
                    group.removeChild(child)
            if group.childCount() <= 1:
                self._tree.takeTopLevelItem(index)
        self._update_summary()
