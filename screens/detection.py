"""Module 3 — Detection Status (timed gas sampling cycle)."""
import statistics
import threading
import time

from kivy.app import App
from kivy.clock import Clock
from kivy.uix.screenmanager import Screen


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

    def _run_cycle(self):
        app = App.get_running_app()
        sensors = app.gas_sensors

        sensors.warmup(self.warmup_s)
        if self._stop_event.is_set():
            return

        self._start_time = time.monotonic()
        Clock.schedule_once(lambda _dt: setattr(self.ids.status_label, "text", "Detecting…"))

        while not self._stop_event.is_set():
            elapsed = time.monotonic() - self._start_time
            if elapsed >= self.duration_s:
                break
            nh3 = sensors.read_nh3_ppm()
            h2s = sensors.read_h2s_ppm()
            with self._lock:
                self._readings.append((time.time(), nh3, h2s))
            self._stop_event.wait(self.poll_interval_s)

        if not self._stop_event.is_set():
            Clock.schedule_once(lambda _dt: self._finish())

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
