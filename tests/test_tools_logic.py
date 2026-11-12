from __future__ import annotations

import datetime as dt
import math
import string
from pathlib import Path

import pytest

from desktop_organizer.app.context import AppContext
from desktop_organizer.core.storage import Database
from desktop_organizer.tools.clipboard.logic import ClipboardStore, content_hash
from desktop_organizer.tools.notes.logic import NotesStore, default_title, extract_tags
from desktop_organizer.tools.password.logic import (
    WORDLIST,
    PasswordOptions,
    generate_passphrase,
    generate_password,
    passphrase_entropy_bits,
    password_entropy_bits,
    strength_level,
)
from desktop_organizer.tools.reminders.logic import RemindersStore, compute_next_due, parse_daily_time
from desktop_organizer.tools.tasks.logic import TasksStore
from desktop_organizer.tools.time_tracker.logic import (
    TimeStore,
    day_bounds,
    export_csv,
    format_duration,
    totals_by_project,
    week_bounds,
)

NOW = dt.datetime(2026, 11, 12, 10, 0, 0)


# password -----------------------------------------------------------------------


def test_password_has_requested_length_and_contains_each_set() -> None:
    options = PasswordOptions(length=24)
    for _ in range(50):
        value = generate_password(options)
        assert len(value) == 24
        assert any(c in string.ascii_lowercase for c in value)
        assert any(c in string.ascii_uppercase for c in value)
        assert any(c in string.digits for c in value)


def test_password_respects_selected_sets_only() -> None:
    value = generate_password(PasswordOptions(length=30, upper=False, digits=False, symbols=False))
    assert value.isalpha() and value.islower()


def test_password_can_exclude_ambiguous_characters() -> None:
    options = PasswordOptions(length=200, exclude_ambiguous=True)
    value = generate_password(options)
    assert not set(value) & set("Il1O0o")


def test_password_rejects_invalid_options() -> None:
    with pytest.raises(ValueError):
        generate_password(PasswordOptions(lower=False, upper=False, digits=False, symbols=False))
    with pytest.raises(ValueError):
        generate_password(PasswordOptions(length=3))
    with pytest.raises(ValueError):
        generate_password(PasswordOptions(length=600))


def test_passphrase_uses_wordlist_and_separator() -> None:
    phrase = generate_passphrase(words=5, separator=" ", capitalize=True)
    parts = phrase.split(" ")
    assert len(parts) == 5
    assert all(p.lower() in WORDLIST and p[0].isupper() for p in parts)
    with pytest.raises(ValueError):
        generate_passphrase(words=2)


def test_entropy_and_strength_levels() -> None:
    assert password_entropy_bits(PasswordOptions(length=20)) > 100
    assert passphrase_entropy_bits(6) == pytest.approx(6 * math.log2(len(WORDLIST)))
    assert strength_level(35) == "weak"
    assert strength_level(50) == "fair"
    assert strength_level(70) == "good"
    assert strength_level(90) == "strong"


# notes --------------------------------------------------------------------------


def test_tags_are_extracted_lowercase_and_unique() -> None:
    assert extract_tags("Ideen #Projekt und #projekt, #web-app") == ("projekt", "web-app")
    assert extract_tags("Preis 5#2 und a&#b") == ()


def test_default_title_uses_first_line() -> None:
    assert default_title("\n  Erste Zeile\nZweite") == "Erste Zeile"


def test_notes_add_update_search_delete(ctx: AppContext) -> None:
    store = NotesStore(ctx.db)
    first = store.add("Einkauf: Milch #haushalt")
    store.add("Projektplan", title="Plan")
    saved = store.get(first)
    assert saved is not None
    assert saved.tags == ("haushalt",)
    assert [n.id for n in store.search("MILCH")] == [first]
    assert len(store.search("haushalt plan")) == 0
    assert len(store.search("")) == 2
    store.update(first, "Einkauf: Brot", title="")
    updated = store.get(first)
    assert updated is not None
    assert updated.title == "Einkauf: Brot"
    assert store.tag_counts() == {}
    store.delete(first)
    assert store.get(first) is None


