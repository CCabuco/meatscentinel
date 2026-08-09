"""
Mock hardware layer.

Lets the whole app run and be demoed on a regular laptop (no GPIO/SPI/RPi
present). Used automatically when hardware_mode == "mock", or when
hardware_mode == "auto" and real peripheral libraries/hardware aren't found.
"""
import random
import time


class MockUltrasonicSensor:
    """Simulates HC-SR04. Starts 'empty', then a sample can be toggled in."""

    def __init__(self, *_, **__):
        self._sample_present = False

    def simulate_place_sample(self):
        self._sample_present = True

    def simulate_remove_sample(self):
        self._sample_present = False

    def distance_cm(self) -> float:
        # Empty chamber ~ 40cm away, sample present ~ 4cm away, with jitter.
        base = 4.0 if self._sample_present else 40.0
        return max(0.5, base + random.uniform(-0.5, 0.5))

    def close(self):
        pass


class MockGasSensorArray:
    """Simulates MQ-135 (NH3) / MQ-136 (H2S) readings via a fake ADC."""

    def __init__(self, *_, spoiled_bias: float = 0.0, **__):
        # spoiled_bias lets a demo deliberately trend toward "Spoiled"
        self._spoiled_bias = spoiled_bias

    def warmup(self, seconds: float):
        time.sleep(min(seconds, 0.2))  # don't actually block demos for long

    def read_nh3_ppm(self) -> float:
        base = 8.0 + self._spoiled_bias * 20.0
        return max(0.0, base + random.uniform(-1.5, 1.5))

    def read_h2s_ppm(self) -> float:
        base = 1.5 + self._spoiled_bias * 5.0
        return max(0.0, base + random.uniform(-0.4, 0.4))

    def close(self):
        pass


class MockFan:
    """Simulates the exhaust fan relay."""

    def __init__(self, *_, **__):
        self.is_active = False

    def on(self):
        self.is_active = True

    def off(self):
        self.is_active = False

    def close(self):
        pass
