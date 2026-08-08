"""
The detection cycle.

Sampling runs on its own thread so that redrawing the interface cannot delay
a reading. A detection period is minutes long; if sampling shared the UI
thread, the interval between readings would vary with whatever the display
happened to be doing, and an average taken at irregular intervals is harder
to defend than one taken at fixed intervals.

The thread appends to a list; the interface reads that list to show progress.
No locking beyond the GIL is required for append-and-read of a list.
"""

from __future__ import annotations

import statistics
import threading
import time
from dataclasses import dataclass, field
from enum import Enum

import config
from hardware import Hardware, HardwareError, Reading


class Outcome(Enum):
    FRESH = "Fresh"
    SPOILED = "Spoiled"
    INVALID = "Invalid"


class AbortReason(Enum):
    SAMPLE_REMOVED = "Sample removed"
    SAMPLE_CHANGED = "Sample changed during detection"
    HARDWARE_ERROR = "Sensor error"
    CANCELLED = "Cancelled"


@dataclass
class DetectionResult:
    outcome: Outcome
    nh3_ppm: float | None
    h2s_ppm: float | None
    nh3_stddev: float | None
    h2s_stddev: float | None
    reading_count: int
    sample_type: str
    reason: str | None = None
    started_at: float = 0.0
    finished_at: float = 0.0

    @property
    def is_valid(self) -> bool:
        return self.outcome is not Outcome.INVALID


@dataclass
class DetectionState:
    """Live state, read by the interface while detection runs."""
    running: bool = False
    elapsed: float = 0.0
    total: float = config.DETECTION_SECONDS
    latest: Reading | None = None
    readings: list[Reading] = field(default_factory=list)
    aborted: AbortReason | None = None
    result: DetectionResult | None = None

    @property
    def progress(self) -> float:
        if self.total <= 0:
            return 1.0
        return min(1.0, self.elapsed / self.total)

    @property
    def remaining(self) -> float:
        return max(0.0, self.total - self.elapsed)


class DetectionRun:
    """
    One detection cycle.

    Aborting discards everything. A partial reading is not submitted as a
    complete one: an incomplete average recorded as final produces a wrong
    record permanently, whereas discarding costs one repeat.
    """

    def __init__(self, hardware: Hardware, sample_type: str, start_weight: float):
        self.hardware = hardware
        self.sample_type = sample_type
        self.start_weight = start_weight
        self.state = DetectionState()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        self.state.running = True
        self.state.total = config.DETECTION_SECONDS
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def cancel(self, reason: AbortReason = AbortReason.CANCELLED) -> None:
        self.state.aborted = reason
        self._stop.set()

    def _run(self) -> None:
        started = time.time()

        while not self._stop.is_set():
            elapsed = time.time() - started
            self.state.elapsed = elapsed

            if elapsed >= config.DETECTION_SECONDS:
                break

            try:
                reading = self.hardware.read_gas()
                self.state.latest = reading
                self.state.readings.append(reading)
            except HardwareError:
                self.state.aborted = AbortReason.HARDWARE_ERROR
                break

            # Sample presence is checked throughout, not only at the start.
            # Gas measured after the sample changed is not attributable to
            # the sample that was selected.
            try:
                weight = self.hardware.read_weight_grams()
                if weight < config.PRESENCE_THRESHOLD_GRAMS:
                    self.state.aborted = AbortReason.SAMPLE_REMOVED
                    break
                if abs(weight - self.start_weight) > config.WEIGHT_TOLERANCE_GRAMS:
                    self.state.aborted = AbortReason.SAMPLE_CHANGED
                    break
            except HardwareError:
                self.state.aborted = AbortReason.HARDWARE_ERROR
                break

            self._stop.wait(config.SAMPLE_INTERVAL_SECONDS)

        self.state.running = False

        if self.state.aborted is None:
            self.state.result = self._evaluate(started)

    def _evaluate(self, started: float) -> DetectionResult:
        usable = [r for r in self.state.readings if r.usable]

        def invalid(reason: str) -> DetectionResult:
            return DetectionResult(
                outcome=Outcome.INVALID,
                nh3_ppm=None, h2s_ppm=None,
                nh3_stddev=None, h2s_stddev=None,
                reading_count=len(usable),
                sample_type=self.sample_type,
                reason=reason,
                started_at=started,
                finished_at=time.time(),
            )

        if len(usable) < config.MIN_READINGS_FOR_VALID:
            # Distinguish "not calibrated" from "not enough readings". Both
            # produce unusable readings, but only one is fixed by repeating
            # the detection, and telling the operator to retry when the cause
            # is calibration wastes their time.
            from hardware import load_calibration
            cal = load_calibration()
            if not cal.get("ro_nh3") or not cal.get("ro_h2s"):
                return invalid("Sensors not calibrated")
            return invalid("Incomplete readings")

        nh3 = [r.nh3_ppm for r in usable]
        h2s = [r.h2s_ppm for r in usable]

        nh3_mean = statistics.fmean(nh3)
        h2s_mean = statistics.fmean(h2s)
        nh3_sd = statistics.stdev(nh3) if len(nh3) > 1 else 0.0
        h2s_sd = statistics.stdev(h2s) if len(h2s) > 1 else 0.0

        # A reading at the sensor's range ceiling means the concentration is
        # above the range, not that it equals the ceiling. The true value is
        # unknown, so no classification is claimed.
        if nh3_mean >= config.NH3_RANGE_CEILING:
            return invalid("NH3 above sensor range")
        if h2s_mean >= config.H2S_RANGE_CEILING:
            return invalid("H2S above sensor range")

        # Stability limits are TBD; when unset, stability is not assessed
        # rather than being assumed acceptable.
        if config.MAX_STDDEV_NH3 is not None and nh3_sd > config.MAX_STDDEV_NH3:
            return invalid("NH3 readings unstable")
        if config.MAX_STDDEV_H2S is not None and h2s_sd > config.MAX_STDDEV_H2S:
            return invalid("H2S readings unstable")

        thresholds = config.THRESHOLDS.get(self.sample_type, {})
        nh3_limit = thresholds.get("nh3")
        h2s_limit = thresholds.get("h2s")

        # Without calibrated thresholds the device does not classify. It
        # reports the measurements and says the classification is
        # unavailable, rather than applying a number nobody established.
        if nh3_limit is None or h2s_limit is None:
            return DetectionResult(
                outcome=Outcome.INVALID,
                nh3_ppm=nh3_mean, h2s_ppm=h2s_mean,
                nh3_stddev=nh3_sd, h2s_stddev=h2s_sd,
                reading_count=len(usable),
                sample_type=self.sample_type,
                reason="Thresholds not calibrated",
                started_at=started,
                finished_at=time.time(),
            )

        spoiled = nh3_mean >= nh3_limit or h2s_mean >= h2s_limit

        return DetectionResult(
            outcome=Outcome.SPOILED if spoiled else Outcome.FRESH,
            nh3_ppm=nh3_mean, h2s_ppm=h2s_mean,
            nh3_stddev=nh3_sd, h2s_stddev=h2s_sd,
            reading_count=len(usable),
            sample_type=self.sample_type,
            started_at=started,
            finished_at=time.time(),
        )


