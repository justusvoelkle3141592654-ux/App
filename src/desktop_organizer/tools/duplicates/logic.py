"""Duplicate finder: group by size first, then by SHA-256. Deletion only to the Recycle Bin."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from desktop_organizer.core.fs import CancelToken, ScanErrors, iter_files, send_to_recycle_bin, sha256_file
from desktop_organizer.core.safety import ensure_allowed

ProgressFn = Callable[[int, str], None]


@dataclass(frozen=True)
class DuplicateGroup:
    size: int
    digest: str
    paths: tuple[Path, ...]

    @property
    def wasted_bytes(self) -> int:
        return self.size * (len(self.paths) - 1)


@dataclass
class ScanResult:
    groups: list[DuplicateGroup] = field(default_factory=list)
    files_scanned: int = 0
    errors: ScanErrors = field(default_factory=ScanErrors)


def find_duplicates(root: Path, progress: ProgressFn, cancel: CancelToken) -> ScanResult:
    ensure_allowed(root)
    result = ScanResult()
    by_size: dict[int, list[Path]] = defaultdict(list)

    for path in iter_files(root, cancel, result.errors):
        try:
            size = path.stat().st_size
        except OSError as exc:
            result.errors.add(str(path), exc)
            continue
        result.files_scanned += 1
        if size > 0:
            by_size[size].append(path)
        if result.files_scanned % 200 == 0:
            progress(0, str(result.files_scanned))

    candidates = [(size, paths) for size, paths in by_size.items() if len(paths) > 1]
    total = sum(len(paths) for _, paths in candidates) or 1
    done = 0
    for size, paths in candidates:
        by_digest: dict[str, list[Path]] = defaultdict(list)
        for path in paths:
            cancel.check()
            done += 1
            progress(int(done * 100 / total), path.name)
            try:
                by_digest[sha256_file(path, cancel)].append(path)
            except OSError as exc:
                result.errors.add(str(path), exc)
        for digest, same in by_digest.items():
            if len(same) > 1:
                result.groups.append(DuplicateGroup(size=size, digest=digest, paths=tuple(sorted(same))))
    result.groups.sort(key=lambda g: g.wasted_bytes, reverse=True)
    progress(100, "")
    return result


def delete_to_recycle_bin(paths: list[Path]) -> tuple[int, list[tuple[str, str]]]:
    """Send the given files to the Recycle Bin. Returns (count, failures)."""
    deleted = 0
    failed: list[tuple[str, str]] = []
    for path in paths:
        try:
            send_to_recycle_bin(path)
            deleted += 1
        except OSError as exc:
            failed.append((str(path), str(exc)))
        except Exception as exc:  # send2trash raises its own error types
            failed.append((str(path), str(exc)))
    return deleted, failed