def test_notes_reject_empty_body(ctx: AppContext) -> None:
    with pytest.raises(ValueError):
        NotesStore(ctx.db).add("   ")


# reminders ----------------------------------------------------------------------


def test_compute_next_due_interval_and_daily() -> None:
    assert compute_next_due("interval", NOW, interval_minutes=30) == NOW + dt.timedelta(minutes=30)
    assert compute_next_due("daily", NOW, daily_time="10:30") == dt.datetime(2026, 11, 12, 10, 30)
    assert compute_next_due("daily", NOW, daily_time="09:30") == dt.datetime(2026, 11, 13, 9, 30)
    assert compute_next_due("once", NOW) is None


def test_invalid_reminder_inputs() -> None:
    with pytest.raises(ValueError):
        parse_daily_time("25:00")
    with pytest.raises(ValueError):
        compute_next_due("interval", NOW, interval_minutes=0)


def test_due_reminders_fire_and_recur(ctx: AppContext) -> None:
    store = RemindersStore(ctx.db)
    store.add_once("Termin", NOW - dt.timedelta(minutes=5))
    store.add_interval("Wasser", 60, NOW - dt.timedelta(minutes=61))
    due = store.due(NOW)
    assert {r.title for r in due} == {"Termin", "Wasser"}
    for reminder in due:
        store.mark_fired(reminder, NOW)
    assert store.due(NOW) == []
    water = next(r for r in store.all() if r.title == "Wasser")
    assert water.active and water.next_due is not None and water.next_due > NOW
    once = next(r for r in store.all() if r.title == "Termin")
    assert once.active is False


# tasks --------------------------------------------------------------------------


def test_task_with_reminder_creates_and_deletes_reminder(ctx: AppContext) -> None:
    reminders = RemindersStore(ctx.db)
    tasks = TasksStore(ctx.db, reminders)
    due = dt.date(2026, 11, 20)
    task_id = tasks.add("Bericht abgeben", due, with_reminder=True, now=NOW)
    assert len(reminders.all()) == 1
    assert reminders.all()[0].next_due == dt.datetime(2026, 11, 20, 9, 0)
    tasks.delete(task_id)
    assert reminders.all() == []


def test_task_reminder_needs_due_date(ctx: AppContext) -> None:
    tasks = TasksStore(ctx.db, RemindersStore(ctx.db))
    with pytest.raises(ValueError):
        tasks.add("ohne Datum", None, with_reminder=True, now=NOW)


def test_task_done_and_sorting(ctx: AppContext) -> None:
    tasks = TasksStore(ctx.db, RemindersStore(ctx.db))
    later = tasks.add("später", dt.date(2026, 12, 1), False, NOW)
    sooner = tasks.add("früher", dt.date(2026, 11, 13), False, NOW)
    tasks.set_done(sooner, True)
    order = [t.id for t in tasks.all()]
    assert order == [later, sooner]
    assert [t.id for t in tasks.all(include_done=False)] == [later]


# time tracker -------------------------------------------------------------------


def test_format_duration() -> None:
    assert format_duration(3725) == "1:02:05"
    assert format_duration(0) == "0:00:00"


def test_week_bounds_start_on_monday() -> None:
    start, end = week_bounds(dt.date(2026, 11, 12))  # a Thursday
    assert start == dt.datetime(2026, 11, 9)
    assert end == dt.datetime(2026, 11, 16)
    assert day_bounds(dt.date(2026, 11, 12)) == (dt.datetime(2026, 11, 12), dt.datetime(2026, 11, 13))


