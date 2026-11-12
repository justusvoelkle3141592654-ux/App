"""SQLite storage with schema versioning. Each migration runs once, in a transaction."""

from __future__ import annotations

import sqlite3
import threading
from collections.abc import Sequence
from pathlib import Path
from typing import Any

# Append new migrations at the end. Never edit a migration that has shipped.
MIGRATIONS: tuple[str, ...] = (
    """
    CREATE TABLE notes (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE TABLE reminders (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('once', 'interval', 'daily')),
        interval_minutes INTEGER,
        daily_time TEXT,
        next_due TEXT,
        active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE tasks (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        done INTEGER NOT NULL DEFAULT 0,
        due_date TEXT,
        reminder_id INTEGER REFERENCES reminders(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL
    );
    CREATE TABLE time_entries (
        id INTEGER PRIMARY KEY,
        project TEXT NOT NULL DEFAULT '',
        task TEXT NOT NULL DEFAULT '',
        started_at TEXT NOT NULL,
        ended_at TEXT
    );
    CREATE TABLE clipboard (
        id INTEGER PRIMARY KEY,
        content TEXT NOT NULL,
        content_hash TEXT NOT NULL UNIQUE,
        pinned INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
    );
    """,
)


class Database:
    """Thin, thread-safe wrapper around one SQLite connection."""

    def __init__(self, path: str | Path) -> None:
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(str(path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA foreign_keys = ON")
        try:
            self.migrate()
        except Exception:
            self._conn.close()
            raise

    @property
    def schema_version(self) -> int:
        with self._lock:
            return int(self._conn.execute("PRAGMA user_version").fetchone()[0])

    def migrate(self) -> None:
        with self._lock:
            current = self.schema_version
            if current > len(MIGRATIONS):
                raise RuntimeError(
                    f"Database schema {current} is newer than this version supports ({len(MIGRATIONS)})."
                )
            for version in range(current, len(MIGRATIONS)):
                try:
                    self._conn.executescript(
                        "BEGIN;" + MIGRATIONS[version] + f"PRAGMA user_version = {version + 1};" + "COMMIT;"
                    )
                except sqlite3.Error:
                    if self._conn.in_transaction:
                        self._conn.rollback()
                    raise

    def query(self, sql: str, params: Sequence[Any] = ()) -> list[sqlite3.Row]:
        with self._lock:
            return list(self._conn.execute(sql, tuple(params)).fetchall())

    def execute(self, sql: str, params: Sequence[Any] = ()) -> int:
        """Run a write statement, commit, and return the last inserted row id."""
        with self._lock:
            cursor = self._conn.execute(sql, tuple(params))
            self._conn.commit()
            return int(cursor.lastrowid or 0)

    def backup_to(self, path: str | Path) -> None:
        """Write a consistent copy of the whole database to path (SQLite online backup)."""
        target = Path(path)
        target.unlink(missing_ok=True)
        with self._lock:
            dest = sqlite3.connect(str(target))
            try:
                self._conn.backup(dest)
            finally:
                dest.close()

    def close(self) -> None:
        with self._lock:
            self._conn.close()
