from __future__ import annotations

from pathlib import Path

import pytest

from desktop_organizer.core.fs import CancelToken
from desktop_organizer.tools.backup.logic import plan_backup, run_backup
from desktop_organizer.tools.duplicates import logic as dup_logic
from desktop_organizer.tools.duplicates.logic import delete_to_recycle_bin, find_duplicates
from desktop_organizer.tools.file_cleaner.logic import (
    CATEGORIES,
    apply_moves,
    category_for,
    has_journal,
    plan_moves,
    undo_last_run,
)
from desktop_organizer.tools.file_sizes.logic import human_size, scan_sizes
from desktop_organizer.tools.text_replacer.logic import (
    ReplaceOptions,
    apply_changes,
    build_pattern,
    has_undo,
    plan_replacements,
    replace_in_text,
)
from desktop_organizer.tools.text_replacer.logic import (
    undo_last_run as undo_replacements,
)


def _noop(_p: int, _m: str) -> None:
    return None


# file cleaner -------------------------------------------------------------------


def test_category_mapping_is_case_insensitive() -> None:
    assert category_for("Photo.JPG") == "Bilder"
    assert category_for("report.pdf") == "Dokumente"
    assert category_for("setup.exe") == "Programme"
    assert category_for("mystery.xyz") == "Sonstiges"
    assert "Bilder" in CATEGORIES


def test_plan_moves_only_top_level_files_and_avoids_collisions(tmp_path: Path) -> None:
    (tmp_path / "a.jpg").write_text("1")
    (tmp_path / "b.jpg").write_text("2")
    (tmp_path / ".hidden.jpg").write_text("3")
    (tmp_path / "Bilder").mkdir()
    (tmp_path / "Bilder" / "a.jpg").write_text("existing")
    (tmp_path / "Bilder" / "nested.jpg").write_text("untouched")
    moves = plan_moves(tmp_path)
    names = [m.source.name for m in moves]
    assert names == ["a.jpg", "b.jpg"]
    assert all(m.target.parent == tmp_path / "Bilder" for m in moves)
    assert moves[0].target.name == "a (2).jpg"


def test_apply_and_undo_restores_original_layout(tmp_path: Path) -> None:
    journal = tmp_path / "journal"
    journal.mkdir()
    (tmp_path / "scan.pdf").write_text("pdf")
    (tmp_path / "movie.mkv").write_text("mkv")
    moves = plan_moves(tmp_path)
    result = apply_moves(moves, journal)
    assert result.moved == 2
    assert (tmp_path / "Dokumente" / "scan.pdf").exists()
    assert has_journal(journal)
    undo = undo_last_run(journal)
    assert undo.restored == 2 and not undo.failed
    assert (tmp_path / "scan.pdf").exists()
    assert (tmp_path / "movie.mkv").exists()
    assert not has_journal(journal)


def test_undo_keeps_journal_when_file_is_missing(tmp_path: Path) -> None:
    journal = tmp_path / "journal"
    journal.mkdir()
    (tmp_path / "note.txt").write_text("x")
    apply_moves(plan_moves(tmp_path), journal)
    (tmp_path / "Dokumente" / "note.txt").unlink()
    undo = undo_last_run(journal)
    assert undo.restored == 0
    assert len(undo.failed) == 1
    assert has_journal(journal)


def test_plan_moves_refuses_protected_folder(system_folder: Path) -> None:
    with pytest.raises(PermissionError):
        plan_moves(system_folder)


# backup -------------------------------------------------------------------------


def _make_source(root: Path) -> Path:
    source = root / "photos"
    (source / "2024").mkdir(parents=True)
    (source / "a.txt").write_text("alpha")
    (source / "2024" / "b.txt").write_text("beta")
    return source


def test_backup_copies_new_files_and_verifies(tmp_path: Path) -> None:
    source = _make_source(tmp_path)
    destination = tmp_path / "dest"
    destination.mkdir()
    plan = plan_backup([source], destination, CancelToken())
    assert len(plan.copies) == 2
    assert all(c.reason == "new" for c in plan.copies)
    result = run_backup(plan, destination, _noop, CancelToken())
    assert result.copied == 2
    assert result.verified == 2
    assert result.mismatched == []
    assert (destination / "photos" / "2024" / "b.txt").read_text() == "beta"
    assert result.log_file is not None and result.log_file.exists()


def test_backup_only_copies_changed_files(tmp_path: Path) -> None:
    import os

    source = _make_source(tmp_path)
    destination = tmp_path / "dest"
    destination.mkdir()
    run_backup(plan_backup([source], destination, CancelToken()), destination, _noop, CancelToken())
    changed = source / "a.txt"
    changed.write_text("alpha changed!")
    later = changed.stat().st_mtime + 60
    os.utime(changed, (later, later))
    plan = plan_backup([source], destination, CancelToken())
    assert [c.source.name for c in plan.copies] == ["a.txt"]
    assert plan.copies[0].reason == "changed"
    assert plan.unchanged == 1


