"""Module 6 — Chamber Ventilation."""
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
        app = App.get_running_app()
        app.fan.on()
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
        self.ids.status_label.text = "Ventilation complete — ready for next inspection."
        self.ids.start_stop_btn.text = "Start Ventilation"
        self.ids.new_inspection_btn.disabled = False

    def _stop_fan(self):
        app = App.get_running_app()
        app.fan.off()
        self._running = False

    def new_inspection(self):
        self.manager.current = "sample_selection"
