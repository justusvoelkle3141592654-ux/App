"""Main window: overview, toolbar, tray icon, reminder checks, global shortcut and clipboard watcher."""

from __future__ import annotations

import datetime as dt
import logging
from pathlib import Path

from PySide6.QtCore import QTimer
from PySide6.QtGui import QAction, QCloseEvent, QIcon
from PySide6.QtWidgets import QApplication, QDialog, QMainWindow, QMenu, QMessageBox, QSystemTrayIcon

from desktop_organizer import APP_NAME
from desktop_organizer.app.context import AppContext
from desktop_organizer.app.overview import Overview
from desktop_organizer.app.settings_dialog import SettingsDialog
from desktop_organizer.app.tool_window import ToolWindow
from desktop_organizer.core.i18n import t
from desktop_organizer.core.theme import apply_theme
from desktop_organizer.core.winapi import HotkeyRegistration
from desktop_organizer.tools import spec_for
from desktop_organizer.tools.clipboard.watcher import ClipboardWatcher
from desktop_organizer.tools.notes.ui import NotesPage, QuickCaptureDialog

log = logging.getLogger(__name__)
REMINDER_CHECK_MS = 30_000
QUICK_NOTE_HOTKEY_ID = 1
VK_N = 0x4E
ICON_PATH = Path(__file__).resolve().parent.parent / "resources" / "icons" / "app.ico"


def app_icon() -> QIcon:
    return QIcon(str(ICON_PATH)) if ICON_PATH.exists() else QIcon()


class MainWindow(QMainWindow):
    def __init__(self, ctx: AppContext) -> None:
        super().__init__()
        self.ctx = ctx
        self._tool_windows: dict[str, ToolWindow] = {}
        self._popups: list[QMessageBox] = []
        self._quitting = False
        self.setWindowTitle(APP_NAME)
        self.setWindowIcon(app_icon())
        self.resize(720, 640)
        self.setMinimumSize(480, 420)

        self.overview = Overview(ctx, self)
        self.overview.open_tool.connect(self.open_tool)
        self.overview.open_note.connect(self.open_note)
        self.setCentralWidget(self.overview)

        toolbar = self.addToolBar(t("app.toolbar"))
        toolbar.setMovable(False)
        settings_action = QAction(t("settings.title"), self)
        settings_action.triggered.connect(self.open_settings)
        toolbar.addAction(settings_action)
        quick_action = QAction(t("notes.quick_title"), self)
        quick_action.triggered.connect(self.quick_note)
        toolbar.addAction(quick_action)

        self._tray: QSystemTrayIcon | None = None
        if ctx.settings.tray_enabled:
            self._setup_tray()

        self.clipboard_watcher = ClipboardWatcher(ctx, self)
        ctx.clipboard_watcher = self.clipboard_watcher
        if ctx.settings.clipboard_enabled:
            self.clipboard_watcher.start()

        self._hotkey: HotkeyRegistration | None = None
        if ctx.settings.quick_note_shortcut:
            self._register_hotkey()

        self._reminder_timer = QTimer(self)
        self._reminder_timer.timeout.connect(self.check_reminders)
        self._reminder_timer.start(REMINDER_CHECK_MS)
        self.check_reminders()

    # tray ------------------------------------------------------------------

    def _setup_tray(self) -> None:
        if not QSystemTrayIcon.isSystemTrayAvailable():
            log.warning("System tray is not available on this system")
            return
        tray = QSystemTrayIcon(app_icon(), self)
        menu = QMenu(self)
        show = QAction(t("tray.open"), self)
        show.triggered.connect(self.show_and_raise)
        quit_action = QAction(t("tray.quit"), self)
        quit_action.triggered.connect(self.quit_app)
        menu.addAction(show)
        menu.addSeparator()
        menu.addAction(quit_action)
        tray.setContextMenu(menu)
        tray.activated.connect(self._tray_activated)
        tray.show()
        self._tray = tray
        self.ctx.notifier.attach_tray(tray)

    def _tray_activated(self, reason: QSystemTrayIcon.ActivationReason) -> None:
        if reason in (QSystemTrayIcon.ActivationReason.Trigger, QSystemTrayIcon.ActivationReason.DoubleClick):
            self.show_and_raise()

    def show_and_raise(self) -> None:
        self.showNormal()
        self.raise_()
        self.activateWindow()

    def start_hidden_if_possible(self) -> bool:
        """With --background and a tray icon, start hidden in the tray. Returns True if hidden."""
        if self._tray is not None:
            self.hide()
            return True
        return False

    # global shortcut ---------------------------------------------------------

    def _register_hotkey(self) -> None:
        registration = HotkeyRegistration(QUICK_NOTE_HOTKEY_ID, self.quick_note)
        if registration.register(HotkeyRegistration.MOD_CONTROL | HotkeyRegistration.MOD_ALT, VK_N):
            self._hotkey = registration
        else:
            log.info("Quick note shortcut not active (unsupported or already in use)")

    def quick_note(self) -> None:
        dialog = QuickCaptureDialog(self.ctx, self)
        dialog.exec()

    # windows -----------------------------------------------------------------

    def open_tool(self, key: str) -> None:
        window = self._tool_windows.get(key)
        if window is None:
            window = ToolWindow(spec_for(key), self.ctx)
            self._tool_windows[key] = window
        window.show()
        window.raise_()
        window.activateWindow()

    def open_note(self, note_id: int) -> None:
        self.open_tool("notes")
        window = self._tool_windows["notes"]
        page = window.page
        if isinstance(page, NotesPage):
            page.open_note(note_id)

    def open_settings(self) -> None:
        dialog = SettingsDialog(self.ctx, self)
        if dialog.exec() != QDialog.DialogCode.Accepted:
            return
        app = QApplication.instance()
        if isinstance(app, QApplication):
            apply_theme(app, self.ctx.settings.theme, self.ctx.settings.reduce_motion)
        if dialog.deleted_everything:
            self.quit_app()
            return
        if self.ctx.settings.clipboard_enabled:
            self.clipboard_watcher.start()
        else:
            self.clipboard_watcher.stop()
        self.ctx.clipboard.max_entries = self.ctx.settings.clipboard_max_entries
        self.overview.refresh()

    # reminders ---------------------------------------------------------------

    def check_reminders(self) -> None:
        now = dt.datetime.now()
        try:
            due = self.ctx.reminders.due(now)
            for reminder in due:
                self._notify(t("app.name"), reminder.title)
                self.ctx.reminders.mark_fired(reminder, now)
        except Exception:
            log.exception("Reminder check failed")

    def _notify(self, title: str, message: str) -> None:
        if self._tray is not None:
            self.ctx.notifier.notify(title, message)
            return
        box = QMessageBox(QMessageBox.Icon.Information, title, message, QMessageBox.StandardButton.Ok, self)
        box.setModal(False)
        box.show()
        self._popups.append(box)

    # closing -----------------------------------------------------------------

    def closeEvent(self, event: QCloseEvent) -> None:
        if self._tray is not None and not self._quitting:
            self.hide()
            event.ignore()
            return
        self._shutdown()
        event.accept()

    def quit_app(self) -> None:
        self._quitting = True
        self.close()
        app = QApplication.instance()
        if app is not None:
            app.quit()

    def _shutdown(self) -> None:
        self._reminder_timer.stop()
        self.overview.shutdown()
        for window in self._tool_windows.values():
            window.page.shutdown()
            window.close()
        self.clipboard_watcher.stop()
        if self._hotkey is not None:
            self._hotkey.unregister()
        if self._tray is not None:
            self._tray.hide()
