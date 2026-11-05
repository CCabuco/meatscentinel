"""
MeatSentinel Kiosk — MVP
Raspberry Pi 4 + 3.5" touchscreen, Kivy UI, Supabase backend.

Sensors (HX711 presence, MQ-136/MQ-137 gas) and the exhaust fan live on an
ESP32 that the kiosk talks to over HTTP (hardware/esp32.py).

Run directly with `python main.py`. The machine running it must be able to
reach the ESP32 at esp32.base_url in config.json.
"""
import json
import logging
import os
import uuid

os.environ.setdefault("KIVY_NO_ARGS", "1")

from kivy.app import App
from kivy.base import ExceptionHandler, ExceptionManager
from kivy.config import Config

# --- Landscape lock (S.8) — must happen before other kivy imports create the window.
Config.set("graphics", "orientation", "landscape")
Config.set("kivy", "exit_on_escape", "1")

# The kiosk originally targeted a 480x320 SPI/GPIO touchscreen panel, but that
# panel has no working GPU-mirroring driver on this OS's modern KMS display
# stack (the classic fbcp/fbcp-ili9341 tools need the deprecated Broadcom
# DispmanX userland, which doesn't exist here) — so the kiosk now runs on a
# regular HDMI display instead. "auto" fullscreen sizes the window to
# whatever the connected display's actual resolution is; kv sizing is
# expressed relative to Window.width/height so every screen scales with it.
# This must be set via Config (not Window.size) *before* kivy.core.window is
# imported: the window is created from these Config values at import time.
Config.set("graphics", "fullscreen", "auto")

# Kiosk mode: no window manager chrome.
Config.set("graphics", "borderless", "1")

from kivy.core.window import Window
from kivy.lang import Builder
from kivy.resources import resource_add_path
from kivy.uix.screenmanager import ScreenManager, NoTransition

from logging_config import setup_logging
from hardware.esp32 import build_esp32_controller
from services.db import KioskStateStore, OfflineQueueStore, load_device_id
from services.supabase_client import OfflineRetryDaemon

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

        # Hardware layer (S.3 — reads as "unavailable" until the ESP32 answers)
        # Simulation (no ESP32): only when KIOSK_SIMULATION=1 is set, e.g. in kiosk/.env.
        # Everything it records is labelled: IDs start with SIM- and the device is "simulator".
        from dotenv import load_dotenv
        load_dotenv(os.path.join(BASE_DIR, ".env"))
        self.simulation = os.getenv("KIOSK_SIMULATION", "").strip().lower() in ("1", "true", "yes", "on")
        if self.simulation:
            self.device_id = "simulator"
            self.log.warning("SIMULATION MODE: no ESP32. Uploads are labelled SIM- / device 'simulator'.")
        # ESP32_BASE_URL in .env overrides esp32.base_url, so each machine can
        # point at its own ESP32 address without editing the shared config.json.
        esp32_url = os.getenv("ESP32_BASE_URL", "").strip()
        if esp32_url:
            if not esp32_url.startswith(("http://", "https://")):
                esp32_url = "http://" + esp32_url
            self.config["esp32"]["base_url"] = esp32_url
        self.log.info("ESP32 address: %s", self.config["esp32"]["base_url"])
        self.esp32 = build_esp32_controller(self.config["esp32"], simulate=self.simulation)

        # Local storage (Module 1.4 persistence, Module 5.3 offline queue)
        self.state_store = KioskStateStore(os.path.join(BASE_DIR, "kiosk_state.db"))
        self.offline_queue = OfflineQueueStore(os.path.join(BASE_DIR, "offline_queue.db"))

        # Offline retry daemon (Module 5.4)
        self.offline_retry_daemon = OfflineRetryDaemon(
            self.offline_queue, self.config["offline_retry_interval_s"], self.config, self.device_id
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
        if not self.simulation:
            return sm

        # Always-visible banner so a simulated run can't be mistaken for a real one.
        from kivy.uix.floatlayout import FloatLayout
        from kivy.uix.label import Label
        from kivy.graphics import Color, Rectangle
        root = FloatLayout()
        root.add_widget(sm)
        banner = Label(text="SIMULATION — no ESP32, readings are generated", bold=True,
                       color=(1, 1, 1, 1), font_size=Window.height * 0.035,
                       size_hint=(1, None), height=Window.height * 0.06, pos_hint={"x": 0, "top": 1})
        with banner.canvas.before:
            Color(0.84, 0.27, 0.27, 1)
            banner._bg = Rectangle(pos=banner.pos, size=banner.size)
        banner.bind(pos=lambda w, v: setattr(w._bg, "pos", v), size=lambda w, v: setattr(w._bg, "size", v))
        root.add_widget(banner)
        self.title = "MeatSentinel Kiosk (SIMULATION)"
        return root

    def reset_inspection_state(self):
        prefix = "SIM-" if getattr(self, "simulation", False) else ""
        self.inspection_id = prefix + str(uuid.uuid4())
        self.selected_meat_type = None
        self.selected_thresholds = None
        self.detection_result = None
        self.current_record = None

    def show_fatal_error(self, message: str):
        error_screen = self.screen_manager.get_screen("error")
        error_screen.show_error(message)
        self.screen_manager.current = "error"

    def on_stop(self):
        self.offline_retry_daemon.stop()
        try:
            self.esp32.close()
        except Exception:
            pass


if __name__ == "__main__":
    MeatSentinelApp().run()
