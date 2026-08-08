"""System-level (S.6) — full-screen error state for unrecoverable errors."""
from kivy.app import App
from kivy.uix.screenmanager import Screen


class ErrorScreen(Screen):
    def show_error(self, message: str):
        self.ids.error_message.text = message

    def restart_app(self):
        app = App.get_running_app()
        app.reset_inspection_state()
        self.manager.current = "sample_selection"
