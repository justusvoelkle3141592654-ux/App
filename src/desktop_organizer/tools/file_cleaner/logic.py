"""File cleaner: plan moves by file type, apply them, and undo the last run."""

from __future__ import annotations

import json
import shutil
from dataclasses import dataclass
from pathlib import Path

from desktop_organizer.core.fs import unique_path
from desktop_organizer.core.safety import ensure_allowed

# Folder names are fixed on disk. The UI shows the same names.
CATEGORIES: dict[str, frozenset[str]] = {
    "Bilder": frozenset({".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".heic", ".svg", ".tif", ".tiff"}),
    "Dokumente": frozenset(
        {
            ".pdf",
            ".doc",
            ".docx",
            ".odt",
            ".txt",
            ".rtf",
            ".md",
            ".xls",
            ".xlsx",
            ".ods",
            ".csv",
            ".ppt",
            ".pptx",
            ".odp",
        }
    ),
    "Videos": frozenset({".mp4", ".mkv", ".mov", ".avi", ".wmv", ".webm"}),
    "Audio": frozenset({".mp3", ".wav", ".flac", ".aac", ".ogg", ".m4a"}),
    "Archive": frozenset({".zip", ".rar", ".7z", ".tar", ".gz", ".iso"}),
    "Programme": frozenset({".exe", ".msi", ".msix", ".appx"}),
}
OTHER_CATEGORY = "Sonstiges"
IGNORED_NAMES = frozenset({"desktop.ini", "thumbs.db", ".ds_store"})
JOURNAL_NAME = "file-cleaner-last-run.json"


@dataclass(frozen=True)
class Move:
    source: Path
    target: Path
    category: str


@dataclass(frozen=True)
class RunResult:
    moved: int
    failed: tuple[tuple[str, str], ...]
    journal: Path | None


def category_for(name: str) -> str:
    suffix = Path(name).suffix.lower()
    for category, extensions in CATEGORIES.items():
        if suffix in extensions:
            return category
    return OTHER_CATEGORY


def plan_moves(folder: Path) -> list[Move]:
    """Plan moves for the files directly inside folder (subfolders are not touched)."""
    ensure_allowed(folder)
    planned: list[Move] = []
    claimed: set[Path] = set()

    def taken(path: Path) -> bool:
        return path in claimed or path.exists()

    for entry in sorted(folder.iterdir(), key=lambda p: p.name.lower()):
        if entry.is_symlink() or not entry.is_file():
            continue
        if entry.name.startswith(".") or entry.name.lower() in IGNORED_NAMES:
            continue
        category = category_for(entry.name)
        target = unique_path(folder / category / entry.name, taken)
        claimed.add(target)
        planned.append(Move(source=entry, target=target, category=category))
    return planned


def apply_moves(moves: list[Move], journal_folder: Path) -> RunResult:
    """Move files and write a journal first, so the last run can be undone."""
    journal = journal_folder / JOURNAL_NAME
    done: list[dict[str, str]] = []
    failed: list[tuple[str, str]] = []
    for move in moves:
        try:
            move.target.parent.mkdir(exist_ok=True)
            if move.target.exists():
                raise FileExistsError(f"Target exists: {move.target.name}")
            shutil.move(str(move.source), str(move.target))
            done.append({"source": str(move.source), "target": str(move.target)})
        except OSError as exc:
            failed.append((str(move.source), str(exc)))
    if done:
        journal.write_text(json.dumps({"moves": done}, ensure_ascii=False, indent=2), encoding="utf-8")
        return RunResult(moved=len(done), failed=tuple(failed), journal=journal)
    return RunResult(moved=0, failed=tuple(failed), journal=None)


@dataclass(frozen=True)
class UndoResult:
    restored: int
    failed: tuple[tuple[str, str], ...]


def has_journal(journal_folder: Path) -> bool:
    return (journal_folder / JOURNAL_NAME).exists()


def undo_last_run(journal_folder: Path) -> UndoResult:
    """Move files back to their original place, newest move first. Keeps the journal on errors."""
    journal = journal_folder / JOURNAL_NAME
    if not journal.exists():
        return UndoResult(restored=0, failed=())
    data = json.loads(journal.read_text(encoding="utf-8"))
    restored = 0
    failed: list[tuple[str, str]] = []
    remaining: list[dict[str, str]] = []
    for item in reversed(data.get("moves", [])):
        source, target = Path(item["source"]), Path(item["target"])
        try:
            if not target.exists():
                raise FileNotFoundError("file was moved or deleted after the run")
            if source.exists():
                raise FileExistsError("original location is occupied")
            source.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(target), str(source))
            restored += 1
        except OSError as exc:
            failed.append((str(target), str(exc)))
            remaining.append(item)
    if remaining:
        journal.write_text(
            json.dumps({"moves": list(reversed(remaining))}, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    else:
        journal.unlink(missing_ok=True)
    return UndoResult(restored=restored, failed=tuple(failed))
