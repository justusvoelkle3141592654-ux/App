from __future__ import annotations

import os
import sys
from collections.abc import Iterator
from pathlib import Path

import pytest

# Headless Qt for CI and local runs. Must be set before PySide6 creates an application.
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from desktop_organizer.app.context import AppContext, build_context
from desktop_organizer.core.i18n import translator


@pytest.fixture
def system_folder() -> Path:
    """A folder the app must refuse to touch: the Windows directory, or /etc on other systems."""
    if sys.platform.startswith("win"):
        return Path(os.environ.get("SYSTEMROOT", r"C:\Windows"))
    return Path("/etc")


@pytest.fixture
def ctx(tmp_path: Path) -> Iterator[AppContext]:
    """Application context with an in-memory database and a temporary data folder."""
    context = build_context(tmp_path / "data", db_path=":memory:")
    translator.set_language("de")
    yield context
    context.db.close()


@pytest.fixture(scope="session")
def qapp() -> object:
    from PySide6.QtWidgets import QApplication

    app = QApplication.instance() or QApplication([])
    return app
