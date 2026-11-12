from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
from PySide6.QtWidgets import QApplication

from desktop_organizer.app.context import AppContext
from desktop_organizer.core.i18n import LANG_DIR
from desktop_organizer.tools import TOOLS

SRC = Path(__file__).resolve().parents[1] / "src" / "desktop_organizer"
KEY_PATTERN = re.compile(r'"([a-z_]+\.[a-z_0-9.{}]+)"')
# Dotted strings in the code that are file names or paths, not translation keys.
NOT_KEYS = {"settings.json", "desktop.ini", "thumbs.db", "portable.flag", "organizer.sqlite3", "app.ico"}


def _catalog(lang: str) -> dict[str, str]:
    data: dict[str, str] = json.loads((LANG_DIR / f"{lang}.json").read_text(encoding="utf-8"))
    return data


def test_both_languages_have_identical_keys() -> None:
    de, en = _catalog("de"), _catalog("en")
    assert set(de) == set(en), f"only in de: {set(de) - set(en)}; only in en: {set(en) - set(de)}"


def test_placeholders_match_between_languages() -> None:
    de, en = _catalog("de"), _catalog("en")
    for key in en:
        assert set(re.findall(r"\{(\w+)\}", de[key])) == set(re.findall(r"\{(\w+)\}", en[key])), key


def test_no_exclamation_marks_in_ui_text() -> None:
    # Style rule from the brief: no exclamation marks in the interface.
    for lang in ("de", "en"):
        offenders = [k for k, v in _catalog(lang).items() if "!" in v]
        assert offenders == [], f"{lang}: {offenders}"


def test_every_literal_key_in_code_exists() -> None:
    catalog = _catalog("en")
    namespaces = {key.split(".")[0] for key in catalog}
    missing: list[str] = []
    for path in SRC.rglob("*.py"):
        for match in KEY_PATTERN.findall(path.read_text(encoding="utf-8")):
            if match in NOT_KEYS or "{" in match:
                continue
            if match.split(".")[0] in namespaces and match not in catalog:
                missing.append(f"{path.relative_to(SRC)}: {match}")
    assert missing == []


def test_dynamic_keys_exist_for_every_value() -> None:
    catalog = _catalog("en")
    for spec in TOOLS:
        assert f"tool.{spec.key}.title" in catalog
        assert f"tool.{spec.key}.desc" in catalog
    for level in ("weak", "fair", "good", "strong"):
        assert f"password.level.{level}" in catalog
    for code in ("de", "en"):
        assert f"settings.language_{code}" in catalog
    for theme in ("system", "light", "dark"):
        assert f"settings.theme_{theme}" in catalog


def test_worker_reports_success_and_failure(qapp: QApplication) -> None:
    from desktop_organizer.core.fs import CancelToken
    from desktop_organizer.core.worker import Worker

    results: list[object] = []
    errors: list[str] = []
    ok = Worker(lambda progress, cancel: 42)
    ok.succeeded.connect(results.append)
    ok.run()
    bad = Worker(lambda progress, cancel: (_ for _ in ()).throw(ValueError("boom")))
    bad.failed.connect(errors.append)
    bad.run()

    def _checked_work(progress: object, cancel: CancelToken) -> int:
        cancel.check()
        return 1

    cancelled = Worker(_checked_work)
    cancelled.cancel()
    flags: list[bool] = []
    cancelled.cancelled.connect(lambda: flags.append(True))
    cancelled.run()
    assert results == [42]
    assert errors == ["boom"]
    assert flags == [True]
    assert isinstance(CancelToken(), CancelToken)


def test_overview_search_finds_tools(qapp: QApplication, ctx: AppContext) -> None:
    from desktop_organizer.app.overview import Overview

    overview = Overview(ctx)
    overview._search.setText("zwischen")
    texts = [overview._list.item(i).text() for i in range(overview._list.count())]
    assert len(texts) == 1
    assert texts[0].startswith("Zwischenablage")
    overview.shutdown()


def test_overview_search_finds_notes(qapp: QApplication, ctx: AppContext) -> None:
    from desktop_organizer.app.overview import Overview

    ctx.notes.add("Geheime Zahlen notieren", title="Zahlen")
    overview = Overview(ctx)
    overview._search.setText("geheime")
    texts = [overview._list.item(i).text() for i in range(overview._list.count())]
    assert any("Zahlen" in text for text in texts)
    overview.shutdown()


def test_password_page_generates_value(qapp: QApplication, ctx: AppContext) -> None:
    from desktop_organizer.tools.password.ui import PasswordPage

    page = PasswordPage(ctx)
    value = page._output.text()
    assert len(value) == 20
    page._mode.setChecked(True)
    assert page._output.text().count("-") == 5
    page.shutdown()


def test_notes_page_saves_and_lists(qapp: QApplication, ctx: AppContext) -> None:
    from desktop_organizer.tools.notes.ui import NotesPage

    page = NotesPage(ctx)
    page._editor.setPlainText("Einkauf #haushalt")
    page._save()
    assert len(ctx.notes.all()) == 1
    assert page._list.count() == 1
    page.shutdown() if hasattr(page, "shutdown") else None


def test_tool_windows_open_for_every_tool(qapp: QApplication, ctx: AppContext) -> None:
    from desktop_organizer.app.tool_window import ToolWindow

    for spec in TOOLS:
        window = ToolWindow(spec, ctx)
        assert window.page is not None
        window.close()


def test_smoke_test_passes(qapp: QApplication) -> None:
    from desktop_organizer.app.smoke import run_smoke_test

    assert run_smoke_test() == 0


@pytest.mark.parametrize("theme", ["light", "dark"])
def test_theme_tokens_apply(qapp: QApplication, theme: str) -> None:
    from desktop_organizer.core.theme import apply_theme

    colors = apply_theme(qapp, theme, reduce_motion=True)
    assert colors.accent.startswith("#")
