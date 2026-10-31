"""
Local SQLite storage for two things:

1. Persistent "last selected meat type" (Module 1.4) — kiosk_state.db
2. Offline upload queue for failed Supabase inserts (Module 5.3) — offline_queue.db
   plus a `rejected` table for records the server will never accept, so
   they are kept for review instead of being retried forever or lost.

Kept as two small, single-purpose files rather than one shared DB so a
corrupt queue file can never take down the simple state lookup.
"""
import json
import sqlite3
import threading
import time
from pathlib import Path

_lock = threading.Lock()


class KioskStateStore:
    def __init__(self, path: str = "kiosk_state.db"):
        self.path = path
        self._init_db()

    def _conn(self):
        return sqlite3.connect(self.path)

    def _init_db(self):
        with self._conn() as conn:
            conn.execute(
                "CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT)"
            )

    def get(self, key: str, default=None):
        with self._conn() as conn:
            row = conn.execute("SELECT value FROM state WHERE key = ?", (key,)).fetchone()
        return row[0] if row else default

    def set(self, key: str, value: str):
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO state (key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (key, value),
            )

    def get_last_meat_type(self):
        return self.get("last_meat_type")

    def set_last_meat_type(self, meat_type: str):
        self.set("last_meat_type", meat_type)


class OfflineQueueStore:
    """Queue of inspection records that failed to upload to Supabase."""

    def __init__(self, path: str = "offline_queue.db"):
        self.path = path
        self._init_db()

    def _conn(self):
        return sqlite3.connect(self.path)

    def _init_db(self):
        with self._conn() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS queue (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    record_json TEXT NOT NULL,
                    queued_at REAL NOT NULL,
                    attempts INTEGER NOT NULL DEFAULT 0
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS rejected (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    record_json TEXT NOT NULL,
                    reason TEXT,
                    rejected_at REAL NOT NULL
                )
                """
            )

    def enqueue(self, record: dict):
        with _lock, self._conn() as conn:
            conn.execute(
                "INSERT INTO queue (record_json, queued_at, attempts) VALUES (?, ?, 0)",
                (json.dumps(record), time.time()),
            )

    def all_pending(self):
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT id, record_json, attempts FROM queue ORDER BY queued_at ASC"
            ).fetchall()
        return [
            {"id": r[0], "record": json.loads(r[1]), "attempts": r[2]} for r in rows
        ]

    def remove(self, row_id: int):
        with _lock, self._conn() as conn:
            conn.execute("DELETE FROM queue WHERE id = ?", (row_id,))

    def add_rejected(self, record: dict, reason: str):
        with _lock, self._conn() as conn:
            conn.execute(
                "INSERT INTO rejected (record_json, reason, rejected_at) VALUES (?, ?, ?)",
                (json.dumps(record), str(reason)[:500], time.time()),
            )

    def move_to_rejected(self, row_id: int, reason: str):
        """Move one queued record to the rejected table in a single transaction."""
        with _lock, self._conn() as conn:
            row = conn.execute("SELECT record_json FROM queue WHERE id = ?", (row_id,)).fetchone()
            if row is None:
                return
            conn.execute(
                "INSERT INTO rejected (record_json, reason, rejected_at) VALUES (?, ?, ?)",
                (row[0], str(reason)[:500], time.time()),
            )
            conn.execute("DELETE FROM queue WHERE id = ?", (row_id,))

    def bump_attempts(self, row_id: int):
        with _lock, self._conn() as conn:
            conn.execute("UPDATE queue SET attempts = attempts + 1 WHERE id = ?", (row_id,))

    def count(self) -> int:
        with self._conn() as conn:
            (n,) = conn.execute("SELECT COUNT(*) FROM queue").fetchone()
        return n


def load_device_id(device_json_path: str = "device.json") -> str:
    """Read device id from /etc/machine-id first, else device.json fallback."""
    machine_id_path = Path("/etc/machine-id")
    if machine_id_path.exists():
        try:
            content = machine_id_path.read_text().strip()
            if content:
                return content
        except OSError:
            pass

    try:
        with open(device_json_path) as f:
            return json.load(f).get("device_id", "unknown-device")
    except (OSError, json.JSONDecodeError):
        return "unknown-device"
