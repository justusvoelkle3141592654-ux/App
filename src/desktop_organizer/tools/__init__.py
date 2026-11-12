"""Tool registry. Adding a tool means one new folder plus one entry in TOOLS below.

Each entry names a page class that derives from ``desktop_organizer.app.base.ToolPage``.
The page module is imported only when the tool is opened.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ToolSpec:
    key: str
    module: str
    page_class: str


TOOLS: tuple[ToolSpec, ...] = (
    ToolSpec("file_cleaner", "desktop_organizer.tools.file_cleaner.ui", "FileCleanerPage"),
    ToolSpec("backup", "desktop_organizer.tools.backup.ui", "BackupPage"),
    ToolSpec("password", "desktop_organizer.tools.password.ui", "PasswordPage"),
    ToolSpec("notes", "desktop_organizer.tools.notes.ui", "NotesPage"),
    ToolSpec("duplicates", "desktop_organizer.tools.duplicates.ui", "DuplicatesPage"),
    ToolSpec("system_monitor", "desktop_organizer.tools.system_monitor.ui", "SystemMonitorPage"),
    ToolSpec("text_replacer", "desktop_organizer.tools.text_replacer.ui", "TextReplacerPage"),
    ToolSpec("reminders", "desktop_organizer.tools.reminders.ui", "RemindersPage"),
    ToolSpec("tasks", "desktop_organizer.tools.tasks.ui", "TasksPage"),
    ToolSpec("file_sizes", "desktop_organizer.tools.file_sizes.ui", "FileSizesPage"),
    ToolSpec("time_tracker", "desktop_organizer.tools.time_tracker.ui", "TimeTrackerPage"),
    ToolSpec("clipboard", "desktop_organizer.tools.clipboard.ui", "ClipboardPage"),
)


def spec_for(key: str) -> ToolSpec:
    for spec in TOOLS:
        if spec.key == key:
            return spec
    raise KeyError(key)
