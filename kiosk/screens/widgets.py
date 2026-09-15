"""Selectable tile used on the sample-selection screen. Visuals (rounded
card, icon, label) live in the `<MeatTile>` kv rule; this class only
carries state/behavior."""
from kivy.properties import StringProperty
from kivy.uix.behaviors import ToggleButtonBehavior
from kivy.uix.boxlayout import BoxLayout


class MeatTile(ToggleButtonBehavior, BoxLayout):
    meat_type = StringProperty("")
    label_text = StringProperty("")
