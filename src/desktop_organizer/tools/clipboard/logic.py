"""Clipboard history: stores text only, de-duplicates by SHA-256, keeps pinned entries."""

from __future__ import annotations

import datetime as dt
import hashlib
from dataclasses import dataclass
from sqlite3 import Row

from desktop_organizer.core.storage import Database

MAX_CHARS = 100_000


@dataclass(frozen=True)
class ClipEntry:
    id: int
    content: str
    pinned: bool
    created_at: dt.datetime


def content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8", errors="replace")).hexdigest()


class ClipboardStore:
    def __init__(self, db: Database, max_entries: int) -> None:
        self._db = db
        self.max_entries = max_entries

    @staticmethod
    def _from_row(row: Row) -> ClipEntry:
        return ClipEntry(
            id=int(row["id"]),
            content=str(row["content"]),
            pinned=bool(row["pinned"]),
            created_at=dt.datetime.fromisoformat(str(row["created_at"])),
        )

    def add_text(self, text: str, now: dt.datetime) -> bool:
        """Store text. Returns True if the history changed. Blank text is ignored."""
        if not text or not text.strip():
            return False
        text = text[:MAX_CHARS]
        digest = content_hash(text)
        stamp = now.isoformat(timespec="seconds")
        existing = self._db.query("SELECT id FROM clipboard WHERE content_hash = ?", (digest,))
        if existing:
            self._db.execute("UPDATE clipboard SET created_at = ? WHERE id = ?", (stamp, int(existing[0]["id"])))
        else:
            self._db.execute(
                "INSERT INTO clipboard (content, content_hash, pinned, created_at) VALUES (?, ?, 0, ?)",
                (text, digest, stamp),
            )
        self._trim()
        return True

    def _trim(self) -> None:
        """Delete the oldest unpinned entries beyond the limit."""
        self._db.execute(
            """
            DELETE FROM clipboard WHERE pinned = 0 AND id NOT IN (
                SELECT id FROM clipboard WHERE pinned = 0 ORDER BY created_at DESC, id DESC LIMIT ?
            ) AND (SELECT COUNT(*) FROM clipboard) > ?
            """,
            (max(self.max_entries - self._pinned_count(), 0), self.max_entries),
        )

    def _pinned_count(self) -> int:
        return int(self._db.query("SELECT COUNT(*) AS n FROM clipboard WHERE pinned = 1")[0]["n"])

    def list(self, query: str = "") -> list[ClipEntry]:
        rows = self._db.query("SELECT * FROM clipboard ORDER BY pinned DESC, created_at DESC, id DESC")
        entries = [self._from_row(r) for r in rows]
        needle = query.strip().casefold()
        if needle:
            entries = [e for e in entries if needle in e.content.casefold()]
        return entries

    def set_pinned(self, entry_id: int, pinned: bool) -> None:
        self._db.execute("UPDATE clipboard SET pinned = ? WHERE id = ?", (1 if pinned else 0, entry_id))

    def delete(self, entry_id: int) -> None:
        self._db.execute("DELETE FROM clipboard WHERE id = ?", (entry_id,))

    def clear(self, keep_pinned: bool = True) -> None:
        if keep_pinned:
            self._db.execute("DELETE FROM clipboard WHERE pinned = 0")
        else:
            self._db.execute("DELETE FROM clipboard")
