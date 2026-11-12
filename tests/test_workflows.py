"""End-to-end flows through the real widgets and background threads (offscreen Qt).

Confirmation and error dialogs are replaced with test doubles, because a modal dialog would block the test.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from pathlib import Path

import pytest
from PySide6.QtWidgets import QApplication

from desktop_organizer.app import base as base_module
from desktop_organizer.app.context import AppContext
from desktop_organizer.tools.backup import ui as backup_ui
from desktop_organizer.tools.duplicates.ui import DuplicatesPage
from desktop_organizer.tools.file_cleaner import ui as cleaner_ui
from desktop_organizer.tools.file_cleaner.ui import FileCleanerPage
from desktop_organizer.tools.text_replacer import ui as replacer_ui
from desktop_organizer.tools.text_replacer.ui import TextReplacerPage


def _settle(qapp: QApplication, page: base_module.ToolPage, timeout: float = 15.0) -> None:
    """Wait for the background job of a page, then process the queued UI callbacks."""
    deadline = time.monotonic() + timeout
    while page.busy and time.monotonic() < deadline:
        qapp.processEvents()
        time.sleep(0.01)
    for _ in range(50):
        qapp.processEvents()
        time.sleep(0.002)
    assert not page.busy, "background job did not finish in time"


@pytest.fixture
def no_dialogs(monkeypatch: pytest.MonkeyPatch) -> dict[str, list[str]]:
    """Confirmations say yes; error messages are collected instead of shown."""
    errors: list[str] = []
    for module in (cleaner_ui, backup_ui, replacer_ui):
        monkeypatch.setattr(module, "confirm", lambda *args, **kwargs: True)
    monkeypatch.setattr(base_module, "error", lambda _parent, text: errors.append(text))
    monkeypatch.setattr(cleaner_ui, "error", lambda _parent, text: errors.append(text))
    monkeypatch.setattr(replacer_ui, "error", lambda _parent, text: errors.append(text))
    return {"errors": errors}


def test_file_cleaner_preview_apply_and_undo(
    qapp: QApplication, ctx: AppContext, tmp_path: Path, no_dialogs: dict[str, list[str]]
) -> None:
    folder = tmp_path / "Downloads"
    folder.mkdir()
    (folder / "urlaub.jpg").write_bytes(b"jpg")
    (folder / "rechnung.pdf").write_bytes(b"pdf")
    page = FileCleanerPage(ctx)
    page._folder.setText(str(folder))
    page._preview()
    _settle(qapp, page)
    assert page._apply_btn.isEnabled()
    page._apply()
    _settle(qapp, page)
    assert (folder / "Bilder" / "urlaub.jpg").exists()
    assert (folder / "Dokumente" / "rechnung.pdf").exists()
    assert page._undo_btn.isEnabled()
    page._undo()
    _settle(qapp, page)
    assert (folder / "urlaub.jpg").exists()
    assert (folder / "rechnung.pdf").exists()
    assert no_dialogs["errors"] == []
    page.shutdown()


def test_file_cleaner_refuses_protected_folder(
    qapp: QApplication, ctx: AppContext, system_folder: Path, no_dialogs: dict[str, list[str]]
) -> None:
    page = FileCleanerPage(ctx)
    page._folder.setText(str(system_folder))
    page._preview()
    _settle(qapp, page)
    assert no_dialogs["errors"], "a protected folder must produce an error message"
    assert not page._apply_btn.isEnabled()
    page.shutdown()


def test_duplicates_scan_lists_groups(
    qapp: QApplication, ctx: AppContext, tmp_path: Path, no_dialogs: dict[str, list[str]]
) -> None:
    (tmp_path / "a.txt").write_text("gleich")
    (tmp_path / "b.txt").write_text("gleich")
    (tmp_path / "c.txt").write_text("anders")
    page = DuplicatesPage(ctx)
    page._folder.setText(str(tmp_path))
    page._scan()
    _settle(qapp, page)
    assert page._tree.topLevelItemCount() == 1
    page._mark_extra()
    assert len(page._checked_paths()) == 1
    page.shutdown()


def test_backup_copies_and_verifies(
    qapp: QApplication, ctx: AppContext, tmp_path: Path, no_dialogs: dict[str, list[str]]
) -> None:
    source = tmp_path / "Fotos"
    (source / "2026").mkdir(parents=True)
    (source / "2026" / "bild.txt").write_text("inhalt")
    destination = tmp_path / "Ziel"
    destination.mkdir()
    page = backup_ui.BackupPage(ctx)
    page._sources.addItem(str(source))
    page._destination.setText(str(destination))
    page._preview()
    _settle(qapp, page)
    assert page._start_btn.isEnabled()
    page._start()
    _settle(qapp, page)
    assert (destination / "Fotos" / "2026" / "bild.txt").read_text() == "inhalt"
    assert no_dialogs["errors"] == []
    page.shutdown()


def test_text_replacer_replaces_and_undoes(
    qapp: QApplication, ctx: AppContext, tmp_path: Path, no_dialogs: dict[str, list[str]]
) -> None:
    (tmp_path / "brief.txt").write_text("Hallo Anna, Anna grüßt.", encoding="utf-8")
    page = TextReplacerPage(ctx)
    page._folder.setText(str(tmp_path))
    page._find.setText("Anna")
    page._replace.setText("Ben")
    page._case.setChecked(True)
    page._preview()
    _settle(qapp, page)
    page._apply()
    _settle(qapp, page)
    assert (tmp_path / "brief.txt").read_text(encoding="utf-8") == "Hallo Ben, Ben grüßt."
    page._undo()
    _settle(qapp, page)
    assert (tmp_path / "brief.txt").read_text(encoding="utf-8") == "Hallo Anna, Anna grüßt."
    page.shutdown()


def test_background_failure_is_reported_not_crashed(
    qapp: QApplication, ctx: AppContext, no_dialogs: dict[str, list[str]]
) -> None:
    page = FileCleanerPage(ctx)

    def _boom(progress: Callable[[int, str], None], cancel: object) -> None:
        raise RuntimeError("disk gone")

    assert page.run_background(_boom, lambda _result: None)
    _settle(qapp, page)
    assert any("disk gone" in text for text in no_dialogs["errors"])
    page.shutdown()
