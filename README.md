# Desktop Organizer

A small, local toolbox for Windows: sort files, back up folders, generate passwords, take notes, find duplicates, check system values, replace text in many files, set reminders, keep a task list, see what fills your disk, track time, and keep a clipboard history. It runs as one portable `.exe`, without installation, without administrator rights, and without an internet connection.

German is the default language; English is available in the settings.

## Download

Download `DesktopOrganizer.exe` and its checksum `DesktopOrganizer.exe.sha256` from the [Releases](../../releases) page. Verify the checksum with:

```powershell
Get-FileHash .\DesktopOrganizer.exe -Algorithm SHA256
```

The executable is not code-signed. Windows SmartScreen may warn on first start. See [SECURITY.md](SECURITY.md).

## System requirements

- Windows 10 or Windows 11, 64-bit.
- Free disk space for the executable and for your data folder.

## The tools

| Tool | Purpose |
|---|---|
| File sorting | Sort the files of a folder by type. Preview and undo. |
| Backup | Copy new and changed files, verify every copy, write a log. |
| Password generator | Passwords and passphrases from a secure random source. |
| Notes | Quick notes with tags and search. Global shortcut Ctrl+Alt+N. |
| Find duplicates | Identical files by content. Deletion only to the Recycle Bin. |
| System monitor | CPU, memory, battery and drives, live. |
| Replace text | Replace terms across text files, with preview, backups and undo. |
| Reminders | One-off, every N minutes, or daily, as Windows notifications. |
| Tasks | Task list with due dates and optional reminders. |
| Storage | Folder sizes, largest first. |
| Time tracker | Timers per project and task, weekly totals, CSV export. |
| Clipboard history | Searchable, pinnable, pausable. Off by default. |

The full guide, in German, is in [docs/user-guide.md](docs/user-guide.md).

## Build from source

Requirements: Python 3.12 on Windows.

```powershell
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements-dev.txt
python build/build.py
```

The executable is written to `dist\DesktopOrganizer.exe`, with its SHA-256 checksum next to it. To also run the packaged app's smoke test:

```powershell
python build/build.py --smoke
```

Run the source tree:

```powershell
python -m desktop_organizer
```

## Development

```powershell
ruff check src tests build
ruff format --check src tests build
mypy
pytest
```

Tests use a headless Qt platform (`QT_QPA_PLATFORM=offscreen`), which the test suite sets itself. CI runs all of the above on `windows-latest` for every push and pull request.

Project structure, layering rules and data handling are described in [docs/architecture.md](docs/architecture.md). The visual rules are in [docs/design-system.md](docs/design-system.md).

## Releases

Versions follow [Semantic Versioning](https://semver.org/). To publish a release:

1. Set `__version__` in `src/desktop_organizer/__init__.py` and add a section to `CHANGELOG.md`.
2. Commit, then push a tag with the same version, for example `v1.0.0`.

The release workflow refuses a tag that does not match the code version, runs the checks, builds the `.exe`, and publishes it with the checksum and the changelog section.

## Known limitations

- No icon set. The interface uses text labels only.
- The file size overview shows bars, not a treemap.
- Notes, tasks and clipboard history are stored unencrypted in the user profile.
- Clipboard privacy exclusion works only for apps that set the Windows clipboard privacy flags.
- Reminders and the shortcut work only while the app runs.
- The app does not check Windows Focus Assist; Windows decides what it shows.
- The executable is not code-signed.

## License

Proprietary. All rights reserved. See [LICENSE](LICENSE).
