"""Module 4 — Gas-Based Result & Invalid Reading Display."""
import time

from kivy.app import App
from kivy.uix.screenmanager import Screen


class ResultScreen(Screen):
    def on_pre_enter(self, *args):
        app = App.get_running_app()
        detection = app.detection_result
        thresholds = app.selected_thresholds
        meat_type = app.selected_meat_type

        avg_nh3 = detection["avg_nh3_ppm"]
        avg_h2s = detection["avg_h2s_ppm"]
        invalid = detection["invalid"]

        self.ids.nh3_value.text = f"{avg_nh3:.2f} ppm" if avg_nh3 is not None else "—"
        self.ids.h2s_value.text = f"{avg_h2s:.2f} ppm" if avg_h2s is not None else "—"

        if invalid:
            verdict = "invalid"
            self.ids.verdict_label.text = "Invalid Reading"
            self.ids.verdict_label.color = (0.55, 0.44, 0.44, 1)
            reason = detection.get("invalid_reason")
            hint = {
                "insufficient_readings": "Too few readings were collected during the cycle.",
                "high_variance": "Readings were too unstable to trust. Try again.",
            }.get(reason, "Reading could not be validated.")
            self.ids.verdict_hint.text = hint
        else:
            nh3_over = avg_nh3 is not None and avg_nh3 > thresholds["nh3_max_ppm"]
            h2s_over = avg_h2s is not None and avg_h2s > thresholds["h2s_max_ppm"]
            spoiled = nh3_over or h2s_over

            verdict = "spoiled" if spoiled else "fresh"
            self.ids.verdict_label.text = "Spoiled" if spoiled else "Fresh"
            self.ids.verdict_label.color = (0.85, 0.25, 0.25, 1) if spoiled else (0.25, 0.75, 0.35, 1)
            self.ids.verdict_hint.text = (
                f"Thresholds for {thresholds['label']}: "
                f"NH[sub]3[/sub] ≤ {thresholds['nh3_max_ppm']} ppm, "
                f"H[sub]2[/sub]S ≤ {thresholds['h2s_max_ppm']} ppm."
            )

        # 4.6 — build the inspection record in memory for Module 5.
        app.current_record = {
            "device_id": app.device_id,
            "created_at": None,  # left for server default / set at upload time
            "meat_type": meat_type,
            "avg_nh3_ppm": avg_nh3,
            "avg_h2s_ppm": avg_h2s,
            "gas_result": verdict,
            "raw_readings": detection["readings"],
            "upload_source": "kiosk",
            "_local_captured_at": time.time(),
        }

    def continue_to_upload(self):
        self.manager.current = "upload"
