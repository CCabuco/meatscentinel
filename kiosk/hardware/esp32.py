"""
ESP32 sensor/fan controller adapter (SYS07_ESP32_Dashboard.ino).

The ESP32 owns all chamber hardware — HX711 presence, MQ-137 (NH3) /
MQ-136 (H2S) gas sensors, exhaust fan relay — and exposes it over HTTP:

  GET  /api       JSON status snapshot (see _parse_status)
  POST /start     409 unless fan off + HX711 ready + object present
  POST /end       409 unless a measurement is active
  POST /fan/on    409 unless a measurement was started *and* ended;
                  403 if the firmware has relay control disabled
  POST /fan/off   always allowed (403 only if relay control disabled)

/start, /end, /fan/* reply with a plain-text message, not JSON. The
firmware stops the fan on its own after 30 s, and silently cancels an
active measurement if the object is removed or the HX711 drops out.

Status is polled on a background thread; screens read the cached
snapshot so they never block on the network. Any timeout/connection
error just makes the snapshot go stale, which reads as "unavailable"
(None) — the same graceful degradation as the old GPIO adapters.
"""
import logging
import platform
import threading
import time

from hardware.mock import MockEsp32Controller

log = logging.getLogger("meatsentinel.hardware.esp32")


def _adc_to_ppm(raw: int, adc_max: int, scale: float, offset: float) -> float:
    """Same placeholder linear mapping the old MCP3008 adapter used
    (ratio of full scale * scale + offset). The ESP32 reports raw 12-bit
    ADC counts, not ppm — replace with the sensor's real calibration
    curve once bench-calibrated against known reference gas."""
    return max(0.0, (raw / adc_max) * scale + offset)


def _parse_status(data: dict) -> dict:
    return {
        "mq136": int(data["mq136"]),
        "mq137": int(data["mq137"]),
        "hx_raw": int(data["hxRaw"]),
        "hx_ready": bool(data["hxReady"]),
        "present": bool(data["present"]),
        "measuring": bool(data["measuring"]),
        "completed": bool(data["completed"]),
        "fan_on": bool(data["fanOn"]),
        "relay_enabled": bool(data["relayEnabled"]),
    }


class Esp32Controller:
    def __init__(self, cfg: dict):
        import requests

        self._requests = requests
        self._base_url = cfg["base_url"].rstrip("/")
        self._timeout = cfg["request_timeout_s"]
        self._poll_interval = cfg["status_poll_interval_s"]
        self._stale_after = cfg["status_stale_after_s"]
        self._adc_max = cfg["adc_max"]
        self._nh3_scale = cfg["nh3_ppm_scale"]
        self._nh3_offset = cfg["nh3_ppm_offset"]
        self._h2s_scale = cfg["h2s_ppm_scale"]
        self._h2s_offset = cfg["h2s_ppm_offset"]

        self._lock = threading.Lock()
        self._status = None
        self._status_at = 0.0
        self._was_reachable = None
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._poll_loop, daemon=True)
        self._thread.start()

    # --- status polling -------------------------------------------------

    def _poll_loop(self):
        while not self._stop.is_set():
            self.refresh_status()
            self._stop.wait(self._poll_interval)

    def refresh_status(self) -> bool:
        try:
            resp = self._requests.get(f"{self._base_url}/api", timeout=self._timeout)
            resp.raise_for_status()
            status = _parse_status(resp.json())
        except Exception as exc:
            if self._was_reachable is not False:
                log.warning("ESP32 status unavailable (%s).", exc)
            self._was_reachable = False
            return False

        with self._lock:
            self._status = status
            self._status_at = time.monotonic()
        if not self._was_reachable:
            log.info("ESP32 status reachable at %s.", self._base_url)
        self._was_reachable = True
        return True

    def status(self, newer_than: float = None):
        """Latest status dict, or None if stale/unreachable. `newer_than`
        (a time.monotonic() value) rejects snapshots fetched before it."""
        with self._lock:
            status, at = self._status, self._status_at
        if status is None or time.monotonic() - at > self._stale_after:
            return None
        if newer_than is not None and at <= newer_than:
            return None
        return dict(status, fetched_at=at)

    # --- readings -------------------------------------------------------

    def is_present(self):
        status = self.status()
        if status is None or not status["hx_ready"]:
            return None
        return status["present"]

    def nh3_ppm(self, status: dict) -> float:
        return _adc_to_ppm(status["mq137"], self._adc_max, self._nh3_scale, self._nh3_offset)

    def h2s_ppm(self, status: dict) -> float:
        return _adc_to_ppm(status["mq136"], self._adc_max, self._h2s_scale, self._h2s_offset)

    # --- commands (blocking: call from a worker thread) -----------------

    def _command(self, path: str):
        try:
            resp = self._requests.post(f"{self._base_url}{path}", timeout=self._timeout)
        except Exception as exc:
            log.warning("ESP32 %s failed: %s", path, exc)
            return False, "ESP32 not responding."
        message = resp.text.strip()
        if resp.status_code != 200:
            log.warning("ESP32 %s rejected (HTTP %s): %s", path, resp.status_code, message)
            return False, message or f"HTTP {resp.status_code}"
        log.info("ESP32 %s: %s", path, message)
        return True, message

    def start_measurement(self):
        return self._command("/start")

    def end_measurement(self):
        return self._command("/end")

    def fan_on(self):
        return self._command("/fan/on")

    def fan_off(self):
        return self._command("/fan/off")

    def close(self):
        self._stop.set()


def _is_raspberry_pi() -> bool:
    return platform.machine() in ("armv7l", "aarch64")


def _probe(cfg: dict) -> bool:
    try:
        import requests

        resp = requests.get(f"{cfg['base_url'].rstrip('/')}/api", timeout=cfg["request_timeout_s"])
        return resp.ok
    except Exception:
        return False


def build_esp32_controller(cfg: dict, hardware_mode: str = "auto"):
    if hardware_mode == "mock":
        log.info("ESP32: mock mode forced by config.")
        return MockEsp32Controller()

    # On the Pi, "auto" never falls back to mock: the ESP32 may simply not
    # have booted yet, and silently faking readings there would upload
    # made-up results. The real client just reports "unavailable" until
    # the ESP32 answers. Off-Pi, use the real ESP32 only if it's reachable.
    if hardware_mode == "auto" and not _is_raspberry_pi() and not _probe(cfg):
        log.warning("ESP32: not reachable at %s from a dev machine. Falling back to mock.",
                    cfg["base_url"])
        return MockEsp32Controller()

    try:
        controller = Esp32Controller(cfg)
    except Exception as exc:  # requests missing, bad config, etc.
        if hardware_mode == "real":
            raise RuntimeError(f"ESP32 init failed and hardware_mode=real: {exc}")
        log.warning("ESP32: client unavailable (%s). Falling back to mock.", exc)
        return MockEsp32Controller()

    log.info("ESP32: HTTP controller polling %s.", cfg["base_url"])
    return controller
