"""
Hardware access, behind an interface.

The interface exists so the application can be built and demonstrated before
the sensors are assembled, and so swapping simulated hardware for real
hardware is a single change in config rather than an edit across the
application.

Two implementations:

    SimulatedHardware  — no hardware required
    Mcp3008Hardware    — MCP3008 ADC and HX711 load cell

The real implementation is written but UNTESTED. It cannot be verified until
the hardware is assembled. Its failure detection in particular is guesswork
until the actual failure signatures are observed.
"""

from __future__ import annotations

import json
import math
import os
import random
import time
from dataclasses import dataclass

import config


@dataclass
class Reading:
    """One sample from both gas sensors."""
    nh3_ppm: float | None
    h2s_ppm: float | None
    nh3_raw: int
    h2s_raw: int
    at: float

    @property
    def usable(self) -> bool:
        return self.nh3_ppm is not None and self.h2s_ppm is not None


class HardwareError(Exception):
    """Hardware is not responding or is returning implausible values."""


class NotCalibrated(Exception):
    """No Ro stored, so ppm cannot be computed."""


# ─── Calibration storage ────────────────────────────────────────────────────

def load_calibration() -> dict:
    """Stored Ro values, or an empty dict if never calibrated."""
    if not os.path.exists(config.CALIBRATION_PATH):
        return {}
    try:
        with open(config.CALIBRATION_PATH) as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        # A corrupt calibration file is the same as none: the device must not
        # proceed on a value it cannot read.
        return {}


def save_calibration(data: dict) -> None:
    with open(config.CALIBRATION_PATH, "w") as f:
        json.dump(data, f, indent=2)


# ─── Conversion ─────────────────────────────────────────────────────────────

def adc_to_voltage(raw: int, vref: float = 3.3, bits: int = 10) -> float:
    return (raw / ((1 << bits) - 1)) * vref


def voltage_to_rs(voltage: float, rl: float, vc: float = 5.0) -> float | None:
    """
    Sensor resistance from the divider output.

    Returns None where the voltage is at either rail: at 0 V the sensor
    resistance is unbounded, and at Vc it is zero. Neither is a real
    measurement, and returning a number for them would invent data.
    """
    if voltage <= 0.01 or voltage >= vc - 0.01:
        return None
    return rl * (vc - voltage) / voltage


def _ppm_to_raw(ppm: float, ro: float, rl: float,
                a: float, b: float, vc: float = 5.0,
                vref: float = 3.3, bits: int = 10) -> int:
    """
    Inverse of the forward conversion, for the simulator only.

    ppm = a * (Rs/Ro) ** b   =>   Rs = Ro * (ppm/a) ** (1/b)
    """
    if ppm <= 0:
        ppm = 0.01
    ratio = math.pow(ppm / a, 1.0 / b)
    rs = ro * ratio
    voltage = vc * rl / (rs + rl)
    raw = int(round(voltage / vref * ((1 << bits) - 1)))
    return max(0, min((1 << bits) - 1, raw))


def rs_ro_to_ppm(ratio: float, a: float, b: float) -> float:
    """
    Power-law conversion fitted from the datasheet sensitivity curve.

    ppm = a * ratio ** b
    """
    if ratio <= 0:
        return 0.0
    return a * math.pow(ratio, b)


# ─── Interface ──────────────────────────────────────────────────────────────

class Hardware:
    """What the application requires of the hardware."""

    def read_gas(self) -> Reading:
        raise NotImplementedError

    def read_weight_grams(self) -> float:
        raise NotImplementedError

    def tare(self) -> None:
        raise NotImplementedError

    def set_fan(self, on: bool) -> None:
        raise NotImplementedError

    def self_test(self) -> list[str]:
        """Return a list of problems. Empty means everything responded."""
        raise NotImplementedError

    def read_raw(self) -> tuple[int, int]:
        """Raw ADC counts, for calibration."""
        raise NotImplementedError

    def close(self) -> None:
        pass


# ─── Simulated ──────────────────────────────────────────────────────────────

