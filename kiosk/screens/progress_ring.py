"""Circular ring progress indicator, drawn with kivy.graphics.Line arc.
Used by Module 3 (detection) and Module 6 (ventilation)."""
from kivy.graphics import Color, Line
from kivy.properties import NumericProperty, ListProperty
from kivy.uix.widget import Widget


class ProgressRing(Widget):
    progress = NumericProperty(0.0)  # 0.0 - 1.0
    ring_color = ListProperty([0.80, 0.55, 0.55, 1])
    track_color = ListProperty([0.9843, 0.9373, 0.9373, 1])
    line_width = NumericProperty(10)

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.bind(pos=self._redraw, size=self._redraw, progress=self._redraw)

    def _redraw(self, *_args):
        self.canvas.clear()
        cx, cy = self.center
        radius = min(self.width, self.height) / 2 - self.line_width
        if radius <= 0:
            return
        progress = max(0.0, min(1.0, self.progress))
        if progress <= 0:
            # Nothing has started yet — stay fully hidden instead of showing
            # a ghostly track circle before the user has pressed "Start".
            return
        with self.canvas:
            Color(*self.track_color)
            Line(
                circle=(cx, cy, radius),
                width=self.line_width,
            )
            Color(*self.ring_color)
            angle_start = 90
            angle_end = 90 - 360 * progress
            Line(
                circle=(cx, cy, radius, angle_end, angle_start),
                width=self.line_width,
                cap="round",
            )