class Calibration:
    """
    Determines Ro, the sensor's resistance in clean air.

    Ro is measured per sensor rather than taken from the datasheet: units vary
    between individual sensors, and the datasheet gives the shape of the
    sensitivity curve, not any particular sensor's baseline. Without Ro there
    is no Rs/Ro ratio and therefore no ppm.
    """

    def __init__(self, hardware: Hardware, which: str):
        self.hardware = hardware
        self.which = which           # 'nh3' or 'h2s'
        self.running = False
        self.phase = "warmup"
        self.elapsed = 0.0
        self.samples: list[int] = []
        self.ro: float | None = None
        self.error: str | None = None
        self._stop = threading.Event()

    def start(self) -> None:
        self.running = True
        threading.Thread(target=self._run, daemon=True).start()

    def cancel(self) -> None:
        self._stop.set()

    def _run(self) -> None:
        started = time.time()

        while not self._stop.is_set():
            self.elapsed = time.time() - started
            if self.elapsed >= config.CALIBRATION_WARMUP_SECONDS:
                break
            self._stop.wait(0.5)

        if self._stop.is_set():
            self.running = False
            return

        self.phase = "sampling"

        while len(self.samples) < config.CALIBRATION_SAMPLE_COUNT:
            if self._stop.is_set():
                self.running = False
                return
            try:
                nh3_raw, h2s_raw = self.hardware.read_raw()
            except HardwareError as e:
                self.error = str(e)
                self.running = False
                return
            self.samples.append(nh3_raw if self.which == "nh3" else h2s_raw)
            self._stop.wait(0.1)

        mean_raw = statistics.fmean(self.samples)
        from hardware import adc_to_voltage, voltage_to_rs, load_calibration, save_calibration

        rl = config.RL_NH3 if self.which == "nh3" else config.RL_H2S
        ratio = (config.NH3_CLEAN_AIR_RATIO if self.which == "nh3"
                 else config.H2S_CLEAN_AIR_RATIO)

        rs = voltage_to_rs(adc_to_voltage(mean_raw), rl)
        if rs is None:
            self.error = "Sensor at rail; cannot calibrate"
            self.running = False
            return

        self.ro = rs / ratio

        cal = load_calibration()
        cal[f"ro_{self.which}"] = self.ro
        cal[f"ro_{self.which}_at"] = time.time()
        save_calibration(cal)

        self.phase = "done"
        self.running = False


