"""Time tracker: start and stop a timer per project/task, daily and weekly totals, CSV export."""

from __future__ import annotations

import csv
import datetime as dt
from dataclasses import dataclass
from pathlib import Path
from sqlite3 import Row

from desktop_organizer.core.storage import Database


@dataclass(frozen=True)
class TimeEntry:
    id: int
    project: str
    task: str
    started_at: dt.datetime
    ended_at: dt.datetime | None

    def seconds_within(self, start: dt.datetime, end: dt.datetime, now: dt.datetime) -> float:
        """Seconds of this entry that fall inside [start, end). A running entry ends at now."""
        stop = self.ended_at or now
        lo = max(self.started_at, start)
        hi = min(stop, end)
        return max(0.0, (hi - lo).total_seconds())


def week_bounds(day: dt.date) -> tuple[dt.datetime, dt.datetime]:
    """Monday 00:00 to next Monday 00:00 (ISO week) for the given day."""
    monday = day - dt.timedelta(days=day.weekday())
    start = dt.datetime.combine(monday, dt.time.min)
    return start, start + dt.timedelta(days=7)


def day_bounds(day: dt.date) -> tuple[dt.datetime, dt.datetime]:
    start = dt.datetime.combine(day, dt.time.min)
    return start, start + dt.timedelta(days=1)


def totals_by_project(
    entries: list[TimeEntry], start: dt.datetime, end: dt.datetime, now: dt.datetime
) -> dict[str, float]:
    totals: dict[str, float] = {}
    for entry in entries:
        seconds = entry.seconds_within(start, end, now)
        if seconds > 0:
            key = entry.project or "-"
            totals[key] = totals.get(key, 0.0) + seconds
    return dict(sorted(totals.items(), key=lambda kv: kv[1], reverse=True))


def format_duration(seconds: float) -> str:
    total = int(round(seconds))
    hours, rest = divmod(total, 3600)
    minutes, secs = divmod(rest, 60)
    return f"{hours:d}:{minutes:02d}:{secs:02d}"


class TimeStore:
    def __init__(self, db: Database) -> None:
        self._db = db

    @staticmethod
    def _from_row(row: Row) -> TimeEntry:
        ended = row["ended_at"]
        return TimeEntry(
            id=int(row["id"]),
            project=str(row["project"]),
            task=str(row["task"]),
            started_at=dt.datetime.fromisoformat(str(row["started_at"])),
            ended_at=dt.datetime.fromisoformat(str(ended)) if ended else None,
        )

    def running(self) -> TimeEntry | None:
        rows = self._db.query("SELECT * FROM time_entries WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1")
        return self._from_row(rows[0]) if rows else None

    def start(self, project: str, task: str, now: dt.datetime) -> int:
        self.stop(now)
        return self._db.execute(
            "INSERT INTO time_entries (project, task, started_at, ended_at) VALUES (?, ?, ?, NULL)",
            (project.strip(), task.strip(), now.isoformat(timespec="seconds")),
        )

    def stop(self, now: dt.datetime) -> TimeEntry | None:
        running = self.running()
        if running is None:
            return None
        self._db.execute(
            "UPDATE time_entries SET ended_at = ? WHERE id = ?",
            (now.isoformat(timespec="seconds"), running.id),
        )
        return running

    def between(self, start: dt.datetime, end: dt.datetime) -> list[TimeEntry]:
        """Entries that overlap [start, end)."""
        rows = self._db.query(
            "SELECT * FROM time_entries WHERE started_at < ? AND (ended_at IS NULL OR ended_at > ?) ORDER BY started_at",
            (end.isoformat(timespec="seconds"), start.isoformat(timespec="seconds")),
        )
        return [self._from_row(r) for r in rows]

    def delete(self, entry_id: int) -> None:
        self._db.execute("DELETE FROM time_entries WHERE id = ?", (entry_id,))


def export_csv(entries: list[TimeEntry], path: Path, now: dt.datetime) -> int:
    """Write entries as CSV (UTF-8 with BOM so Excel shows umlauts correctly). Returns row count."""
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle, delimiter=";")
        writer.writerow(["project", "task", "started", "ended", "minutes"])
        for entry in entries:
            stop = entry.ended_at or now
            minutes = max(0.0, (stop - entry.started_at).total_seconds()) / 60
            writer.writerow(
                [
                    entry.project,
                    entry.task,
                    entry.started_at.isoformat(timespec="minutes"),
                    entry.ended_at.isoformat(timespec="minutes") if entry.ended_at else "",
                    f"{minutes:.1f}".replace(".", ","),
                ]
            )
    return len(entries)
