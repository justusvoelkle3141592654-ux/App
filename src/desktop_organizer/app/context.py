"""Shared services handed to every tool page: settings, database, stores and notifier."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

from desktop_organizer.core import paths
from desktop_organizer.core.notify import Notifier
from desktop_organizer.core.settings import Settings, load_settings, save_settings
from desktop_organizer.core.storage import Database
from desktop_organizer.tools.clipboard.logic import ClipboardStore
from desktop_organizer.tools.notes.logic import NotesStore
from desktop_organizer.tools.reminders.logic import RemindersStore
from desktop_organizer.tools.tasks.logic import TasksStore
from desktop_organizer.tools.time_tracker.logic import TimeStore

if TYPE_CHECKING:
    from desktop_organizer.tools.clipboard.watcher import ClipboardWatcher


@dataclass
class AppContext:
    base_dir: Path
    settings: Settings
    settings_path: Path
    db: Database
    notifier: Notifier
    journal_dir: Path
    log_dir: Path
    backup_dir: Path
    reminders: RemindersStore
    notes: NotesStore
    tasks: TasksStore
    time: TimeStore
    clipboard: ClipboardStore
    clipboard_watcher: ClipboardWatcher | None = None

    def save_settings(self) -> None:
        save_settings(self.settings_path, self.settings)


def build_context(base_dir: Path, *, db_path: str | Path | None = None) -> AppContext:
    """Create the context. Tests pass ``db_path=':memory:'`` and a temporary base_dir."""
    base_dir.mkdir(parents=True, exist_ok=True)
    settings_path = paths.settings_file(base_dir)
    settings = load_settings(settings_path)
    db = Database(db_path if db_path is not None else paths.database_file(base_dir))
    reminders = RemindersStore(db)
    return AppContext(
        base_dir=base_dir,
        settings=settings,
        settings_path=settings_path,
        db=db,
        notifier=Notifier(),
        journal_dir=paths.journal_dir(base_dir),
        log_dir=paths.log_dir(base_dir),
        backup_dir=base_dir / "backups",
        reminders=reminders,
        notes=NotesStore(db),
        tasks=TasksStore(db, reminders),
        time=TimeStore(db),
        clipboard=ClipboardStore(db, settings.clipboard_max_entries),
    )
