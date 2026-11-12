"""Task list: title, done state, optional due date, and an optional reminder on the due date."""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from sqlite3 import Row

from desktop_organizer.core.storage import Database
from desktop_organizer.tools.reminders.logic import RemindersStore

DEFAULT_REMINDER_HOUR = 9


@dataclass(frozen=True)
class Task:
    id: int
    title: str
    done: bool
    due_date: dt.date | None
    reminder_id: int | None


def parse_due(text: str) -> dt.date | None:
    text = text.strip()
    if not text:
        return None
    return dt.date.fromisoformat(text)  # raises ValueError with a clear message on bad input


class TasksStore:
    def __init__(self, db: Database, reminders: RemindersStore) -> None:
        self._db = db
        self._reminders = reminders

    @staticmethod
    def _from_row(row: Row) -> Task:
        due = row["due_date"]
        return Task(
            id=int(row["id"]),
            title=str(row["title"]),
            done=bool(row["done"]),
            due_date=dt.date.fromisoformat(due) if due else None,
            reminder_id=int(row["reminder_id"]) if row["reminder_id"] is not None else None,
        )

    def add(self, title: str, due: dt.date | None, with_reminder: bool, now: dt.datetime) -> int:
        title = title.strip()
        if not title:
            raise ValueError("A task needs a title.")
        reminder_id: int | None = None
        if with_reminder:
            if due is None:
                raise ValueError("A reminder needs a due date.")
            reminder_id = self._reminders.add_once(title, dt.datetime.combine(due, dt.time(DEFAULT_REMINDER_HOUR, 0)))
        return self._db.execute(
            "INSERT INTO tasks (title, done, due_date, reminder_id, created_at) VALUES (?, 0, ?, ?, ?)",
            (title, due.isoformat() if due else None, reminder_id, now.isoformat(timespec="seconds")),
        )

    def update(self, task_id: int, title: str, due: dt.date | None) -> None:
        title = title.strip()
        if not title:
            raise ValueError("A task needs a title.")
        self._db.execute(
            "UPDATE tasks SET title = ?, due_date = ? WHERE id = ?",
            (title, due.isoformat() if due else None, task_id),
        )

    def set_done(self, task_id: int, done: bool) -> None:
        self._db.execute("UPDATE tasks SET done = ? WHERE id = ?", (1 if done else 0, task_id))

    def delete(self, task_id: int) -> None:
        task = self.get(task_id)
        self._db.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
        if task and task.reminder_id is not None:
            self._reminders.delete(task.reminder_id)

    def get(self, task_id: int) -> Task | None:
        rows = self._db.query("SELECT * FROM tasks WHERE id = ?", (task_id,))
        return self._from_row(rows[0]) if rows else None

    def all(self, include_done: bool = True) -> list[Task]:
        sql = "SELECT * FROM tasks"
        if not include_done:
            sql += " WHERE done = 0"
        sql += " ORDER BY done, (due_date IS NULL), due_date, id"
        return [self._from_row(r) for r in self._db.query(sql)]
