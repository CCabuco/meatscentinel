"""
MeatScentinel device interface.

Tkinter, sized for the 3.5 inch touchscreen. Touch targets are sized for
fingers.

The interface polls; it does not drive. Detection runs on its own thread and
this reads its state, so a slow redraw cannot delay a reading.

Run:  python app.py
Simulated hardware is used unless config.SIMULATE_HARDWARE is False.
"""

from __future__ import annotations

import time
import tkinter as tk
from tkinter import font as tkfont

import config
from detection import (AbortReason, Calibration, DetectionRun, Outcome,
                       VentilationRun, VentOutcome)
from hardware import HardwareError, create_hardware, load_calibration
from submission import Queue, Submission, Uploader, create_transport, make_inspection_id

# ─── Palette ────────────────────────────────────────────────────────────────

BG = "#faf9f5"
CARD = "#ffffff"
SUNKEN = "#f2f0ea"
LINE = "#e3e1d9"
INK = "#1c1c1a"
MUTED = "#5f5e5a"
FAINT = "#95938c"
BRAND = "#b62b54"
BRAND_DARK = "#912243"
BRAND_TINT = "#fcedf2"
FRESH = "#3b6d11"
FRESH_TINT = "#eaf3de"
SPOILED = "#a32d2d"
SPOILED_TINT = "#fcebeb"
REVIEW = "#854f0b"
REVIEW_TINT = "#faeeda"

POLL_MS = 200