class VentOutcome(Enum):
    CLEARED = "Cleared"
    TIMED_OUT = "Timed out"
    FAULT = "Sensor error"
    CANCELLED = "Cancelled"


@dataclass
class VentilationState:
    """Live state, read by the interface while ventilation runs."""
    running: bool = False
    elapsed: float = 0.0
    nh3_ratio: float | None = None
    h2s_ratio: float | None = None
    in_band: bool = False
    held: float = 0.0
    outcome: VentOutcome | None = None

    @property
    def target_text(self) -> str:
        # Expressed against the NH3 target; both sensors use the same
        # fractional tolerance around their own clean-air ratio.
        t = config.NH3_CLEAN_AIR_RATIO
        return f"{t * (1 - config.CLEAR_TOLERANCE):.1f}–" \
               f"{t * (1 + config.CLEAR_TOLERANCE):.1f}"


class VentilationRun:
    """
    Purges the chamber until the sensors return to their calibrated
    clean-air baseline.

    Runs on a background thread for the same reason detection does: polling
    on the interface thread would make the check interval depend on redraw
    timing.

    The stop condition is Rs/Ro returning to the sensor's clean-air ratio,
    held continuously for CLEAR_HOLD_SECONDS, after at least
    VENT_MIN_SECONDS. Falling outside the band resets the hold, so a cycle
    cannot end on a momentary dip into tolerance.

    Note the target is the datasheet clean-air ratio, NOT 1.0. Ro is defined
    as the clean-air resistance divided by that ratio, so a sensor sitting in
    clean air reads Rs/Ro equal to the ratio itself.

    Clearance is verified AT THE SENSOR. Residue on the chamber walls may
    continue releasing gas while air at the sensor reads clean.
    """

    def __init__(self, hardware: Hardware):
        self.hardware = hardware
        self.state = VentilationState()
        self._stop = threading.Event()

    def start(self) -> None:
        self.state.running = True
        threading.Thread(target=self._run, daemon=True).start()

    def cancel(self) -> None:
        self.state.outcome = VentOutcome.CANCELLED
        self._stop.set()

    def _ratios(self) -> tuple[float | None, float | None]:
        """
        Rs/Ro for each sensor, or None where it cannot be computed.

        Recovered from the raw counts rather than from ppm, because the
        condition is about returning to baseline, and expressing that as a
        ratio avoids depending on the power-law curve constants — which are
        themselves TBD.
        """
        from hardware import adc_to_voltage, voltage_to_rs, load_calibration

        cal = load_calibration()
        nh3_raw, h2s_raw = self.hardware.read_raw()

        def ratio(raw, rl, ro_key):
            ro = cal.get(ro_key)
            if not ro:
                return None
            rs = voltage_to_rs(adc_to_voltage(raw), rl)
            if rs is None:
                return None
            return rs / ro

        return (ratio(nh3_raw, config.RL_NH3, "ro_nh3"),
                ratio(h2s_raw, config.RL_H2S, "ro_h2s"))

    def _run(self) -> None:
        started = time.time()
        self.hardware.set_fan(True)

        try:
            while not self._stop.is_set():
                elapsed = time.time() - started
                self.state.elapsed = elapsed

                if elapsed >= config.VENT_TIMEOUT_SECONDS:
                    self.state.outcome = VentOutcome.TIMED_OUT
                    break

                try:
                    nh3, h2s = self._ratios()
                except HardwareError:
                    self.state.outcome = VentOutcome.FAULT
                    break

                self.state.nh3_ratio = nh3
                self.state.h2s_ratio = h2s

                # Both sensors must be inside the band. A ratio that cannot
                # be computed counts as outside it: an unknown reading is not
                # evidence the chamber is clear.
                def inside(r, target):
                    if r is None:
                        return False
                    return abs(r - target) <= target * config.CLEAR_TOLERANCE

                if (inside(nh3, config.NH3_CLEAN_AIR_RATIO)
                        and inside(h2s, config.H2S_CLEAN_AIR_RATIO)):
                    self.state.held += config.VENT_POLL_SECONDS
                    self.state.in_band = True
                else:
                    # Falling outside resets the hold, so a momentary dip
                    # into tolerance cannot end the cycle.
                    self.state.held = 0.0
                    self.state.in_band = False

                if (self.state.held >= config.CLEAR_HOLD_SECONDS
                        and elapsed >= config.VENT_MIN_SECONDS):
                    self.state.outcome = VentOutcome.CLEARED
                    break

                self._stop.wait(config.VENT_POLL_SECONDS)
        finally:
            self.hardware.set_fan(False)
            self.state.running = False
