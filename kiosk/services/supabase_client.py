"""
Supabase integration for Module 5 (Upload Status).

The schema is owned by the web dashboard team, not this repo — see
README's "Shared Supabase schema" section for the tables/columns the
kiosk is allowed to touch and why. In short:

  inspection_records(inspection_id text PK, final_classification, ...)
    - a database trigger auto-creates one status_entries row the moment
      this is inserted, so the kiosk must NEVER insert into
      status_entries itself (doing so would fight the trigger and, since
      status_entries is append-only, leave duplicate rows forever).
  gas_submissions(inspection_id text PK+FK->inspection_records,
    sample_type, nh3_ppm, h2s_ppm, gas_result 'Fresh'|'Spoiled',
    is_valid, detected_at, received_at default now())

- insert_inspection(): upserts the parent inspection_records row, then
  inserts the gas_submissions row — but only if one doesn't already exist
  for this inspection_id, since gas_submissions rejects writes to
  existing rows ("immutable once received"). That check is what makes
  retries from the offline queue safe after a partial failure.
- RealtimeConfirmer: subscribes to INSERT events on gas_submissions and
  reports back rows so the caller can match against the inspection_id
  it's currently waiting on.
- OfflineRetryDaemon: background thread, checks connectivity every N
  seconds, drains the local SQLite offline queue back into Supabase.

All Supabase/network calls are wrapped defensively — a missing/unreachable
backend must never crash the kiosk; it should just queue and retry.
"""
import logging
import os
import threading

from dotenv import load_dotenv

from services.network import is_online

log = logging.getLogger("meatsentinel.services.supabase")

load_dotenv()

INSPECTION_RECORDS_TABLE = "inspection_records"
GAS_SUBMISSIONS_TABLE = "gas_submissions"


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
    """Write one inspection into the shared schema. Returns True on full
    success, False on any failure (caller queues for retry).

    inspection_records is upserted — gas_submissions.inspection_id is a
    foreign key to it, so the parent case row must exist first, and
    re-upserting the same inspection_id is a harmless no-op.

    gas_submissions itself is NOT upserted: the database rejects any
    write to an existing row there ("submissions are immutable once
    received" — it's a measurement event, not editable metadata). So a
    retry after a successful-but-unconfirmed insert must detect the
    existing row and treat it as success, rather than trying to upsert
    (which would just fail the same way every time).
    """
    client = _get_client()
    if client is None:
        return False

    try:
        inspection_id = record["inspection_id"]
        client.table(INSPECTION_RECORDS_TABLE).upsert(
            {"inspection_id": inspection_id}, on_conflict="inspection_id"
        ).execute()

        existing = (
            client.table(GAS_SUBMISSIONS_TABLE)
            .select("inspection_id")
            .eq("inspection_id", inspection_id)
            .limit(1)
            .execute()
        )
        if not existing.data:
            gas_payload = {
                "inspection_id": inspection_id,
                "sample_type": record["sample_type"],
                "nh3_ppm": record.get("nh3_ppm"),
                "h2s_ppm": record.get("h2s_ppm"),
                "gas_result": record.get("gas_result"),
                "is_valid": record["is_valid"],
                "detected_at": record["detected_at"],
            }
            client.table(GAS_SUBMISSIONS_TABLE).insert(gas_payload).execute()
        return True
    except Exception as exc:
        log.warning("Supabase insert failed: %s", exc)
        return False


class RealtimeConfirmer:
    """Best-effort Realtime subscription that fires a callback whenever a
    gas_submissions row is confirmed persisted server-side. The caller
    matches payloads against whatever inspection_id it currently cares
    about — inspection_id changes every cycle, so filtering happens here
    rather than being baked into the subscription.

    Realtime client APIs vary across supabase-py versions; failures here
    are logged and swallowed rather than crashing the kiosk — REST insert
    success is already a reasonable confirmation on its own.
    """

    def __init__(self, on_confirmed):
        self.on_confirmed = on_confirmed
        self._channel = None

    def start(self):
        client = _get_client()
        if client is None:
            return
        try:
            channel = client.channel("gas_submissions-inserts")

            def _handle_insert(payload):
                try:
                    row = payload.get("data", {}).get("record", payload.get("new", {}))
                    self.on_confirmed(row)
                except Exception as exc:
                    log.debug("Realtime payload handling error: %s", exc)

            channel.on_postgres_changes(
                event="INSERT",
                schema="public",
                table=GAS_SUBMISSIONS_TABLE,
                callback=_handle_insert,
            )
            channel.subscribe()
            self._channel = channel
            log.info("Realtime confirmation channel subscribed for gas_submissions")
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
