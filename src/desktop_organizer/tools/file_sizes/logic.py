"""File size overview: sum sizes per folder, largest first. Symlinks are not followed."""

from __future__ import annotations

import os
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from desktop_organizer.core.fs import CancelToken, ScanErrors, long_path
from desktop_organizer.core.safety import ensure_allowed

ProgressFn = Callable[[int, str], None]


@dataclass(frozen=True)
class FolderSize:
    name: str
    path: Path | None  # None for files that sit directly in the chosen folder
    total_bytes: int
    file_count: int


@dataclass
class SizeReport:
    rows: list[FolderSize] = field(default_factory=list)
    errors: ScanErrors = field(default_factory=ScanErrors)

    @property
    def total_bytes(self) -> int:
        return sum(row.total_bytes for row in self.rows)


def _size_of_tree(root: Path, cancel: CancelToken, errors: ScanErrors) -> tuple[int, int]:
    total = 0
    count = 0
    for current, dirs, files in os.walk(long_path(root), followlinks=False):
        cancel.check()
        dirs[:] = [d for d in dirs if not os.path.islink(os.path.join(current, d))]
        for name in files:
            full = os.path.join(current, name)
            if os.path.islink(full):
                continue
            try:
                total += os.lstat(full).st_size
                count += 1
            except OSError as exc:
                errors.add(full, exc)
    return total, count


def scan_sizes(folder: Path, progress: ProgressFn, cancel: CancelToken) -> SizeReport:
    ensure_allowed(folder)
    report = SizeReport()
    children = sorted(folder.iterdir(), key=lambda p: p.name.lower())
    loose_bytes = 0
    loose_count = 0
    for index, child in enumerate(children, start=1):
        cancel.check()
        progress(int(index * 100 / max(len(children), 1)), child.name)
        if child.is_symlink():
            continue
        if child.is_dir():
            total, count = _size_of_tree(child, cancel, report.errors)
            report.rows.append(FolderSize(name=child.name, path=child, total_bytes=total, file_count=count))
        elif child.is_file():
            try:
                loose_bytes += child.stat().st_size
                loose_count += 1
            except OSError as exc:
                report.errors.add(str(child), exc)
    if loose_count:
        report.rows.append(FolderSize(name="", path=None, total_bytes=loose_bytes, file_count=loose_count))
    report.rows.sort(key=lambda row: row.total_bytes, reverse=True)
    progress(100, "")
    return report


def human_size(num_bytes: int) -> str:
    """Plain decimal units, one decimal place from KB upwards."""
    value = float(num_bytes)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if value < 1000 or unit == "TB":
            return f"{int(value)} {unit}" if unit == "B" else f"{value:.1f} {unit}"
        value /= 1000
    return f"{value:.1f} TB"
