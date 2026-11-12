"""User settings stored as JSON. Unreadable files are set aside and defaults are used."""

from __future__ import annotations

import contextlib
import json
import logging
from dataclasses import asdict, dataclass, fields
from pathlib import Path

LANGUAGES: tuple[str, ...] = ("de", "en")
THEMES: tuple[str, ...] = ("system", "light", "dark")

log = logging.getLogger(__name__)


@dataclass
class Settings:
    language: str = "de"
    theme: str = "system"
    reduce_motion: bool = False
    autostart: bool = False
    tray_enabled: bool = False
    clipboard_enabled: bool = False
    clipboard_max_entries: int = 200
    quick_note_shortcut: bool = True
    backup_destination: str = ""
    last_cleaned_folder: str = ""

    def validated(self) -> Settings:
        if self.language not in LANGUAGES:
            self.language = "de"
        if self.theme not in THEMES:
            self.theme = "system"
        self.clipboard_max_entries = min(max(int(self.clipboard_max_entries), 10), 5000)
        return self


def load_settings(path: Path) -> Settings:
    if not path.exists():
        return Settings()
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise ValueError("settings root is not an object")
        known = {f.name for f in fields(Settings)}
        values = {key: value for key, value in raw.items() if key in known}
        return Settings(**values).validated()
    except (OSError, ValueError, TypeError) as exc:
        log.warning("Settings could not be read, defaults are used: %s", exc)
        with contextlib.suppress(OSError):
            path.replace(path.with_suffix(".corrupt.json"))
        return Settings()


def save_settings(path: Path, settings: Settings) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(asdict(settings), indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)
