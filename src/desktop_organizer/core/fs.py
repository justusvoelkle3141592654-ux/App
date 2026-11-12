"""File helpers shared by all file-based tools.

Rules used everywhere:
- Symbolic links and junctions are never followed.
- Unreadable entries are collected as errors and the scan continues.
- Long Windows paths get the \\\\?\\ prefix so they work beyond 260 characters.
- Deletion always goes to the Recycle Bin.
"""

from __future__ import annotations

import hashlib
import os
import sys
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from pathlib import Path

CHUNK_SIZE = 1024 * 1024
_LONG_PATH_LIMIT = 240


class Cancelled(Exception):
    """Raised inside background work when the user presses cancel."""


class CancelToken:
    def __init__(self) -> None:
        self._cancelled = False

    def cancel(self) -> None:
        self._cancelled = True

    @property
    def cancelled(self) -> bool:
        return self._cancelled

    def check(self) -> None:
        if self._cancelled:
            raise Cancelled()


@dataclass
class ScanErrors:
    items: list[tuple[str, str]] = field(default_factory=list)

    def add(self, path: str, error: object) -> None:
        self.items.append((path, str(error)))


def long_path(path: Path) -> str:
    """Return a string usable with OS calls, with the extended-length prefix on Windows if needed."""
    text = str(path)
    if sys.platform.startswith("win") and len(text) > _LONG_PATH_LIMIT and not text.startswith("\\\\?\\"):
        if text.startswith("\\\\"):
            return "\\\\?\\UNC\\" + text[2:]
        return "\\\\?\\" + text
    return text


def iter_files(root: Path, cancel: CancelToken | None = None, errors: ScanErrors | None = None) -> Iterator[Path]:
    """Yield regular files below root. Symlinks and junctions are skipped, never followed."""
    for current, dirs, files in os.walk(long_path(root), followlinks=False, onerror=None):
        if cancel is not None:
            cancel.check()
        dirs[:] = [d for d in dirs if not _is_link(os.path.join(current, d))]
        for name in files:
            full = os.path.join(current, name)
            if _is_link(full):
                continue
            yield Path(full)


def _is_link(path: str) -> bool:
    try:
        return os.path.islink(path) or _is_junction(path)
    except OSError:
        return True


def _is_junction(path: str) -> bool:
    if not sys.platform.startswith("win"):
        return False
    try:
        return bool(os.lstat(path).st_file_attributes & 0x400)  # FILE_ATTRIBUTE_REPARSE_POINT
    except (OSError, AttributeError):
        return False


def sha256_file(path: Path, cancel: CancelToken | None = None) -> str:
    digest = hashlib.sha256()
    with open(long_path(path), "rb") as handle:
        while chunk := handle.read(CHUNK_SIZE):
            if cancel is not None:
                cancel.check()
            digest.update(chunk)
    return digest.hexdigest()


def unique_path(target: Path, taken: Callable[[Path], bool] | None = None) -> Path:
    """Return target, or 'name (2).ext', 'name (3).ext' ... if it already exists."""
    exists = taken or (lambda p: p.exists())
    if not exists(target):
        return target
    stem, suffix = target.stem, target.suffix
    counter = 2
    while True:
        candidate = target.with_name(f"{stem} ({counter}){suffix}")
        if not exists(candidate):
            return candidate
        counter += 1


def send_to_recycle_bin(path: Path) -> None:
    from send2trash import send2trash

    send2trash(long_path(path))
