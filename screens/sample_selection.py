"""Module 1 — Sample Type Selection."""
from kivy.app import App
from kivy.uix.screenmanager import Screen


class SampleSelectionScreen(Screen):
    def on_pre_enter(self, *args):
        app = App.get_running_app()
        # Reset any prior inspection state (also used by Module 6.6 "New Inspection").
        app.reset_inspection_state()

        last_type = app.state_store.get_last_meat_type()
        self.select_type(last_type, persist=False) if last_type else self._clear_selection()

    def _clear_selection(self):
        self.selected_type = None
        for btn_id in ("chicken_tile", "pork_tile", "beef_tile"):
            tile = self.ids.get(btn_id)
            if tile:
                tile.state = "normal"
        self.ids.continue_btn.disabled = True

    def select_type(self, meat_type: str, persist: bool = True):
        if meat_type not in ("chicken", "pork", "beef"):
            return
        app = App.get_running_app()

        self.selected_type = meat_type
        app.selected_meat_type = meat_type
        app.selected_thresholds = app.thresholds[meat_type]

        for key, btn_id in (
            ("chicken", "chicken_tile"),
            ("pork", "pork_tile"),
            ("beef", "beef_tile"),
        ):
            tile = self.ids.get(btn_id)
            if tile:
                tile.state = "down" if key == meat_type else "normal"

        self.ids.continue_btn.disabled = False

        if persist:
            app.state_store.set_last_meat_type(meat_type)

    def go_to_placement(self):
        if getattr(self, "selected_type", None):
            self.manager.current = "placement"
