"""Backup helper: copy new and changed files, verify the copies, write a log.

Files are only copied, never deleted at the destination. A file counts as changed when
the size or the modification time differs. Every copy is verified with SHA-256.
"""

from __future__ import annotations

import datetime as dt
import shutil
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from desktop_organizer.core.fs import CancelToken, ScanErrors, iter_files, long_path, sha256_file
from desktop_organizer.core.safety import ensure_allowed

ProgressFn = Callable[[int, str], None]
MTIME_TOLERANCE_SECONDS = 2.0


@dataclass(frozen=True)
class PlannedCopy:
    source: Path
    target: Path
    size: int
    reason: str  # "new" or "changed"


@dataclass
class BackupPlan:
    copies: list[PlannedCopy] = field(default_factory=list)
    unchanged: int = 0
    errors: ScanErrors = field(default_factory=ScanErrors)


@dataclass
class BackupResult:
    copied: int = 0
    failed: list[tuple[str, str]] = field(default_factory=list)
    verified: int = 0
    mismatched: list[str] = field(default_factory=list)
    log_file: Path | None = None


def _is_inside(path: Path, parent: Path) -> bool:
    try:
        path.resolve().relative_to(parent.resolve())
    except ValueError:
        return False
    return True


def validate(sources: list[Path], destination: Path) -> None:
    if not sources:
        raise ValueError("No source folder selected.")
    for source in sources:
        if not source.is_dir():
            raise ValueError(f"Source folder does not exist: {source}")
        ensure_allowed(source)
        if _is_inside(destination, source) or _is_inside(source, destination):
            raise ValueError("Source and destination must not be inside each other.")
    if not destination.exists():
        raise ValueError(f"Destination folder does not exist: {destination}")
    ensure_allowed(destination)


def plan_backup(sources: list[Path], destination: Path, cancel: CancelToken | None = None) -> BackupPlan:
    validate(sources, destination)
    plan = BackupPlan()
    for source in sources:
        base = destination / source.name
        for file in iter_files(source, cancel, plan.errors):
            try:
                relative = file.relative_to(source)
                target = base / relative
                stat = file.stat()
            except OSError as exc:
                plan.errors.add(str(file), exc)
                continue
            if not target.exists():
                plan.copies.append(PlannedCopy(file, target, stat.st_size, "new"))
                continue
            try:
                target_stat = target.stat()
            except OSError as exc:
                plan.errors.add(str(target), exc)
                continue
            changed = (
                stat.st_size != target_stat.st_size
                or abs(stat.st_mtime - target_stat.st_mtime) > MTIME_TOLERANCE_SECONDS
            )
            if changed:
                plan.copies.append(PlannedCopy(file, target, stat.st_size, "changed"))
            else:
                plan.unchanged += 1
    return plan


def run_backup(plan: BackupPlan, destination: Path, progress: ProgressFn, cancel: CancelToken) -> BackupResult:
    result = BackupResult()
    log_lines: list[str] = []
    total = max(len(plan.copies), 1)
    started = dt.datetime.now()
    log_lines.append(f"Backup started {started.isoformat(timespec='seconds')}")
    for index, item in enumerate(plan.copies, start=1):
        cancel.check()
        progress(int(index * 100 / total), item.source.name)
        try:
            item.target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(long_path(item.source), long_path(item.target))
            result.copied += 1
            log_lines.append(f"COPIED ({item.reason}) {item.source}")
        except OSError as exc:
            result.failed.append((str(item.source), str(exc)))
            log_lines.append(f"FAILED {item.source}: {exc}")
            continue
        try:
            same = item.target.stat().st_size == item.size and sha256_file(item.source, cancel) == sha256_file(
                item.target, cancel
            )
        except OSError as exc:
            same = False
            log_lines.append(f"VERIFY ERROR {item.target}: {exc}")
        if same:
            result.verified += 1
        else:
            result.mismatched.append(str(item.target))
            log_lines.append(f"VERIFY MISMATCH {item.target}")
    for path, error in plan.errors.items:
        log_lines.append(f"SKIPPED {path}: {error}")
    log_lines.append(
        f"Summary: copied {result.copied}, verified {result.verified}, "
        f"failed {len(result.failed)}, mismatched {len(result.mismatched)}, "
        f"unchanged {plan.unchanged}"
    )
    log_file = destination / f"_backup-log-{started:%Y%m%d-%H%M%S}.txt"
    log_file.write_text("\n".join(log_lines) + "\n", encoding="utf-8")
    result.log_file = log_file
    progress(100, "")
    return result
