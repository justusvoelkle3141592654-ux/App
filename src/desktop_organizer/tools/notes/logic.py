"""Notes: quick capture, #tags, and a case-insensitive search over title, body and tags."""

from __future__ import annotations

import datetime as dt
import re
from dataclasses import dataclass
from sqlite3 import Row

from desktop_organizer.core.storage import Database

TAG_PATTERN = re.compile(r"(?<![\w&])#([\w-]{1,40})")
TITLE_LENGTH = 60


@dataclass(frozen=True)
class Note:
    id: int
    title: str
    body: str
    tags: tuple[str, ...]
    updated_at: str


def extract_tags(text: str) -> tuple[str, ...]:
    return tuple(sorted({match.lower() for match in TAG_PATTERN.findall(text)}))


def default_title(body: str) -> str:
    first = next((line.strip() for line in body.splitlines() if line.strip()), "")
    return first[:TITLE_LENGTH]


def _now() -> str:
    return dt.datetime.now().isoformat(timespec="seconds")


class NotesStore:
    def __init__(self, db: Database) -> None:
        self._db = db

    @staticmethod
    def _row_to_note(row: Row) -> Note:
        body = str(row["body"])
        return Note(
            id=int(row["id"]),
            title=str(row["title"]),
            body=body,
            tags=extract_tags(body),
            updated_at=str(row["updated_at"]),
        )

    def add(self, body: str, title: str = "") -> int:
        body = body.strip()
        if not body:
            raise ValueError("A note needs some text.")
        now = _now()
        return self._db.execute(
            "INSERT INTO notes (title, body, created_at, updated_at) VALUES (?, ?, ?, ?)",
            (title.strip() or default_title(body), body, now, now),
        )

    def update(self, note_id: int, body: str, title: str = "") -> None:
        body = body.strip()
        if not body:
            raise ValueError("A note needs some text.")
        self._db.execute(
            "UPDATE notes SET title = ?, body = ?, updated_at = ? WHERE id = ?",
            (title.strip() or default_title(body), body, _now(), note_id),
        )

    def delete(self, note_id: int) -> None:
        self._db.execute("DELETE FROM notes WHERE id = ?", (note_id,))

    def get(self, note_id: int) -> Note | None:
        rows = self._db.query("SELECT * FROM notes WHERE id = ?", (note_id,))
        return self._row_to_note(rows[0]) if rows else None

    def all(self) -> list[Note]:
        rows = self._db.query("SELECT * FROM notes ORDER BY updated_at DESC, id DESC")
        return [self._row_to_note(row) for row in rows]

    def search(self, query: str) -> list[Note]:
        """Every whitespace-separated term must appear in title, body or tags (case-insensitive)."""
        terms = [term.casefold() for term in query.split() if term.strip()]
        notes = self.all()
        if not terms:
            return notes
        result = []
        for note in notes:
            haystack = f"{note.title}\n{note.body}\n{' '.join(note.tags)}".casefold()
            if all(term in haystack for term in terms):
                result.append(note)
        return result

    def tag_counts(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for note in self.all():
            for tag in note.tags:
                counts[tag] = counts.get(tag, 0) + 1
        return dict(sorted(counts.items()))
