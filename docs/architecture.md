# Architecture

## Layers

```
src/desktop_organizer/
├─ __main__.py          entry point for "python -m desktop_organizer" and the .exe
├─ app/                 application shell (Qt widgets only)
│  ├─ main.py           start-up, logging, data folder, theme, error dialog
│  ├─ main_window.py    overview window, tray icon, reminders, global shortcut, clipboard watcher
│  ├─ overview.py       start screen with the search field and the status line
│  ├─ tool_window.py    one window per tool; loads the page class by name
│  ├─ base.py           ToolPage base class: background jobs with progress and cancel
│  ├─ widgets.py        shared buttons, dialogs, progress panel, table and folder field
│  ├─ settings_dialog.py
│  ├─ context.py        AppContext: settings, database, stores, notifier
│  └─ smoke.py          --smoke-test: builds every window once
├─ core/                shared services, no tool knowledge
│  ├─ paths.py          data folder rules (APPDATA, portable mode, DESKTOP_ORGANIZER_DATA)
│  ├─ settings.py       JSON settings with validation and corrupt-file handling
│  ├─ storage.py        SQLite wrapper with numbered migrations
│  ├─ i18n.py           translator; catalogs in resources/lang
│  ├─ theme.py          design tokens and the Qt stylesheet
│  ├─ safety.py         protected locations
│  ├─ fs.py             file walking without links, hashing, unique names, Recycle Bin, long paths
│  ├─ worker.py         QThread wrapper with progress, cancel and error signals
│  ├─ notify.py         Windows notifications through the tray icon
│  ├─ winapi.py         Windows-only: global hotkey, clipboard privacy flags, autostart
│  └─ logging_setup.py  rotating log file and unhandled-exception hook
├─ tools/               one folder per tool
│  ├─ __init__.py       the tool registry (TOOLS)
│  └─ <tool>/
│     ├─ logic.py       pure logic and persistence; no Qt imports
│     └─ ui.py          the page (Qt), built on ToolPage
└─ resources/
   ├─ lang/de.json, en.json
   └─ icons/app.ico
```

## Rules

- **Logic is separate from the window.** Each tool's `logic.py` does not import Qt, so the tests can run it without a display. The exceptions are the clipboard watcher (`tools/clipboard/watcher.py`), which needs the Qt clipboard, and the page modules.
- **One tool, one folder.** Adding a tool means a new folder with `logic.py` and `ui.py`, plus one line in `tools/__init__.py`, plus the translation keys. Nothing else changes.
- **Long work runs off the UI thread.** `ToolPage.run_background` starts a `Worker`. Its signals are connected with queued connections, so the callbacks run on the UI thread.
- **All user-facing text lives in `resources/lang`.** A test fails if code uses a key that is missing in either language, if the placeholders differ, or if the two catalogs have different keys.
- **Destructive actions** go through `confirm()` in `app/widgets.py`, with "No" as the default. Deletions use the Recycle Bin.
- **Protected locations** are checked by `core/safety.py` before any scan, move, copy or replace.

## Data

- Settings: `settings.json` (validated on load; an unreadable file is renamed to `settings.corrupt.json` and defaults are used).
- Database: `organizer.sqlite3`. Schema version in `PRAGMA user_version`. Migrations are appended to `core/storage.py`; a shipped migration is never edited. The app refuses to open a database with a newer schema.
- Journals for undo: `journal/` in the data folder. Written before a move or replacement is considered complete, and removed after a successful undo.
- Logs: `logs/desktop-organizer.log`, 1 MB per file, three rotated files.

## Background jobs

| Tool | Job | Cancel |
|---|---|---|
| File cleaner | Plan, apply, undo | No (the job is short; the preview can be redone) |
| Backup | Compare, copy and verify | Yes, between files; copies already made are kept |
| Duplicate finder | Scan and hash | Yes, between files |
| Text replacer | Scan | Yes, between files; apply and undo cannot be cancelled |
| File size overview | Measure folders | Yes, between entries |

The cancel button is shown only for jobs that support it (`cancellable=True` in `ToolPage.run_background`).

## Windows-specific code

`core/winapi.py` is the only module with Windows API calls. Each function returns "not supported" on other systems, so the source tree still runs and tests on Linux.

## Build and release

- `build/build.py` reads the version from `src/desktop_organizer/__init__.py`, writes the Windows version resource, runs PyInstaller with `build/desktop_organizer.spec`, and writes `DesktopOrganizer.exe.sha256`.
- `collect_submodules("desktop_organizer")` in the spec is required, because tool pages are loaded by name at run time.
- The release workflow runs only on a tag, checks that the tag matches the version, runs the checks, builds, and publishes the release notes from `CHANGELOG.md`.
