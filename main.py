"""
MeatSentinel Kiosk — MVP
Raspberry Pi 4 + 3.5" touchscreen, Kivy UI, Supabase backend.

Run directly with `python main.py`. Falls back to a mock hardware layer
automatically when GPIO/SPI/RPi libraries aren't present, so this also runs
fine on a regular dev laptop for building/testing the UI and logic.
"""
import json
import logging
import os

os.environ.setdefault("KIVY_NO_ARGS", "1")

from kivy.app import App
from kivy.base import ExceptionHandler, ExceptionManager
from kivy.config import Config

# --- Landscape lock (S.8) — must happen before other kivy imports create the window.
Config.set("graphics", "orientation", "landscape")
Config.set("kivy", "exit_on_escape", "1")

# Target the kiosk's actual panel: 480x320 is the standard resolution for the
# 3.5" touchscreens used with the Raspberry Pi (Waveshare/Elecrow/etc.). All
# kv sizing is expressed relative to Window.width/height, so this also sets
# the scale for every screen — change it here if the real panel differs. This
# must be set via Config (not Window.size) *before* kivy.core.window is
# imported: the window is created from these Config values at import time, so
# a later Window.size assignment lands only after the kv rules have already
# bound to the old (Config-default 800x600) size.
Config.set("graphics", "width", "480")
Config.set("graphics", "height", "320")

from kivy.core.window import Window
from kivy.lang import Builder
from kivy.resources import resource_add_path
from kivy.uix.screenmanager import ScreenManager, NoTransition

from logging_config import setup_logging
from hardware.ultrasonic import build_ultrasonic_sensor
from hardware.gas_sensors import build_gas_sensor_array
from hardware.fan import build_fan
from services.db import KioskStateStore, OfflineQueueStore, load_device_id
from services.supabase_client import RealtimeConfirmer, OfflineRetryDaemon

# Screens (imported so Kivy's factory can resolve <ClassName> rules in .kv)
from screens.progress_ring import ProgressRing  # noqa: F401  (used by kv)
from screens.spinner import LoadingSpinner  # noqa: F401  (used by kv)
from screens.upload_animation import UploadFlyer  # noqa: F401  (used by kv)
from screens.widgets import MeatTile  # noqa: F401  (used by kv)
from screens.sample_selection import SampleSelectionScreen
from screens.placement import PlacementScreen
from screens.detection import DetectionScreen
from screens.result import ResultScreen
from screens.upload import UploadScreen
from screens.ventilation import VentilationScreen
from screens.error_screen import ErrorScreen

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
resource_add_path(BASE_DIR)  # lets kv `source:` paths resolve regardless of cwd


def _load_json(filename):
    with open(os.path.join(BASE_DIR, filename)) as f:
        return json.load(f)


class KioskExceptionHandler(ExceptionHandler):
    """System-level (S.6) — catch unrecoverable errors app-wide and show
    a full-screen error state instead of crashing to the console/desktop."""

    def __init__(self, app):
        super().__init__()
        self.app = app

    def handle_exception(self, inst):
        logging.getLogger("meatsentinel").exception("Unhandled exception", exc_info=inst)
        try:
            self.app.show_fatal_error(str(inst))
        except Exception:
            pass
        return ExceptionManager.PASS


class MeatSentinelApp(App):
    def build(self):
        self.config = _load_json("config.json")
        self.thresholds = _load_json("thresholds.json")
        self.device_id = load_device_id(os.path.join(BASE_DIR, "device.json"))

        self.log = setup_logging(
            os.path.join(BASE_DIR, self.config["log_file"]),
            self.config["log_max_bytes"],
            self.config["log_backup_count"],
        )
        self.log.info("MeatSentinel Kiosk starting. device_id=%s", self.device_id)

        # Global exception handler (S.6)
        ExceptionManager.add_handler(KioskExceptionHandler(self))

        # Hardware layer (S.3 — graceful fallback if a sensor isn't detected)
        hardware_mode = self.config.get("hardware_mode", "auto")
        self.ultrasonic_sensor = build_ultrasonic_sensor(self.config["pins"], hardware_mode)
        self.gas_sensors = build_gas_sensor_array(self.config["adc"], hardware_mode)
        self.fan = build_fan(self.config["pins"], hardware_mode)

        # Local storage (Module 1.4 persistence, Module 5.3 offline queue)
        self.state_store = KioskStateStore(os.path.join(BASE_DIR, "kiosk_state.db"))
        self.offline_queue = OfflineQueueStore(os.path.join(BASE_DIR, "offline_queue.db"))

        # Realtime confirmation (Module 5.6) — best effort, never blocks the UI.
        self.realtime_confirmer = RealtimeConfirmer(
            self.device_id, on_confirmed=self._on_realtime_confirmed
        )
        self.realtime_confirmer.start()

        # Offline retry daemon (Module 5.4)
        self.offline_retry_daemon = OfflineRetryDaemon(
            self.offline_queue, self.config["offline_retry_interval_s"], self.config
        )
        self.offline_retry_daemon.start()

        # In-memory inspection state, reset each new-inspection cycle.
        self.reset_inspection_state()

        # Load KV files
        for kv_file in [
            "kv/common.kv",
            "kv/sample_selection.kv",
            "kv/placement.kv",
            "kv/detection.kv",
            "kv/result.kv",
            "kv/upload.kv",
            "kv/ventilation.kv",
            "kv/error_screen.kv",
        ]:
            Builder.load_file(os.path.join(BASE_DIR, kv_file))

        sm = ScreenManager(transition=NoTransition())
        sm.add_widget(SampleSelectionScreen(name="sample_selection"))
        sm.add_widget(PlacementScreen(name="placement"))
        sm.add_widget(DetectionScreen(name="detection"))
        sm.add_widget(ResultScreen(name="result"))
        sm.add_widget(UploadScreen(name="upload"))
        sm.add_widget(VentilationScreen(name="ventilation"))
        sm.add_widget(ErrorScreen(name="error"))
        self.screen_manager = sm

        Window.clearcolor = (0.9882, 0.9725, 0.9725, 1)
        return sm

    def reset_inspection_state(self):
        self.selected_meat_type = None
        self.selected_thresholds = None
        self.detection_result = None
        self.current_record = None

    def _on_realtime_confirmed(self, row):
        self.log.info("Realtime confirmation received for record id=%s", row.get("id"))

    def show_fatal_error(self, message: str):
        error_screen = self.screen_manager.get_screen("error")
        error_screen.show_error(message)
        self.screen_manager.current = "error"

    def on_stop(self):
        self.offline_retry_daemon.stop()
        self.realtime_confirmer.stop()
        for device in (self.ultrasonic_sensor, self.gas_sensors, self.fan):
            try:
                device.close()
            except Exception:
                pass


if __name__ == "__main__":
    MeatSentinelApp().run()
