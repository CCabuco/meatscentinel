"""
Supabase integration for Module 5 (Upload Status).

- insert_inspection(): primary REST insert via supabase-py.
- RealtimeConfirmer: subscribes to INSERT events on `inspections` for this
  device_id, so the UI can show a genuine "persisted" confirmation rather
  than just trusting the insert response.
- OfflineRetryDaemon: background thread, checks connectivity every N
  seconds, drains the local SQLite offline queue back into Supabase.

All Supabase/network calls are wrapped defensively — a missing/unreachable
backend must never crash the kiosk; it should just queue and retry.
"""
import logging
import os
import threading
import time

from dotenv import load_dotenv

from services.network import is_online

log = logging.getLogger("meatsentinel.services.supabase")

load_dotenv()

TABLE_NAME = "inspections"


def _get_client():
    """Lazily build a supabase-py client. Returns None if not configured
    or the library/network isn't available — callers must handle that."""
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY")
    if not url or not key:
        log.warning("SUPABASE_URL / SUPABASE_SERVICE_KEY not set — uploads will queue offline.")
        return None
    try:
        from supabase import create_client

        return create_client(url, key)
    except Exception as exc:
        log.error("Failed to build Supabase client: %s", exc)
        return None


def insert_inspection(record: dict) -> bool:
    """Attempt a single insert. Returns True on success, False on any failure."""
    client = _get_client()
    if client is None:
        return False
    try:
        client.table(TABLE_NAME).insert(record).execute()
        return True
    except Exception as exc:
        log.warning("Supabase insert failed: %s", exc)
        return False


class RealtimeConfirmer:
    """Best-effort Realtime subscription that fires a callback when this
    device's inspection row is confirmed persisted server-side.

    Realtime client APIs vary across supabase-py versions; failures here
    are logged and swallowed rather than crashing the kiosk — REST insert
    success is already a reasonable confirmation on its own.
    """

    def __init__(self, device_id: str, on_confirmed):
        self.device_id = device_id
        self.on_confirmed = on_confirmed
        self._channel = None

    def start(self):
        client = _get_client()
        if client is None:
            return
        try:
            channel = client.channel(f"inspections-{self.device_id}")

            def _handle_insert(payload):
                try:
                    row = payload.get("data", {}).get("record", payload.get("new", {}))
                    if row.get("device_id") == self.device_id:
                        self.on_confirmed(row)
                except Exception as exc:
                    log.debug("Realtime payload handling error: %s", exc)

            channel.on_postgres_changes(
                event="INSERT",
                schema="public",
                table=TABLE_NAME,
                callback=_handle_insert,
            )
            channel.subscribe()
            self._channel = channel
            log.info("Realtime confirmation channel subscribed for device %s", self.device_id)
        except Exception as exc:
            log.warning("Realtime subscription unavailable (%s) — REST insert result still used.", exc)

    def stop(self):
        if self._channel is not None:
            try:
                self._channel.unsubscribe()
            except Exception:
                pass


class OfflineRetryDaemon:
    """Background thread that periodically retries the local offline queue."""

    def __init__(self, queue_store, interval_s: int, network_cfg: dict):
        self.queue_store = queue_store
        self.interval_s = interval_s
        self.network_cfg = network_cfg
        self._stop_event = threading.Event()
        self._thread = None

    def start(self):
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self):
        self._stop_event.set()

    def _run(self):
        while not self._stop_event.is_set():
            self._stop_event.wait(self.interval_s)
            if self._stop_event.is_set():
                break
            if self.queue_store.count() == 0:
                continue
            if not is_online(
                self.network_cfg.get("network_check_host", "8.8.8.8"),
                self.network_cfg.get("network_check_port", 53),
                self.network_cfg.get("network_check_timeout_s", 3),
            ):
                continue
            for item in self.queue_store.all_pending():
                ok = insert_inspection(item["record"])
                if ok:
                    self.queue_store.remove(item["id"])
                    log.info("Offline queue: record %s uploaded and removed.", item["id"])
                else:
                    self.queue_store.bump_attempts(item["id"])
