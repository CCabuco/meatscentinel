"""
Record submission and the local queue.

Records are written to local storage before transmission is attempted, so a
transmission failure cannot lose an inspection. The device is expected to
operate without connectivity; uploads accumulate and drain when a network is
available.

Each record carries a submission_id generated on the device. A device cannot
distinguish a request that never arrived from a response that was lost, so
retrying after a timeout risks a duplicate record. The identifier lets the
receiving end recognise a retry as the same submission.

The transport is behind an interface. The real endpoint is not yet decided,
so the working implementation is the queue itself; sending is stubbed.
"""

from __future__ import annotations

import json
import sqlite3
import time
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timezone

import config
from detection import DetectionResult


def clock_is_reliable() -> bool:
    """
    A Raspberry Pi has no battery-backed clock. Without network time at boot
    the system clock is wrong, and a timestamp from it would be misleading.
    """
    return datetime.now(timezone.utc).year >= 2024


def make_inspection_id(device_id: str, sequence: int) -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
    return f"{device_id}-{stamp}-{sequence:04d}"


@dataclass
class Submission:
    submission_id: str
    device_id: str
    inspection_id: str
    sample_type: str
    nh3_ppm: float | None
    h2s_ppm: float | None
    nh3_stddev: float | None
    h2s_stddev: float | None
    gas_result: str | None
    is_valid: bool
    invalid_reason: str | None
    reading_count: int
    detected_at: str
    clock_reliable: bool

    @classmethod
    def from_result(cls, result: DetectionResult, device_id: str,
                    inspection_id: str) -> "Submission":
        return cls(
            submission_id=str(uuid.uuid4()),
            device_id=device_id,
            inspection_id=inspection_id,
            sample_type=result.sample_type,
            nh3_ppm=result.nh3_ppm,
            h2s_ppm=result.h2s_ppm,
            nh3_stddev=result.nh3_stddev,
            h2s_stddev=result.h2s_stddev,
            gas_result=result.outcome.value if result.is_valid else None,
            is_valid=result.is_valid,
            invalid_reason=result.reason,
            reading_count=result.reading_count,
            detected_at=datetime.fromtimestamp(
                result.finished_at, timezone.utc).isoformat(),
            clock_reliable=clock_is_reliable(),
        )


class Queue:
    """Local store. Written before any transmission is attempted."""

    def __init__(self, path: str = None):
        self.path = path or config.QUEUE_DB_PATH
        self._init_db()

    def _connect(self):
        return sqlite3.connect(self.path)

    def _init_db(self) -> None:
        with self._connect() as db:
            db.execute("""
                create table if not exists queue (
                    submission_id   text primary key,
                    payload         text not null,
                    status          text not null default 'pending',
                    attempts        integer not null default 0,
                    created_at      real not null,
                    last_attempt_at real,
                    last_error      text
                )
            """)
            db.execute("""
                create table if not exists sequence (
                    day  text primary key,
                    next integer not null
                )
            """)

    def next_sequence(self) -> int:
        """Per-day counter for inspection IDs."""
        day = datetime.now(timezone.utc).strftime("%Y%m%d")
        with self._connect() as db:
            row = db.execute(
                "select next from sequence where day = ?", (day,)).fetchone()
            n = row[0] if row else 1
            db.execute(
                "insert into sequence (day, next) values (?, ?) "
                "on conflict(day) do update set next = ?",
                (day, n + 1, n + 1))
        return n

    def add(self, submission: Submission) -> None:
        with self._connect() as db:
            db.execute(
                "insert or ignore into queue "
                "(submission_id, payload, created_at) values (?, ?, ?)",
                (submission.submission_id,
                 json.dumps(asdict(submission)),
                 time.time()))

    def pending(self, limit: int = 50) -> list[tuple[str, dict, int]]:
        with self._connect() as db:
            rows = db.execute(
                "select submission_id, payload, attempts from queue "
                "where status = 'pending' order by created_at limit ?",
                (limit,)).fetchall()
        return [(r[0], json.loads(r[1]), r[2]) for r in rows]

    def pending_count(self) -> int:
        with self._connect() as db:
            return db.execute(
                "select count(*) from queue where status = 'pending'"
            ).fetchone()[0]

    def mark_sent(self, submission_id: str) -> None:
        with self._connect() as db:
            db.execute("update queue set status = 'sent' where submission_id = ?",
                       (submission_id,))

    def mark_rejected(self, submission_id: str, error: str) -> None:
        """
        A rejection means the payload is wrong; retrying it unchanged cannot
        succeed. The record is kept rather than discarded so the cause can be
        investigated and the record recovered.
        """
        with self._connect() as db:
            db.execute(
                "update queue set status = 'rejected', last_error = ? "
                "where submission_id = ?", (error, submission_id))

    def record_failure(self, submission_id: str, error: str) -> None:
        with self._connect() as db:
            db.execute(
                "update queue set attempts = attempts + 1, "
                "last_attempt_at = ?, last_error = ? where submission_id = ?",
                (time.time(), error, submission_id))


