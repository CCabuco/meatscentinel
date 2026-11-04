"""Module 2 — Sample Placement Validation."""
from kivy.app import App
from kivy.clock import Clock
from kivy.core.window import Window
from kivy.factory import Factory
from kivy.uix.screenmanager import Screen

SCENARIO_LABELS = {"fresh": "Fresh", "spoiled": "Spoiled", "unstable": "Unstable"}


class PlacementScreen(Screen):
    def on_pre_enter(self, *args):
        app = App.get_running_app()
        self._poll_interval_ms = app.config["placement_poll_interval_ms"]
        self.sample_detected = False

        self.ids.status_label.text = "Waiting for sample"
        self.ids.chamber_icon.spinning = True
        self.ids.start_detection_btn.disabled = True
        self._build_sim_panel(app)

        # Presence comes from the ESP32's HX711 status, which the controller
        # already polls on its own background thread — reading the cached
        # value here never blocks the UI.
        self._ui_event = Clock.schedule_interval(
            self._update_ui, self._poll_interval_ms / 1000.0
        )

    def on_leave(self, *args):
        if hasattr(self, "_ui_event"):
            self._ui_event.cancel()
        self.ids.chamber_icon.spinning = False

    def _update_ui(self, _dt):
        is_present = App.get_running_app().esp32.is_present()

        if is_present is None:
            # ESP32 unreachable or HX711 not ready/tared: /start would be refused.
            self.sample_detected = False
            self.ids.status_label.text = "Scale unavailable — check ESP32"
            self.ids.chamber_icon.spinning = True
            self.ids.start_detection_btn.disabled = True
            return

        if is_present and not self.sample_detected:
            self.sample_detected = True
            self.ids.status_label.text = "Sample detected"
            self.ids.chamber_icon.spinning = False
            self.ids.start_detection_btn.disabled = False

        elif not is_present and (self.sample_detected
                                 or self.ids.status_label.text != "Waiting for sample"):
            # Removal guard (2.5): revert to waiting state if pulled before Start.
            self.sample_detected = False
            self.ids.status_label.text = "Waiting for sample"
            self.ids.chamber_icon.spinning = True
            self.ids.start_detection_btn.disabled = True

    # --- simulation only --------------------------------------------------

    def _build_sim_panel(self, app):
        panel = self.ids.sim_panel
        panel.clear_widgets()
        if not getattr(app, "simulation", False):
            panel.height, panel.opacity = 0, 0
            return
        panel.height, panel.opacity = Window.height * 0.13, 1
        esp32 = app.esp32
        esp32.set_present(False)  # every inspection starts with an empty chamber

        place_btn = Factory.SecondaryButton(text="Sim: Place sample")
        scenario_btn = Factory.SecondaryButton(text=f"Sim reading: {SCENARIO_LABELS[esp32.scenario]}")

        def toggle_sample(*_):
            esp32.set_present(not esp32.is_present())
            place_btn.text = "Sim: Remove sample" if esp32.is_present() else "Sim: Place sample"

        def next_scenario(*_):
            names = list(SCENARIO_LABELS)
            esp32.set_scenario(names[(names.index(esp32.scenario) + 1) % len(names)])
            scenario_btn.text = f"Sim reading: {SCENARIO_LABELS[esp32.scenario]}"

        place_btn.bind(on_release=toggle_sample)
        scenario_btn.bind(on_release=next_scenario)
        panel.add_widget(place_btn)
        panel.add_widget(scenario_btn)

    def go_to_detection(self):
        if self.sample_detected:
            self.manager.current = "detection"
