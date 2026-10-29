"""
Mock hardware layer.

Lets the whole app run and be demoed on a regular laptop with no ESP32 on
the network. Used automatically when hardware_mode == "mock", or when
hardware_mode == "auto" on a non-Pi machine that can't reach the ESP32.
"""
import random
import threading
import time

FAN_MAX_ON_S = 30.0  # matches the firmware's FAN_MAX_ON_MS safety cut-off
ADC_MAX = 4095
AUTO_PLACE_AFTER_S = 3.0  # simulated sample lands this long after presence is first polled


class MockEsp32Controller:
    """Simulates SYS07_ESP32_Dashboard.ino, including its required order:
    object present → /start → /end → only then /fan/on."""

    def __init__(self, *_, spoiled_bias: float = 0.0, **__):
        # spoiled_bias lets a demo deliberately trend toward "Spoiled"
        self._spoiled_bias = spoiled_bias
        self._lock = threading.Lock()
        self._present = False
        self._measuring = False
        self._completed = False
        self._fan_on = False
        self._fan_started_at = 0.0
        self._waiting_since = None

    def simulate_place_sample(self):
        with self._lock:
            self._present = True

    def simulate_remove_sample(self):
        with self._lock:
            self._present = False
            if self._measuring:
                self._measuring = False
                self._completed = False

    def refresh_status(self) -> bool:
        return True

    def status(self, newer_than: float = None):
        with self._lock:
            if self._fan_on and time.monotonic() - self._fan_started_at >= FAN_MAX_ON_S:
                self._fan_on = False
            # Empty chamber ~ 8 ppm NH3 / 1.5 ppm H2S, using the same
            # placeholder 60 / 15 ppm full-scale mapping as config.json.
            nh3 = max(0.0, 8.0 + self._spoiled_bias * 20.0 + random.uniform(-1.5, 1.5))
            h2s = max(0.0, 1.5 + self._spoiled_bias * 5.0 + random.uniform(-0.4, 0.4))
            return {
                "mq136": int(h2s / 15.0 * ADC_MAX),
                "mq137": int(nh3 / 60.0 * ADC_MAX),
                "hx_raw": random.randint(6000, 9000) if self._present else random.randint(-500, 500),
                "hx_ready": True,
                "present": self._present,
                "measuring": self._measuring,
                "completed": self._completed,
                "fan_on": self._fan_on,
                "relay_enabled": True,
                "fetched_at": time.monotonic(),
            }

    def is_present(self):
        # No weight sensor off-Pi: pretend a sample is placed a few seconds
        # after the placement screen starts waiting for one.
        with self._lock:
            if not self._present:
                now = time.monotonic()
                if self._waiting_since is None:
                    self._waiting_since = now
                elif now - self._waiting_since >= AUTO_PLACE_AFTER_S:
                    self._present = True
                    self._waiting_since = None
            return self._present

    def nh3_ppm(self, status: dict) -> float:
        return status["mq137"] / ADC_MAX * 60.0

    def h2s_ppm(self, status: dict) -> float:
        return status["mq136"] / ADC_MAX * 15.0

    def start_measurement(self):
        with self._lock:
            if self._fan_on or not self._present:
                return False, "Cannot start: fan must be off and object present."
            self._measuring = True
            self._completed = False
        return True, "Measurement started. Fan remains OFF."

    def end_measurement(self):
        with self._lock:
            if not self._measuring:
                return False, "No active measurement."
            self._measuring = False
            self._completed = True
        return True, "Measurement ended."

    def fan_on(self):
        with self._lock:
            if self._measuring or not self._completed:
                return False, "End a measurement before turning on the fan."
            self._fan_on = True
            self._fan_started_at = time.monotonic()
            # Operator takes the sample out to ventilate; the next inspection
            # starts from an empty platform and auto-places again.
            self._present = False
        return True, "Fan ON. Gas readings paused."

    def fan_off(self):
        with self._lock:
            self._fan_on = False
        return True, "Fan OFF. Gas readings resumed."

    def close(self):
        pass
