"""Module 2 — Sample Placement Validation."""
import threading

from kivy.app import App
from kivy.clock import Clock
from kivy.uix.screenmanager import Screen


class PlacementScreen(Screen):
    def on_pre_enter(self, *args):
        app = App.get_running_app()
        self._threshold_cm = app.config["placement_distance_threshold_cm"]
        self._poll_interval_ms = app.config["placement_poll_interval_ms"]

        self._latest_distance = None
        self._lock = threading.Lock()
        self._stop_poll = threading.Event()
        self.sample_detected = False

        self.ids.status_label.text = "Waiting for sample"
        self.ids.chamber_icon.spinning = True
        self.ids.start_detection_btn.disabled = True

        self._poll_thread = threading.Thread(target=self._poll_sensor, daemon=True)
        self._poll_thread.start()
        self._ui_event = Clock.schedule_interval(
            self._update_ui, self._poll_interval_ms / 1000.0
        )

    def on_leave(self, *args):
        self._stop_poll.set()
        if hasattr(self, "_ui_event"):
            self._ui_event.cancel()
        self.ids.chamber_icon.spinning = False

    def _poll_sensor(self):
        app = App.get_running_app()
        sensor = app.ultrasonic_sensor
        while not self._stop_poll.is_set():
            try:
                distance = sensor.distance_cm()
            except Exception:
                distance = None
            with self._lock:
                self._latest_distance = distance
            self._stop_poll.wait(self._poll_interval_ms / 1000.0)

    def _update_ui(self, _dt):
        with self._lock:
            distance = self._latest_distance

        if distance is None:
            return

        is_present = distance < self._threshold_cm

        if is_present and not self.sample_detected:
            self.sample_detected = True
            self.ids.status_label.text = "Sample detected"
            self.ids.chamber_icon.spinning = False
            self.ids.start_detection_btn.disabled = False

        elif not is_present and self.sample_detected:
            # Removal guard (2.5): revert to waiting state if pulled before Start.
            self.sample_detected = False
            self.ids.status_label.text = "Waiting for sample"
            self.ids.chamber_icon.spinning = True
            self.ids.start_detection_btn.disabled = True

    def simulate_place_sample(self):
        """Dev-only helper wired to the mock hardware layer for demoing
        off real hardware. No-ops harmlessly against real sensors."""
        app = App.get_running_app()
        sim = getattr(app.ultrasonic_sensor, "simulate_place_sample", None)
        if sim:
            sim()

    def go_to_detection(self):
        if self.sample_detected:
            self.manager.current = "detection"
