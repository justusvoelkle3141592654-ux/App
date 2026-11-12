"""Entry point. Used by ``python -m desktop_organizer`` and by the packaged .exe."""

from __future__ import annotations

import argparse
import logging
import sys

from PySide6.QtWidgets import QApplication, QMessageBox

from desktop_organizer import APP_NAME
from desktop_organizer.app.context import build_context
from desktop_organizer.app.main_window import MainWindow, app_icon
from desktop_organizer.core import paths
from desktop_organizer.core.i18n import translator
from desktop_organizer.core.logging_setup import setup_logging
from desktop_organizer.core.theme import apply_theme

log = logging.getLogger(__name__)


def _parse(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="desktop-organizer")
    parser.add_argument("--background", action="store_true", help="start in the tray (used by autostart)")
    parser.add_argument("--smoke-test", action="store_true", help="create every window once and exit")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse(sys.argv[1:] if argv is None else argv)
    if args.smoke_test:
        from desktop_organizer.app.smoke import run_smoke_test

        return run_smoke_test()
    base = paths.data_dir()
    setup_logging(paths.log_dir(base))
    log.info("Starting %s", APP_NAME)

    app = QApplication(sys.argv)
    app.setApplicationName(APP_NAME)
    app.setWindowIcon(app_icon())

    try:
        ctx = build_context(base)
    except Exception as exc:
        log.exception("Start-up failed")
        QMessageBox.critical(
            None,
            APP_NAME,
            f"Desktop Organizer could not open its data.\n\n{exc}\n\nLog: {paths.log_dir(base)}",
        )
        return 1

    translator.set_language(ctx.settings.language)
    apply_theme(app, ctx.settings.theme, ctx.settings.reduce_motion)

    window = MainWindow(ctx)
    if not (args.background and window.start_hidden_if_possible()):
        window.show()

    code = app.exec()
    ctx.db.close()
    log.info("Stopped with code %s", code)
    return int(code)
