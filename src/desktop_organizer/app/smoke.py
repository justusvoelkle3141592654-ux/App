"""Smoke test: build the main window and every tool window once, in a temporary data folder.

Run with ``DesktopOrganizer.exe --smoke-test`` (or ``python -m desktop_organizer --smoke-test``).
Exit code 0 means every window was created without an exception.
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

from PySide6.QtWidgets import QApplication

from desktop_organizer.app.context import build_context
from desktop_organizer.app.main_window import MainWindow
from desktop_organizer.app.tool_window import ToolWindow
from desktop_organizer.core.i18n import load_catalog, translator
from desktop_organizer.core.settings import LANGUAGES
from desktop_organizer.core.theme import apply_theme
from desktop_organizer.tools import TOOLS


def run_smoke_test() -> int:
    existing = QApplication.instance()
    app = existing if isinstance(existing, QApplication) else QApplication(sys.argv)
    failures: list[str] = []
    for lang in LANGUAGES:
        if not load_catalog(lang):
            failures.append(f"language catalog {lang} is empty or missing")
    with tempfile.TemporaryDirectory() as tmp:
        ctx = build_context(Path(tmp), db_path=":memory:")
        translator.set_language(ctx.settings.language)
        apply_theme(app, ctx.settings.theme, ctx.settings.reduce_motion)
        window = MainWindow(ctx)
        window.show()
        for spec in TOOLS:
            try:
                tool = ToolWindow(spec, ctx)
                tool.show()
                tool.close()
            except Exception as exc:
                failures.append(f"{spec.key}: {exc!r}")
        window.quit_app()
        ctx.db.close()
    for failure in failures:
        print(f"SMOKE FAILURE {failure}", file=sys.stderr)
    if not failures:
        print(f"SMOKE OK: main window and {len(TOOLS)} tool windows created, {len(LANGUAGES)} languages loaded")
    return 1 if failures else 0