def test_timer_start_stops_previous_and_totals(ctx: AppContext) -> None:
    store = TimeStore(ctx.db)
    store.start("Kunde A", "Entwurf", NOW)
    store.start("Kunde B", "Review", NOW + dt.timedelta(hours=1))
    running = store.running()
    assert running is not None and running.project == "Kunde B"
    store.stop(NOW + dt.timedelta(hours=1, minutes=30))
    start, end = week_bounds(NOW.date())
    entries = store.between(start, end)
    totals = totals_by_project(entries, start, end, NOW + dt.timedelta(days=1))
    assert totals == {"Kunde A": 3600.0, "Kunde B": 1800.0}


def test_running_entry_counts_until_now(ctx: AppContext) -> None:
    store = TimeStore(ctx.db)
    store.start("P", "T", NOW)
    start, end = day_bounds(NOW.date())
    totals = totals_by_project(store.between(start, end), start, end, NOW + dt.timedelta(minutes=10))
    assert totals == {"P": 600.0}


def test_csv_export_uses_semicolons_and_utf8_bom(tmp_path: Path, ctx: AppContext) -> None:
    store = TimeStore(ctx.db)
    store.start("Büro", "Übersicht", NOW)
    store.stop(NOW + dt.timedelta(minutes=90))
    entries = store.between(NOW, NOW + dt.timedelta(days=1))
    target = tmp_path / "export.csv"
    assert export_csv(entries, target, NOW + dt.timedelta(days=1)) == 1
    raw = target.read_bytes()
    assert raw.startswith(b"\xef\xbb\xbf")
    text = raw.decode("utf-8-sig")
    assert text.splitlines()[1].split(";")[:2] == ["Büro", "Übersicht"]
    assert text.splitlines()[1].endswith("90,0")


# clipboard ----------------------------------------------------------------------


def test_clipboard_deduplicates_and_ignores_blank(ctx: AppContext) -> None:
    store = ClipboardStore(ctx.db, max_entries=50)
    assert store.add_text("   ", NOW) is False
    assert store.add_text("hallo", NOW) is True
    assert store.add_text("hallo", NOW + dt.timedelta(minutes=1)) is True
    assert len(store.list()) == 1
    assert content_hash("hallo") == content_hash("hallo")


def test_clipboard_trims_oldest_unpinned_and_keeps_pinned(ctx: AppContext) -> None:
    store = ClipboardStore(ctx.db, max_entries=3)
    first_id = None
    for i in range(4):
        store.add_text(f"eintrag {i}", NOW + dt.timedelta(minutes=i))
        if i == 0:
            first_id = store.list()[-1].id
    contents = {e.content for e in store.list()}
    assert "eintrag 0" not in contents
    assert len(contents) == 3
    pinned = next(e for e in store.list() if e.content == "eintrag 1")
    store.set_pinned(pinned.id, True)
    for i in range(4, 8):
        store.add_text(f"eintrag {i}", NOW + dt.timedelta(minutes=i))
    remaining = {e.content for e in store.list()}
    assert "eintrag 1" in remaining
    assert len(remaining) == 3
    assert first_id is not None


def test_clipboard_clear_keeps_pinned_by_default(ctx: AppContext) -> None:
    store = ClipboardStore(ctx.db, max_entries=10)
    store.add_text("a", NOW)
    store.add_text("b", NOW)
    keep = next(e for e in store.list() if e.content == "a")
    store.set_pinned(keep.id, True)
    store.clear(keep_pinned=True)
    assert [e.content for e in store.list()] == ["a"]
    store.clear(keep_pinned=False)
    assert store.list() == []


def test_clipboard_search_is_case_insensitive(ctx: AppContext) -> None:
    store = ClipboardStore(ctx.db, max_entries=10)
    store.add_text("Rechnung 2026", NOW)
    store.add_text("Notiz", NOW)
    assert [e.content for e in store.list("rechnung")] == ["Rechnung 2026"]


def test_database_is_usable_in_memory() -> None:
    db = Database(":memory:")
    assert db.query("SELECT COUNT(*) AS n FROM notes")[0]["n"] == 0
    db.close()