class DeviceApp(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("MeatScentinel")
        self.geometry(f"{config.SCREEN_WIDTH}x{config.SCREEN_HEIGHT}")
        self.configure(bg=BG)
        self.resizable(False, False)
        if config.FULLSCREEN:
            self.attributes("-fullscreen", True)

        self.f_huge = tkfont.Font(family="DejaVu Sans", size=30, weight="bold")
        self.f_big = tkfont.Font(family="DejaVu Sans", size=16, weight="bold")
        self.f_med = tkfont.Font(family="DejaVu Sans", size=11)
        self.f_label = tkfont.Font(family="DejaVu Sans", size=8, weight="bold")
        self.f_small = tkfont.Font(family="DejaVu Sans", size=9)
        self.f_mono = tkfont.Font(family="DejaVu Sans Mono", size=13)
        self.f_mono_s = tkfont.Font(family="DejaVu Sans Mono", size=9)

        self.hardware = create_hardware()
        self.queue = Queue()
        self.uploader = Uploader(self.queue, create_transport())

        self.run: DetectionRun | None = None
        self.calibration: Calibration | None = None
        self.last_result = None
        self.sample_type: str | None = None
        self.needs_ventilation = False
        self.fault_message: str | None = None
        self.started_at = time.time()
        self._press_started: float | None = None
        self.vent: VentilationRun | None = None
        self.last_vent_seconds: float | None = None
        self.last_vent_outcome: str | None = None

        self.container = tk.Frame(self, bg=BG)
        self.container.pack(fill="both", expand=True)

        # Anything (the simulator panel) can subscribe to device events.
        self.listeners: list = []

        self.state = "BOOT"
        self._render()
        self.after(POLL_MS, self._tick)

    # ─── State ──────────────────────────────────────────────────────────────

    def emit(self, message: str) -> None:
        for listener in self.listeners:
            try:
                listener(message)
            except Exception:
                pass

    def go(self, state: str) -> None:
        if state != self.state:
            self.emit(f"→ {state}")
        self.state = state
        self._render()

    def _clear(self) -> None:
        for w in self.container.winfo_children():
            w.destroy()

    def _render(self) -> None:
        self._clear()
        getattr(self, f"_screen_{self.state.lower()}")()

    def _tick(self) -> None:
        try:
            self._poll()
        except Exception as e:
            self.fault_message = str(e)
            self.go("FAULT")
        self.after(POLL_MS, self._tick)

    def _poll(self) -> None:
        if self.state == "IDLE":
            try:
                weight = self.hardware.read_weight_grams()
            except HardwareError as e:
                self.fault_message = str(e)
                self.go("FAULT")
                return
            if weight >= config.PRESENCE_THRESHOLD_GRAMS and not self.needs_ventilation:
                self.emit(f"Weight detected: {weight:.0f} g")
                self.go("SELECT_TYPE")

        elif self.state == "DETECTING" and self.run:
            if self.run.state.running:
                self._update_detecting()
            elif self.run.state.aborted:
                reason = self.run.state.aborted.value
                self.emit(f"Detection aborted: {reason} — partial readings discarded")
                if self.run.state.aborted is AbortReason.HARDWARE_ERROR:
                    # A dead sensor is not a per-sample problem. Returning to
                    # IDLE would immediately re-prompt an inspection that the
                    # hardware cannot perform.
                    self.fault_message = "A sensor stopped responding during detection."
                    self.go("FAULT")
                else:
                    self.go("IDLE")
                    self._toast(f"Detection cancelled — {reason.lower()}")
            else:
                self.last_result = self.run.state.result
                r = self.last_result
                if r.is_valid:
                    self.emit(f"Result: {r.outcome.value}  "
                              f"NH3 {r.nh3_ppm:.1f} ppm, H2S {r.h2s_ppm:.1f} ppm "
                              f"({r.reading_count} readings)")
                else:
                    self.emit(f"Result: INVALID — {r.reason}")
                self.needs_ventilation = True
                self.go("RESULT")

        elif self.state == "VENTILATING" and self.vent:
            if self.vent.state.running:
                self._update_ventilating()
            else:
                self._finish_ventilation()

        elif self.state == "SETTINGS" and self.calibration:
            self._update_calibration()

    # ─── Widgets ────────────────────────────────────────────────────────────

    def _header(self, parent, text: str, step: str = "") -> None:
        bar = tk.Frame(parent, bg=BRAND, height=34)
        bar.pack(fill="x")
        bar.pack_propagate(False)
        tk.Label(bar, text="MEATSCENTINEL", bg=BRAND, fg="#f5adc3",
                 font=self.f_label).pack(side="left", padx=12)
        tk.Label(bar, text=text, bg=BRAND, fg="#ffffff",
                 font=self.f_med).pack(side="right", padx=12)
        if step:
            tk.Label(bar, text=step, bg=BRAND, fg="#f5adc3",
                     font=self.f_label).pack(side="right")

    def _field(self, parent, label: str, value: str, colour=INK, mono=False):
        """A labelled value. Used wherever a reading is shown."""
        w = tk.Frame(parent, bg=parent["bg"])
        w.pack(fill="x", pady=1)
        tk.Label(w, text=label, bg=parent["bg"], fg=FAINT,
                 font=self.f_label).pack(side="left")
        tk.Label(w, text=value, bg=parent["bg"], fg=colour,
                 font=self.f_mono if mono else self.f_small).pack(side="right")

    def _button(self, parent, text, command, primary=True, height=2):
        return tk.Button(
            parent, text=text, command=command,
            bg=BRAND if primary else CARD,
            fg="#ffffff" if primary else INK,
            activebackground=BRAND_DARK if primary else BG,
            activeforeground="#ffffff" if primary else INK,
            font=self.f_big if primary else self.f_med,
            relief="flat", bd=0, height=height,
            highlightthickness=0 if primary else 1,
            highlightbackground=LINE,
        )

    # ─── BOOT ───────────────────────────────────────────────────────────────

    def _screen_boot(self) -> None:
        f = tk.Frame(self.container, bg=BG)
        f.pack(fill="both", expand=True)

        tk.Label(f, text="MeatScentinel", bg=BG, fg=INK,
                 font=self.f_big).pack(pady=(60, 4))
        status = tk.Label(f, text="Starting…", bg=BG, fg=MUTED, font=self.f_med)
        status.pack()

        def check():
            problems = self.hardware.self_test()

            cal = load_calibration()
            if not cal.get("ro_nh3") or not cal.get("ro_h2s"):
                problems.append("Sensors not calibrated")

            if problems:
                self.fault_message = "\n".join(problems)
                self.go("FAULT")
            else:
                self.go("IDLE")

        self.after(700, check)

    # ─── IDLE ───────────────────────────────────────────────────────────────

    def _screen_idle(self) -> None:
        f = tk.Frame(self.container, bg=BG)
        f.pack(fill="both", expand=True)
        f.bind("<ButtonPress-1>", self._press_down)
        f.bind("<ButtonRelease-1>", self._press_up)

        self._header(f, "Ready" if not self.needs_ventilation else "Chamber")

        body = tk.Frame(f, bg=BG)
        body.pack(fill="both", expand=True)

        centre = tk.Frame(body, bg=BG)
        centre.place(relx=0.5, rely=0.45, anchor="center")

        if self.needs_ventilation:
            tk.Label(centre, text="VENTILATION REQUIRED", bg=REVIEW_TINT,
                     fg=REVIEW, font=self.f_label,
                     padx=10, pady=4).pack()
            tk.Label(centre, text="Clear the chamber", bg=BG, fg=INK,
                     font=self.f_big).pack(pady=(10, 2))
            tk.Label(centre, text="Residual gas would carry into the next reading",
                     bg=BG, fg=MUTED, font=self.f_small).pack()
            tk.Button(centre, text="Ventilate",
                      command=lambda: self.go("VENTILATING"),
                      bg=BRAND, fg="#ffffff", activebackground=BRAND_DARK,
                      activeforeground="#ffffff", font=self.f_med,
                      relief="flat", bd=0, padx=28, pady=8,
                      highlightthickness=0).pack(pady=(12, 0))
        else:
            tk.Label(centre, text="READY", bg=FRESH_TINT, fg=FRESH,
                     font=self.f_label, padx=10, pady=4).pack()
            tk.Label(centre, text="Place a sample", bg=BG, fg=INK,
                     font=self.f_huge).pack(pady=(8, 0))
            tk.Label(centre, text="Detection begins once weight is detected",
                     bg=BG, fg=MUTED, font=self.f_small).pack()

        self._status_bar(f)

    def _status_bar(self, parent) -> None:
        tk.Frame(parent, bg=LINE, height=1).pack(fill="x", side="bottom")
        bar = tk.Frame(parent, bg=SUNKEN, height=24)
        bar.pack(fill="x", side="bottom")
        bar.pack_propagate(False)

        pending = self.queue.pending_count()
        online = bool(config.SUBMIT_ENDPOINT) or not config.SIMULATE_HARDWARE

        tk.Label(bar, text=config.DEVICE_ID, bg=SUNKEN, fg=FAINT,
                 font=self.f_mono_s).pack(side="left", padx=10)

        if pending:
            colour = REVIEW if pending >= config.QUEUE_WARNING_DEPTH else FAINT
            tk.Label(bar, text=f"{pending} queued", bg=SUNKEN, fg=colour,
                     font=self.f_small).pack(side="right", padx=10)

        tk.Label(bar, text="\u25cf", bg=SUNKEN,
                 fg=FRESH if online else FAINT,
                 font=self.f_small).pack(side="right")
        tk.Label(bar, text="Online" if online else "Offline",
                 bg=SUNKEN, fg=FAINT,
                 font=self.f_small).pack(side="right", padx=(10, 3))

    def _press_down(self, _event) -> None:
        self._press_started = time.time()

    def _press_up(self, _event) -> None:
        if (self._press_started
                and time.time() - self._press_started >= config.LONG_PRESS_SECONDS):
            self.go("SETTINGS")
        self._press_started = None

    # ─── SELECT_TYPE ────────────────────────────────────────────────────────

    def _screen_select_type(self) -> None:
        f = tk.Frame(self.container, bg=BG)
        f.pack(fill="both", expand=True)
        self._header(f, "Sample type", "STEP 1")

        body = tk.Frame(f, bg=BG)
        body.pack(fill="both", expand=True, padx=18, pady=(12, 8))

        try:
            weight = self.hardware.read_weight_grams()
            tk.Label(body, text=f"{weight:.0f} g in chamber", bg=BG, fg=MUTED,
                     font=self.f_small).pack(pady=(0, 8))
        except HardwareError:
            pass

        for key in config.SAMPLE_TYPES:
            b = tk.Button(
                body, text=config.SAMPLE_TYPE_LABELS[key],
                command=lambda k=key: self._begin(k),
                bg=CARD, fg=INK, activebackground=BRAND_TINT,
                activeforeground=BRAND_DARK, font=self.f_med,
                relief="flat", bd=0, pady=9,
                highlightthickness=1, highlightbackground=LINE,
                highlightcolor=LINE, cursor="hand2")
            b.pack(fill="x", pady=3)

        tk.Label(body, text="Thresholds differ by meat type",
                 bg=BG, fg=FAINT, font=self.f_small).pack(pady=(8, 0))

    def _begin(self, sample_type: str) -> None:
        try:
            weight = self.hardware.read_weight_grams()
        except HardwareError as e:
            self.fault_message = str(e)
            self.go("FAULT")
            return

        if weight < config.MIN_SAMPLE_GRAMS:
            self._toast(f"Sample too small (minimum {config.MIN_SAMPLE_GRAMS} g)")
            return
        if weight > config.MAX_SAMPLE_GRAMS:
            self._toast(f"Sample too large (maximum {config.MAX_SAMPLE_GRAMS} g)")
            return

        self.sample_type = sample_type
        self.emit(f"Detection started: {sample_type}, {weight:.0f} g, "
                  f"{config.DETECTION_SECONDS:.0f} s")
        self.run = DetectionRun(self.hardware, sample_type, weight)
        self.run.start()
        self.go("DETECTING")

    def _toast(self, message: str) -> None:
        self.emit(f"Notice: {message}")
        t = tk.Label(self.container, text=message, bg=REVIEW, fg="#ffffff",
                     font=self.f_small, padx=10, pady=6)
        t.place(relx=0.5, rely=0.88, anchor="center")
        self.after(2200, t.destroy)

    # ─── DETECTING ──────────────────────────────────────────────────────────

    def _screen_detecting(self) -> None:
        f = tk.Frame(self.container, bg=BG)
        f.pack(fill="both", expand=True)
        self._header(f, config.SAMPLE_TYPE_LABELS.get(self.sample_type, ""),
                     "STEP 2")

        body = tk.Frame(f, bg=BG)
        body.pack(fill="both", expand=True, padx=22)

        tk.Label(body, text="DETECTING", bg=BG, fg=BRAND,
                 font=self.f_label).pack(pady=(22, 4))

        self._countdown = tk.Label(body, text="", bg=BG, fg=INK,
                                   font=self.f_huge)
        self._countdown.pack()

        tk.Label(body, text="seconds remaining", bg=BG, fg=FAINT,
                 font=self.f_small).pack()

        track = tk.Frame(body, bg=LINE, height=6)
        track.pack(fill="x", pady=(14, 12))
        track.pack_propagate(False)
        self._bar = tk.Frame(track, bg=BRAND, height=6)
        self._bar.place(x=0, y=0, relwidth=0, relheight=1)

        if config.SHOW_LIVE_VALUES:
            card = tk.Frame(body, bg=CARD, highlightthickness=1,
                            highlightbackground=LINE)
            card.pack(fill="x")
            inner = tk.Frame(card, bg=CARD)
            inner.pack(fill="x", padx=12, pady=7)
            self._live_nh3 = tk.Label(inner, text="NH\u2083  \u2014",
                                      bg=CARD, fg=INK, font=self.f_mono)
            self._live_nh3.pack(anchor="w")
            self._live_h2s = tk.Label(inner, text="H\u2082S  \u2014",
                                      bg=CARD, fg=INK, font=self.f_mono)
            self._live_h2s.pack(anchor="w")
            self._live_n = tk.Label(inner, text="", bg=CARD, fg=FAINT,
                                    font=self.f_small)
            self._live_n.pack(anchor="w", pady=(3, 0))

    def _update_detecting(self) -> None:
        """
        Reconfigures existing labels rather than rebuilding widgets. Called
        five times a second; recreating widgets at that rate is what makes a
        Tk interface feel heavy on a Pi.
        """
        if not self.run or not hasattr(self, "_bar"):
            return
        st = self.run.state
        try:
            self._bar.place_configure(relwidth=st.progress)
            self._countdown.config(text=f"{int(st.remaining)}")

            if config.SHOW_LIVE_VALUES and st.latest and hasattr(self, "_live_nh3"):
                nh3 = st.latest.nh3_ppm
                h2s = st.latest.h2s_ppm
                self._live_nh3.config(
                    text=f"NH\u2083  {nh3:6.1f} ppm" if nh3 is not None
                    else "NH\u2083     \u2014")
                self._live_h2s.config(
                    text=f"H\u2082S  {h2s:6.1f} ppm" if h2s is not None
                    else "H\u2082S     \u2014")
                self._live_n.config(text=f"{len(st.readings)} readings averaged")
        except tk.TclError:
            pass

    # ─── RESULT ─────────────────────────────────────────────────────────────

    def _screen_result(self) -> None:
        f = tk.Frame(self.container, bg=BG)
        f.pack(fill="both", expand=True)
        self._header(f, config.SAMPLE_TYPE_LABELS.get(self.sample_type, ""),
                     "STEP 3")

        body = tk.Frame(f, bg=BG)
        body.pack(fill="both", expand=True, padx=18, pady=(10, 8))

        r = self.last_result
        if r is None:
            tk.Label(body, text="No result", bg=BG, fg=MUTED,
                     font=self.f_big).pack(pady=40)
            return

        if r.outcome is Outcome.FRESH:
            text, colour, tint = "FRESH", FRESH, FRESH_TINT
        elif r.outcome is Outcome.SPOILED:
            text, colour, tint = "SPOILED", SPOILED, SPOILED_TINT
        else:
            text, colour, tint = "INVALID READING", REVIEW, REVIEW_TINT

        banner = tk.Frame(body, bg=tint)
        banner.pack(fill="x")
        tk.Label(banner, text=text, bg=tint, fg=colour,
                 font=self.f_huge if r.is_valid else self.f_big).pack(pady=9)

        if r.reason:
            tk.Label(body, text=r.reason, bg=BG, fg=MUTED,
                     font=self.f_small).pack(pady=(5, 0))

        card = tk.Frame(body, bg=CARD, highlightthickness=1,
                        highlightbackground=LINE)
        card.pack(fill="x", pady=8)
        inner = tk.Frame(card, bg=CARD)
        inner.pack(fill="x", padx=12, pady=8)

        nh3 = f"{r.nh3_ppm:.1f} ppm" if r.nh3_ppm is not None else "\u2014"
        h2s = f"{r.h2s_ppm:.1f} ppm" if r.h2s_ppm is not None else "\u2014"

        self._field(inner, "NH\u2083 AVERAGE", nh3, mono=True)
        self._field(inner, "H\u2082S AVERAGE", h2s, mono=True)
        self._field(inner, "READINGS", str(r.reading_count))

        tk.Button(body, text="Continue", command=self._upload,
                  bg=BRAND, fg="#ffffff", activebackground=BRAND_DARK,
                  activeforeground="#ffffff", font=self.f_med,
                  relief="flat", bd=0, pady=8,
                  highlightthickness=0, cursor="hand2").pack(fill="x")

    def _upload(self) -> None:
        self.go("UPLOADING")

    # ─── UPLOADING ──────────────────────────────────────────────────────────

    def _screen_uploading(self) -> None:
        f = tk.Frame(self.container, bg=BG)
        f.pack(fill="both", expand=True)
        self._header(f, "Upload", "STEP 4")

        body = tk.Frame(f, bg=BG)
        body.pack(fill="both", expand=True, padx=18)

        centre = tk.Frame(body, bg=BG)
        centre.place(relx=0.5, rely=0.42, anchor="center")

        badge = tk.Label(centre, text="SENDING", bg=BRAND_TINT, fg=BRAND,
                         font=self.f_label, padx=10, pady=4)
        badge.pack()

        status = tk.Label(centre, text="Uploading", bg=BG, fg=INK,
                          font=self.f_big)
        status.pack(pady=(8, 2))
        detail = tk.Label(centre, text="", bg=BG, fg=MUTED,
                          font=self.f_mono_s)
        detail.pack()

        def send():
            sequence = self.queue.next_sequence()
            inspection_id = make_inspection_id(config.DEVICE_ID, sequence)
            submission = Submission.from_result(
                self.last_result, config.DEVICE_ID, inspection_id)

            ok, message = self.uploader.submit(submission)

            if ok:
                self.emit(f"Uploaded: {inspection_id}")
                badge.config(text="DELIVERED", bg=FRESH_TINT, fg=FRESH)
                status.config(text="Upload successful", fg=FRESH)
                detail.config(text=inspection_id)
            else:
                # Not an error. The record is stored and will be retried.
                self.emit(f"Upload failed ({message}) \u2014 {inspection_id} "
                          "saved locally")
                badge.config(text="QUEUED", bg=REVIEW_TINT, fg=REVIEW)
                status.config(text="Saved on device", fg=REVIEW)
                detail.config(text=f"{inspection_id}\n{message}")

            tk.Button(centre, text="Done",
                      command=lambda: self.go("IDLE"),
                      bg=BRAND, fg="#ffffff", activebackground=BRAND_DARK,
                      activeforeground="#ffffff", font=self.f_med,
                      relief="flat", bd=0, padx=34, pady=7,
                      highlightthickness=0,
                      cursor="hand2").pack(pady=(14, 0))

        self.after(500, send)

    # ─── VENTILATING ────────────────────────────────────────────────────────

    def _screen_ventilating(self) -> None:
        f = tk.Frame(self.container, bg=BG)
        f.pack(fill="both", expand=True)
        self._header(f, "Ventilation", "STEP 5")

        body = tk.Frame(f, bg=BG)
        body.pack(fill="both", expand=True, padx=18)

        # Ended without clearing: the operator must decide what to do.
        if self.vent and not self.vent.state.running:
            self._vent_incomplete(body)
            return

        if self.vent is None:
            self._vent_ready(body)
        else:
            self._vent_running(body)

    def _vent_ready(self, body) -> None:
        centre = tk.Frame(body, bg=BG)
        centre.place(relx=0.5, rely=0.44, anchor="center")

        try:
            weight = self.hardware.read_weight_grams()
            present = weight >= config.PRESENCE_THRESHOLD_GRAMS
        except HardwareError:
            present = False

        tk.Label(centre, text="CHAMBER", bg=REVIEW_TINT, fg=REVIEW,
                 font=self.f_label, padx=10, pady=4).pack()
        tk.Label(centre,
                 text="Remove the sample" if present else "Ready to clear",
                 bg=BG, fg=INK, font=self.f_big).pack(pady=(8, 3))
        tk.Label(centre,
                 text="Ventilation runs until the sensors return\nto their "
                      "clean-air baseline.",
                 bg=BG, fg=MUTED, font=self.f_small,
                 justify="center").pack()

        tk.Button(centre, text="Start ventilation", command=self._start_vent,
                  bg=BRAND, fg="#ffffff", activebackground=BRAND_DARK,
                  activeforeground="#ffffff", font=self.f_med,
                  relief="flat", bd=0, padx=22, pady=8,
                  highlightthickness=0, cursor="hand2").pack(pady=(14, 0))

    def _vent_running(self, body) -> None:
        top = tk.Frame(body, bg=BG)
        top.pack(fill="x", pady=(12, 0))

        self._vent_badge = tk.Label(top, text="CLEARING", bg=BRAND_TINT,
                                    fg=BRAND, font=self.f_label,
                                    padx=10, pady=4)
        self._vent_badge.pack()

        self._vent_elapsed = tk.Label(body, text="", bg=BG, fg=INK,
                                      font=self.f_huge)
        self._vent_elapsed.pack(pady=(6, 0))
        tk.Label(body, text="seconds elapsed", bg=BG, fg=FAINT,
                 font=self.f_small).pack()

        card = tk.Frame(body, bg=CARD, highlightthickness=1,
                        highlightbackground=LINE)
        card.pack(fill="x", pady=(10, 0))
        inner = tk.Frame(card, bg=CARD)
        inner.pack(fill="x", padx=12, pady=7)

        self._vent_nh3 = tk.Label(inner, text="", bg=CARD, fg=INK,
                                  font=self.f_mono_s)
        self._vent_nh3.pack(anchor="w")
        self._vent_h2s = tk.Label(inner, text="", bg=CARD, fg=INK,
                                  font=self.f_mono_s)
        self._vent_h2s.pack(anchor="w")
        self._vent_hold = tk.Label(inner, text="", bg=CARD, fg=FAINT,
                                   font=self.f_small)
        self._vent_hold.pack(anchor="w", pady=(3, 0))

    def _vent_incomplete(self, body) -> None:
        st = self.vent.state
        centre = tk.Frame(body, bg=BG)
        centre.place(relx=0.5, rely=0.42, anchor="center")

        tk.Label(centre, text="NOT CLEARED", bg=REVIEW_TINT, fg=REVIEW,
                 font=self.f_label, padx=10, pady=4).pack()
        tk.Label(centre, text="Chamber did not clear", bg=BG, fg=INK,
                 font=self.f_big).pack(pady=(8, 3))
        tk.Label(centre,
                 text=f"Sensors stayed outside the clean-air band for "
                      f"{st.elapsed:.0f} s.\nDetection remains blocked.",
                 bg=BG, fg=MUTED, font=self.f_small,
                 justify="center").pack()

        row = tk.Frame(centre, bg=BG)
        row.pack(pady=(14, 0))
        tk.Button(row, text="Keep clearing", command=self._resume_vent,
                  bg=BRAND, fg="#ffffff", activebackground=BRAND_DARK,
                  activeforeground="#ffffff", font=self.f_small,
                  relief="flat", bd=0, padx=18, pady=7,
                  highlightthickness=0, cursor="hand2").pack(side="left", padx=3)
        tk.Button(row, text="Back", command=self._abandon_vent,
                  bg=CARD, fg=INK, font=self.f_small, relief="flat", bd=0,
                  padx=18, pady=7, highlightthickness=1,
                  highlightbackground=LINE,
                  cursor="hand2").pack(side="left", padx=3)

    def _resume_vent(self) -> None:
        self.vent = None
        self._start_vent()

    def _abandon_vent(self) -> None:
        self.vent = None
        self.go("IDLE")

    def _start_vent(self) -> None:
        # The chamber must be empty first. Ventilating around the sample
        # clears little, and on returning to IDLE the still-present sample
        # would immediately prompt a fresh inspection of meat that has just
        # been purged — readings from which would not be comparable.
        try:
            weight = self.hardware.read_weight_grams()
        except HardwareError as e:
            self.fault_message = str(e)
            self.go("FAULT")
            return

        if weight >= config.PRESENCE_THRESHOLD_GRAMS:
            self._toast("Remove the sample before ventilating")
            return

        self.emit("Ventilation started \u2014 clearing until sensors "
                  "return to baseline")
        self.vent = VentilationRun(self.hardware)
        self.vent.start()
        self._render()

    def _finish_ventilation(self) -> None:
        st = self.vent.state
        outcome = st.outcome
        self.last_vent_seconds = st.elapsed
        self.last_vent_outcome = outcome.value if outcome else None

        if outcome is VentOutcome.CLEARED:
            self.emit(f"Chamber cleared in {st.elapsed:.0f} s")
            self.needs_ventilation = False
            self.hardware.tare()
            self.vent = None
            self.go("IDLE")
            return

        if outcome is VentOutcome.FAULT:
            self.emit("Ventilation stopped: sensor error")
            self.vent = None
            self.fault_message = "A sensor stopped responding during ventilation."
            self.go("FAULT")
            return

        # Timed out or cancelled. The condition was not met, so the chamber
        # is not marked clear and detection stays blocked. Treating a
        # timeout as success would defeat the gate.
        self.emit(f"Ventilation ended without clearing: "
                  f"{outcome.value if outcome else 'unknown'} "
                  f"after {st.elapsed:.0f} s")
        self._render()

    def _update_ventilating(self) -> None:
        """Reconfigures labels only; no widget churn while the fan runs."""
        if not self.vent or not hasattr(self, "_vent_elapsed"):
            return
        st = self.vent.state
        try:
            self._vent_elapsed.config(text=f"{int(st.elapsed)}")

            def line(name, ratio, target):
                if ratio is None:
                    return f"{name}  Rs/Ro  \u2014"
                ok = abs(ratio - target) <= target * config.CLEAR_TOLERANCE
                return f"{name}  Rs/Ro {ratio:5.2f}  {'\u2713' if ok else ' '}"

            self._vent_nh3.config(
                text=line("NH\u2083", st.nh3_ratio, config.NH3_CLEAN_AIR_RATIO))
            self._vent_h2s.config(
                text=line("H\u2082S", st.h2s_ratio, config.H2S_CLEAN_AIR_RATIO))

            if st.in_band:
                self._vent_badge.config(text="IN RANGE", bg=FRESH_TINT, fg=FRESH)
                self._vent_hold.config(
                    text=f"holding {st.held:.0f} / {config.CLEAR_HOLD_SECONDS:.0f} s"
                         f"   target {st.target_text}")
            else:
                self._vent_badge.config(text="CLEARING", bg=BRAND_TINT, fg=BRAND)
                self._vent_hold.config(text=f"target Rs/Ro {st.target_text}")
        except tk.TclError:
            pass

    # ─── SETTINGS ───────────────────────────────────────────────────────────

    def _screen_settings(self) -> None:
        f = tk.Frame(self.container, bg=BG)
        f.pack(fill="both", expand=True)
        self._header(f, "Settings")

        body = tk.Frame(f, bg=BG)
        body.pack(fill="both", expand=True, padx=16, pady=10)

        cal = load_calibration()
        ro_nh3 = cal.get("ro_nh3")
        ro_h2s = cal.get("ro_h2s")

        card = tk.Frame(body, bg=CARD, highlightthickness=1,
                        highlightbackground=LINE)
        card.pack(fill="x")
        inner = tk.Frame(card, bg=CARD)
        inner.pack(fill="x", padx=12, pady=8)

        self._field(inner, "Ro \u00b7 NH\u2083",
                    f"{ro_nh3/1000:.2f} k\u03a9" if ro_nh3 else "not set",
                    INK if ro_nh3 else REVIEW)
        self._field(inner, "Ro \u00b7 H\u2082S",
                    f"{ro_h2s/1000:.2f} k\u03a9" if ro_h2s else "not set",
                    INK if ro_h2s else REVIEW)
        self._field(inner, "DEVICE", config.DEVICE_ID)
        self._field(inner, "QUEUED", str(self.queue.pending_count()))

        if self.calibration and self.calibration.running:
            prog = tk.Frame(body, bg=BRAND_TINT)
            prog.pack(fill="x", pady=(10, 0))
            self._cal_label = tk.Label(prog, text="", bg=BRAND_TINT, fg=BRAND,
                                       font=self.f_small, justify="center")
            self._cal_label.pack(pady=8)
            tk.Button(body, text="Cancel", command=self._cancel_calibration,
                      bg=CARD, fg=INK, font=self.f_small, relief="flat",
                      bd=0, pady=6, highlightthickness=1,
                      highlightbackground=LINE,
                      cursor="hand2").pack(fill="x", pady=(6, 0))
            return

        tk.Label(body, text="Calibrate with the chamber empty in clean air",
                 bg=BG, fg=FAINT, font=self.f_small).pack(pady=(10, 4))

        row = tk.Frame(body, bg=BG)
        row.pack(fill="x")
        for label, which in [("Calibrate NH\u2083", "nh3"),
                             ("Calibrate H\u2082S", "h2s")]:
            tk.Button(row, text=label,
                      command=lambda w=which: self._calibrate(w),
                      bg=CARD, fg=INK, activebackground=BRAND_TINT,
                      activeforeground=BRAND_DARK, font=self.f_small,
                      relief="flat", bd=0, pady=7, highlightthickness=1,
                      highlightbackground=LINE, cursor="hand2"
                      ).pack(side="left", expand=True, fill="x", padx=2)

        tk.Button(body, text="Back", command=lambda: self.go("IDLE"),
                  bg=BRAND, fg="#ffffff", activebackground=BRAND_DARK,
                  activeforeground="#ffffff", font=self.f_med, relief="flat",
                  bd=0, pady=7, highlightthickness=0,
                  cursor="hand2").pack(fill="x", pady=(10, 0))

    def _calibrate(self, which: str) -> None:
        self.calibration = Calibration(self.hardware, which)
        self.calibration.start()
        self._render()

    def _cancel_calibration(self) -> None:
        if self.calibration:
            self.calibration.cancel()
        self.calibration = None
        self._render()

    def _update_calibration(self) -> None:
        c = self.calibration
        if not c or not hasattr(self, "_cal_label"):
            return
        try:
            if c.phase == "warmup":
                left = max(0, config.CALIBRATION_WARMUP_SECONDS - c.elapsed)
                self._cal_label.config(
                    text=f"Warming up · {int(left)} s\nChamber must be empty")
            elif c.phase == "sampling":
                self._cal_label.config(
                    text=f"Sampling clean air · "
                         f"{len(c.samples)}/{config.CALIBRATION_SAMPLE_COUNT}")
        except tk.TclError:
            pass

        if not c.running:
            self.calibration = None
            self._render()

    # ─── FAULT ──────────────────────────────────────────────────────────────

    def _screen_fault(self) -> None:
        f = tk.Frame(self.container, bg=BG)
        f.pack(fill="both", expand=True)
        self._header(f, "Fault")

        body = tk.Frame(f, bg=BG)
        body.pack(fill="both", expand=True, padx=20)

        centre = tk.Frame(body, bg=BG)
        centre.place(relx=0.5, rely=0.42, anchor="center")

        tk.Label(centre, text="CANNOT PROCEED", bg=SPOILED_TINT, fg=SPOILED,
                 font=self.f_label, padx=10, pady=4).pack()
        tk.Label(centre, text=self.fault_message or "Unknown fault",
                 bg=BG, fg=INK, font=self.f_med,
                 wraplength=360, justify="center").pack(pady=(10, 0))
        tk.Label(centre, text="Detection is blocked until this is resolved",
                 bg=BG, fg=FAINT, font=self.f_small).pack(pady=(4, 0))

        row = tk.Frame(centre, bg=BG)
        row.pack(pady=(16, 0))
        tk.Button(row, text="Settings", command=lambda: self.go("SETTINGS"),
                  bg=CARD, fg=INK, font=self.f_small, relief="flat", bd=0,
                  padx=18, pady=7, highlightthickness=1,
                  highlightbackground=LINE,
                  cursor="hand2").pack(side="left", padx=3)
        tk.Button(row, text="Retry", command=self._retry_boot,
                  bg=BRAND, fg="#ffffff", activebackground=BRAND_DARK,
                  activeforeground="#ffffff", font=self.f_small,
                  relief="flat", bd=0, padx=22, pady=7,
                  highlightthickness=0,
                  cursor="hand2").pack(side="left", padx=3)

    def _retry_boot(self) -> None:
        self.fault_message = None
        self.go("BOOT")


def main() -> None:
    app = DeviceApp()
    try:
        app.mainloop()
    finally:
        app.hardware.close()


if __name__ == "__main__":
    main()