class SimulatedHardware(Hardware):
    """
    Simulated sensors, so the interface can be developed without hardware.

    Gas readings rise over the life of a detection cycle in the way spoilage
    gas accumulates in a sealed chamber, with noise, so that the detection and
    result screens are exercised against varying values rather than constants.

    This is a development aid. It is not a model of meat spoilage and produces
    no findings.
    """

    def __init__(self):
        self._weight = 0.0
        self._spoiled = False
        self._fan_on = False
        self._failed = set()
        self._last = time.time()

        # Clean-air ppm derived from the curve constants and the datasheet
        # clean-air ratio, so the simulated baseline is the same point the
        # calibration procedure targets. Hard-coding a baseline instead makes
        # the simulator internally inconsistent: ventilation would aim at a
        # ratio the simulated sensor never produces.
        self._clean_nh3 = config.NH3_CURVE_A * math.pow(
            config.NH3_CLEAN_AIR_RATIO, config.NH3_CURVE_B)
        self._clean_h2s = config.H2S_CURVE_A * math.pow(
            config.H2S_CLEAN_AIR_RATIO, config.H2S_CURVE_B)

        self._nh3 = self._clean_nh3
        self._h2s = self._clean_h2s

    # Test controls, not part of the Hardware interface.

    def place_sample(self, grams: float = 120.0, spoiled: bool = False) -> None:
        self._weight = grams
        self._spoiled = spoiled

    def remove_sample(self) -> None:
        self._weight = 0.0

    def fail(self, component: str) -> None:
        """Simulate a failure: 'nh3', 'h2s', 'loadcell', or 'adc'."""
        self._failed.add(component)

    def clear_failures(self) -> None:
        self._failed.clear()

    # Interface.

    def _advance(self) -> None:
        """
        Move the simulated concentrations forward.

        Three regimes: gas accumulates while a sample sits in the chamber,
        decays back toward the clean-air baseline while the fan runs, and
        holds otherwise. Decay targets the same baseline calibration
        establishes, so a ventilation cycle can actually reach its stop
        condition.
        """
        now = time.time()
        dt = min(now - self._last, 5.0)
        self._last = now
        if dt <= 0:
            return

        if self._fan_on:
            # Exponential decay toward clean air.
            k = math.exp(-dt / 6.0)
            self._nh3 = self._clean_nh3 + (self._nh3 - self._clean_nh3) * k
            self._h2s = self._clean_h2s + (self._h2s - self._clean_h2s) * k
        elif self._weight > 0:
            # Accumulation toward a ceiling that depends on the sample.
            ceil_nh3 = self._clean_nh3 + (90 if self._spoiled else 18)
            ceil_h2s = self._clean_h2s + (40 if self._spoiled else 4)
            k = math.exp(-dt / 45.0)
            self._nh3 = ceil_nh3 + (self._nh3 - ceil_nh3) * k
            self._h2s = ceil_h2s + (self._h2s - ceil_h2s) * k

    def read_raw(self) -> tuple[int, int]:
        """
        Simulated ADC counts.

        The concentration is converted backwards through the same curve the
        application uses forwards, so the whole conversion chain is exercised
        and an error in it appears during development rather than on the
        hardware.
        """
        if "adc" in self._failed:
            raise HardwareError("ADC not responding")

        self._advance()

        nh3 = self._nh3 * random.uniform(0.98, 1.02)
        h2s = self._h2s * random.uniform(0.98, 1.02)

        nh3_raw = 0 if "nh3" in self._failed else _ppm_to_raw(
            nh3, self._ro("ro_nh3"), config.RL_NH3,
            config.NH3_CURVE_A, config.NH3_CURVE_B)
        h2s_raw = 0 if "h2s" in self._failed else _ppm_to_raw(
            h2s, self._ro("ro_h2s"), config.RL_H2S,
            config.H2S_CURVE_A, config.H2S_CURVE_B)

        return nh3_raw, h2s_raw

    @staticmethod
    def _ro(key: str) -> float:
        """
        Stored Ro, or a default consistent with the clean-air ratio.

        The default is Rs_clean divided by the clean-air ratio, matching what
        the calibration procedure would compute, so an uncalibrated simulator
        still produces coherent ratios.
        """
        cal = load_calibration()
        if cal.get(key):
            return cal[key]
        rl = config.RL_NH3 if key == "ro_nh3" else config.RL_H2S
        ratio = (config.NH3_CLEAN_AIR_RATIO if key == "ro_nh3"
                 else config.H2S_CLEAN_AIR_RATIO)
        return rl * 2.0 / ratio

    def read_gas(self) -> Reading:
        nh3_raw, h2s_raw = self.read_raw()
        return _convert(nh3_raw, h2s_raw)

    def read_weight_grams(self) -> float:
        if "loadcell" in self._failed:
            raise HardwareError("Load cell not responding")
        if self._weight == 0:
            return random.uniform(-1.5, 1.5)      # idle noise
        return self._weight + random.uniform(-2, 2)

    def tare(self) -> None:
        pass

    def set_fan(self, on: bool) -> None:
        self._fan_on = on

    def self_test(self) -> list[str]:
        problems = []
        try:
            nh3_raw, h2s_raw = self.read_raw()
            if nh3_raw == 0:
                problems.append("NH3 sensor reading zero")
            if h2s_raw == 0:
                problems.append("H2S sensor reading zero")
        except HardwareError as e:
            problems.append(str(e))
        try:
            self.read_weight_grams()
        except HardwareError as e:
            problems.append(str(e))
        return problems


# ─── Real ───────────────────────────────────────────────────────────────────

