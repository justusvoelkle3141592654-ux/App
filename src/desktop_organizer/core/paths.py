"""Locations of the application's data.

Default: %APPDATA%\\DesktopOrganizer. If a file named ``portable.flag`` sits next to the
executable, data goes to a ``data`` folder next to the executable instead. The
environment variable ``DESKTOP_ORGANIZER_DATA`` overrides both (used by tests).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from desktop_organizer import APP_NAME

DATA_ENV_VAR = "DESKTOP_ORGANIZER_DATA"
PORTABLE_FLAG = "portable.flag"
_FOLDER_NAME = "DesktopOrganizer"


def app_base_dir() -> Path:
    """Folder that contains the executable (frozen build) or the repository root (source run)."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parents[3]


def data_dir() -> Path:
    """Return the data folder and make sure it exists."""
    override = os.environ.get(DATA_ENV_VAR)
    path: Path
    if override:
        path = Path(override)
    elif (app_base_dir() / PORTABLE_FLAG).exists():
        path = app_base_dir() / "data"
    else:
        appdata = os.environ.get("APPDATA")
        base = Path(appdata) if appdata else Path.home() / ".config"
        path = base / _FOLDER_NAME
    path.mkdir(parents=True, exist_ok=True)
    return path


def settings_file(base: Path) -> Path:
    return base / "settings.json"


def database_file(base: Path) -> Path:
    return base / "organizer.sqlite3"


def log_dir(base: Path) -> Path:
    path = base / "logs"
    path.mkdir(parents=True, exist_ok=True)
    return path


def journal_dir(base: Path) -> Path:
    path = base / "journal"
    path.mkdir(parents=True, exist_ok=True)
    return path


def app_title() -> str:
    return APP_NAME
