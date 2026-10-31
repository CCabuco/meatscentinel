"""
Upload path for Module 5 (Upload Status).

The kiosk does NOT talk to the database directly and does NOT hold the
Supabase service key. It POSTs each gas result to the submit-inspection
Edge Function, authenticated with a per-deployment DEVICE_SECRET. The
function validates the payload and writes it through a restricted
database function (migration 016), so the kiosk can only ever add a gas
submission, never read or change anything else.

Settings (kiosk/.env):
  SUPABASE_URL              https://<project-ref>.supabase.co
  DEVICE_SECRET             same value as the DEVICE_SECRET Edge Function secret
  SUPABASE_PUBLISHABLE_KEY  optional; sent as the apikey header (public value)

submit_inspection() returns one of:
  UPLOAD_OK        stored now, or already stored by an earlier attempt
  UPLOAD_RETRY     network/server problem; keep it in the offline queue
  UPLOAD_REJECTED  the server will never accept this payload (bad data, or
                   the inspection already has a gas result). Retrying is
                   pointless, so the caller moves it to the rejected table
                   instead of losing it.

Idempotency: submission_id is derived from inspection_id (uuid5), so the
first attempt, every offline retry, and records queued by older kiosk
versions all send the same submission_id. A retry after a lost response
comes back as 'duplicate' and counts as success.
"""
import logging
import os
import threading
import uuid

import requests
from dotenv import load_dotenv

from services.network import is_online

log = logging.getLogger("meatsentinel.services.supabase")

load_dotenv()

UPLOAD_OK = "ok"
UPLOAD_RETRY = "retry"
UPLOAD_REJECTED = "rejected"

FUNCTION_PATH = "/functions/v1/submit-inspection"
REQUEST_TIMEOUT_S = 10
_SUBMISSION_NAMESPACE = uuid.UUID("6f1c2a52-3b0e-4d7e-9a51-4f2b8f0c9d11")


def submission_id_for(inspection_id: str) -> str:
    return str(uuid.uuid5(_SUBMISSION_NAMESPACE, inspection_id))


def _settings():
    url = (os.getenv("SUPABASE_URL") or "").rstrip("/")
    secret = os.getenv("DEVICE_SECRET") or ""
    apikey = os.getenv("SUPABASE_PUBLISHABLE_KEY") or ""
    if os.getenv("SUPABASE_SERVICE_KEY"):
        log.warning(
            "SUPABASE_SERVICE_KEY is still in kiosk/.env. It is no longer used — "
            "delete it from this machine."
        )
    if not url or not secret:
        log.warning("SUPABASE_URL / DEVICE_SECRET not set — uploads will queue offline.")
        return None
    return url, secret, apikey


def _payload(record: dict, device_id: str) -> dict:
    return {
        "submission_id": record.get("submission_id") or submission_id_for(record["inspection_id"]),
        "device_id": record.get("device_id") or device_id,
        "inspection_id": record["inspection_id"],
        "sample_type": record["sample_type"],
        "nh3_ppm": record.get("nh3_ppm"),
        "h2s_ppm": record.get("h2s_ppm"),
        "gas_result": record.get("gas_result"),
        "is_valid": record["is_valid"],
        "detected_at": record["detected_at"],
        "reading_count": record.get("reading_count"),
        "nh3_stddev": record.get("nh3_stddev"),
        "h2s_stddev": record.get("h2s_stddev"),
    }


def submit_inspection(record: dict, device_id: str):
    """Send one gas result. Returns (outcome, detail)."""
    settings = _settings()
    if settings is None:
        return UPLOAD_RETRY, "not configured"
    url, secret, apikey = settings

    headers = {"Content-Type": "application/json", "x-device-secret": secret}
    if apikey:
        headers["apikey"] = apikey

    try:
        payload = _payload(record, device_id)
    except KeyError as exc:
        return UPLOAD_REJECTED, f"record is missing {exc}"

    try:
        resp = requests.post(url + FUNCTION_PATH, json=payload, headers=headers, timeout=REQUEST_TIMEOUT_S)
    except requests.RequestException as exc:
        log.warning("Upload failed (network): %s", exc)
        return UPLOAD_RETRY, "network error"

    try:
        body = resp.json()
    except ValueError:
        body = {}

    if resp.status_code in (200, 201):
        log.info("Upload %s for inspection_id=%s", body.get("status", "ok"), payload["inspection_id"])
        return UPLOAD_OK, body.get("status", "ok")

    if resp.status_code in (400, 409, 422):
        detail = body.get("details") or body.get("error") or resp.text[:300]
        log.error("Upload REJECTED (%s) for inspection_id=%s: %s",
                  resp.status_code, payload["inspection_id"], detail)
        return UPLOAD_REJECTED, f"{resp.status_code}: {detail}"

    if resp.status_code == 401:
        # Wrong secret is a setup problem, not bad data. Keep the record so
        # it uploads once DEVICE_SECRET is fixed.
        log.error("Upload refused: DEVICE_SECRET does not match the server.")
        return UPLOAD_RETRY, "device secret rejected"

    log.warning("Upload failed (%s): %s", resp.status_code, body.get("error") or resp.text[:200])
    return UPLOAD_RETRY, f"server {resp.status_code}"


class OfflineRetryDaemon:
    """Background thread that periodically retries the local offline queue."""

    def __init__(self, queue_store, interval_s: int, network_cfg: dict, device_id: str):
        self.queue_store = queue_store
        self.interval_s = interval_s
        self.network_cfg = network_cfg
        self.device_id = device_id
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
                outcome, detail = submit_inspection(item["record"], self.device_id)
                if outcome == UPLOAD_OK:
                    self.queue_store.remove(item["id"])
                    log.info("Offline queue: record %s uploaded (%s).", item["id"], detail)
                elif outcome == UPLOAD_REJECTED:
                    self.queue_store.move_to_rejected(item["id"], detail)
                    log.error("Offline queue: record %s rejected and kept in the rejected table.", item["id"])
                else:
                    self.queue_store.bump_attempts(item["id"])
                    if detail in ("not configured", "device secret rejected"):
                        break  # every other record would fail the same way
