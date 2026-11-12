"""Text replacer: plan replacements across text files, preview them, apply with backups, undo."""

from __future__ import annotations

import datetime as dt
import json
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from desktop_organizer.core.fs import CancelToken, ScanErrors, iter_files, long_path, unique_path
from desktop_organizer.core.safety import ensure_allowed

ProgressFn = Callable[[int, str], None]
MAX_FILE_BYTES = 20 * 1024 * 1024
JOURNAL_NAME = "text-replacer-last-run.json"


@dataclass(frozen=True)
class ReplaceOptions:
    find: str
    replace: str
    case_sensitive: bool = False
    whole_word: bool = False
    extensions: frozenset[str] = frozenset(
        {".txt", ".md", ".csv", ".json", ".xml", ".html", ".htm", ".py", ".js", ".ts", ".ini", ".cfg", ".log"}
    )


@dataclass(frozen=True)
class FileChange:
    path: Path
    count: int
    original: str
    updated: str


@dataclass
class PlanResult:
    changes: list[FileChange] = field(default_factory=list)
    scanned: int = 0
    skipped_binary: int = 0
    errors: ScanErrors = field(default_factory=ScanErrors)


def build_pattern(options: ReplaceOptions) -> re.Pattern[str]:
    if not options.find:
        raise ValueError("Enter the text to find.")
    escaped = re.escape(options.find)
    if options.whole_word:
        escaped = rf"(?<!\w){escaped}(?!\w)"
    flags = 0 if options.case_sensitive else re.IGNORECASE
    return re.compile(escaped, flags)


def replace_in_text(text: str, options: ReplaceOptions) -> tuple[str, int]:
    pattern = build_pattern(options)
    replacement = options.replace
    # A lambda keeps backslashes in the replacement text literal.
    return pattern.subn(lambda _match: replacement, text)


def plan_replacements(root: Path, options: ReplaceOptions, progress: ProgressFn, cancel: CancelToken) -> PlanResult:
    ensure_allowed(root)
    build_pattern(options)
    result = PlanResult()
    files = list(iter_files(root, cancel, result.errors))
    for index, path in enumerate(files, start=1):
        cancel.check()
        progress(int(index * 100 / max(len(files), 1)), path.name)
        if path.suffix.lower() not in options.extensions:
            continue
        result.scanned += 1
        try:
            if path.stat().st_size > MAX_FILE_BYTES:
                result.errors.add(str(path), "file larger than 20 MB")
                continue
            raw = Path(long_path(path)).read_bytes()
        except OSError as exc:
            result.errors.add(str(path), exc)
            continue
        if b"\x00" in raw:
            result.skipped_binary += 1
            continue
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            result.errors.add(str(path), "not UTF-8 text, skipped")
            continue
        updated, count = replace_in_text(text, options)
        if count:
            result.changes.append(FileChange(path=path, count=count, original=text, updated=updated))
    progress(100, "")
    return result


def apply_changes(
    changes: list[FileChange], backup_folder: Path | None, journal_folder: Path
) -> tuple[int, list[tuple[str, str]]]:
    """Write the new text atomically. With a backup folder, keep each original and record an undo journal."""
    run_folder: Path | None = None
    if backup_folder is not None:
        stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S-%f")
        run_folder = backup_folder / f"replace-{stamp}"
        run_folder.mkdir(parents=True, exist_ok=True)
    journal: list[dict[str, str]] = []
    failed: list[tuple[str, str]] = []
    for change in changes:
        try:
            backup_text = ""
            if run_folder is not None:
                backup = unique_path(run_folder / change.path.name)
                backup.write_text(change.original, encoding="utf-8", newline="")
                backup_text = str(backup)
            tmp = change.path.with_name(change.path.name + ".tmp-replace")
            tmp.write_text(change.updated, encoding="utf-8", newline="")
            tmp.replace(change.path)
            if run_folder is not None:
                journal.append({"path": str(change.path), "backup": backup_text})
        except OSError as exc:
            failed.append((str(change.path), str(exc)))
    if journal:
        (journal_folder / JOURNAL_NAME).write_text(
            json.dumps({"files": journal}, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    written = len(changes) - len(failed)
    return written, failed


def has_undo(journal_folder: Path) -> bool:
    return (journal_folder / JOURNAL_NAME).exists()


def undo_last_run(journal_folder: Path) -> tuple[int, list[tuple[str, str]]]:
    journal = journal_folder / JOURNAL_NAME
    if not journal.exists():
        return 0, []
    data = json.loads(journal.read_text(encoding="utf-8"))
    restored = 0
    failed: list[tuple[str, str]] = []
    for item in data.get("files", []):
        try:
            backup = Path(item["backup"])
            target = Path(item["path"])
            target.write_bytes(backup.read_bytes())
            restored += 1
        except OSError as exc:
            failed.append((item.get("path", ""), str(exc)))
    if not failed:
        journal.unlink(missing_ok=True)
    return restored, failed
