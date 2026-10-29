"""Module 3 — Detection Status (timed gas sampling cycle)."""
import logging
import statistics
import threading
import time

from kivy.app import App
from kivy.clock import Clock
from kivy.uix.screenmanager import Screen

log = logging.getLogger("meatsentinel.screens.detection")


class DetectionScreen(Screen):
    def on_pre_enter(self, *args):
        app = App.get_running_app()
        cfg = app.config

        self.duration_s = cfg["detection_duration_s"]
        self.poll_interval_s = cfg["detection_poll_interval_s"]
        self.warmup_s = cfg["sensor_warmup_s"]
        self.min_readings = cfg["min_readings_required"]
        self.max_variance = cfg["max_reading_variance_ppm"]

        self._readings = []  # list of (timestamp, nh3, h2s)
        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._start_time = None
        self._measuring = False

        self.ids.status_label.text = "Warming up sensors…"
        self.ids.ring.progress = 0.0
        self.ids.percent_label.text = "0%"

        self._worker = threading.Thread(target=self._run_cycle, daemon=True)
        self._worker.start()
        self._ui_event = Clock.schedule_interval(self._update_ui, 0.25)

    def on_leave(self, *args):
        self._stop_event.set()
        if hasattr(self, "_ui_event"):
            self._ui_event.cancel()
        if self._measuring:
            # Left mid-cycle: don't leave the ESP32 stuck in MEASURING.
            self._measuring = False
            threading.Thread(target=App.get_running_app().esp32.end_measurement,
                             daemon=True).start()

    def _run_cycle(self):
        esp32 = App.get_running_app().esp32

        # Firmware order: object present → /start → /end → /fan/on.
        ok, message = esp32.start_measurement()
        if not ok:
            self._abort(f"Couldn't start measurement: {message}")
            return
        self._measuring = True

        self._stop_event.wait(self.warmup_s)
        if self._stop_event.is_set():
            return

        self._start_time = time.monotonic()
        last_seen = self._start_time
        Clock.schedule_once(lambda _dt: setattr(self.ids.status_label, "text", "Detecting…"))

        while not self._stop_event.is_set():
            elapsed = time.monotonic() - self._start_time
            if elapsed >= self.duration_s:
                break
            # Only snapshots fetched since the last one we used, so the same
            # ESP32 reading is never counted twice. A stale/unreachable
            # status just means no reading this tick.
            status = esp32.status(newer_than=last_seen)
            if status is not None:
                last_seen = status["fetched_at"]
                if not status["measuring"]:
                    # The firmware cancels a measurement on its own when the
                    # object is removed or the HX711 drops out.
                    self._measuring = False
                    self._abort("Measurement cancelled — sample removed or scale lost.")
                    return
                with self._lock:
                    self._readings.append((time.time(), esp32.nh3_ppm(status), esp32.h2s_ppm(status)))
            self._stop_event.wait(self.poll_interval_s)

        if self._stop_event.is_set():
            return

        ok, message = esp32.end_measurement()
        self._measuring = False
        if not ok:
            # Readings are still good; ventilation will report the fan being refused.
            log.warning("End Measurement failed: %s", message)
        Clock.schedule_once(lambda _dt: self._finish())

    def _abort(self, message):
        log.warning("Detection aborted: %s", message)

        def show(_dt):
            if self._stop_event.is_set():
                return
            self.ids.status_label.text = message
            Clock.schedule_once(back_to_placement, 3)

        def back_to_placement(_dt):
            if self.manager.current == self.name:
                self.manager.current = "placement"

        Clock.schedule_once(show)

    def _update_ui(self, _dt):
        if self._start_time is None:
            return  # still warming up
        elapsed = time.monotonic() - self._start_time
        progress = min(1.0, elapsed / self.duration_s) if self.duration_s > 0 else 1.0
        self.ids.ring.progress = progress
        self.ids.percent_label.text = f"{int(progress * 100)}%"

    def _finish(self):
        with self._lock:
            readings = list(self._readings)

        app = App.get_running_app()
        nh3_values = [r[1] for r in readings]
        h2s_values = [r[2] for r in readings]

        invalid = False
        reason = None

        if len(readings) < self.min_readings:
            invalid = True
            reason = "insufficient_readings"
        else:
            nh3_variance = statistics.pvariance(nh3_values) ** 0.5  # stdev as a variance proxy
            h2s_variance = statistics.pvariance(h2s_values) ** 0.5
            if nh3_variance > self.max_variance or h2s_variance > self.max_variance:
                invalid = True
                reason = "high_variance"

        avg_nh3 = round(statistics.mean(nh3_values), 3) if nh3_values else None
        avg_h2s = round(statistics.mean(h2s_values), 3) if h2s_values else None

        app.detection_result = {
            "readings": [{"timestamp": t, "nh3": n, "h2s": h} for t, n, h in readings],
            "avg_nh3_ppm": avg_nh3,
            "avg_h2s_ppm": avg_h2s,
            "invalid": invalid,
            "invalid_reason": reason,
            "finished_at": time.time(),
        }

        self.manager.current = "result"
