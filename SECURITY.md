# Security and privacy

Desktop Organizer runs locally, as a normal user, without network access.

## What the app reads

- **Folders you choose** for a tool (for example Downloads for the file cleaner). Only these folders are scanned.
- **Its own data folder** (default `%APPDATA%\DesktopOrganizer`, or `data` next to the .exe if `portable.flag` exists): `settings.json`, `organizer.sqlite3`, log files and the undo journal.
- **The clipboard**, only while "Record clipboard history" is on. Text is read when the clipboard changes.
- **Clipboard privacy flags** set by the copying application (used by password managers on Windows). Entries flagged this way are skipped.
- **The per-user autostart entry** in `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, only to read and change the setting.

## What the app writes

- **Files you confirm** in the file cleaner, backup helper, text replacer and duplicate finder. Each action shows a preview and asks first.
- **Backups** in the destination folder you choose, including a log file `_backup-log-<time>.txt`.
- **Its data folder**: settings, database, logs, undo journal, and backups of replaced text originals.
- **Recycle Bin**: duplicate files you mark and confirm are moved there, never deleted permanently.
- **Export files** you save through the settings or time tracker dialogs.

## What the app never does

- It does not connect to the internet. There is no telemetry, no account, no update check and no crash upload.
- It does not run as administrator and does not ask for elevation.
- It does not scan or change system folders such as the Windows directory, Program Files, ProgramData, other users' profiles, or drive roots. Those paths are refused.
- It does not follow symbolic links or junctions while scanning.
- It does not permanently delete duplicate files. Deletions go to the Recycle Bin.
- It does not store generated passwords on disk or in the log. A copied password is removed from the clipboard after 30 seconds, if the clipboard still contains it.
- It does not record clipboard content when recording is off.

## Known limits

- Notes, tasks and clipboard history are stored **unencrypted** in SQLite inside your user profile. Anyone with access to your Windows account can read them.
- Password-manager exclusion works only for apps that set the Windows privacy flags. Other copied text is recorded while recording is on.
- Log files may contain file names and paths. Review them before sharing.
- The .exe is not code-signed. Windows SmartScreen may warn when you run it for the first time.

## Reporting a security issue

Please do not open a public issue for a security problem. Use GitHub's private vulnerability reporting on this repository (Security tab, "Report a vulnerability").

## Dependencies

Runtime dependencies are pinned in `requirements.txt`. CI runs `pip-audit` on them on every push.
