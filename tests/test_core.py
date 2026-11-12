from __future__ import annotations

import json
import os
import sqlite3
import sys
from pathlib import Path

import pytest

from desktop_organizer.core.fs import CancelToken, iter_files, sha256_file, unique_path
from desktop_organizer.core.i18n import Translator
from desktop_organizer.core.safety import ProtectedPathError, ensure_allowed, is_protected
from desktop_organizer.core.settings import Settings, load_settings, save_settings
from desktop_organizer.core.storage import MIGRATIONS, Database

# settings ---------------------------------------------------------------------


def test_settings_round_trip(tmp_path: Path) -> None:
    path = tmp_path / "settings.json"
    save_settings(path, Settings(language="en", theme="dark", clipboard_max_entries=500))
    loaded = load_settings(path)
    assert loaded.language == "en"
    assert loaded.theme == "dark"
    assert loaded.clipboard_max_entries == 500
    assert loaded.autostart is False


def test_settings_invalid_values_are_corrected(tmp_path: Path) -> None:
    path = tmp_path / "settings.json"
    path.write_text(json.dumps({"language": "fr", "theme": "neon", "clipboard_max_entries": 1}), encoding="utf-8")
    loaded = load_settings(path)
    assert loaded.language == "de"
    assert loaded.theme == "system"
    assert loaded.clipboard_max_entries == 10


def test_corrupt_settings_are_set_aside(tmp_path: Path) -> None:
    path = tmp_path / "settings.json"
    path.write_text("{not json", encoding="utf-8")
    loaded = load_settings(path)
    assert loaded == Settings()
    assert (tmp_path / "settings.corrupt.json").exists()
    assert not path.exists()


def test_unknown_keys_are_ignored(tmp_path: Path) -> None:
    path = tmp_path / "settings.json"
    path.write_text(json.dumps({"language": "en", "future_option": True}), encoding="utf-8")
    assert load_settings(path).language == "en"


# storage ----------------------------------------------------------------------


def test_migrations_apply_once(tmp_path: Path) -> None:
    db_path = tmp_path / "db.sqlite3"
    first = Database(db_path)
    assert first.schema_version == len(MIGRATIONS)
    first.close()
    second = Database(db_path)
    assert second.schema_version == len(MIGRATIONS)
    second.close()


def test_newer_schema_is_refused(tmp_path: Path) -> None:
    db_path = tmp_path / "db.sqlite3"
    raw = sqlite3.connect(db_path)
    raw.execute("PRAGMA user_version = 99")
    raw.commit()
    raw.close()
    with pytest.raises(RuntimeError, match="newer"):
        Database(db_path)


def test_backup_to_creates_readable_copy(tmp_path: Path) -> None:
    db = Database(tmp_path / "db.sqlite3")
    db.execute("INSERT INTO notes (title, body, created_at, updated_at) VALUES ('t', 'b', 'x', 'x')")
    copy = tmp_path / "copy.sqlite3"
    db.backup_to(copy)
    db.close()
    raw = sqlite3.connect(copy)
    assert raw.execute("SELECT COUNT(*) FROM notes").fetchone()[0] == 1
    raw.close()


# i18n -------------------------------------------------------------------------


def test_translation_falls_back_to_english_then_key() -> None:
    tr = Translator("de")
    assert tr.t("common.yes") == "Ja"
    assert tr.t("does.not.exist") == "does.not.exist"
    tr.set_language("en")
    assert tr.t("common.yes") == "Yes"


def test_translation_formats_placeholders() -> None:
    assert Translator("en").t("file_cleaner.done", moved=3, failed=1) == "3 files moved, 1 errors."


# safety -----------------------------------------------------------------------


@pytest.mark.skipif(sys.platform.startswith("win"), reason="POSIX system folders")
def test_posix_system_folders_are_protected(tmp_path: Path) -> None:
    home = tmp_path / "home" / "user"
    assert is_protected(Path("/etc/passwd"), home=home)
    assert is_protected(Path("/usr/bin"), home=home)
    assert is_protected(Path("/"), home=home)
    assert not is_protected(home / "Downloads", home=home)


@pytest.mark.skipif(not sys.platform.startswith("win"), reason="Windows system folders")
def test_windows_system_folders_are_protected(tmp_path: Path) -> None:
    home = tmp_path / "home" / "user"
    windows_dir = Path(os.environ.get("SYSTEMROOT", r"C:\Windows"))
    assert is_protected(windows_dir / "System32", home=home)
    assert is_protected(Path(os.environ.get("PROGRAMFILES", r"C:\Program Files")), home=home)
    assert not is_protected(home / "Downloads", home=home)


def test_ensure_allowed_raises_for_protected_path(system_folder: Path) -> None:
    with pytest.raises(ProtectedPathError):
        ensure_allowed(system_folder)


# filesystem helpers -------------------------------------------------------------


def test_unique_path_appends_counter(tmp_path: Path) -> None:
    (tmp_path / "a.txt").write_text("x")
    (tmp_path / "a (2).txt").write_text("x")
    assert unique_path(tmp_path / "a.txt") == tmp_path / "a (3).txt"
    assert unique_path(tmp_path / "free.txt") == tmp_path / "free.txt"


def test_iter_files_skips_symlinks(tmp_path: Path) -> None:
    real = tmp_path / "real"
    real.mkdir()
    (real / "file.txt").write_text("data")
    target = tmp_path / "outside"
    target.mkdir()
    (target / "secret.txt").write_text("secret")
    link = real / "link"
    try:
        link.symlink_to(target, target_is_directory=True)
    except OSError:
        pytest.skip("symlinks not available")
    names = sorted(p.name for p in iter_files(real, CancelToken()))
    assert names == ["file.txt"]


def test_sha256_matches_known_value(tmp_path: Path) -> None:
    path = tmp_path / "abc.txt"
    path.write_bytes(b"abc")
    assert sha256_file(path) == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"


def test_cancel_token_stops_work(tmp_path: Path) -> None:
    from desktop_organizer.core.fs import Cancelled

    token = CancelToken()
    token.cancel()
    with pytest.raises(Cancelled):
        token.check()
