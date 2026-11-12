"""Small Windows-only helpers (global hotkey, clipboard privacy flag, autostart).

On other platforms every function reports "not available" so the app still runs.
"""

from __future__ import annotations

import contextlib
import importlib
import logging
import sys
from collections.abc import Callable

log = logging.getLogger(__name__)
IS_WINDOWS = sys.platform.startswith("win")

_EXCLUDE_FROM_HISTORY = "ExcludeClipboardContentFromMonitorProcessing"
_EXCLUDE_FROM_DUMP = "CanIncludeInDump"


def clipboard_marked_private() -> bool:
    """True if the copying app set the Windows privacy flags (password managers do this)."""
    if not IS_WINDOWS:
        return False
    import ctypes

    user32 = ctypes.windll.user32  # type: ignore[attr-defined]
    for name in (_EXCLUDE_FROM_HISTORY, _EXCLUDE_FROM_DUMP):
        fmt = user32.RegisterClipboardFormatW(name)
        if fmt and user32.IsClipboardFormatAvailable(fmt):
            return True
    return False


class HotkeyRegistration:
    """Registers one global hotkey with Windows and calls back when it is pressed.

    Requires a QApplication. Returns False from ``register`` when unsupported or taken.
    """

    WM_HOTKEY = 0x0312
    MOD_ALT = 0x0001
    MOD_CONTROL = 0x0002
    MOD_SHIFT = 0x0004
    MOD_NOREPEAT = 0x4000

    def __init__(self, hotkey_id: int, callback: Callable[[], None]) -> None:
        self._id = hotkey_id
        self._callback = callback
        self._filter: object | None = None

    def register(self, modifiers: int, virtual_key: int) -> bool:
        if not IS_WINDOWS:
            return False
        import ctypes

        from PySide6.QtCore import QAbstractNativeEventFilter
        from PySide6.QtWidgets import QApplication

        app = QApplication.instance()
        if app is None:
            return False
        if not ctypes.windll.user32.RegisterHotKey(  # type: ignore[attr-defined]
            None, self._id, modifiers | self.MOD_NOREPEAT, virtual_key
        ):
            log.warning("Global hotkey could not be registered (already in use?)")
            return False
        callback = self._callback
        hotkey_id = self._id
        wm_hotkey = self.WM_HOTKEY

        class _Filter(QAbstractNativeEventFilter):
            def nativeEventFilter(self, event_type, message):  # type: ignore[no-untyped-def]
                if event_type == b"windows_generic_MSG":
                    from ctypes import wintypes

                    msg = wintypes.MSG.from_address(int(message))
                    if msg.message == wm_hotkey and msg.wParam == hotkey_id:
                        callback()
                        return True, 0
                return False, 0

        self._filter = _Filter()
        app.installNativeEventFilter(self._filter)
        return True

    def unregister(self) -> None:
        if not IS_WINDOWS:
            return
        import ctypes

        from PySide6.QtWidgets import QApplication

        app = QApplication.instance()
        ctypes.windll.user32.UnregisterHotKey(None, self._id)  # type: ignore[attr-defined]
        if app is not None and self._filter is not None:
            app.removeNativeEventFilter(self._filter)  # type: ignore[arg-type]
        self._filter = None


_RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
AUTOSTART_VALUE = "DesktopOrganizer"


def autostart_command() -> str:

    if getattr(sys, "frozen", False):
        return f'"{sys.executable}" --background'
    return f'"{sys.executable}" -m desktop_organizer --background'


def set_autostart(enabled: bool) -> bool:
    """Add or remove the per-user Run entry. Returns False if not supported here."""
    if not IS_WINDOWS:
        return False
    winreg = importlib.import_module("winreg")

    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, _RUN_KEY, 0, winreg.KEY_SET_VALUE) as key:
        if enabled:
            winreg.SetValueEx(key, AUTOSTART_VALUE, 0, winreg.REG_SZ, autostart_command())
        else:
            with contextlib.suppress(FileNotFoundError):
                winreg.DeleteValue(key, AUTOSTART_VALUE)
    return True
