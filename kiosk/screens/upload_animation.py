"""'File transfer' style loading animation for the upload screen — the
chicken/pork/beef icons take turns flying into a folder, looping
continuously, in place of a plane-into-folder animation."""
import math

from kivy.clock import Clock
from kivy.properties import ListProperty
from kivy.uix.image import Image
from kivy.uix.widget import Widget

_ICONS = ["chicken", "pork", "beef"]
_FOLDER_ICON = "folder"
_FLIGHT_S = 1.15
_PAUSE_S = 0.35
_CYCLE_S = _FLIGHT_S + _PAUSE_S


class UploadFlyer(Widget):
    folder_color = ListProperty([0.80, 0.55, 0.55, 1])
    icon_color = ListProperty([0.18, 0.13, 0.13, 1])

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self._t = 0.0
        self._index = 0
        self._start_slot = (0, 0)
        self._tray_slot = (0, 0)

        self._folder = Image(
            source=f"assets/icons/{_FOLDER_ICON}.png",
            color=self.folder_color,
            allow_stretch=True,
            keep_ratio=True,
            size_hint=(None, None),
        )
        self.add_widget(self._folder)

        self._icon = Image(
            source=f"assets/icons/{_ICONS[0]}.png",
            color=self.icon_color,
            allow_stretch=True,
            keep_ratio=True,
            size_hint=(None, None),
        )
        self.add_widget(self._icon)

        self.bind(
            pos=self._on_geometry,
            size=self._on_geometry,
            folder_color=self._apply_folder_color,
            icon_color=self._apply_icon_color,
        )
        self._clock_event = Clock.schedule_interval(self._tick, 1 / 60.0)
        self._on_geometry()

    def stop(self):
        if self._clock_event:
            self._clock_event.cancel()
            self._clock_event = None

    def _apply_folder_color(self, *_args):
        self._folder.color = self.folder_color

    def _apply_icon_color(self, *_args):
        self._icon.color = self.icon_color

    def _on_geometry(self, *_args):
        w, h = self.size
        if w <= 0 or h <= 0:
            return
        # keep_ratio fits the image inside this box using whichever side is
        # more constraining, so give it a tall box and a generous width
        # allowance — otherwise a short box (h was the bottleneck before)
        # shrinks the whole icon down to a sliver.
        folder_h = h * 0.85
        folder_w = w * 0.34
        fx = self.x + w * 0.58
        fy = self.y + h * 0.05
        self._folder.size = (folder_w, folder_h)
        self._folder.pos = (fx, fy)
        # Aim for the folder's open flap, near the top of its silhouette.
        self._tray_slot = (fx + folder_w * 0.5, fy + folder_h * 0.58)
        self._start_slot = (self.x + w * 0.16, self.y + h * 0.6)
        self._place_icon()

    def _tick(self, dt):
        self._t += dt
        if self._t >= _CYCLE_S:
            self._t -= _CYCLE_S
            self._index = (self._index + 1) % len(_ICONS)
            self._icon.source = f"assets/icons/{_ICONS[self._index]}.png"
        self._place_icon()

    def _place_icon(self):
        w, h = self.size
        if w <= 0 or h <= 0:
            return
        progress = min(1.0, self._t / _FLIGHT_S)
        eased = progress * progress * (3 - 2 * progress)  # smoothstep

        sx, sy = self._start_slot
        tx, ty = self._tray_slot
        x = sx + (tx - sx) * eased
        arc_h = h * 0.16 * math.sin(math.pi * eased)
        y = sy + (ty - sy) * eased + arc_h

        # Thin line-art icons turn into an illegible smudge if shrunk too
        # far, so start large and only shrink down near the folder.
        base_size = min(w, h) * 0.7
        icon_size = max(base_size * (1.0 - 0.7 * eased), 1)

        self._icon.size = (icon_size, icon_size)
        self._icon.pos = (x - icon_size / 2, y - icon_size / 2)
        self._icon.opacity = 1.0 if progress < 0.8 else max(0.0, (1.0 - progress) / 0.2)
