"""Reminders: one-off, every N minutes, or daily at a fixed time. Stored in SQLite."""

from __future__ import annotations

import datetime as dt
import re
from dataclasses import dataclass
from sqlite3 import Row

from desktop_organizer.core.storage import Database

KINDS = ("once", "interval", "daily")
_TIME = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")


@dataclass(frozen=True)
class Reminder:
    id: int
    title: str
    kind: str
    interval_minutes: int | None
    daily_time: str | None
    next_due: dt.datetime | None
    active: bool


def parse_daily_time(text: str) -> str:
    text = text.strip()
    if not _TIME.match(text):
        raise ValueError("Time must look like 09:30.")
    return text


def compute_next_due(
    kind: str,
    now: dt.datetime,
    *,
    after: dt.datetime | None = None,
    interval_minutes: int | None = None,
    daily_time: str | None = None,
) -> dt.datetime | None:
    """Next due time strictly after ``after`` (or ``now``). None means the reminder is finished."""
    if kind == "once":
        return None
    if kind == "interval":
        if not interval_minutes or interval_minutes < 1:
            raise ValueError("Interval must be at least 1 minute.")
        base = after or now
        candidate = base + dt.timedelta(minutes=interval_minutes)
        while candidate <= now:
            candidate += dt.timedelta(minutes=interval_minutes)
        return candidate
    if kind == "daily":
        if daily_time is None:
            raise ValueError("Daily reminders need a time.")
        hour, minute = (int(part) for part in parse_daily_time(daily_time).split(":"))
        reference = after or now
        candidate = reference.replace(hour=hour, minute=minute, second=0, microsecond=0)
        while candidate <= reference or candidate <= now:
            candidate += dt.timedelta(days=1)
        return candidate
    raise ValueError(f"Unknown reminder kind: {kind}")


class RemindersStore:
    def __init__(self, db: Database) -> None:
        self._db = db

    @staticmethod
    def _from_row(row: Row) -> Reminder:
        due = row["next_due"]
        return Reminder(
            id=int(row["id"]),
            title=str(row["title"]),
            kind=str(row["kind"]),
            interval_minutes=int(row["interval_minutes"]) if row["interval_minutes"] is not None else None,
            daily_time=str(row["daily_time"]) if row["daily_time"] else None,
            next_due=dt.datetime.fromisoformat(due) if due else None,
            active=bool(row["active"]),
        )

    def add_once(self, title: str, due: dt.datetime) -> int:
        return self._add(title, "once", due, None, None)

    def add_interval(self, title: str, minutes: int, now: dt.datetime) -> int:
        due = compute_next_due("interval", now, interval_minutes=minutes)
        return self._add(title, "interval", due, minutes, None)

    def add_daily(self, title: str, daily_time: str, now: dt.datetime) -> int:
        time_text = parse_daily_time(daily_time)
        due = compute_next_due("daily", now, daily_time=time_text)
        return self._add(title, "daily", due, None, time_text)

    def _add(self, title: str, kind: str, due: dt.datetime | None, minutes: int | None, daily: str | None) -> int:
        title = title.strip()
        if not title:
            raise ValueError("A reminder needs a title.")
        return self._db.execute(
            "INSERT INTO reminders (title, kind, interval_minutes, daily_time, next_due, active) VALUES (?, ?, ?, ?, ?, 1)",
            (title, kind, minutes, daily, due.isoformat(timespec="seconds") if due else None),
        )

    def all(self) -> list[Reminder]:
        return [self._from_row(r) for r in self._db.query("SELECT * FROM reminders ORDER BY active DESC, next_due")]

    def get(self, reminder_id: int) -> Reminder | None:
        rows = self._db.query("SELECT * FROM reminders WHERE id = ?", (reminder_id,))
        return self._from_row(rows[0]) if rows else None

    def due(self, now: dt.datetime) -> list[Reminder]:
        rows = self._db.query(
            "SELECT * FROM reminders WHERE active = 1 AND next_due IS NOT NULL AND next_due <= ? ORDER BY next_due",
            (now.isoformat(timespec="seconds"),),
        )
        return [self._from_row(r) for r in rows]

    def mark_fired(self, reminder: Reminder, now: dt.datetime) -> None:
        """Advance a recurring reminder, or switch a one-off reminder off."""
        if reminder.kind == "once":
            self._db.execute("UPDATE reminders SET active = 0, next_due = NULL WHERE id = ?", (reminder.id,))
            return
        nxt = compute_next_due(
            reminder.kind,
            now,
            after=reminder.next_due,
            interval_minutes=reminder.interval_minutes,
            daily_time=reminder.daily_time,
        )
        self._db.execute(
            "UPDATE reminders SET next_due = ? WHERE id = ?",
            (nxt.isoformat(timespec="seconds") if nxt else None, reminder.id),
        )

    def set_active(self, reminder_id: int, active: bool) -> None:
        self._db.execute("UPDATE reminders SET active = ? WHERE id = ?", (1 if active else 0, reminder_id))

    def delete(self, reminder_id: int) -> None:
        self._db.execute("DELETE FROM reminders WHERE id = ?", (reminder_id,))
