"""
Simulated ESP32 for testing the kiosk and the database without hardware.

Turned on only when the KIOSK_SIMULATION environment variable is set to 1
(for example in kiosk/.env). It behaves like SYS07_ESP32_Dashboard.ino:

  * HX711 is always "ready"; the operator places/removes the sample with
    on-screen buttons on the placement screen.
  * /start is refused unless a sample is present and the fan is off.
  * Removing the sample mid-measurement cancels it, like the firmware.
  * /fan/on is refused until a measurement was started and ended.
  * The fan stops on its own after 30 s.
  * Gas readings are frozen while the fan is on.

Gas readings are raw 12-bit ADC counts generated for the chosen scenario,
converted to ppm with the same placeholder formula as the real controller:

  fresh    ~8 ppm NH3,  ~2 ppm H2S   (below every meat's threshold)
  spoiled  ~42 ppm NH3, ~9 ppm H2S   (above every meat's threshold)
  unstable readings jump around, so the kiosk marks them Invalid

Everything recorded in simulation is labelled: inspection IDs start with
"SIM-" and the device ID is "simulator" (see main.py).
"""
import logging
import random
import threading
import time

from hardware.esp32 import _adc_to_ppm

log = logging.getLogger("meatsentinel.hardware.esp32_sim")

FAN_MAX_ON_S = 30.0
SCENARIOS = ("fresh", "spoiled", "unstable")


class SimulatedEsp32:
    simulated = True

    def __init__(self, cfg: dict):
        self._adc_max = cfg["adc_max"]
        self._nh3_scale = cfg["nh3_ppm_scale"]
        self._nh3_offset = cfg["nh3_ppm_offset"]
        self._h2s_scale = cfg["h2s_ppm_scale"]
        self._h2s_offset = cfg["h2s_ppm_offset"]

        self._lock = threading.Lock()
        self._present = False
        self._measuring = False
        self._completed = False
        self._fan_on = False
        self._fan_started = 0.0
        self._scenario = "fresh"
        self._mq137 = self._raw_for(8.0, self._nh3_scale, self._nh3_offset)
        self._mq136 = self._raw_for(2.0, self._h2s_scale, self._h2s_offset)
        log.warning("ESP32 SIMULATION is ON. Readings are generated, not measured.")

    # --- operator controls (placement screen buttons) --------------------

    @property
    def scenario(self):
        return self._scenario

    def set_scenario(self, name: str):
        if name in SCENARIOS:
            with self._lock:
                self._scenario = name
            log.info("Simulation scenario: %s", name)

    def set_present(self, present: bool):
        with self._lock:
            self._present = bool(present)
            if not present and self._measuring:
                # Same as the firmware: removing the object cancels the run.
                self._measuring = False
                self._completed = False
        log.info("Simulation: sample %s", "placed" if present else "removed")

    # --- same interface as Esp32Controller -------------------------------

    def _raw_for(self, ppm: float, scale: float, offset: float) -> int:
        return max(0, min(self._adc_max, round((ppm - offset) / scale * self._adc_max)))

    def _next_readings(self):
        targets = {"fresh": (8.0, 2.0, 0.6, 0.2), "spoiled": (42.0, 9.0, 1.5, 0.4), "unstable": (25.0, 5.0, 40.0, 8.0)}
        nh3, h2s, nh3_sd, h2s_sd = targets[self._scenario]
        self._mq137 = self._raw_for(max(0.0, random.gauss(nh3, nh3_sd)), self._nh3_scale, self._nh3_offset)
        self._mq136 = self._raw_for(max(0.0, random.gauss(h2s, h2s_sd)), self._h2s_scale, self._h2s_offset)

    def status(self, newer_than: float = None):
        with self._lock:
            if self._fan_on and time.monotonic() - self._fan_started >= FAN_MAX_ON_S:
                self._fan_on = False
            if not self._fan_on:
                self._next_readings()
            return {
                "mq136": self._mq136,
                "mq137": self._mq137,
                "hx_raw": 120000 if self._present else 0,
                "hx_ready": True,
                "present": self._present,
                "measuring": self._measuring,
                "completed": self._completed,
                "fan_on": self._fan_on,
                "relay_enabled": True,
                # Always a fresh snapshot, so newer_than is always satisfied.
                "fetched_at": time.monotonic(),
            }

    def refresh_status(self) -> bool:
        return True

    def is_present(self):
        with self._lock:
            return self._present

    def nh3_ppm(self, status: dict) -> float:
        return _adc_to_ppm(status["mq137"], self._adc_max, self._nh3_scale, self._nh3_offset)

    def h2s_ppm(self, status: dict) -> float:
        return _adc_to_ppm(status["mq136"], self._adc_max, self._h2s_scale, self._h2s_offset)

    def start_measurement(self):
        with self._lock:
            if self._fan_on or not self._present:
                return False, "Cannot start: fan must be off and object present. (simulation)"
            self._measuring = True
            self._completed = False
        log.info("Simulation /start (scenario %s)", self._scenario)
        return True, "Measurement started. (simulation)"

    def end_measurement(self):
        with self._lock:
            if not self._measuring:
                return False, "No active measurement. (simulation)"
            self._measuring = False
            self._completed = True
        return True, "Measurement ended. (simulation)"

    def fan_on(self):
        with self._lock:
            if self._measuring or not self._completed:
                return False, "End a measurement before turning on the fan. (simulation)"
            self._fan_on = True
            self._fan_started = time.monotonic()
        return True, "Fan ON. (simulation)"

    def fan_off(self):
        with self._lock:
            self._fan_on = False
        return True, "Fan OFF. (simulation)"

    def close(self):
        pass