def test_backup_refuses_destination_inside_source(tmp_path: Path) -> None:
    source = _make_source(tmp_path)
    inside = source / "inside"
    inside.mkdir()
    with pytest.raises(ValueError, match="must not be inside"):
        plan_backup([source], inside, CancelToken())


# duplicates ---------------------------------------------------------------------


def test_duplicates_group_by_content_not_name_or_size(tmp_path: Path) -> None:
    (tmp_path / "a.txt").write_text("same content")
    (tmp_path / "copy-of-a.txt").write_text("same content")
    (tmp_path / "same-size.txt").write_text("xxame conten")  # same length as "same content", different bytes
    (tmp_path / "longer.txt").write_text("same content plus")
    result = find_duplicates(tmp_path, _noop, CancelToken())
    assert len(result.groups) == 1
    assert {p.name for p in result.groups[0].paths} == {"a.txt", "copy-of-a.txt"}
    assert result.groups[0].wasted_bytes == len("same content")


def test_delete_uses_recycle_bin_only(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    sent: list[Path] = []
    monkeypatch.setattr(dup_logic, "send_to_recycle_bin", lambda p: sent.append(p))
    target = tmp_path / "x.txt"
    target.write_text("x")
    deleted, failed = delete_to_recycle_bin([target])
    assert deleted == 1 and not failed
    assert sent == [target]


# text replacer ------------------------------------------------------------------


def test_whole_word_and_case_options() -> None:
    options = ReplaceOptions(find="cat", replace="dog", whole_word=True)
    text, count = replace_in_text("cat concat Cat", options)
    assert text == "dog concat dog"
    assert count == 2
    strict = ReplaceOptions(find="cat", replace="dog", case_sensitive=True)
    assert replace_in_text("Cat cat", strict) == ("Cat dog", 1)


def test_replacement_text_keeps_backslashes_literal() -> None:
    text, count = replace_in_text("a-b", ReplaceOptions(find="-", replace=r"\n\1"))
    assert text == r"a\n\1b"
    assert count == 1


def test_empty_search_is_rejected() -> None:
    with pytest.raises(ValueError):
        build_pattern(ReplaceOptions(find="", replace="x"))


def test_plan_apply_and_undo_with_backups(tmp_path: Path) -> None:
    root = tmp_path / "docs"
    root.mkdir()
    (root / "one.txt").write_text("hello world", encoding="utf-8")
    (root / "two.md").write_text("world world", encoding="utf-8")
    (root / "image.txt").write_bytes(b"\x00\x01world")
    (root / "broken.txt").write_bytes(b"\xff\xfeworld")
    journal = tmp_path / "journal"
    journal.mkdir()
    backups = tmp_path / "backups"
    options = ReplaceOptions(find="world", replace="there")
    plan = plan_replacements(root, options, _noop, CancelToken())
    assert {c.path.name for c in plan.changes} == {"one.txt", "two.md"}
    assert plan.skipped_binary == 1
    assert any(path.endswith("broken.txt") for path, _ in plan.errors.items)
    written, failed = apply_changes(plan.changes, backups, journal)
    assert written == 2 and not failed
    assert (root / "one.txt").read_text(encoding="utf-8") == "hello there"
    assert has_undo(journal)
    restored, undo_failed = undo_replacements(journal)
    assert restored == 2 and not undo_failed
    assert (root / "one.txt").read_text(encoding="utf-8") == "hello world"


def test_apply_without_backup_writes_no_undo(tmp_path: Path) -> None:
    root = tmp_path / "docs"
    root.mkdir()
    (root / "a.txt").write_text("foo", encoding="utf-8")
    journal = tmp_path / "journal"
    journal.mkdir()
    plan = plan_replacements(root, ReplaceOptions(find="foo", replace="bar"), _noop, CancelToken())
    written, _ = apply_changes(plan.changes, None, journal)
    assert written == 1
    assert (root / "a.txt").read_text(encoding="utf-8") == "bar"
    assert not has_undo(journal)


# file sizes ---------------------------------------------------------------------


def test_scan_sizes_sorts_largest_first(tmp_path: Path) -> None:
    big = tmp_path / "big"
    big.mkdir()
    (big / "data.bin").write_bytes(b"x" * 3000)
    small = tmp_path / "small"
    small.mkdir()
    (small / "data.bin").write_bytes(b"x" * 100)
    (tmp_path / "loose.txt").write_bytes(b"y" * 10)
    report = scan_sizes(tmp_path, _noop, CancelToken())
    assert [row.name for row in report.rows] == ["big", "small", ""]
    assert report.rows[0].total_bytes == 3000
    assert report.total_bytes == 3110


def test_human_size_units() -> None:
    assert human_size(999) == "999 B"
    assert human_size(1500) == "1.5 KB"
    assert human_size(2_000_000) == "2.0 MB"
