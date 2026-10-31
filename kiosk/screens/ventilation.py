"""Module 6 — Chamber Ventilation."""
import threading
import time

from kivy.app import App
from kivy.clock import Clock
from kivy.uix.screenmanager import Screen


class VentilationScreen(Screen):
    def on_pre_enter(self, *args):
        app = App.get_running_app()
        self.duration_s = app.config["ventilation_duration_s"]
        self._start_time = None
        self._event = None
        self._running = False

        self.ids.ring.progress = 0.0
        self.ids.percent_label.text = "0%"
        self.ids.status_label.text = "Ready to ventilate"
        self.ids.start_stop_btn.text = "Start Ventilation"
        self.ids.start_stop_btn.disabled = False
        self.ids.new_inspection_btn.disabled = True

    def on_leave(self, *args):
        self._stop_fan()
        if self._event:
            self._event.cancel()

    def toggle_ventilation(self):
        if self._running:
            self._manual_stop()
        else:
            self._start()

    def _start(self):
        # Fan commands are HTTP calls to the ESP32 — keep them off the UI thread.
        self.ids.start_stop_btn.disabled = True
        self.ids.status_label.text = "Starting fan…"
        esp32 = App.get_running_app().esp32

        def worker():
            # If detection's /end was lost to a network drop, the ESP32 is
            # still MEASURING and would refuse the fan with a 409 — end it here.
            status = esp32.status()
            if status is None or status["measuring"]:
                esp32.end_measurement()
            ok, message = esp32.fan_on()
            Clock.schedule_once(lambda _dt: self._on_fan_on(ok, message))

        threading.Thread(target=worker, daemon=True).start()

    def _on_fan_on(self, ok, message):
        self.ids.start_stop_btn.disabled = False
        if self.manager.current != self.name:
            return
        if not ok:
            # e.g. 409 "End a measurement before turning on the fan."
            self.ids.status_label.text = f"Fan refused: {message}"
            self.ids.new_inspection_btn.disabled = False
            return
        self._running = True
        self._start_time = time.monotonic()
        self.ids.start_stop_btn.text = "Stop Ventilation"
        self.ids.status_label.text = "Ventilating…"
        self._event = Clock.schedule_interval(self._tick, 0.2)

    def _tick(self, _dt):
        elapsed = time.monotonic() - self._start_time
        progress = min(1.0, elapsed / self.duration_s) if self.duration_s > 0 else 1.0
        self.ids.ring.progress = progress
        self.ids.percent_label.text = f"{int(progress * 100)}%"

        status = App.get_running_app().esp32.status(newer_than=self._start_time)
        if status is None:
            self.ids.status_label.text = "Ventilating… (ESP32 not responding)"
        elif not status["fan_on"]:
            # Firmware stops the fan itself after 30 s (or it was switched off).
            self._complete()
            return
        else:
            self.ids.status_label.text = "Ventilating…"

        if progress >= 1.0:
            self._complete()

    def _manual_stop(self):
        self._stop_fan()
        if self._event:
            self._event.cancel()
        self.ids.status_label.text = "Ventilation stopped early"
        self.ids.start_stop_btn.text = "Start Ventilation"
        self.ids.new_inspection_btn.disabled = False

    def _complete(self):
        self._stop_fan()
        if self._event:
            self._event.cancel()
        self.ids.ring.progress = 1.0
        self.ids.percent_label.text = "100%"
        self.ids.status_label.text = "Ventilation complete — ready for next inspection."
        self.ids.start_stop_btn.text = "Start Ventilation"
        self.ids.new_inspection_btn.disabled = False

    def _stop_fan(self):
        app = App.get_running_app()
        threading.Thread(target=app.esp32.fan_off, daemon=True).start()
        self._running = False

    def new_inspection(self):
        self.manager.current = "sample_selection"
