"""Settings: language, theme, autostart, tray, clipboard, shortcut, data folder and privacy actions."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

from PySide6.QtWidgets import (
    QCheckBox,
    QComboBox,
    QDialog,
    QFileDialog,
    QFormLayout,
    QLabel,
    QVBoxLayout,
    QWidget,
)

from desktop_organizer.app.context import AppContext
from desktop_organizer.app.widgets import button, confirm, error, info, muted, row
from desktop_organizer.core import winapi
from desktop_organizer.core.i18n import t
from desktop_organizer.core.settings import LANGUAGES, THEMES
from desktop_organizer.core.theme import SPACE_2


def open_folder(path: Path) -> None:
    if sys.platform.startswith("win"):
        os.startfile(str(path))  # type: ignore[attr-defined]
    else:
        subprocess.Popen(["xdg-open", str(path)])


class SettingsDialog(QDialog):
    def __init__(self, ctx: AppContext, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.ctx = ctx
        self.setWindowTitle(t("settings.title"))
        self.resize(560, 520)
        self.deleted_everything = False
        s = ctx.settings
        layout = QVBoxLayout(self)

        form = QFormLayout()
        self._language = QComboBox()
        for code in LANGUAGES:
            self._language.addItem(t(f"settings.language_{code}"), code)
        self._language.setCurrentIndex(LANGUAGES.index(s.language))
        self._theme = QComboBox()
        for code in THEMES:
            self._theme.addItem(t(f"settings.theme_{code}"), code)
        self._theme.setCurrentIndex(THEMES.index(s.theme))
        self._reduce = QCheckBox(t("settings.reduce_motion"))
        self._reduce.setChecked(s.reduce_motion)
        self._autostart = QCheckBox(t("settings.autostart"))
        self._autostart.setChecked(s.autostart)
        self._autostart.setEnabled(winapi.IS_WINDOWS)
        self._tray = QCheckBox(t("settings.tray"))
        self._tray.setChecked(s.tray_enabled)
        self._hotkey = QCheckBox(t("settings.quick_note_shortcut"))
        self._hotkey.setChecked(s.quick_note_shortcut)
        self._hotkey.setEnabled(winapi.IS_WINDOWS)
        self._clip = QCheckBox(t("settings.clipboard_recording"))
        self._clip.setChecked(s.clipboard_enabled)
        form.addRow(t("settings.language"), self._language)
        form.addRow(t("settings.theme"), self._theme)
        form.addRow("", self._reduce)
        form.addRow("", self._autostart)
        form.addRow("", self._tray)
        form.addRow("", self._hotkey)
        form.addRow("", self._clip)
        layout.addLayout(form)
        layout.addWidget(muted(t("settings.restart_note")))

        layout.addWidget(QLabel(t("settings.data_heading")))
        layout.addWidget(muted(t("settings.data_location", path=str(ctx.base_dir))))
        open_data = button("settings.open_data", parent=self)
        open_logs = button("settings.open_logs", parent=self)
        export = button("settings.export", parent=self)
        open_data.clicked.connect(lambda: open_folder(ctx.base_dir))
        open_logs.clicked.connect(lambda: open_folder(ctx.log_dir))
        export.clicked.connect(self._export)
        layout.addLayout(row(open_data, open_logs, export, stretch_last=True))

        delete = button("settings.delete_all", parent=self)
        delete.clicked.connect(self._delete_all)
        layout.addWidget(muted(t("settings.delete_all_note")))
        layout.addLayout(row(delete, stretch_last=True))

        self._status = QLabel("")
        layout.addWidget(self._status)
        layout.addStretch(1)

        save = button("settings.save", primary=True, parent=self)
        cancel = button("common.cancel", parent=self)
        save.clicked.connect(self._save)
        cancel.clicked.connect(self.reject)
        layout.addLayout(row(save, cancel, stretch_last=True))
        layout.setSpacing(SPACE_2)

    def _save(self) -> None:
        s = self.ctx.settings
        old_autostart = s.autostart
        s.language = str(self._language.currentData())
        s.theme = str(self._theme.currentData())
        s.reduce_motion = self._reduce.isChecked()
        s.autostart = self._autostart.isChecked()
        # Autostart starts the app in the tray, so it needs the tray icon.
        s.tray_enabled = self._tray.isChecked() or s.autostart
        s.quick_note_shortcut = self._hotkey.isChecked()
        s.clipboard_enabled = self._clip.isChecked()
        if s.autostart != old_autostart:
            try:
                winapi.set_autostart(s.autostart)
            except OSError as exc:
                error(self, t("settings.autostart_failed", message=str(exc)))
                s.autostart = old_autostart
                self._autostart.setChecked(old_autostart)
                return
        self.ctx.save_settings()
        self.accept()

    def _export(self) -> None:
        target, _ = QFileDialog.getSaveFileName(
            self, t("settings.export"), str(Path.home() / "desktop-organizer-export.zip"), "ZIP (*.zip)"
        )
        if not target:
            return
        export_data(self.ctx, Path(target))
        info(self, t("settings.export"), t("settings.exported", path=target))

    def _delete_all(self) -> None:
        if not confirm(self, "settings.delete_title", "settings.delete_text"):
            return
        self.ctx.db.close()
        for item in self.ctx.base_dir.iterdir():
            if item.is_dir():
                shutil.rmtree(item, ignore_errors=True)
            else:
                item.unlink(missing_ok=True)
        self.deleted_everything = True
        info(self, t("settings.delete_all"), t("settings.deleted"))
        self.accept()


def export_data(ctx: AppContext, target: Path) -> None:
    """Zip a consistent copy of the database and the settings file."""
    staging = ctx.base_dir / "export-staging.sqlite3"
    ctx.db.backup_to(staging)
    try:
        with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.write(staging, arcname="organizer.sqlite3")
            if ctx.settings_path.exists():
                archive.write(ctx.settings_path, arcname="settings.json")
    finally:
        staging.unlink(missing_ok=True)