class Mcp3008Hardware(Hardware):
    """
    MCP3008 ADC over SPI, HX711 load cell, GPIO fan control.

    UNTESTED. Written from the datasheets and standard library usage, and not
    verified against assembled hardware. In particular, self_test cannot
    distinguish a failed sensor from a sensor legitimately reading at a rail
    until the real failure signatures have been observed.

    Requires: adafruit-circuitpython-mcp3xxx, hx711 (or equivalent), RPi.GPIO
    """

    NH3_CHANNEL = 0
    H2S_CHANNEL = 1
    FAN_PIN = 18            # TBD — depends on wiring

    def __init__(self):
        import board
        import busio
        import digitalio
        import adafruit_mcp3xxx.mcp3008 as MCP
        from adafruit_mcp3xxx.analog_in import AnalogIn

        spi = busio.SPI(clock=board.SCK, MISO=board.MISO, MOSI=board.MOSI)
        cs = digitalio.DigitalInOut(board.D5)      # TBD — depends on wiring
        self._mcp = MCP.MCP3008(spi, cs)
        self._nh3 = AnalogIn(self._mcp, self.NH3_CHANNEL)
        self._h2s = AnalogIn(self._mcp, self.H2S_CHANNEL)

        # Load cell. The specific library depends on what is installed; this
        # is one common choice.
        from hx711 import HX711
        self._hx = HX711(dout_pin=5, pd_sck_pin=6)   # TBD — wiring
        self._hx.zero()

        import RPi.GPIO as GPIO
        self._gpio = GPIO
        GPIO.setmode(GPIO.BCM)
        GPIO.setup(self.FAN_PIN, GPIO.OUT)
        GPIO.output(self.FAN_PIN, GPIO.LOW)

    def read_raw(self) -> tuple[int, int]:
        try:
            # AnalogIn reports 16-bit; the MCP3008 is 10-bit.
            return self._nh3.value >> 6, self._h2s.value >> 6
        except Exception as e:
            raise HardwareError(f"ADC read failed: {e}") from e

    def read_gas(self) -> Reading:
        nh3_raw, h2s_raw = self.read_raw()
        return _convert(nh3_raw, h2s_raw)

    def read_weight_grams(self) -> float:
        try:
            return float(self._hx.get_weight_mean(readings=5))
        except Exception as e:
            raise HardwareError(f"Load cell read failed: {e}") from e

    def tare(self) -> None:
        self._hx.zero()

    def set_fan(self, on: bool) -> None:
        self._gpio.output(self.FAN_PIN, self._gpio.HIGH if on else self._gpio.LOW)

    def self_test(self) -> list[str]:
        problems = []
        try:
            nh3_raw, h2s_raw = self.read_raw()
            # A sensor pinned at either rail is not producing a measurement.
            # Whether this reliably indicates failure is UNVERIFIED.
            if nh3_raw <= 1 or nh3_raw >= 1022:
                problems.append(f"NH3 sensor at rail (raw {nh3_raw})")
            if h2s_raw <= 1 or h2s_raw >= 1022:
                problems.append(f"H2S sensor at rail (raw {h2s_raw})")
        except HardwareError as e:
            problems.append(str(e))
        try:
            self.read_weight_grams()
        except HardwareError as e:
            problems.append(str(e))
        return problems

    def close(self) -> None:
        try:
            self.set_fan(False)
            self._gpio.cleanup()
        except Exception:
            pass


# ─── Shared conversion ──────────────────────────────────────────────────────

def _convert(nh3_raw: int, h2s_raw: int) -> Reading:
    """
    Raw ADC counts to ppm, using the stored Ro.

    ppm is None where the sensor is at a rail (no valid resistance) or where
    the device has not been calibrated. Both cases mean the concentration is
    unknown, and None says so rather than substituting a number.
    """
    cal = load_calibration()
    now = time.time()

    nh3_ppm = None
    h2s_ppm = None

    nh3_v = adc_to_voltage(nh3_raw)
    nh3_rs = voltage_to_rs(nh3_v, config.RL_NH3)
    if nh3_rs is not None and cal.get("ro_nh3"):
        ratio = nh3_rs / cal["ro_nh3"]
        nh3_ppm = rs_ro_to_ppm(ratio, config.NH3_CURVE_A, config.NH3_CURVE_B)

    h2s_v = adc_to_voltage(h2s_raw)
    h2s_rs = voltage_to_rs(h2s_v, config.RL_H2S)
    if h2s_rs is not None and cal.get("ro_h2s"):
        ratio = h2s_rs / cal["ro_h2s"]
        h2s_ppm = rs_ro_to_ppm(ratio, config.H2S_CURVE_A, config.H2S_CURVE_B)

    return Reading(nh3_ppm, h2s_ppm, nh3_raw, h2s_raw, now)


def create_hardware() -> Hardware:
    """The configured hardware implementation."""
    if config.SIMULATE_HARDWARE:
        return SimulatedHardware()
    return Mcp3008Hardware()
