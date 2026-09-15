"""Indeterminate loading spinner, drawn with kivy.graphics.Line arc (same
approach as ProgressRing). Used by Module 2 (placement) while waiting for a
sample — swaps to a solid ring once the sample is confirmed present."""
from kivy.clock import Clock
from kivy.graphics import Color, Line
from kivy.properties import BooleanProperty, ListProperty, NumericProperty
from kivy.uix.widget import Widget


class LoadingSpinner(Widget):
    angle = NumericProperty(0)
    spinning = BooleanProperty(True)
    sweep = NumericProperty(110)  # degrees of arc shown while spinning
    speed = NumericProperty(220)  # degrees per second
    line_width = NumericProperty(6)
    track_color = ListProperty([0.9843, 0.9373, 0.9373, 1])
    active_color = ListProperty([0.55, 0.44, 0.44, 1])
    done_color = ListProperty([0.80, 0.55, 0.55, 1])

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self._clock_event = None
        self.bind(
            pos=self._redraw,
            size=self._redraw,
            angle=self._redraw,
            track_color=self._redraw,
            active_color=self._redraw,
            done_color=self._redraw,
            spinning=self._on_spinning,
        )
        self._on_spinning()

    def _on_spinning(self, *_args):
        # Kivy's Animation.repeat only loops Sequence animations, not plain
        # ones, so a single tweened Animation here would rotate once and
        # freeze. Drive it frame-by-frame instead for a true continuous spin.
        if self._clock_event:
            self._clock_event.cancel()
            self._clock_event = None
        if self.spinning:
            self._clock_event = Clock.schedule_interval(self._tick, 1 / 60.0)
        self._redraw()

    def _tick(self, dt):
        self.angle = (self.angle + self.speed * dt) % 360

    def _redraw(self, *_args):
        self.canvas.clear()
        cx, cy = self.center
        radius = min(self.width, self.height) / 2 - self.line_width
        if radius <= 0:
            return
        with self.canvas:
            Color(*self.track_color)
            Line(circle=(cx, cy, radius), width=self.line_width)
            if self.spinning:
                Color(*self.active_color)
                Line(
                    circle=(cx, cy, radius, self.angle, self.angle + self.sweep),
                    width=self.line_width,
                    cap="round",
                )
            else:
                Color(*self.done_color)
                Line(circle=(cx, cy, radius), width=self.line_width)
