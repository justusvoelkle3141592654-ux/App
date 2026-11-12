# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-11-12

### Added

- Overview window with one entry per tool, a search field for tools and notes, and a status line with CPU, memory and battery.
- File cleaner: sorts the files of a folder by type, with a preview and undo for the last run.
- Backup helper: copies new and changed files, verifies each copy with SHA-256, and writes a log file.
- Password generator: random passwords and passphrases from a cryptographically secure source, with a strength indicator.
- Notes: quick capture (global shortcut Ctrl+Alt+N on Windows), tags, and search.
- Duplicate finder: groups files by content, moves only confirmed files to the Recycle Bin.
- System monitor: CPU, memory, battery and drives, updated every second.
- Text replacer: previews every change, optional backup of originals, case and whole-word options, undo.
- Reminders: one-off, every N minutes, or daily, shown as Windows notifications.
- Task list: due dates and an optional reminder on the due date.
- File size overview: folder sizes, largest first, with bars.
- Time tracker: one timer at a time, daily and weekly totals, CSV export.
- Clipboard history: text only, searchable, pinnable, pausable, with a clear-history action.
- Settings: German and English, light, dark or follow Windows, optional tray icon, optional autostart, data export, and delete all data.
- Portable mode through a `portable.flag` file next to the executable.
- Smoke test for the packaged executable (`DesktopOrganizer.exe --smoke-test`).
- CI on Windows (lint, types, tests, vulnerability check, build) and a release workflow that publishes the executable with a SHA-256 checksum.