class Transport:
    """How a record reaches the server."""

    def send(self, payload: dict) -> tuple[bool, bool, str]:
        """
        Returns (delivered, permanent_failure, message).

        permanent_failure distinguishes a rejected payload, which retrying
        cannot fix, from a transmission failure, which retrying may.
        """
        raise NotImplementedError


class StubTransport(Transport):
    """
    Placeholder until the endpoint exists.

    Reports failure so records remain queued rather than being silently
    marked delivered when nothing received them.
    """

    def send(self, payload: dict) -> tuple[bool, bool, str]:
        return False, False, "No endpoint configured"


class HttpTransport(Transport):
    """
    UNTESTED. The endpoint, payload schema, and authentication have not been
    decided, so this cannot be verified. Written to show the intended shape.
    """

    def send(self, payload: dict) -> tuple[bool, bool, str]:
        import urllib.error
        import urllib.request

        if not config.SUBMIT_ENDPOINT:
            return False, False, "No endpoint configured"

        body = json.dumps(payload).encode()
        req = urllib.request.Request(
            config.SUBMIT_ENDPOINT,
            data=body,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {config.DEVICE_SECRET}",
            },
        )

        try:
            with urllib.request.urlopen(
                    req, timeout=config.UPLOAD_TIMEOUT_SECONDS) as resp:
                return resp.status < 300, False, "Delivered"
        except urllib.error.HTTPError as e:
            # 4xx means the payload is wrong; retrying will not help.
            permanent = 400 <= e.code < 500
            return False, permanent, f"HTTP {e.code}"
        except Exception as e:
            return False, False, str(e)


def create_transport() -> Transport:
    if config.SUBMIT_ENDPOINT:
        return HttpTransport()
    return StubTransport()


class Uploader:
    """Drains the queue. Records are added by the application, not here."""

    def __init__(self, queue: Queue, transport: Transport):
        self.queue = queue
        self.transport = transport

    def submit(self, submission: Submission) -> tuple[bool, str]:
        """Store first, then attempt delivery."""
        self.queue.add(submission)
        return self.drain_one(submission.submission_id, asdict(submission))

    def drain_one(self, submission_id: str, payload: dict) -> tuple[bool, str]:
        delivered, permanent, message = self.transport.send(payload)

        if delivered:
            self.queue.mark_sent(submission_id)
            return True, message

        if permanent:
            self.queue.mark_rejected(submission_id, message)
            return False, message

        self.queue.record_failure(submission_id, message)
        return False, message

    def drain(self) -> int:
        sent = 0
        for submission_id, payload, attempts in self.queue.pending():
            if attempts >= config.MAX_RETRY_ATTEMPTS:
                continue
            ok, _ = self.drain_one(submission_id, payload)
            if ok:
                sent += 1
        return sent
