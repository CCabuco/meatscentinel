"""Module 5 — Upload Status."""
import threading

from kivy.app import App
from kivy.clock import Clock
from kivy.uix.screenmanager import Screen

from services.supabase_client import insert_inspection


class UploadScreen(Screen):
    def on_pre_enter(self, *args):
        app = App.get_running_app()
        self.ids.status_label.text = "Uploading…"
        self.ids.ventilate_btn.disabled = False  # 5.5 — operator can proceed even before/after result
        self.ids.retry_note.text = ""

        threading.Thread(target=self._do_upload, args=(app,), daemon=True).start()

    def _do_upload(self, app):
        record = app.current_record
        ok = insert_inspection(record)

        if ok:
            Clock.schedule_once(lambda _dt: self._on_success())
        else:
            app.offline_queue.enqueue(record)
            Clock.schedule_once(lambda _dt: self._on_failure())

    def _on_success(self):
        self.ids.status_label.text = "Upload Successful"

    def _on_failure(self):
        self.ids.status_label.text = "Upload Failed — stored locally, will retry"
        self.ids.retry_note.text = "A background service will retry automatically once you're back online."

    def go_to_ventilation(self):
        self.manager.current = "ventilation"
