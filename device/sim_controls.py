"""
Simulator control panel.

A separate window beside the device screen, so the device interface remains
exactly what the real hardware shows while every scenario is driven from
here.

Laid out in the order of the inspection process, so the panel reads as a
walkthrough: place a sample, watch detection, interrupt it if you want to,
choose how the upload behaves, then ventilate. The event log records what
the device did at each step.

Simulation only. None of this exists on the real device.
"""

from __future__ import annotations

import time
import tkinter as tk

from submission import Transport

# Dark, so it is never mistaken for the device screen.
BG = "#1a1a17"
CARD = "#242420"
LINE = "#33332c"
FG = "#eceae3"
DIM = "#8f8d84"
STEP = "#f5adc3"
OK = "#8fbf63"
WARN = "#e0a44a"
BAD = "#e08b80"

F = "DejaVu Sans"
FM = "DejaVu Sans Mono"


class SimTransport(Transport):
    """Upload behaviour, selected from the panel."""

    def __init__(self):
        self.mode = "success"

    def send(self, payload):
        if self.mode == "network":
            return False, False, "network unreachable"
        if self.mode == "reject":
            return False, True, "HTTP 400 rejected"
        return True, False, "delivered"


class SimPanel:
    def __init__(self, app):
        self.app = app
        self.transport = SimTransport()
        app.uploader.transport = self.transport
        app.listeners.append(self.log)

        win = tk.Toplevel(app)
        win.title("Simulator")
        win.geometry("380x640+40+40")
        win.configure(bg=BG)
        win.protocol("WM_DELETE_WINDOW", lambda: None)
        self.win = win

        self.f_step = (F, 8, "bold")
        self.f_body = (F, 9)
        self.f_small = (F, 8)
        self.f_log = (FM, 8)

        self._title()
        self._step_1()
        self._step_2()
        self._step_3()
        self._step_4()
        self._log_panel()

        self.log("Simulator ready")

    # ─── Chrome ─────────────────────────────────────────────────────────────

    def _title(self):
        bar = tk.Frame(self.win, bg=CARD, height=38)
        bar.pack(fill="x")
        bar.pack_propagate(False)
        tk.Label(bar, text="Simulator", bg=CARD, fg=FG,
                 font=(F, 11, "bold")).pack(side="left", padx=14)
        tk.Label(bar, text="device window is beside this", bg=CARD, fg=DIM,
                 font=self.f_small).pack(side="right", padx=14)

    def _step(self, number: str, title: str, note: str = "") -> tk.Frame:
        """A numbered process step containing its controls."""
        wrap = tk.Frame(self.win, bg=BG)
        wrap.pack(fill="x", padx=12, pady=(10, 0))

        head = tk.Frame(wrap, bg=BG)
        head.pack(fill="x")
        tk.Label(head, text=number, bg=BG, fg=STEP,
                 font=self.f_step).pack(side="left")
        tk.Label(head, text=title.upper(), bg=BG, fg=FG,
                 font=self.f_step).pack(side="left", padx=(6, 0))

        if note:
            tk.Label(wrap, text=note, bg=BG, fg=DIM, font=self.f_small,
                     anchor="w", justify="left",
                     wraplength=340).pack(fill="x", pady=(1, 0))

        body = tk.Frame(wrap, bg=CARD, highlightthickness=1,
                        highlightbackground=LINE)
        body.pack(fill="x", pady=(5, 0))
        return body

    def _button(self, parent, text, command, colour=FG, side="left"):
        b = tk.Button(parent, text=text, command=command,
                      bg=CARD, fg=colour, activebackground=LINE,
                      activeforeground=colour, relief="flat", bd=0,
                      font=self.f_body, padx=6, pady=6,
                      highlightthickness=0, cursor="hand2")
        b.pack(side=side, expand=True, fill="x", padx=1, pady=1)
        return b

    # ─── Step 1 ─────────────────────────────────────────────────────────────

    def _step_1(self):
        body = self._step("1", "Place a sample",
                          "The load cell detects weight and the device asks "
                          "for the meat type.")

        row = tk.Frame(body, bg=CARD)
        row.pack(fill="x")
        self._button(row, "Fresh  120 g", lambda: self._place(120, False), OK)
        self._button(row, "Spoiled  120 g", lambda: self._place(120, True), BAD)

        tk.Frame(body, bg=LINE, height=1).pack(fill="x")

        row = tk.Frame(body, bg=CARD)
        row.pack(fill="x")
        self._button(row, "Under 50 g", lambda: self._place(30, False), WARN)
        self._button(row, "Over 500 g", lambda: self._place(600, False), WARN)

    # ─── Step 2 ─────────────────────────────────────────────────────────────

    def _step_2(self):
        body = self._step("2", "Interrupt detection",
                          "Use these while a reading is running. Partial "
                          "readings are always discarded.")

        row = tk.Frame(body, bg=CARD)
        row.pack(fill="x")
        self._button(row, "Remove sample", self._remove, BAD)
        self._button(row, "Swap sample", lambda: self._place(300, False), WARN)

        tk.Frame(body, bg=LINE, height=1).pack(fill="x")

        faults = tk.Frame(body, bg=CARD)
        faults.pack(fill="x", padx=6, pady=4)
        tk.Label(faults, text="Fail a component", bg=CARD, fg=DIM,
                 font=self.f_small, anchor="w").pack(fill="x")

        grid = tk.Frame(faults, bg=CARD)
        grid.pack(fill="x")
        for label, key in [("NH₃ sensor", "nh3"), ("H₂S sensor", "h2s"),
                           ("Load cell", "loadcell"), ("ADC", "adc")]:
            self._fault_toggle(grid, label, key)

    def _fault_toggle(self, parent, label, key):
        var = tk.BooleanVar(value=False)

        def flip():
            if var.get():
                self.app.hardware.fail(key)
                self.log(f"Fault injected: {label}", BAD)
            else:
                self.app.hardware._failed.discard(key)
                self.log(f"Fault cleared: {label}", OK)

        tk.Checkbutton(parent, text=label, variable=var, command=flip,
                       bg=CARD, fg=FG, selectcolor=BG,
                       activebackground=CARD, activeforeground=FG,
                       font=self.f_small, anchor="w",
                       highlightthickness=0, bd=0,
                       ).pack(side="left", expand=True, fill="x")

    # ─── Step 3 ─────────────────────────────────────────────────────────────

    def _step_3(self):
        body = self._step("3", "Upload the record",
                          "Records are stored locally first, so a failed "
                          "upload never loses an inspection.")

        self.mode = tk.StringVar(value="success")
        for value, label, colour in [
            ("success", "Succeeds", OK),
            ("network", "Fails — no network (record queues)", WARN),
            ("reject", "Rejected by server (not retried)", BAD),
        ]:
            tk.Radiobutton(
                body, text=label, value=value, variable=self.mode,
                command=self._set_mode,
                bg=CARD, fg=colour, selectcolor=BG,
                activebackground=CARD, activeforeground=colour,
                font=self.f_small, anchor="w",
                highlightthickness=0, bd=0,
            ).pack(fill="x", padx=8, pady=1)

        tk.Frame(body, bg=LINE, height=1).pack(fill="x", pady=(4, 0))

        row = tk.Frame(body, bg=CARD)
        row.pack(fill="x")
        self._button(row, "Retry queued uploads", self._drain, STEP)

    # ─── Step 4 ─────────────────────────────────────────────────────────────

    def _step_4(self):
        body = self._step("4", "Clear the chamber",
                          "Ventilation is refused while a sample is present.")

        row = tk.Frame(body, bg=CARD)
        row.pack(fill="x")
        self._button(row, "Remove sample", self._remove, FG)

    # ─── Log ────────────────────────────────────────────────────────────────

    def _log_panel(self):
        wrap = tk.Frame(self.win, bg=BG)
        wrap.pack(fill="both", expand=True, padx=12, pady=(12, 12))

        head = tk.Frame(wrap, bg=BG)
        head.pack(fill="x")
        tk.Label(head, text="EVENT LOG", bg=BG, fg=FG,
                 font=self.f_step).pack(side="left")
        tk.Button(head, text="clear", command=self._clear_log,
                  bg=BG, fg=DIM, activebackground=BG, activeforeground=FG,
                  relief="flat", bd=0, font=self.f_small,
                  cursor="hand2").pack(side="right")

        box = tk.Frame(wrap, bg=CARD, highlightthickness=1,
                       highlightbackground=LINE)
        box.pack(fill="both", expand=True, pady=(4, 0))

        self.log_box = tk.Text(box, bg=CARD, fg=FG, font=self.f_log,
                               relief="flat", wrap="word", state="disabled",
                               padx=8, pady=6, height=8,
                               highlightthickness=0)
        scroll = tk.Scrollbar(box, command=self.log_box.yview,
                              bg=CARD, troughcolor=BG, bd=0,
                              highlightthickness=0)
        self.log_box.configure(yscrollcommand=scroll.set)
        scroll.pack(side="right", fill="y")
        self.log_box.pack(fill="both", expand=True)

        for tag, colour in [("ok", OK), ("warn", WARN), ("bad", BAD),
                            ("dim", DIM), ("step", STEP)]:
            self.log_box.tag_configure(tag, foreground=colour)
        self.log_box.tag_configure("time", foreground=DIM)

    def _clear_log(self):
        self.log_box.configure(state="normal")
        self.log_box.delete("1.0", "end")
        self.log_box.configure(state="disabled")

    def log(self, message: str, colour: str | None = None):
        tag = "dim"
        if colour == OK:
            tag = "ok"
        elif colour == WARN:
            tag = "warn"
        elif colour == BAD:
            tag = "bad"
        elif message.startswith("→"):
            tag = "step"
        elif "aborted" in message or "failed" in message.lower():
            tag = "bad"
        elif message.startswith("Result:") or message.startswith("Uploaded:"):
            tag = "ok"
        elif message.startswith("Notice:"):
            tag = "warn"
        else:
            tag = ""

        try:
            self.log_box.configure(state="normal")
            self.log_box.insert("end", time.strftime("%H:%M:%S  "), "time")
            self.log_box.insert("end", message + "\n", tag)
            self.log_box.see("end")
            self.log_box.configure(state="disabled")
        except tk.TclError:
            pass

    # ─── Actions ────────────────────────────────────────────────────────────

    def _place(self, grams, spoiled):
        self.app.hardware.place_sample(grams, spoiled)
        kind = "spoiled" if spoiled else "fresh"
        self.log(f"Sample placed: {grams} g, {kind}")

    def _remove(self):
        self.app.hardware.remove_sample()
        self.log("Sample removed")

    def _set_mode(self):
        self.transport.mode = self.mode.get()
        self.log(f"Upload set to: {self.mode.get()}")

    def _drain(self):
        sent = self.app.uploader.drain()
        pending = self.app.queue.pending_count()
        self.log(f"Retry: {sent} delivered, {pending} pending",
                 OK if pending == 0 else WARN)
        if self.app.state == "IDLE":
            self.app._render()


def attach(app) -> SimPanel:
    return SimPanel(app)
